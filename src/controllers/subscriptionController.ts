import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
import { getActorMemberId } from '../lib/auth';
import { logger } from '../lib/logger';
import { recordSystemEvent } from '../lib/systemEvents';
import {
  getClubProStatus,
  createOrScheduleSubscriptionForClub,
  refreshClubSubscriptionStatuses,
  assertUserBelongsToClub,
  getLastExpiredSubscriptionForClub,
  SubscriptionRecord,
  ClubProStatus,
} from '../services/subscriptionService';

export type ClubSubscriptionStatusDto = {
  isPro: boolean;
  billingState: 'free' | 'active_renewing' | 'active_cancelled' | 'expired';
  activeSubscription: {
    id: string;
    platform: 'ios' | 'android';
    planCycle: 'monthly' | 'yearly';
    startsAt: string | null;
    expiresAt: string | null;
    status: string;
    productId: string | null;
    autoRenews: boolean | null;
  } | null;
  scheduledSubscription: {
    id: string;
    platform: 'ios' | 'android';
    planCycle: 'monthly' | 'yearly';
    startsAt: string | null;
    expiresAt: string | null;
    status: string;
    productId: string | null;
    autoRenews: boolean | null;
  } | null;
  lastExpiredSubscription: {
    id: string;
    platform: 'ios' | 'android';
    planCycle: 'monthly' | 'yearly';
    startsAt: string | null;
    expiresAt: string | null;
    status: string;
    productId: string | null;
  } | null;
};

function toSubscriptionDto(
  sub: SubscriptionRecord | null | undefined
): ClubSubscriptionStatusDto['activeSubscription'] {
  if (!sub) return null;
  return {
    id: sub.id,
    platform: sub.platform,
    planCycle: sub.plan,
    startsAt: sub.startsAt ? sub.startsAt.toISOString() : null,
    expiresAt: sub.endsAt ? sub.endsAt.toISOString() : null,
    status: sub.status,
    productId: sub.productId ?? null,
    // autoRenews is not stored in DB yet — return null for forward-compat.
    // When webhook data is enriched, populate from verification_payload.
    autoRenews: null,
  };
}

function toExpiredDto(
  sub: SubscriptionRecord | null | undefined
): ClubSubscriptionStatusDto['lastExpiredSubscription'] {
  if (!sub) return null;
  return {
    id: sub.id,
    platform: sub.platform,
    planCycle: sub.plan,
    startsAt: sub.startsAt ? sub.startsAt.toISOString() : null,
    expiresAt: sub.endsAt ? sub.endsAt.toISOString() : null,
    status: sub.status,
    productId: sub.productId ?? null,
  };
}

function deriveBillingState(
  active: SubscriptionRecord | null,
  lastExpired: SubscriptionRecord | null
): ClubSubscriptionStatusDto['billingState'] {
  if (!active) {
    return lastExpired ? 'expired' : 'free';
  }
  // autoRenews not stored — treat as renewing by default
  return 'active_renewing';
}

async function getLastExpiredSubscription(
  clubId: string
): Promise<SubscriptionRecord | null> {
  return getLastExpiredSubscriptionForClub(clubId);
}

function toProStatusDto(
  status: ClubProStatus,
  lastExpired: SubscriptionRecord | null
): ClubSubscriptionStatusDto {
  const billingState = deriveBillingState(
    status.activeSubscription,
    lastExpired
  );
  return {
    isPro: status.isPro,
    billingState,
    activeSubscription: toSubscriptionDto(status.activeSubscription),
    scheduledSubscription: toSubscriptionDto(status.scheduledSubscription),
    lastExpiredSubscription: toExpiredDto(lastExpired),
  };
}

function maskTokenSuffix(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value.slice(-8);
}

// ─── POST /api/subscriptions/verify ──────────────────────────────────────────

