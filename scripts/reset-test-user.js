// Resets test user (11111111...) data so the join flow can be tested fresh.
// Run: node scripts/reset-test-user.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const USER_ID = '11111111-1111-1111-1111-111111111111';

async function run() {
  const ct = await pool.query(
    'DELETE FROM credit_transactions WHERE user_id = $1',
    [USER_ID]
  );
  console.log('credit_transactions deleted:', ct.rowCount);

  const at = await pool.query('DELETE FROM attendances WHERE user_id = $1', [
    USER_ID,
  ]);
  console.log('attendances deleted:', at.rowCount);

  const mb = await pool.query('DELETE FROM memberships WHERE user_id = $1', [
    USER_ID,
  ]);
  console.log('memberships deleted:', mb.rowCount);

  const us = await pool.query(
    "UPDATE users SET name = 'New Member', updated_at = NOW() WHERE id = $1",
    [USER_ID]
  );
  console.log('user name reset:', us.rowCount);

  console.log('\nDone. Join code is: DEMO01');
}

run()
  .catch((e) => console.error(e.message))
  .finally(() => pool.end());
