/**
 * Apple App Store Server Notifications v2 processing.
 *
 * Handles signed notification JWTs from Apple and maps them into the
 * existing club-level subscription lifecycle model.
 *
 * ─── Architecture notes ───────────────────────────────────────────────────────
 * Apple sends a POST request to our webhook endpoint with a JSON body:
 *   { "signedPayload": "<signed-JWT>" }
 *
 * The JWT payload contains:
 *   - notificationType  — e.g. 'DID_RENEW', 'EXPIRED', 'DID_CHANGE_RENEWAL_STATUS'
 *   - subtype           — e.g. 'AUTO_RENEW_DISABLED', 'VOLUNTARY', 'BILLING_FAILURE'
 *   - notificationUUID  — idempotency key (used for dedupe)
 *   - data.signedTransactionInfo  — nested JWT with transaction details
 *   - data.signedRenewalInfo      — nested JWT with renewal details
 *
 * ─── JWT signature verification ───────────────────────────────────────────────
 * All three JWTs (signedPayload, signedTransactionInfo, signedRenewalInfo) are
 * verified using verifyAndDecodeAppleJwt() in src/lib/iap/appleJwtVerify.ts.
 * Verification validates:
 *   - alg=ES256
 *   - x5c certificate chain terminates at our pinned Apple Root CA G3
 *   - each cert's validity period
 *   - JWT signature with the leaf certificate's public key
 * Any verification failure throws before any DB write or entitlement change.
 *
 * ─── Notification types handled ───────────────────────────────────────────────
 *   DID_RENEW             — renewal succeeded; extend ends_at, set auto_renews=true
 *   EXPIRED               — entitlement ended; mark row expired, refresh Pro
 *   GRACE_PERIOD_EXPIRED  — billing grace period ended; mark expired, refresh Pro
 *   REFUND / REVOKE       — purchase refunded; mark expired, refresh Pro
 *   DID_CHANGE_RENEWAL_STATUS + AUTO_RENEW_DISABLED — mark status=canceled, auto_renews=false
 *   DID_CHANGE_RENEWAL_STATUS + AUTO_RENEW_ENABLED  — restore status=active, auto_renews=true
 *   DID_FAIL_TO_RENEW     — renewal failed, grace period started; log only
 *   SUBSCRIBED            — initial subscription or resubscription; log only (row exists from verify)
 *   TEST                  — Apple test notification; log, return
 *   Others                — log + mark processed; no DB change
 *
 * ─── Required env vars ────────────────────────────────────────────────────────
 *   APPLE_BUNDLE_ID  — bundle identifier to validate against the notification payload
 *                      (optional but strongly recommended in production)
 */

import { db } from '../db';
import { logger } from '../lib/logger';
import { recordSystemEvent } from '../lib/systemEvents';
import { refreshClubSubscriptionStatuses } from './subscriptionService';
import { verifyAndDecodeAppleJwt } from '../lib/iap/appleJwtVerify';

// ─── Apple notification payload types ────────────────────────────────────────

interface AppleNotificationData {
  /** App bundle identifier */
  bundleId: string;
  bundleVersion?: string;
  /** 'Production' | 'Sandbox' */
  environment: string;
  /** Signed JWT containing AppleTransactionInfo */
  signedTransactionInfo: string;
  /** Signed JWT containing AppleRenewalInfo */
  signedRenewalInfo?: string;
}

interface AppleNotificationPayload {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  version?: string;
  /** Epoch ms of when Apple sent this notification */
  signedDate?: number;
  data?: AppleNotificationData;
  [key: string]: unknown;
}

interface AppleTransactionInfo {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  /** Epoch ms */
  purchaseDate: number;
  /** Epoch ms */
  originalPurchaseDate: number;
  /** Epoch ms — undefined if not a subscription */
  expiresDate?: number;
  /** Epoch ms — set when a refund or revocation happened */
  revocationDate?: number;
  revocationReason?: number;
  quantity?: number;
  type?: string;
  environment?: string;
  inAppOwnershipType?: string;
}

interface AppleRenewalInfo {
  originalTransactionId: string;
  productId: string;
  /** 0 = off, 1 = on */
  autoRenewStatus: number;
  autoRenewProductId?: string;
  expirationIntent?: number;
  isInBillingRetryPeriod?: boolean;
  renewalDate?: number;
  signedDate?: number;
}

