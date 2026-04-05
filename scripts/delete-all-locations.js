const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    'postgresql://postgres:EMELqsDeAhRVyEVNYwlcSieDYQsVCllY@interchange.proxy.rlwy.net:18496/railway',
});

async function main() {
  const client = await pool.connect();
  try {
    const list = await client.query(
      'SELECT id, club_id, name, address FROM club_locations ORDER BY created_at DESC'
    );
    console.log('Current locations:');
    console.table(list.rows);

    if (list.rows.length === 0) {
      console.log('No locations to delete.');
      return;
    }

    const del = await client.query(
      'DELETE FROM club_locations RETURNING id, name'
    );
    console.log(`\nDeleted ${del.rowCount} location(s):`, del.rows);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
