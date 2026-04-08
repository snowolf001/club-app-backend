/**
 * Auto-migration runner.
 * Tracks applied migrations in a `schema_migrations` table.
 * Runs all pending SQL files from sql/migrations/ in filename order on startup.
 * Each migration runs inside a transaction — if it fails, the transaction rolls
 * back and the server aborts startup so the problem is visible immediately.
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../lib/logger';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'sql', 'migrations');

export async function runMigrations(pool: Pool): Promise<void> {
  // Ensure the tracking table exists.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Read and sort migration filenames.
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  // Fetch already-applied migrations.
  const result = await pool.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations'
  );
  const applied = new Set(result.rows.map(r => r.filename));

  const pending = files.filter(f => !applied.has(f));

  if (pending.length === 0) {
    logger.info('[migrate] All migrations already applied.');
    return;
  }

  for (const filename of pending) {
    const filePath = path.join(MIGRATIONS_DIR, filename);
    const sql = fs.readFileSync(filePath, 'utf8');

    logger.info(`[migrate] Applying migration: ${filename}`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename]
      );
      await client.query('COMMIT');
      logger.info(`[migrate] Applied: ${filename}`);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`[migrate] FAILED on migration: ${filename}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err; // Abort startup
    } finally {
      client.release();
    }
  }

  logger.info(`[migrate] ${pending.length} migration(s) applied.`);
}
