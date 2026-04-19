import cron from 'node-cron';
import { db } from '../db';
import { logger } from '../lib/logger';

/**
 * Daily cleanup job for session_intents table.
 *
 * Runs at 03:10 server time every day (10 min offset from systemEventsCleanup).
 * Retention policy:
 *
 * - Delete any intent whose session started more than 7 days ago.
 *   After 7 days the session is well and truly over; keeping the rows
 *   serves no product or audit purpose.
 *
 * Column reference (schema aligned with 001_initial_schema.sql):
 *   sessions.starts_at  TIMESTAMPTZ
 */
export function startSessionIntentsCleanupJob(): void {
  cron.schedule('10 3 * * *', async () => {
    const start = Date.now();

    try {
      logger.info('[cron] session_intents cleanup started');

      const result = await db.query(`
        DELETE FROM session_intents si
        USING sessions s
        WHERE si.session_id = s.id
          AND s.starts_at < NOW() - INTERVAL '7 days'
      `);

      const duration = Date.now() - start;

      logger.info('[cron] session_intents cleanup completed', {
        durationMs: duration,
        rowsDeleted: result.rowCount ?? 0,
      });
    } catch (error) {
      logger.error('[cron] session_intents cleanup failed', { error });
    }
  });
}
