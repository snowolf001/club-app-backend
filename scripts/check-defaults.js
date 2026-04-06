const { Pool } = require('pg');
const pool = new Pool({
  connectionString:
    'postgresql://postgres:EMELqsDeAhRVyEVNYwlcSieDYQsVCllY@interchange.proxy.rlwy.net:18496/railway',
  ssl: { rejectUnauthorized: false },
});
pool
  .query(
    "SELECT column_name, column_default FROM information_schema.columns WHERE table_name='memberships' ORDER BY ordinal_position"
  )
  .then((r) => {
    r.rows.forEach((c) =>
      console.log(c.column_name, '| default:', c.column_default)
    );
    pool.end();
  })
  .catch((e) => {
    console.error(e.message);
    pool.end();
  });
