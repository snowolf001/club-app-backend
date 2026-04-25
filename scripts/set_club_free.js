/**
 * set_club_free.js
 *
 * Resets a club's Pro status to free and expires all active/scheduled
 * subscriptions for that club.
 *
 * Usage:
 *   node scripts/set_club_free.js <club_id>
 *
 * The script prints a summary of what it changed and asks for confirmation
 * before writing anything to the database.
 *
 * Requires DATABASE_URL in environment (or .env file).
 */

require('dotenv').config();
const { Client } = require('pg');
const readline = require('readline');

const clubId = process.argv[2];

if (!clubId) {
  console.error('Usage: node scripts/set_club_free.js <club_id>');
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  await client.connect();

  // 1) Fetch club info
  const clubRes = await client.query(
    `SELECT id, name, pro_status, pro_expires_at FROM clubs WHERE id = $1`,
    [clubId]
  );

  if (clubRes.rowCount === 0) {
    console.error(`No club found with id: ${clubId}`);
    await client.end();
    process.exit(1);
  }

  const club = clubRes.rows[0];
  console.log('\nClub:');
  console.log(`  id:             ${club.id}`);
  console.log(`  name:           ${club.name}`);
  console.log(`  pro_status:     ${club.pro_status}`);
  console.log(`  pro_expires_at: ${club.pro_expires_at ?? '(none)'}`);

  if (club.pro_status === 'free') {
    console.log('\nClub is already free. Nothing to do.');
    await client.end();
    return;
  }

  // 2) Fetch active / scheduled subscriptions
  const subRes = await client.query(
    `SELECT id, platform, plan, status, transaction_id, original_transaction_id, ends_at
       FROM club_subscriptions
      WHERE club_id = $1
        AND status IN ('active', 'scheduled', 'canceled')
      ORDER BY ends_at DESC`,
    [clubId]
  );

  console.log(`\nSubscriptions to expire (${subRes.rowCount} row(s)):`);
  if (subRes.rowCount === 0) {
    console.log('  (none)');
  } else {
    for (const s of subRes.rows) {
      console.log(
        `  [${s.id}] platform=${s.platform} plan=${s.plan} status=${s.status} ends_at=${s.ends_at ?? '(none)'}`
      );
    }
  }

  console.log('\nThis will:');
  console.log('  1. Set clubs.pro_status = \'free\', pro_expires_at = NULL');
  console.log(`  2. Mark ${subRes.rowCount} subscription row(s) as \'expired\'`);

  const answer = await prompt('\nProceed? (yes/no): ');
  if (answer !== 'yes') {
    console.log('Aborted.');
    await client.end();
    return;
  }

  // 3) Apply changes in a transaction
  try {
    await client.query('BEGIN');

    // Expire active/scheduled/canceled subscriptions
    if (subRes.rowCount > 0) {
      await client.query(
        `UPDATE club_subscriptions
            SET status = 'expired',
                updated_at = NOW()
          WHERE club_id = $1
            AND status IN ('active', 'scheduled', 'canceled')`,
        [clubId]
      );
    }

    // Reset club Pro cache
    await client.query(
      `UPDATE clubs
          SET pro_status = 'free',
              pro_expires_at = NULL,
              pro_updated_at = NOW()
        WHERE id = $1`,
      [clubId]
    );

    await client.query('COMMIT');
    console.log(`\nDone. Club "${club.name}" is now free.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nTransaction failed, rolled back:', err.message);
    process.exit(1);
  }

  await client.end();
}

main().catch(async (err) => {
  console.error('Unexpected error:', err.message);
  try { await client.end(); } catch (_) {}
  process.exit(1);
});
