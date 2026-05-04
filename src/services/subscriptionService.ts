import { db } from '../db';
import { AppError } from '../errors/AppError';
import { getPlanCycleFromProductId, PlanCycle } from '../utils/iapProducts';
import { IapVerifyResult } from '../lib/iap/types';
import { verifyApplePurchase } from '../lib/iap/appleVerify';
import { verifyGooglePurchase } from '../lib/iap/googleVerify';
import { logger } from '../lib/logger';
import { recordSystemEvent } from '../lib/systemEvents';

// ─── Types ────────────────────────────────────────────────────────────────────

export async function refreshGoogleSubscriptionByPurchaseToken(
  purchaseToken: string
): Promise<void> {
  const rowResult = await db.query(
    `
    SELECT id, product_id
      FROM club_subscriptions
     WHERE platform = 'android'
       AND purchase_token = $1
     ORDER BY updated_at DESC
     LIMIT 1
    `,
    [purchaseToken]
  );

  if (rowResult.rowCount === 0) {
    logger.warn('[subscription] refresh skipped, no row found', {
      purchaseToken,
    });
    void recordSystemEvent({
      category: 'subscription',
      event_type: 'webhook_no_local_subscription',
      event_status: 'failure',
      platform: 'android',
      purchase_token: purchaseToken,
      message: 'refresh skipped, no local subscription row found',
    });
    return;
  }

  const row = rowResult.rows[0] as {
    id: string;
    product_id: string;
  };

  const verifyResult = await verifyGooglePurchase({
    productId: row.product_id,
    purchaseToken,
  });

  const status = verifyResult.valid ? 'active' : 'invalid';
  const startedAt =
    typeof verifyResult.purchaseDateMs === 'number'
      ? new Date(verifyResult.purchaseDateMs)
      : null;
  const expiresAt =
    typeof verifyResult.expiresAtMs === 'number'
      ? new Date(verifyResult.expiresAtMs)
      : null;

  await db.query(
    `
    UPDATE club_subscriptions
       SET status = $1,
           order_id = COALESCE($2, order_id),
           starts_at = COALESCE($3, starts_at),
           ends_at = coalesce($4, ends_at),
           verification_payload = COALESCE($5::jsonb, verification_payload),
           updated_at = NOW()
     WHERE id = $6
    `,
    [
      status,
      verifyResult.orderId ?? null,
      startedAt,
      expiresAt,
      verifyResult.raw ? JSON.stringify(verifyResult.raw) : null,
      row.id,
    ]
  );

  void recordSystemEvent({
    category: 'subscription',
    event_type: 'subscription_refreshed',
    event_status: 'info',
    platform: 'android',
    purchase_token: purchaseToken,
    related_subscription_id: row.id,
    details: {
      status,
      expiresAt,
    },
  });
}

/** Normalised view of a club_subscriptions row returned to callers. */
export interface SubscriptionRecord {
  id: string;
  clubId: string;
  platform: 'ios' | 'android';
  plan: PlanCycle;
  status: 'active' | 'scheduled' | 'expired' | 'canceled';
  productId: string;
  purchasedByMembershipId: string;
  startsAt: Date | null;
  endsAt: Date | null;
  transactionId: string | null;
  originalTransactionId: string | null;
  purchaseToken: string | null;
  orderId: string | null;
  autoRenews: boolean | null;
  createdAt: Date;
}

export interface ClubProStatus {
  isPro: boolean;
  activeSubscription: SubscriptionRecord | null;
  scheduledSubscription: SubscriptionRecord | null;
}

export interface VerifyPurchaseInput {
  clubId: string;
  /** membership.id of the actor triggering the purchase */
  actorMemberId: string;
  platform: 'ios' | 'android';
  productId: string;

  // iOS
  receiptData?: string;
  transactionId?: string;
  originalTransactionId?: string;

  // Android
  purchaseToken?: string;
  orderId?: string;

  // Parsed provider payload to store
  verificationPayload?: unknown;
}

export interface VerifyPurchaseResult {
  subscription: SubscriptionRecord;
  idempotent: boolean;
}

