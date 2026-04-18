import cron from 'node-cron';
import { db } from '../db';
import { logger } from '../lib/logger';

/**
 * Daily cleanup job for system_events table.
 *
 * Runs at 03:00 server time every day.
 * Applies retention policy:
 *
 * - 90 days:
 *   purchase_verify_started, purchase_verify_succeeded, purchase_verify_failed
 *   subscription_created, subscription_scheduled, subscription_expired
 *
 * - 30 days:
 *   webhook_processed, webhook_failed, webhook_no_local_subscription
 *
 * - 7 days:
 *   everything else
 */
export function startSystemEventsCleanupJob(): void {
  cron.schedule('0 3 * * *', async () => {
    const start = Date.now();

    try {
      logger.info('[cron] system_events cleanup started');

      // ─── 90 days ─────────────────────────────
      await db.query(`
        DELETE FROM system_events
        WHERE created_at < NOW() - INTERVAL '90 days'
        AND event_type IN (
          'purchase_verify_started',
          'purchase_verify_succeeded',
          'purchase_verify_failed',
          'subscription_created',
          'subscription_scheduled',
          'subscription_expired'
        );
      `);

      // ─── 30 days ─────────────────────────────
      await db.query(`
        DELETE FROM system_events
        WHERE created_at < NOW() - INTERVAL '30 days'
        AND event_type IN (
          'webhook_processed',
          'webhook_failed',
          'webhook_no_local_subscription'
        );
      `);

      // ─── 7 days (everything else) ─────────────
      await db.query(`
        DELETE FROM system_events
        WHERE created_at < NOW() - INTERVAL '7 days'
        AND event_type NOT IN (
          'purchase_verify_started',
          'purchase_verify_succeeded',
          'purchase_verify_failed',
          'subscription_created',
          'subscription_scheduled',
          'subscription_expired',
          'webhook_processed',
          'webhook_failed',
          'webhook_no_local_subscription'
        );
      `);

      const duration = Date.now() - start;

      logger.info('[cron] system_events cleanup completed', {
        durationMs: duration,
      });
    } catch (error) {
      logger.error('[cron] system_events cleanup failed', {
        error,
      });
    }
  });

  logger.info('[cron] system_events cleanup scheduled (03:00 daily)');
}
