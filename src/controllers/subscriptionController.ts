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
} from '../services/subscriptionService';

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

    // ── verify started ─────────────────────────────────────────────
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

    // ── ⚠️ 补：防御性记录（极少发生，但可排查） ─────────────────
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
        message: 'verify returned no subscription',
        details: {
          reason: 'NO_SUBSCRIPTION_CREATED',
        },
      });
    }

    logger.info('[subscription] verifyPurchase', {
      clubId,
      platform,
      productId,
      subscriptionId: result.subscription.id,
      status: result.subscription.status,
      idempotent: result.idempotent,
      actorMemberId,
    });

    // ── verify succeeded ───────────────────────────────────────────
    void recordSystemEvent({
      category: 'iap',
      event_type: 'verify_succeeded',
      event_status: 'success',
      club_id: clubId,
      membership_id: actorMemberId,
      platform: platform as 'ios' | 'android',
      product_id: productId,
      related_subscription_id: result.subscription.id,
      message: result.idempotent ? 'idempotent' : 'verify succeeded',
      details: {
        status: result.subscription.status,
        idempotent: result.idempotent,
      },
    });

    // Return full club Pro status + the subscription that was created/found
    const proStatus = await getClubProStatus(clubId);

    res.json({
      success: true,
      data: {
        isPro: proStatus.isPro,
        activeSubscription: proStatus.activeSubscription,
        scheduledSubscription: proStatus.scheduledSubscription,
        createdSubscription: result.subscription,
      },
    });
  } catch (err) {
    // ── verify failed (exception) ─────────────────────────────────
    void recordSystemEvent({
      category: 'iap',
      event_type: 'verify_failed',
      event_status: 'failure',
      club_id: typeof req.body?.clubId === 'string' ? req.body.clubId : null,
      platform:
        typeof req.body?.platform === 'string' &&
        ['ios', 'android'].includes(req.body.platform)
          ? (req.body.platform as 'ios' | 'android')
          : null,
      product_id:
        typeof req.body?.productId === 'string' ? req.body.productId : null,
      purchase_token:
        typeof req.body?.purchaseToken === 'string'
          ? req.body.purchaseToken
          : null,
      message: err instanceof Error ? err.message : String(err),
      details: {
        reason: 'EXCEPTION_THROWN',
        productId: req.body?.productId,
        purchaseTokenSuffix: req.body?.purchaseToken?.slice(-8),
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

    const { assertUserBelongsToClub } =
      await import('../services/subscriptionService');
    await assertUserBelongsToClub(actorMemberId, clubId);

    const status = await getClubProStatus(clubId);

    res.json({ success: true, data: status });
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

    const { assertUserBelongsToClub } =
      await import('../services/subscriptionService');
    await assertUserBelongsToClub(actorMemberId, clubId);
    await refreshClubSubscriptionStatuses(clubId);

    const status = await getClubProStatus(clubId);

    logger.info('[subscription] refreshStatus', {
      clubId,
      isPro: status.isPro,
      actorMemberId,
    });

    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/subscriptions/webhooks/apple ───────────────────────────────────

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

// ─── POST /api/subscriptions/webhooks/google ──────────────────────────────────

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