type QueryResultRow = Record<string, unknown>;

type QueryResult = {
  rows: QueryResultRow[];
  rowCount: number;
};

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<QueryResult>;
};

type TransactionalClient = Queryable & {
  release: () => void;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function assertUserBelongsToClub(
  memberId: string,
  clubId: string,
  client: Queryable = db
): Promise<void> {
  const result = await client.query(
    `SELECT id
     FROM memberships
     WHERE id = $1
       AND club_id = $2
       AND status = 'active'`,
    [memberId, clubId]
  );

  if (result.rowCount === 0) {
    throw new AppError(403, 'FORBIDDEN', 'Membership not found for this club');
  }
}

function addPlanInterval(from: Date, plan: PlanCycle): Date {
  const d = new Date(from);
  if (plan === 'monthly') {
    d.setMonth(d.getMonth() + 1);
  } else {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d;
}

function rowToRecord(row: Record<string, unknown>): SubscriptionRecord {
  return {
    id: row.id as string,
    clubId: row.club_id as string,
    platform: row.platform as 'ios' | 'android',
    plan: row.plan as PlanCycle,
    status: row.status as SubscriptionRecord['status'],
    productId: row.product_id as string,
    purchasedByMembershipId: row.purchased_by_membership_id as string,
    startsAt: row.starts_at ? new Date(row.starts_at as string) : null,
    endsAt: row.ends_at ? new Date(row.ends_at as string) : null,
    transactionId: (row.transaction_id as string | null) ?? null,
    originalTransactionId:
      (row.original_transaction_id as string | null) ?? null,
    purchaseToken: (row.purchase_token as string | null) ?? null,
    orderId: (row.order_id as string | null) ?? null,
    autoRenews: typeof row.auto_renews === 'boolean' ? row.auto_renews : null,
    createdAt: new Date(row.created_at as string),
  };
}

function assertExistingSubscriptionBelongsToClub(
  row: Record<string, unknown>,
  clubId: string
): SubscriptionRecord {
  const existing = rowToRecord(row);

  if (existing.clubId !== clubId) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'This purchase is already linked to another club'
    );
  }

  return existing;
}

function isUniqueViolation(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;

  return code === '23505';
}

/**
 * Returns true when a PostgreSQL unique violation is specifically on the
 * idx_csub_one_active_per_club partial index, meaning a concurrent request
 * slipped past the code-level guard and tried to insert a second active
 * row for the same club.
 */
function isActiveClubSubscriptionConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505' &&
    'constraint' in error &&
    (error as { constraint?: unknown }).constraint === 'idx_csub_one_active_per_club'
  );
}

/**
 * For this app, entitlement is club-level, not store-account-level.
 * We therefore derive the club entitlement window from the club plan chain:
 * - if a club already has active / scheduled time in the future, the new plan is queued
 * - otherwise it starts immediately
 *
 * We intentionally do NOT directly use provider expiresAtMs as the final club
 * endsAt when creating the row, because store expiry is tied to charge time while
 * club entitlement may be deferred behind an already-active club subscription.
 */
function calculateClubEntitlementWindow(
  now: Date,
  plan: PlanCycle,
  lastEndsAt: Date | null,
  providerStartsAt?: Date | null,
  providerEndsAt?: Date | null
): {
  startsAt: Date;
  endsAt: Date;
  status: 'active' | 'scheduled';
} {
  let startsAt: Date;
  let status: 'active' | 'scheduled';

  if (lastEndsAt && lastEndsAt > now) {
    startsAt = lastEndsAt;
    status = 'scheduled';
  } else {
    startsAt = providerStartsAt ?? now;
    status = 'active';
  }

  // If active, use provider expiry — but only if it's still in the future.
  // If providerEndsAt is already past (e.g. sandbox timing delay), fall back to
  // addPlanInterval so the subscription is not immediately expired on creation.
  const useProviderEndsAt =
    status === 'active' && providerEndsAt != null && providerEndsAt > now;
  const endsAt = useProviderEndsAt
    ? providerEndsAt!
    : addPlanInterval(startsAt, plan);

  return { startsAt, endsAt, status };
}