// ─── In-memory notification dedupe (per process) ─────────────────────────────
// Mirrors the pattern in googleRtdnService. The DB event table is the durable
// audit trail; this cache only prevents processing the same UUID twice within
// one process lifetime.

const processedNotificationUUIDs = new Map<string, number>(); // uuid -> expiresAtMs

function cleanupProcessedUUIDs(): void {
  const now = Date.now();
  for (const [uuid, expiresAt] of processedNotificationUUIDs.entries()) {
    if (expiresAt <= now) processedNotificationUUIDs.delete(uuid);
  }
}

function wasNotificationProcessed(uuid: string): boolean {
  cleanupProcessedUUIDs();
  const expiresAt = processedNotificationUUIDs.get(uuid);
  return !!expiresAt && expiresAt > Date.now();
}

function markNotificationProcessed(uuid: string): void {
  cleanupProcessedUUIDs();
  // Keep for 24 hours — Apple may retry within this window
  processedNotificationUUIDs.set(uuid, Date.now() + 24 * 60 * 60 * 1000);
}


// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Persist an Apple webhook event for audit/debugging.
 * Uses ON CONFLICT DO NOTHING on notificationUUID to be idempotent.
 */
async function insertAppleWebhookEvent(params: {
  notificationUUID: string | null;
  notificationType: string | null;
  subtype: string | null;
  bundleId: string | null;
  productId: string | null;
  transactionId: string | null;
  originalTransactionId: string | null;
  environment: string | null;
  payload: unknown;
}): Promise<void> {
  // message_id is keyed on the UNIQUE index; notificationUUID is Apple's equivalent.
  await db.query(
    `
    INSERT INTO subscription_webhook_events (
      provider,
      message_id,
      package_name,
      product_id,
      purchase_token,
      original_transaction_id,
      notification_type_text,
      notification_subtype,
      event_time,
      payload
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9::jsonb)
    ON CONFLICT (message_id) DO NOTHING
    `,
    [
      'apple',
      params.notificationUUID,
      params.bundleId,
      params.productId,
      params.transactionId,
      params.originalTransactionId,
      params.notificationType,
      params.subtype ?? null,
      JSON.stringify(params.payload),
    ]
  );
}

/**
 * Find the most recent club_subscriptions row for an iOS original_transaction_id.
 * Returns the row plus its club_id for Pro cache refresh.
 */
async function findSubscriptionByOriginalTransactionId(
  originalTransactionId: string
): Promise<{ id: string; clubId: string; status: string } | null> {
  const result = await db.query(
    `
    SELECT id, club_id, status
      FROM club_subscriptions
     WHERE platform = 'ios'
       AND original_transaction_id = $1
     ORDER BY created_at DESC
     LIMIT 1
    `,
    [originalTransactionId]
  );

  if (!result.rows[0]) return null;

  const row = result.rows[0] as {
    id: string;
    club_id: string;
    status: string;
  };

  return { id: row.id, clubId: row.club_id, status: row.status };
}

// ─── Lifecycle update helpers ─────────────────────────────────────────────────

/**
 * Handle DID_RENEW: extend ends_at and update transaction_id to the latest.
 *
 * Apple does not issue a new purchase_token on renewal; the originalTransactionId
 * is the stable link. We update the existing row's expiry so the club Pro window
 * is extended without creating a duplicate entitlement row.
 */
