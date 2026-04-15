import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';
import { recordSystemEvent } from '../lib/systemEvents';
import {
  parsePubSubEnvelope,
  processGoogleRtdnEnvelope,
  verifyPubSubPushJwt,
  verifyWebhookToken,
} from '../services/googleRtdnService';

export async function googlePlayWebhookHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    verifyWebhookToken(req.query.token);
    await verifyPubSubPushJwt(req.header('authorization'));

    const envelope = parsePubSubEnvelope(req.body);
    await processGoogleRtdnEnvelope(envelope);

    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('[google-rtdn] webhook processing failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    void recordSystemEvent({
      category: 'webhook',
      event_type: 'webhook_failed',
      event_status: 'failure',
      platform: 'android',
      message: error instanceof Error ? error.message : String(error),
    });
    next(error);
  }
}