async function findExistingSubscriptionByVerifiedIds(
  clubId: string,
  ids: {
    transactionId?: string | null;
    originalTransactionId?: string | null;
    purchaseToken?: string | null;
  },
  client: Queryable = db
): Promise<SubscriptionRecord | null> {
  const { transactionId, originalTransactionId, purchaseToken } = ids;

  if (transactionId) {
    const r = await client.query(
      `SELECT *
         FROM club_subscriptions
        WHERE transaction_id = $1
          AND status NOT IN ('expired')
        LIMIT 1`,
      [transactionId]
    );

    if (r.rows[0]) {
      return assertExistingSubscriptionBelongsToClub(r.rows[0], clubId);
    }
  }

  if (originalTransactionId) {
    // Always check by originalTransactionId — regardless of whether transactionId
    // is also provided. iOS renewals carry a new transactionId but the same
    // originalTransactionId, so we must match on OT to prevent duplicate rows.
    //
    // Exclude 'expired' rows: an expired row + a valid Apple receipt means the
    // subscription was renewed (webhook may have missed it) or reactivated.
    // A new row should be created so the club regains Pro status correctly.
    const r = await client.query(
      `SELECT *
         FROM club_subscriptions
        WHERE original_transaction_id = $1
          AND status NOT IN ('expired')
        ORDER BY created_at DESC
        LIMIT 1`,
      [originalTransactionId]
    );

    if (r.rows[0]) {
      return assertExistingSubscriptionBelongsToClub(r.rows[0], clubId);
    }
  }

  if (purchaseToken) {
    const r = await client.query(
      `SELECT *
         FROM club_subscriptions
        WHERE purchase_token = $1
        LIMIT 1`,
      [purchaseToken]
    );

    if (r.rows[0]) {
      return assertExistingSubscriptionBelongsToClub(r.rows[0], clubId);
    }
  }

  return null;
}

