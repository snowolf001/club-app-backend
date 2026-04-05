const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    'postgresql://postgres:EMELqsDeAhRVyEVNYwlcSieDYQsVCllY@interchange.proxy.rlwy.net:18496/railway',
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('Running migration 003...');

    await client.query(`ALTER TABLE sessions ALTER COLUMN title DROP NOT NULL`);
    console.log('✅ title column made nullable');

    await client.query(
      `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES club_locations(id) ON DELETE RESTRICT`
    );
    console.log('✅ location_id column added');

    await client.query('COMMIT');
    console.log('✅ Migration 003 complete');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed, rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
