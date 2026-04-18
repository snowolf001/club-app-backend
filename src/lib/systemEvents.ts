import { db } from '../db';
import { logger } from './logger';

export interface SystemEventInput {
  category: string;
  event_type: string;
  event_status: 'success' | 'failure' | 'info';
  club_id?: string | null;
  membership_id?: string | null;
  platform?: 'ios' | 'android' | null;
  plan?: string | null;
  product_id?: string | null;
  purchase_token?: string | null;
  transaction_id?: string | null;
  original_transaction_id?: string | null;
  order_id?: string | null;
  related_subscription_id?: string | null;
  message?: string | null;
  details?: unknown;
}

// ─── Webhook failure dedupe ───────────────────────────────────────────────────
// Prevents repeated identical webhook_failed rows from flooding system_events
// when PubSub retries or auth is misconfigured. In-memory per-process.

const WEBHOOK_FAILURE_DEDUPE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const recentWebhookFailures = new Map<string, number>(); // signature -> expiresAtMs

function cleanupWebhookFailureCache(): void {
  const now = Date.now();
  for (const [key, expiresAt] of recentWebhookFailures.entries()) {
    if (expiresAt <= now) recentWebhookFailures.delete(key);
  }
}

function makeWebhookFailureSignature(input: SystemEventInput): string {
  return [
    input.event_type,
    input.platform ?? '',
    // First 120 chars groups similar error messages without exact matching
    (input.message ?? '').slice(0, 120),
    // Last 8 chars of token to scope per-purchase deduplication
    input.purchase_token ? input.purchase_token.slice(-8) : '',
  ].join('\x00');
}

function isDuplicateWebhookFailure(input: SystemEventInput): boolean {
  cleanupWebhookFailureCache();
  const sig = makeWebhookFailureSignature(input);
  const existing = recentWebhookFailures.get(sig);
  return !!existing && existing > Date.now();
}

function markWebhookFailureRecorded(input: SystemEventInput): void {
  cleanupWebhookFailureCache();
  const sig = makeWebhookFailureSignature(input);
  recentWebhookFailures.set(sig, Date.now() + WEBHOOK_FAILURE_DEDUPE_WINDOW_MS);
}

/**
 * Write one row to `system_events`.
 *
 * Best-effort: catches and logs all errors internally.
 * A failure here must never affect calling code — callers should fire-and-forget
 * with `void recordSystemEvent(...)`.
 *
 * webhook_failed events are deduplicated within a 10-minute window to prevent
 * PubSub retry loops from flooding the table.
 */
export async function recordSystemEvent(
  input: SystemEventInput
): Promise<void> {
  // Deduplicate repeated webhook_failed rows caused by PubSub retries
  if (input.event_type === 'webhook_failed') {
    if (isDuplicateWebhookFailure(input)) {
      logger.info('[system-events] dedupe suppressed webhook_failed', {
        platform: input.platform,
        message: (input.message ?? '').slice(0, 80),
      });
      return;
    }
    markWebhookFailureRecorded(input);
  }

  try {
    await db.query(
      `INSERT INTO system_events (
        category, event_type, event_status,
        club_id, membership_id,
        platform, plan, product_id,
        purchase_token, transaction_id, original_transaction_id, order_id,
        related_subscription_id,
        message, details
      ) VALUES (
        $1, $2, $3,
        $4, $5,
        $6, $7, $8,
        $9, $10, $11, $12,
        $13,
        $14, $15::jsonb
      )`,
      [
        input.category,
        input.event_type,
        input.event_status,
        input.club_id ?? null,
        input.membership_id ?? null,
        input.platform ?? null,
        input.plan ?? null,
        input.product_id ?? null,
        input.purchase_token ?? null,
        input.transaction_id ?? null,
        input.original_transaction_id ?? null,
        input.order_id ?? null,
        input.related_subscription_id ?? null,
        input.message ?? null,
        input.details != null ? JSON.stringify(input.details) : null,
      ]
    );
  } catch (err) {
    // Log but never throw — event recording must never disrupt business operations.
    logger.error('[system-events] failed to record event', {
      error: err instanceof Error ? err.message : String(err),
      category: input.category,
      event_type: input.event_type,
    });
  }
}
