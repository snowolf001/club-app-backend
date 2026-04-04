import 'dotenv/config';
import app from './app';
import { pool } from './db/pool';

const port = Number(process.env.PORT || 3000);

async function start(): Promise<void> {
  try {
    await pool.query('SELECT 1');
    console.log('[db] Database connection successful.');

    app.listen(port, () => {
      console.log(`[server] Club App backend listening on port ${port}`);
    });
  } catch (error) {
    console.error('[startup] Failed to start server:', error);
    process.exit(1);
  }
}

void start();
