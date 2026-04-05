const { Pool } = require('pg');
const pool = new Pool({
  connectionString:
    'postgresql://postgres:EMELqsDeAhRVyEVNYwlcSieDYQsVCllY@interchange.proxy.rlwy.net:18496/railway',
  ssl: { rejectUnauthorized: false },
});

pool
  .query(
    `UPDATE memberships
     SET credits_remaining = credits_remaining + 10, updated_at = NOW()
     WHERE LOWER(recovery_code) = LOWER($1)
     RETURNING id, credits_remaining`,
    ['6009-7793-d2fd']
  )
  .then((r) => {
    if (r.rowCount === 0) {
      console.log('No membership found with that recovery code.');
    } else {
      console.log('Updated:', r.rows[0]);
    }
    pool.end();
  })
  .catch((e) => {
    console.error('Error:', e.message);
    pool.end();
  });