export async function verifyPurchaseHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorMemberId = getActorMemberId(req);

    const {
      clubId,
      platform,
      productId,
      receiptData,
      transactionId,
      originalTransactionId,
      purchaseToken,
      orderId,
      verificationPayload,
    } = req.body;

    if (!clubId || !isValidUUID(clubId)) {
      throw new AppError(400, 'INVALID_INPUT', 'clubId must be a valid UUID');
    }

    if (!platform || !['ios', 'android'].includes(platform)) {
      throw new AppError(
        400,
        'INVALID_INPUT',
        "platform must be 'ios' or 'android'"
      );
    }

    if (!productId) {
      throw new AppError(400, 'INVALID_INPUT', 'productId is required');
    }

    if (platform === 'ios' && !receiptData) {
      throw new AppError(
        400,
        'INVALID_INPUT',
        'receiptData is required for iOS'
      );
    }

    if (platform === 'android' && !purchaseToken) {
      throw new AppError(
        400,
        'INVALID_INPUT',
        'purchaseToken is required for Android'
      );
    }

    // Ensure the actor belongs to the club before doing any verify work.
    await assertUserBelongsToClub(actorMemberId, clubId);

    // ── verify started ────────────────────────────────────────────────────────
    void recordSystemEvent({
      category: 'iap',
      event_type: 'verify_started',
      event_status: 'info',
      club_id: clubId,
      membership_id: actorMemberId,
      platform: platform as 'ios' | 'android',
      product_id: productId,
      purchase_token: typeof purchaseToken === 'string' ? purchaseToken : null,
      transaction_id: typeof transactionId === 'string' ? transactionId : null,
      original_transaction_id:
        typeof originalTransactionId === 'string'
          ? originalTransactionId
          : null,
      order_id: typeof orderId === 'string' ? orderId : null,
      message: 'verify started',
    });

    const result = await createOrScheduleSubscriptionForClub({
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
    });

    // Defensive record for debugging; should be unreachable in normal flow.
    if (!result || !result.subscription) {
      void recordSystemEvent({
        category: 'iap',
        event_type: 'verify_failed',
        event_status: 'failure',
        club_id: clubId,
        membership_id: actorMemberId,
        platform: platform as 'ios' | 'android',
        product_id: productId,
        purchase_token:
          typeof purchaseToken === 'string' ? purchaseToken : null,
        transaction_id:
          typeof transactionId === 'string' ? transactionId : null,
        original_transaction_id:
          typeof originalTransactionId === 'string'
            ? originalTransactionId
            : null,
        order_id: typeof orderId === 'string' ? orderId : null,
        message: 'verify returned no subscription',
        details: {
          reason: 'NO_SUBSCRIPTION_CREATED',
        },
      });

      throw new AppError(
        500,
        'INTERNAL_ERROR',
        'Verification returned no subscription'
      );
    }

    logger.info('[subscription] verifyPurchase', {
      clubId,
      platform,
      productId,
      subscriptionId: result.subscription.id,
      status: result.subscription.status,
      idempotent: result.idempotent,
      actorMemberId,
      purchaseTokenSuffix: maskTokenSuffix(purchaseToken),
      transactionId: typeof transactionId === 'string' ? transactionId : null,
      originalTransactionId:
        typeof originalTransactionId === 'string'
          ? originalTransactionId
          : null,
      orderId: typeof orderId === 'string' ? orderId : null,
    });

    // ── verify succeeded ──────────────────────────────────────────────────────
    void recordSystemEvent({
      category: 'iap',
      event_type: 'verify_succeeded',
      event_status: 'success',
      club_id: clubId,
      membership_id: actorMemberId,
      platform: platform as 'ios' | 'android',
      product_id: productId,
      purchase_token: typeof purchaseToken === 'string' ? purchaseToken : null,
      transaction_id: typeof transactionId === 'string' ? transactionId : null,
      original_transaction_id:
        typeof originalTransactionId === 'string'
          ? originalTransactionId
          : null,
      order_id: typeof orderId === 'string' ? orderId : null,
      related_subscription_id: result.subscription.id,
      message: result.idempotent ? 'idempotent' : 'verify succeeded',
      details: {
        status: result.subscription.status,
        idempotent: result.idempotent,
      },
    });

    // Return full club Pro status + the subscription that was created/found
    const proStatus = await getClubProStatus(clubId);
    const lastExpiredForVerify = await getLastExpiredSubscription(clubId);

    res.json({
      success: true,
      data: {
        ...toProStatusDto(proStatus, lastExpiredForVerify),
        createdSubscription: toSubscriptionDto(result.subscription),
        idempotent: result.idempotent,
      },
    });
  } catch (err) {
    const clubId =
      typeof req.body?.clubId === 'string' ? req.body.clubId : null;
    const platform =
      typeof req.body?.platform === 'string' &&
      ['ios', 'android'].includes(req.body.platform)
        ? (req.body.platform as 'ios' | 'android')
        : null;
    const actorMemberId =
      typeof req.headers['x-member-id'] === 'string'
        ? req.headers['x-member-id']
        : null;

    // ── verify failed (exception) ────────────────────────────────────────────
    void recordSystemEvent({
      category: 'iap',
      event_type: 'verify_failed',
      event_status: 'failure',
      club_id: clubId,
      membership_id: actorMemberId,
      platform,
      product_id:
        typeof req.body?.productId === 'string' ? req.body.productId : null,
      purchase_token:
        typeof req.body?.purchaseToken === 'string'
          ? req.body.purchaseToken
          : null,
      transaction_id:
        typeof req.body?.transactionId === 'string'
          ? req.body.transactionId
          : null,
      original_transaction_id:
        typeof req.body?.originalTransactionId === 'string'
          ? req.body.originalTransactionId
          : null,
      order_id: typeof req.body?.orderId === 'string' ? req.body.orderId : null,
      message: err instanceof Error ? err.message : String(err),
      details: {
        reason: 'EXCEPTION_THROWN',
        productId: req.body?.productId,
        purchaseTokenSuffix: maskTokenSuffix(req.body?.purchaseToken),
      },
    });

    next(err);
  }
}

