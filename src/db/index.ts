import { Pool } from 'pg';
import { databaseUrl } from '../config/env';

export const db = new Pool({
  connectionString: databaseUrl,
});

export async function testDbConnection(): Promise<void> {
  if (!databaseUrl) {
    console.warn(
      '[db] WARNING: DATABASE_URL is not set. Skipping DB connection test.'
    );
    return;
  }

  try {
    await db.query('SELECT 1');
    console.log('[db] Database connection successful.');
  } catch (err) {
    console.error('[db] Database connection failed:', err);
    throw err;
  }
}
