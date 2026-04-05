// scripts/run-migration-004.js
// Applies migration 004: checked_in_by_user_id + audit_log session_id + indexes

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString:
    'postgresql://postgres:EMELqsDeAhRVyEVNYwlcSieDYQsVCllY@interchange.proxy.rlwy.net:18496/railway',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const sqlPath = path.join(
    __dirname,
    '../src/db/migrations/004_add_report_enhancements.sql'
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ Migration 004 applied successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration 004 failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