// ─── GET /api/subscriptions/status?clubId= ───────────────────────────────────

export async function getProStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorMemberId = getActorMemberId(req);
    const clubId = req.query.clubId as string;

    if (!clubId || !isValidUUID(clubId)) {
      throw new AppError(400, 'INVALID_INPUT', 'clubId must be a valid UUID');
    }

    await assertUserBelongsToClub(actorMemberId, clubId);

    const status = await getClubProStatus(clubId);

    const lastExpiredForStatus = await getLastExpiredSubscription(clubId);

    // Provide detailed active subscription diagnostics if present
    logger.info('[subscription] GET /status debug', {
      clubId,
      now: new Date().toISOString(),
      isPro: status.isPro,
      activeSubscriptionId: status.activeSubscription?.id ?? null,
      activeStartsAt:
        status.activeSubscription?.startsAt?.toISOString() ?? null,
      activeEndsAt: status.activeSubscription?.endsAt?.toISOString() ?? null,
      scheduledSubscriptionId: status.scheduledSubscription?.id ?? null,
      billingState: deriveBillingState(
        status.activeSubscription,
        lastExpiredForStatus
      ),
    });

    res.json({
      success: true,
      data: toProStatusDto(status, lastExpiredForStatus),
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/subscriptions/refresh ─────────────────────────────────────────

export async function refreshStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const actorMemberId = getActorMemberId(req);
    const { clubId } = req.body;

    if (!clubId || !isValidUUID(clubId)) {
      throw new AppError(400, 'INVALID_INPUT', 'clubId must be a valid UUID');
    }

    await assertUserBelongsToClub(actorMemberId, clubId);
    await refreshClubSubscriptionStatuses(clubId);

    const status = await getClubProStatus(clubId);
    const lastExpiredForRefresh = await getLastExpiredSubscription(clubId);

    logger.info('[subscription] refreshStatus', {
      clubId,
      isPro: status.isPro,
      actorMemberId,
    });

    res.json({
      success: true,
      data: toProStatusDto(status, lastExpiredForRefresh),
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/subscriptions/webhooks/apple ──────────────────────────────────

export async function appleWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    logger.info('[subscription] appleWebhook received', {
      notificationType: req.body?.notificationType,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/subscriptions/webhooks/google ─────────────────────────────────

export async function googleWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    logger.info('[subscription] googleWebhook received', {
      messageId: req.body?.message?.messageId,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