async function handleRenewal(
  txInfo: AppleTransactionInfo,
  renewalInfo: AppleRenewalInfo | null
): Promise<void> {
  const { transactionId, originalTransactionId, productId } = txInfo;

  const existing = await findSubscriptionByOriginalTransactionId(
    originalTransactionId
  );

  if (!existing) {
    logger.warn('[apple-webhook] DID_RENEW: no subscription found', {
      originalTransactionId,
      transactionId,
      productId,
    });
    void recordSystemEvent({
      category: 'webhook',
      event_type: 'webhook_no_local_subscription',
      event_status: 'info',
      platform: 'ios',
      product_id: productId,
      transaction_id: transactionId,
      original_transaction_id: originalTransactionId,
      message: 'DID_RENEW: no club_subscriptions row found for originalTransactionId',
    });
    return;
  }

  // Guard: do not reactivate a subscription that has already been marked expired.
  // A DID_RENEW may arrive late (e.g., after a backend outage or Apple retry delay)
  // for a renewal period that has itself since passed. Applying it would silently
  // flip an expired row back to active with a stale ends_at in the past.
  // The new renewal period will have its own row (created via /verify or SUBSCRIBED).
  if (existing.status === 'expired') {
    logger.warn('[apple-webhook] DID_RENEW: subscription already expired, skipping reactivation', {
      subscriptionId: existing.id,
      originalTransactionId,
      transactionId,
    });
    void recordSystemEvent({
      category: 'webhook',
      event_type: 'webhook_skipped',
      event_status: 'info',
      platform: 'ios',
      product_id: productId,
      transaction_id: transactionId,
      original_transaction_id: originalTransactionId,
      related_subscription_id: existing.id,
      message: 'DID_RENEW: skipped — subscription already expired',
    });
    return;
  }

  const newEndsAt = txInfo.expiresDate ? new Date(txInfo.expiresDate) : null;
  const autoRenews =
    renewalInfo?.autoRenewStatus !== undefined
      ? renewalInfo.autoRenewStatus === 1
      : true;

  // Store the latest renewal transactionId in the payload for audit purposes.
  // We intentionally do NOT overwrite the `transaction_id` column because:
  //   a) It has a UNIQUE constraint — a second row created by a race would conflict.
  //   b) The `original_transaction_id` is the stable identifier for the renewal chain.
  //   c) The verify idempotency path uses `original_transaction_id` to detect renewals.
  const mergedPayload = {
    source: 'apple_notification',
    notificationType: 'DID_RENEW',
    processedAt: new Date().toISOString(),
    latestTransactionId: transactionId,
    originalTransactionId,
    expiresDate: newEndsAt?.toISOString() ?? null,
    autoRenewStatus: renewalInfo?.autoRenewStatus ?? null,
  };

  await db.query(
    `
    UPDATE club_subscriptions
       SET status = 'active',
           ends_at = COALESCE($1, ends_at),
           auto_renews = $2,
           verification_payload = $3::jsonb,
           updated_at = NOW()
     WHERE id = $4
    `,
    [
      newEndsAt,
      autoRenews,
      JSON.stringify(mergedPayload),
      existing.id,
    ]
  );

  logger.info('[apple-webhook] DID_RENEW: subscription extended', {
    subscriptionId: existing.id,
    clubId: existing.clubId,
    newEndsAt: newEndsAt?.toISOString() ?? null,
    transactionId,
    originalTransactionId,
  });

  void recordSystemEvent({
    category: 'webhook',
    event_type: 'subscription_refreshed',
    event_status: 'success',
    platform: 'ios',
    club_id: existing.clubId,
    product_id: productId,
    transaction_id: transactionId,
    original_transaction_id: originalTransactionId,
    related_subscription_id: existing.id,
    message: 'DID_RENEW: subscription extended',
    details: { newEndsAt: newEndsAt?.toISOString() ?? null },
  });

  // Refresh club Pro cache to reflect new ends_at
  await refreshClubSubscriptionStatuses(existing.clubId);
}

/**
 * Handle EXPIRED / GRACE_PERIOD_EXPIRED / REFUND / REVOKE:
 * mark the subscription expired and refresh the club's Pro status.
 */
async function handleExpiry(
  txInfo: AppleTransactionInfo,
  notificationType: string
): Promise<void> {
  const { transactionId, originalTransactionId, productId } = txInfo;

  const existing = await findSubscriptionByOriginalTransactionId(
    originalTransactionId
  );

  if (!existing) {
    logger.warn(`[apple-webhook] ${notificationType}: no subscription found`, {
      originalTransactionId,
      transactionId,
    });
    void recordSystemEvent({
      category: 'webhook',
      event_type: 'webhook_no_local_subscription',
      event_status: 'info',
      platform: 'ios',
      product_id: productId,
      transaction_id: transactionId,
      original_transaction_id: originalTransactionId,
      message: `${notificationType}: no club_subscriptions row found for originalTransactionId`,
    });
    return;
  }

  const mergedPayload = {
    source: 'apple_notification',
    notificationType,
    processedAt: new Date().toISOString(),
    transactionId,
    originalTransactionId,
    revocationDate: txInfo.revocationDate
      ? new Date(txInfo.revocationDate).toISOString()
      : null,
  };

  await db.query(
    `
    UPDATE club_subscriptions
       SET status = 'expired',
           verification_payload = $1::jsonb,
           updated_at = NOW()
     WHERE id = $2
       AND status NOT IN ('expired')
    `,
    [JSON.stringify(mergedPayload), existing.id]
  );

  logger.info(`[apple-webhook] ${notificationType}: subscription expired`, {
    subscriptionId: existing.id,
    clubId: existing.clubId,
    transactionId,
    originalTransactionId,
  });

  void recordSystemEvent({
    category: 'webhook',
    event_type: 'subscription_updated',
    event_status: 'info',
    platform: 'ios',
    club_id: existing.clubId,
    product_id: productId,
    transaction_id: transactionId,
    original_transaction_id: originalTransactionId,
    related_subscription_id: existing.id,
    message: `${notificationType}: subscription marked expired`,
  });

  // Sweep statuses and update club Pro cache
  await refreshClubSubscriptionStatuses(existing.clubId);
}

