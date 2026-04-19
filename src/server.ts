import 'dotenv/config';
import app from './app';
import { pool } from './db/pool';
import { runMigrations } from './db/migrate';
import { startSystemEventsCleanupJob } from './jobs/systemEventsCleanup';
import { startSessionIntentsCleanupJob } from './jobs/sessionIntentsCleanup';

const port = Number(process.env.PORT || 3000);

async function start(): Promise<void> {
  try {
    await pool.query('SELECT 1');
    console.log('[db] Database connection successful.');

    await runMigrations(pool);

    app.listen(port, () => {
      console.log(`[server] Club App backend listening on port ${port}`);

      // ─── Start cron ONLY in production ─────────────────────
      const isProduction =
        process.env.NODE_ENV === 'production' ||
        process.env.RAILWAY_ENVIRONMENT_NAME === 'production';

      if (isProduction) {
        startSystemEventsCleanupJob();
        console.log('[cron] system_events cleanup job started');
        startSessionIntentsCleanupJob();
        console.log('[cron] session_intents cleanup job started');
      } else {
        console.log('[cron] skipped (non-production environment)');
      }
    });
  } catch (error) {
    console.error('[startup] Failed to start server:', error);
    process.exit(1);
  }
}

void start();
