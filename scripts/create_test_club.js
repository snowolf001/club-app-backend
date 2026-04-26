/**
 * Create a fresh test club with an owner membership.
 *
 * Usage:
 *   node scripts/create_test_club.js <user_id> [club_name]
 *
 * Example:
 *   node scripts/create_test_club.js 66511256-d206-4721-a92c-cca79df573d1 "Yearly Test Club"
 *
 * Output:
 *   club_id, join_code, membership_id, recovery_code
 *   — everything you need to log in and test subscriptions.
 */

'use strict';

const { Pool } = require('pg');
const { randomBytes } = require('crypto');

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:EMELqsDeAhRVyEVNYwlcSieDYQsVCllY@interchange.proxy.rlwy.net:18496/railway';

const userId = process.argv[2];
const clubName = process.argv[3] || 'Test Club ' + new Date().toISOString().slice(0, 10);

if (!userId) {
  console.error('Usage: node scripts/create_test_club.js <user_id> [club_name]');
  process.exit(1);
}

// Same format as the real backend generateJoinCode(): 8 uppercase hex chars, no hyphens
function generateJoinCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

// Recovery code: XXXX-XXXX-XXXX (same as backend generateRecoveryCode())
function generateRecoveryCode() {
  const hex = randomBytes(6).toString('hex').toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

async function main() {
  const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1) Create club
    const joinCode = generateJoinCode();
    const clubResult = await client.query(
      `INSERT INTO clubs (name, join_code, pro_status)
       VALUES ($1, $2, 'free')
       RETURNING id, name, join_code`,
      [clubName, joinCode]
    );
    const club = clubResult.rows[0];

    // 2) Create owner membership
    const recoveryCode = generateRecoveryCode();
    const memberResult = await client.query(
      `INSERT INTO memberships (club_id, user_id, display_name, role, status, credits_remaining, recovery_code)
       VALUES ($1, $2, 'Test Owner', 'owner', 'active', 0, $3)
       RETURNING id, recovery_code`,
      [club.id, userId, recoveryCode]
    );
    const membership = memberResult.rows[0];

    await client.query('COMMIT');

    console.log('\n✅ Test club created successfully!\n');
    console.log('┌─────────────────────────────────────────────────────');
    console.log(`│  Club Name      : ${club.name}`);
    console.log(`│  club_id        : ${club.id}`);
    console.log(`│  join_code      : ${club.join_code}`);
    console.log(`│  membership_id  : ${membership.id}`);
    console.log(`│  recovery_code  : ${membership.recovery_code}`);
    console.log('└─────────────────────────────────────────────────────');
    console.log('\nNext steps:');
    console.log('  1. In app, join club with join_code or use recovery_code to log in');
    console.log('  2. Purchase yearly subscription with a fresh sandbox account');
    console.log(`  3. Check DB: SELECT * FROM club_subscriptions WHERE club_id = '${club.id}';`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