/**
 * Handle DID_CHANGE_RENEWAL_STATUS:
 *   - AUTO_RENEW_DISABLED → status='canceled', auto_renews=false  (still active until ends_at)
 *   - AUTO_RENEW_ENABLED  → restore status='active', auto_renews=true
 */
async function handleRenewalStatusChange(
  txInfo: AppleTransactionInfo,
  renewalInfo: AppleRenewalInfo | null,
  subtype: string | undefined
): Promise<void> {
  const { transactionId, originalTransactionId, productId } = txInfo;

  const existing = await findSubscriptionByOriginalTransactionId(
    originalTransactionId
  );

  if (!existing) {
    logger.warn('[apple-webhook] DID_CHANGE_RENEWAL_STATUS: no subscription found', {
      originalTransactionId,
      subtype,
    });
    void recordSystemEvent({
      category: 'webhook',
      event_type: 'webhook_no_local_subscription',
      event_status: 'info',
      platform: 'ios',
      product_id: productId,
      original_transaction_id: originalTransactionId,
      message: `DID_CHANGE_RENEWAL_STATUS (${subtype ?? ''}): no row found`,
    });
    return;
  }

  const isDisabling = subtype === 'AUTO_RENEW_DISABLED';
  // autoRenewStatus from renewalInfo is the authoritative source
  const autoRenews =
    renewalInfo?.autoRenewStatus !== undefined
      ? renewalInfo.autoRenewStatus === 1
      : !isDisabling;

  // Map to our status model:
  // AUTO_RENEW_DISABLED → 'canceled' (still within entitlement, but won't renew)
  //   Preserve 'expired' and 'scheduled' as-is — don't flip an already-expired row
  //   to 'canceled', and don't prematurely mark a scheduled row as canceled before
  //   it has activated. auto_renews=false is still recorded on those rows so the
  //   refresh job / eventual activation will use the correct value.
  // AUTO_RENEW_ENABLED  → 'active' (only if the row is currently active or canceled;
  //                        preserve 'scheduled' and 'expired' as-is — do not activate early)
  const newStatus =
    isDisabling
      ? existing.status === 'active' || existing.status === 'canceled'
        ? 'canceled'
        : existing.status // preserve 'expired' and 'scheduled'
      : existing.status === 'active' || existing.status === 'canceled'
        ? 'active'
        : existing.status;

  const mergedPayload = {
    source: 'apple_notification',
    notificationType: 'DID_CHANGE_RENEWAL_STATUS',
    subtype: subtype ?? null,
    processedAt: new Date().toISOString(),
    transactionId,
    originalTransactionId,
    autoRenewStatus: renewalInfo?.autoRenewStatus ?? null,
  };

  await db.query(
    `
    UPDATE club_subscriptions
       SET status = $1,
           auto_renews = $2,
           verification_payload = $3::jsonb,
           updated_at = NOW()
     WHERE id = $4
    `,
    [newStatus, autoRenews, JSON.stringify(mergedPayload), existing.id]
  );

  logger.info('[apple-webhook] DID_CHANGE_RENEWAL_STATUS processed', {
    subscriptionId: existing.id,
    clubId: existing.clubId,
    subtype,
    newStatus,
    autoRenews,
    originalTransactionId,
  });

  void recordSystemEvent({
    category: 'webhook',
    event_type: 'subscription_updated',
    event_status: 'info',
    platform: 'ios',
    club_id: existing.clubId,
    product_id: productId,
    transaction_id: transactionId,
    original_transaction_id: originalTransactionId,
    related_subscription_id: existing.id,
    message: `DID_CHANGE_RENEWAL_STATUS (${subtype ?? ''}): status=${newStatus}, autoRenews=${String(autoRenews)}`,
  });
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Process an incoming Apple App Store Server Notification v2.
 *
 * Called by the webhook controller. Always resolves (never throws) except
 * for truly unexpected errors — processing failures are logged and written
 * to system_events, and the controller still returns 200 to Apple.
 */
export async function processAppleNotification(body: unknown): Promise<void> {
  // 1) Validate top-level structure
  if (!body || typeof body !== 'object' || !('signedPayload' in body)) {
    throw new Error('Apple notification missing signedPayload field');
  }

  const rawSignedPayload = (body as Record<string, unknown>).signedPayload;
  if (typeof rawSignedPayload !== 'string' || !rawSignedPayload.trim()) {
    throw new Error('Apple notification signedPayload must be a non-empty string');
  }

  // 2) Verify and decode the outer notification JWT.
  //    verifyAndDecodeAppleJwt validates the x5c certificate chain against our
  //    pinned Apple Root CA G3 and verifies the ES256 signature. It throws on
  //    any failure — no DB writes or entitlement changes happen if this throws.
  let notification: AppleNotificationPayload;

  try {
    notification = verifyAndDecodeAppleJwt<AppleNotificationPayload>(rawSignedPayload);
  } catch (verifyErr) {
    // Propagate with a clear prefix so callers can distinguish auth errors
    // from processing errors and avoid writing system_events for probe traffic.
    throw new Error(
      `Apple JWT verification failed: ${
        verifyErr instanceof Error ? verifyErr.message : String(verifyErr)
      }`
    );
  }

  const {
    notificationType,
    subtype,
    notificationUUID,
    data,
  } = notification;

  if (!notificationType) {
    throw new Error('Apple notification payload missing notificationType');
  }

  if (!notificationUUID) {
    throw new Error('Apple notification payload missing notificationUUID');
  }

  // 3) In-memory dedupe
  if (wasNotificationProcessed(notificationUUID)) {
    logger.info('[apple-webhook] duplicate notification ignored', {
      notificationUUID,
      notificationType,
      subtype: subtype ?? null,
    });
    return;
  }

  logger.info('[apple-webhook] notification received', {
    notificationType,
    subtype: subtype ?? null,
    notificationUUID,
    bundleId: data?.bundleId ?? null,
    environment: data?.environment ?? null,
  });

  // 4) Validate bundle ID if configured
  const expectedBundleId = process.env.APPLE_BUNDLE_ID;
  if (expectedBundleId && data?.bundleId && data.bundleId !== expectedBundleId) {
    throw new Error(
      `Apple notification bundle ID mismatch: expected ${expectedBundleId}, got ${data.bundleId}`
    );
  }

  // 5) Handle TEST notifications early
  if (notificationType === 'TEST') {
    logger.info('[apple-webhook] TEST notification received', { notificationUUID });
    markNotificationProcessed(notificationUUID);
    return;
  }

  // 6) Verify and decode transaction and renewal info JWTs.
  //    These inner JWTs are also signed by Apple using the same x5c mechanism.
  let txInfo: AppleTransactionInfo | null = null;
  let renewalInfo: AppleRenewalInfo | null = null;

  if (data?.signedTransactionInfo) {
    // Fatal: if signedTransactionInfo is present but invalid, reject the notification.
    try {
      txInfo = verifyAndDecodeAppleJwt<AppleTransactionInfo>(
        data.signedTransactionInfo
      );
    } catch (err) {
      throw new Error(
        `Apple JWT verification failed for signedTransactionInfo: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  if (data?.signedRenewalInfo) {
    // Non-fatal: signedRenewalInfo is optional and not present on all notification types.
    // But if present, it must also verify — log and continue without it if it fails.
    try {
      renewalInfo = verifyAndDecodeAppleJwt<AppleRenewalInfo>(
        data.signedRenewalInfo
      );
    } catch (err) {
      logger.warn('[apple-webhook] signedRenewalInfo JWT verification failed — continuing without it', {
        notificationUUID,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 7) Persist raw event for audit trail (best-effort, non-fatal)
  try {
    await insertAppleWebhookEvent({
      notificationUUID,
      notificationType,
      subtype: subtype ?? null,
      bundleId: data?.bundleId ?? null,
      productId: txInfo?.productId ?? null,
      transactionId: txInfo?.transactionId ?? null,
      originalTransactionId: txInfo?.originalTransactionId ?? null,
      environment: data?.environment ?? null,
      payload: notification,
    });
  } catch (dbErr) {
    // Failure to insert audit row must not block notification processing
    logger.warn('[apple-webhook] failed to insert webhook event row', {
      notificationUUID,
      error: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
  }

  // 8) Route by notificationType
  try {
    switch (notificationType) {
      case 'DID_RENEW':
        if (!txInfo) throw new Error('DID_RENEW missing signedTransactionInfo');
        await handleRenewal(txInfo, renewalInfo);
        break;

      case 'EXPIRED':
      case 'GRACE_PERIOD_EXPIRED':
      case 'REFUND':
      case 'REVOKE':
        if (!txInfo) {
          logger.warn(`[apple-webhook] ${notificationType} missing txInfo`, {
            notificationUUID,
          });
          break;
        }
        await handleExpiry(txInfo, notificationType);
        break;

      case 'DID_CHANGE_RENEWAL_STATUS':
        if (!txInfo) {
          logger.warn('[apple-webhook] DID_CHANGE_RENEWAL_STATUS missing txInfo', {
            notificationUUID,
          });
          break;
        }
        await handleRenewalStatusChange(txInfo, renewalInfo, subtype);
        break;

      case 'DID_FAIL_TO_RENEW':
        // Subscription is in a billing retry / grace period. No status change yet —
        // Apple will send EXPIRED or DID_RENEW once resolved.
        logger.info('[apple-webhook] DID_FAIL_TO_RENEW: billing retry period started', {
          notificationUUID,
          originalTransactionId: txInfo?.originalTransactionId ?? null,
        });
        break;

      case 'SUBSCRIBED':
        // Initial subscription or resubscription after expiry.
        // The row was already created via /verify — log only.
        logger.info('[apple-webhook] SUBSCRIBED notification received (row created via verify)', {
          notificationUUID,
          subtype: subtype ?? null,
          originalTransactionId: txInfo?.originalTransactionId ?? null,
        });
        break;

      case 'PRICE_INCREASE':
      case 'RENEWAL_EXTENSION':
      case 'CONSUMPTION_REQUEST':
        // Informational — no subscription status change required.
        logger.info(`[apple-webhook] ${notificationType} notification noted`, {
          notificationUUID,
          subtype: subtype ?? null,
        });
        break;

      default:
        // Unknown future type — log with enough context to diagnose.
        logger.warn('[apple-webhook] unknown notificationType', {
          notificationType,
          subtype: subtype ?? null,
          notificationUUID,
        });
        break;
    }
  } catch (processingError) {
    const msg =
      processingError instanceof Error
        ? processingError.message
        : String(processingError);

    logger.error('[apple-webhook] processing failed', {
      notificationType,
      subtype: subtype ?? null,
      notificationUUID,
      originalTransactionId: txInfo?.originalTransactionId ?? null,
      error: msg,
    });

    void recordSystemEvent({
      category: 'webhook',
      event_type: 'webhook_failed',
      event_status: 'failure',
      platform: 'ios',
      product_id: txInfo?.productId ?? null,
      transaction_id: txInfo?.transactionId ?? null,
      original_transaction_id: txInfo?.originalTransactionId ?? null,
      message: msg,
      details: { notificationType, subtype: subtype ?? null, notificationUUID },
    });

    // Re-throw so the controller can also log; controller still returns 200.
    throw processingError;
  }

  // 9) Mark processed after successful routing
  markNotificationProcessed(notificationUUID);

  void recordSystemEvent({
    category: 'webhook',
    event_type: 'webhook_processed',
    event_status: 'success',
    platform: 'ios',
    product_id: txInfo?.productId ?? null,
    transaction_id: txInfo?.transactionId ?? null,
    original_transaction_id: txInfo?.originalTransactionId ?? null,
    message: notificationUUID,
    details: { notificationType, subtype: subtype ?? null },
  });
}
