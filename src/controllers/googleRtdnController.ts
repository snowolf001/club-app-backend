import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { recordSystemEvent } from '../lib/systemEvents';
import {
  parsePubSubEnvelope,
  processGoogleRtdnEnvelope,
  verifyPubSubPushJwt,
  verifyWebhookToken,
} from '../services/googleRtdnService';

// Auth error messages from googleRtdnService that indicate probing/misconfiguration.
// These are low-value noise — do NOT write to system_events and do NOT return 500
// (returning 500 triggers PubSub retry which would flood the table).
const AUTH_ERROR_MESSAGES = [
  'Invalid webhook token',
  'Missing Pub/Sub bearer token',
  'Empty Pub/Sub bearer token',
  'Missing Pub/Sub JWT payload',
  'Unexpected Pub/Sub JWT email',
  'Pub/Sub JWT email is not verified',
];

function isAuthError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return AUTH_ERROR_MESSAGES.some((msg) => error.message.includes(msg));
}

export async function googlePlayWebhookHandler(
  req: Request,
  res: Response
): Promise<void> {
  // ── Phase 1: Auth — return 401 without DB write on failure ──────────────
  // Auth failures are not retryable business events — they are either
  // misconfiguration or probe traffic. Never write to system_events here
  // as it creates noise rows with no useful context.
  try {
    verifyWebhookToken(req.query.token);
    await verifyPubSubPushJwt(req.header('authorization'));
  } catch (authError) {
    logger.warn('[google-rtdn] webhook auth rejected', {
      error: authError instanceof Error ? authError.message : String(authError),
      ip: req.ip,
    });
    // Return 401 — do NOT call next(error) which would return 500 and trigger retries.
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // ── Phase 2: Processing — always return 200 to ack and stop PubSub retries ──
  // Returning a non-2xx here causes PubSub to retry indefinitely.
  // For processing failures, we record to system_events (with dedupe) but
  // still ack the message so retries don't flood the system_events table.
  try {
    const envelope = parsePubSubEnvelope(req.body);
    await processGoogleRtdnEnvelope(envelope);
    res.status(200).json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[google-rtdn] webhook processing failed', { error: msg });

    // Auth errors that somehow surface here (e.g. if parsePubSubEnvelope throws
    // an auth-like message) should also not trigger DB writes.
    if (!isAuthError(error)) {
      void recordSystemEvent({
        category: 'webhook',
        event_type: 'webhook_failed',
        event_status: 'failure',
        platform: 'android',
        message: msg,
      });
    }

    // Return 200 to stop PubSub retry loop.
    // The failure is already logged above and recorded to system_events (with dedupe).
    res.status(200).json({ ok: true });
  }
}