async function withDbTransaction<T>(
  fn: (client: TransactionalClient) => Promise<T>
): Promise<T> {
  const client = (await db.connect()) as TransactionalClient;

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('[subscription] rollback failed', {
        error: rollbackError,
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getActiveSubscriptionForClub(
  clubId: string,
  at: Date = new Date(),
  client: Queryable = db
): Promise<SubscriptionRecord | null> {
  const result = await client.query(
    `SELECT *
     FROM club_subscriptions
     WHERE club_id = $1
       AND status IN ('active', 'canceled')
       AND (starts_at <= $2 OR starts_at IS NULL)
       AND (ends_at > $2 OR ends_at IS NULL)
     ORDER BY starts_at DESC
     LIMIT 1`,
    [clubId, at]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const record = rowToRecord(row);

  if (!record.endsAt) {
    logger.warn('[subscription] Active subscription is missing ends_at', {
      clubId,
      subscriptionId: record.id,
    });
  }

  return record;
}

export async function getScheduledSubscriptionForClub(
  clubId: string,
  at: Date = new Date(),
  client: Queryable = db
): Promise<SubscriptionRecord | null> {
  const result = await client.query(
    `SELECT *
     FROM club_subscriptions
     WHERE club_id = $1
       AND status = 'scheduled'
       AND (starts_at > $2 OR starts_at IS NULL)
     ORDER BY starts_at ASC
     LIMIT 1`,
    [clubId, at]
  );

  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

export async function getLastExpiredSubscriptionForClub(
  clubId: string,
  client: Queryable = db
): Promise<SubscriptionRecord | null> {
  const result = await client.query(
    `SELECT *
       FROM club_subscriptions
      WHERE club_id = $1
        AND status = 'expired'
      ORDER BY ends_at DESC
      LIMIT 1`,
    [clubId]
  );
  return result.rows[0] ? rowToRecord(result.rows[0]) : null;
}

// ─── Refresh / expiry sweep ───────────────────────────────────────────────────

async function refreshClubSubscriptionStatusesInTxn(
  clubId: string,
  client: Queryable
): Promise<void> {
  const now = new Date();

  // Lock the club row so refresh + scheduling is serialized per club.
  await client.query(
    `SELECT id
     FROM clubs
     WHERE id = $1
     FOR UPDATE`,
    [clubId]
  );

  // 1) Expire active subscriptions whose entitlement has ended
  await client.query(
    `UPDATE club_subscriptions
     SET status = 'expired',
         updated_at = NOW()
     WHERE club_id = $1
       AND status IN ('active', 'canceled')
       AND ends_at <= $2`,
    [clubId, now]
  );

  // 2) If a valid active subscription still exists, keep club as Pro
  const active = await client.query(
    `SELECT id, ends_at
     FROM club_subscriptions
     WHERE club_id = $1
       AND status IN ('active', 'canceled')
       AND starts_at <= $2
       AND ends_at > $2
     ORDER BY ends_at DESC
     LIMIT 1`,
    [clubId, now]
  );

  if (active.rows[0]) {
    await client.query(
      `UPDATE clubs
       SET pro_status = 'pro',
           pro_expires_at = $1,
           pro_updated_at = NOW()
       WHERE id = $2`,
      [active.rows[0].ends_at, clubId]
    );
    return;
  }

  // 3) Activate the earliest scheduled subscription that should begin now
  const next = await client.query(
    `SELECT id, ends_at
     FROM club_subscriptions
     WHERE club_id = $1
       AND status = 'scheduled'
       AND starts_at <= $2
     ORDER BY starts_at ASC
     LIMIT 1`,
    [clubId, now]
  );

  if (next.rows[0]) {
    await client.query(
      `UPDATE club_subscriptions
       SET status = 'active',
           updated_at = NOW()
       WHERE id = $1`,
      [next.rows[0].id]
    );

    await client.query(
      `UPDATE clubs
       SET pro_status = 'pro',
           pro_expires_at = $1,
           pro_updated_at = NOW()
       WHERE id = $2`,
      [next.rows[0].ends_at, clubId]
    );

    void recordSystemEvent({
      category: 'subscription',
      event_type: 'subscription_updated',
      event_status: 'info',
      club_id: clubId,
      related_subscription_id: next.rows[0].id as string,
      message: 'scheduled subscription activated',
    });

    return;
  }

  // 4) No active and nothing scheduled to start — club is free
  await client.query(
    `UPDATE clubs
     SET pro_status = 'free',
         pro_expires_at = NULL,
         pro_updated_at = NOW()
     WHERE id = $1`,
    [clubId]
  );
}

export async function refreshClubSubscriptionStatuses(
  clubId: string,
  client?: Queryable
): Promise<void> {
  if (client) {
    await refreshClubSubscriptionStatusesInTxn(clubId, client);
    return;
  }

  await withDbTransaction(async (tx) => {
    await refreshClubSubscriptionStatusesInTxn(clubId, tx);
  });
}

// ─── Pro status ───────────────────────────────────────────────────────────────

export async function getClubProStatus(clubId: string): Promise<ClubProStatus> {
  return withDbTransaction(async (client) => {
    await refreshClubSubscriptionStatusesInTxn(clubId, client);

    const now = new Date();
    const activeSubscription = await getActiveSubscriptionForClub(
      clubId,
      now,
      client
    );
    const scheduledSubscription = await getScheduledSubscriptionForClub(
      clubId,
      now,
      client
    );

    return {
      isPro: activeSubscription !== null,
      activeSubscription,
      scheduledSubscription,
    };
  });
}

// ─── Core purchase handler ────────────────────────────────────────────────────

export async function createOrScheduleSubscriptionForClub(
  input: VerifyPurchaseInput
): Promise<VerifyPurchaseResult> {
  const {
    clubId,
    actorMemberId,
    platform,
    productId,
    receiptData,
    transactionId,
    originalTransactionId,
    purchaseToken,
    orderId,
    verificationPayload,
  } = input;

  const plan = getPlanCycleFromProductId(productId);
  if (!plan) {
    throw new AppError(
      400,
      'INVALID_INPUT',
      `Unknown product ID: ${productId}`
    );
  }

  // 1) Actor must belong to the club
  await assertUserBelongsToClub(actorMemberId, clubId);

  // 2) Fast-path idempotency checks before provider call.
  //
  // Only check by exact identifiers (transactionId, purchaseToken) at this stage.
  // The originalTransactionId check is intentionally deferred to the post-verify
  // in-transaction step so that iOS renewals (new transactionId, same
  // originalTransactionId) still go through Apple verification before we return
  // an idempotent result. This ensures we never skip Apple verify for renewals.
  const fastExisting = await findExistingSubscriptionByVerifiedIds(clubId, {
    transactionId,
    originalTransactionId: null, // deferred to post-verify
    purchaseToken,
  });

  if (fastExisting) {
    logger.info('[subscription] purchase idempotent (fast path)', {
      clubId,
      platform,
      productId,
      subscriptionId: fastExisting.id,
    });
    void recordSystemEvent({
      category: 'subscription',
      event_type: 'purchase_idempotent',
      event_status: 'info',
      club_id: clubId,
      membership_id: actorMemberId,
      platform,
      product_id: productId,
      purchase_token: purchaseToken ?? null,
      transaction_id: transactionId ?? null,
      original_transaction_id: originalTransactionId ?? null,
      related_subscription_id: fastExisting.id,
      message: 'purchase already exists — fast-path idempotent return',
    });
    return { subscription: fastExisting, idempotent: true };
  }

  // 3) Verify with provider
  let verifyResult: IapVerifyResult;

  if (platform === 'ios') {
    if (!receiptData) {
      throw new AppError(
        400,
        'INVALID_INPUT',
        'receiptData is required for iOS'
      );
    }

    logger.info('[subscription] iOS verify call start', {
      clubId,
      platform,
      productId,
      transactionId: transactionId ?? null,
      originalTransactionId: originalTransactionId ?? null,
    });

    verifyResult = await verifyApplePurchase({
      productId,
      receiptData,
      transactionId,
      originalTransactionId,
    });

    logger.info('[subscription] iOS verify call result', {
      clubId,
      platform,
      productId,
      transactionId: verifyResult.transactionId ?? transactionId ?? null,
      originalTransactionId:
        verifyResult.originalTransactionId ?? originalTransactionId ?? null,
      verificationMode: verifyResult.verificationMode ?? 'real',
      appleVerificationSucceeded: verifyResult.valid,
      errorCode: verifyResult.errorCode ?? null,
      errorMessage: verifyResult.valid ? null : (verifyResult.errorMessage ?? null),
    });
  } else {
    if (!purchaseToken) {
      throw new AppError(
        400,
        'INVALID_INPUT',
        'purchaseToken is required for Android'
      );
    }

    logger.info('[subscription] Android verify call start', {
      clubId,
      platform,
      productId,
      purchaseToken: purchaseToken.slice(-8),
      orderId: orderId ?? null,
    });

    verifyResult = await verifyGooglePurchase({
      productId,
      purchaseToken,
      orderId,
    });

    logger.info('[subscription] Android verify call result', {
      clubId,
      platform,
      productId,
      orderId: verifyResult.orderId ?? orderId ?? null,
      androidVerificationSucceeded: verifyResult.valid,
      errorMessage: verifyResult.valid ? null : (verifyResult.errorMessage ?? null),
    });
  }

  if (!verifyResult.valid) {
    void recordSystemEvent({
      category: 'subscription',
      event_type: 'verify_failed',
      event_status: 'failure',
      club_id: clubId,
      membership_id: actorMemberId,
      platform,
      product_id: productId,
      purchase_token: purchaseToken ?? null,
      transaction_id: transactionId ?? null,
      original_transaction_id: originalTransactionId ?? null,
      order_id: orderId ?? null,
      message: verifyResult.errorMessage ?? 'verify returned invalid',
      details: {
        valid: false,
        errorCode: verifyResult.errorCode ?? 'VERIFY_RESULT_INVALID',
        verificationMode: verifyResult.verificationMode ?? 'real',
        providerState:
          verifyResult.raw &&
          typeof verifyResult.raw === 'object' &&
          'subscriptionState' in verifyResult.raw
            ? (verifyResult.raw as { subscriptionState?: unknown })
                .subscriptionState
            : null,
      },
    });

    // Server misconfiguration errors: return 503 so the client knows
    // this is not a payment problem and can surface a clear message.
    if (verifyResult.errorCode === 'IOS_VERIFICATION_NOT_CONFIGURED') {
      throw new AppError(
        503,
        'IOS_VERIFICATION_NOT_CONFIGURED',
        'iOS in-app purchase verification is not configured on this server'
      );
    }
    if (verifyResult.errorCode === 'IAP_MOCK_IN_PRODUCTION') {
      throw new AppError(
        503,
        'IAP_MOCK_IN_PRODUCTION',
        'IAP mock mode is not allowed in production — contact the server operator'
      );
    }

    throw new AppError(
      402,
      'PAYMENT_REQUIRED',
      verifyResult.errorMessage ?? 'IAP verification failed'
    );
  }

  // Provider-returned ids are more trustworthy than client-provided ids
  const finalTransactionId =
    verifyResult.transactionId ?? transactionId ?? null;
  const finalOriginalTransactionId =
    verifyResult.originalTransactionId ?? originalTransactionId ?? null;
  const finalPurchaseToken =
    verifyResult.purchaseToken ?? purchaseToken ?? null;
  const finalOrderId = verifyResult.orderId ?? orderId ?? null;

  const providerStartsAt = verifyResult.purchaseDateMs
    ? new Date(verifyResult.purchaseDateMs)
    : null;
  const providerEndsAt = verifyResult.expiresAtMs
    ? new Date(verifyResult.expiresAtMs)
    : null;

  // Build the stored verification payload.
  // The `_iapVerification` key embeds the verification mode so DB rows can be
  // audited (e.g. queried for `verification_payload->>'_iapVerification'`).
  // Mock-verified rows will have `verificationMode: 'mock'` here.
  const storedPayload = {
    ...(typeof verificationPayload === 'object' && verificationPayload !== null
      ? (verificationPayload as object)
      : {}),
    _iapVerification: {
      verificationMode: verifyResult.verificationMode ?? 'real',
      ...(verifyResult.appleEnvironment ? { appleEnvironment: verifyResult.appleEnvironment } : {}),
      platform,
      productId: verifyResult.productId,
      transactionId: finalTransactionId,
      originalTransactionId: finalOriginalTransactionId,
    },
  };

  // Record verification success in system_events before opening the DB transaction.
  void recordSystemEvent({
    category: 'subscription',
    event_type: 'verify_success',
    event_status: 'success',
    club_id: clubId,
    membership_id: actorMemberId,
    platform,
    product_id: verifyResult.productId ?? productId,
    purchase_token: finalPurchaseToken,
    transaction_id: finalTransactionId,
    original_transaction_id: finalOriginalTransactionId,
    order_id: finalOrderId,
    message: `${platform} IAP verification succeeded`,
    details: {
      verificationMode: verifyResult.verificationMode ?? 'real',
      expiresAt: providerEndsAt?.toISOString() ?? null,
      autoRenewEnabled: verifyResult.autoRenewEnabled ?? null,
    },
  });

  const client = (await db.connect()) as TransactionalClient;

  try {
    await client.query('BEGIN');

    // Re-check membership inside txn
    await assertUserBelongsToClub(actorMemberId, clubId, client);

    // Serialize operations per club to avoid overlapping entitlement windows.
    await client.query(
      `SELECT id
       FROM clubs
       WHERE id = $1
       FOR UPDATE`,
      [clubId]
    );

    // 4) Cross-club / idempotency checks inside txn using verified ids
    const existing = await findExistingSubscriptionByVerifiedIds(
      clubId,
      {
        transactionId: finalTransactionId,
        originalTransactionId: finalOriginalTransactionId,
        purchaseToken: finalPurchaseToken,
      },
      client
    );

    if (existing) {
      await client.query('COMMIT');
      logger.info('[subscription] purchase idempotent (in-txn)', {
        clubId,
        platform,
        productId,
        subscriptionId: existing.id,
      });
      void recordSystemEvent({
        category: 'subscription',
        event_type: 'purchase_idempotent',
        event_status: 'info',
        club_id: clubId,
        membership_id: actorMemberId,
        platform,
        product_id: productId,
        purchase_token: finalPurchaseToken,
        transaction_id: finalTransactionId,
        original_transaction_id: finalOriginalTransactionId,
        related_subscription_id: existing.id,
        message: 'purchase already exists — in-txn idempotent return',
      });
      return { subscription: existing, idempotent: true };
    }

    // 4.5) Club-level duplicate active subscription guard
    //
    // At this point we know this is a genuinely new purchase identity — step 4
    // found no matching row. Before inserting, verify the club does not already
    // have a currently-entitled subscription from a *different* identity.
    //
    // 'active'   = billing current and auto-renewing (or manually active)
    // 'canceled' = user disabled auto-renew but entitlement window not yet over
    //
    // Both statuses represent unexpired Pro time, so both block a new purchase.
    // Checking inside the transaction (after the clubs FOR UPDATE lock) prevents
    // a race where two members purchase simultaneously.
    {
      const guardNow = new Date();
      const conflictResult = await client.query(
        `SELECT id
           FROM club_subscriptions
          WHERE club_id = $1
            AND status IN ('active', 'canceled')
            AND (starts_at IS NULL OR starts_at <= $2)
            AND (ends_at IS NULL OR ends_at > $2)
          LIMIT 1`,
        [clubId, guardNow]
      );

      if (conflictResult.rows[0]) {
        const conflictingId = conflictResult.rows[0].id as string;

        logger.warn('[subscription] duplicate active subscription blocked', {
          clubId,
          actorMemberId,
          platform,
          productId,
          conflictingSubscriptionId: conflictingId,
        });

        void recordSystemEvent({
          category: 'subscription',
          event_type: 'duplicate_active_subscription_blocked',
          event_status: 'info',
          club_id: clubId,
          membership_id: actorMemberId,
          platform,
          plan,
          product_id: productId,
          transaction_id: finalTransactionId,
          original_transaction_id: finalOriginalTransactionId,
          purchase_token: finalPurchaseToken ?? null,
          related_subscription_id: conflictingId,
          message: 'purchase blocked — club already has an active Pro subscription',
          details: { existingSubscriptionId: conflictingId },
        });

        throw new AppError(
          409,
          'CLUB_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
          'This club already has an active Pro subscription. No additional purchase is needed.',
          { existingSubscriptionId: conflictingId }
        );
      }
    }

    // 5) Refresh current statuses inside the same txn
    await refreshClubSubscriptionStatusesInTxn(clubId, client);

    const now = new Date();

    const last = await client.query(
      `SELECT ends_at
       FROM club_subscriptions
       WHERE club_id = $1
         AND status IN ('active', 'scheduled')
         AND ends_at > $2
       ORDER BY ends_at DESC
       LIMIT 1`,
      [clubId, now]
    );

    const lastEndsAt: Date | null = last.rows[0]?.ends_at
      ? new Date(last.rows[0].ends_at as string)
      : null;

    const { startsAt, endsAt, status } = calculateClubEntitlementWindow(
      now,
      plan,
      lastEndsAt,
      providerStartsAt,
      providerEndsAt
    );

    // 6) Insert subscription (UPSERT: re-verification of an expired row with the same
    //    transaction_id updates it in-place instead of hitting the unique constraint)
    const insert = await client.query(
      `INSERT INTO club_subscriptions
         (club_id,
          platform,
          plan,
          status,
          product_id,
          purchased_by_membership_id,
          starts_at,
          ends_at,
          transaction_id,
          original_transaction_id,
          receipt_data,
          purchase_token,
          order_id,
          auto_renews,
          verification_payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (transaction_id) WHERE transaction_id IS NOT NULL
       DO UPDATE SET
         status       = EXCLUDED.status,
         starts_at    = EXCLUDED.starts_at,
         ends_at      = EXCLUDED.ends_at,
         auto_renews  = EXCLUDED.auto_renews,
         receipt_data = EXCLUDED.receipt_data,
         updated_at   = NOW()
       RETURNING *`,
      [
        clubId,
        platform,
        plan,
        status,
        productId,
        actorMemberId,
        startsAt,
        endsAt,
        finalTransactionId,
        finalOriginalTransactionId,
        platform === 'ios' ? (receiptData ?? null) : null,
        finalPurchaseToken,
        finalOrderId,
        verifyResult.autoRenewEnabled ?? null,
        storedPayload,
      ]
    );

    const subscription = rowToRecord(insert.rows[0]);

    // 7) Update clubs Pro cache
    if (status === 'active') {
      await client.query(
        `UPDATE clubs
         SET pro_status = 'pro',
             pro_expires_at = CASE
               WHEN pro_expires_at IS NULL THEN $1
               ELSE GREATEST(pro_expires_at, $1)
             END,
             pro_updated_at = NOW()
         WHERE id = $2`,
        [endsAt, clubId]
      );
    } else {
      // Scheduled purchase should not shorten current cache.
      await client.query(
        `UPDATE clubs
         SET pro_updated_at = NOW()
         WHERE id = $1`,
        [clubId]
      );
    }

    await client.query('COMMIT');

    void recordSystemEvent({
      category: 'subscription',
      event_type:
        status === 'active' ? 'subscription_created' : 'subscription_scheduled',
      event_status: 'success',
      club_id: clubId,
      membership_id: actorMemberId,
      platform,
      plan,
      product_id: productId,
      purchase_token: finalPurchaseToken,
      transaction_id: finalTransactionId,
      original_transaction_id: finalOriginalTransactionId,
      order_id: finalOrderId,
      related_subscription_id: subscription.id,
      details: { status, idempotent: false },
    });

    return {
      subscription,
      idempotent: false,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    // AppErrors are intentional responses (409, 402, 403, etc.) — rethrow
    // immediately without fallback so they reach the error handler intact.
    if (error instanceof AppError) {
      throw error;
    }

    // A concurrent request slipped past the code-level guard and hit the
    // idx_csub_one_active_per_club partial unique index — surface as 409.
    if (isActiveClubSubscriptionConflict(error)) {
      logger.warn('[subscription] race: duplicate active subscription via DB index', {
        clubId,
        platform,
        productId,
      });
      void recordSystemEvent({
        category: 'subscription',
        event_type: 'duplicate_active_subscription_blocked',
        event_status: 'info',
        club_id: clubId,
        membership_id: actorMemberId,
        platform,
        plan,
        product_id: productId,
        transaction_id: finalTransactionId,
        original_transaction_id: finalOriginalTransactionId,
        purchase_token: finalPurchaseToken ?? null,
        message: 'purchase blocked by DB index — race condition prevented',
      });
      throw new AppError(
        409,
        'CLUB_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
        'This club already has an active Pro subscription. No additional purchase is needed.'
      );
    }

    if (process.env.NODE_ENV !== 'production') {
      logger.error(
        '[subscription] createOrScheduleSubscriptionForClub failed',
        {
          error,
          clubId,
          actorMemberId,
          platform,
          productId,
          transactionId: finalTransactionId,
          originalTransactionId: finalOriginalTransactionId,
          purchaseToken: finalPurchaseToken,
          orderId: finalOrderId,
        }
      );
    }

    // Graceful fallback for unique constraint races on transaction_id /
    // purchase_token — return idempotent rather than surfacing a 500.
    if (isUniqueViolation(error)) {
      const existing = await findExistingSubscriptionByVerifiedIds(clubId, {
        transactionId: finalTransactionId,
        originalTransactionId: finalOriginalTransactionId,
        purchaseToken: finalPurchaseToken,
      });

      if (existing) {
        return { subscription: existing, idempotent: true };
      }
    }

    throw error;
  } finally {
    client.release();
  }
}
