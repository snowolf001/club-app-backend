// Adds 12 test members with credits to the first club, for PDF report testing.
// Run: node scripts/add-test-members.js
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

const pool = new Pool({
  connectionString:
    'postgresql://postgres:EMELqsDeAhRVyEVNYwlcSieDYQsVCllY@interchange.proxy.rlwy.net:18496/railway',
  ssl: { rejectUnauthorized: false },
});

const MEMBERS = [
  'Alex Rivera',
  'Jordan Blake',
  'Morgan Chen',
  'Taylor Kim',
  'Casey Torres',
  'Riley Patel',
  'Avery Walsh',
  'Quinn Nguyen',
  'Skyler Okafor',
  'Reese Müller',
  'Parker Ibáñez',
  'Drew Kowalski',
];

function recoveryCode() {
  const seg = () =>
    Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, '0');
  return `${seg()}-${seg()}-${seg()}`;
}

async function main() {
  // Target the first club
  const { rows: clubs } = await pool.query(
    'SELECT id, name FROM clubs LIMIT 1'
  );
  if (clubs.length === 0) throw new Error('No clubs found in DB.');
  const { id: clubId, name: clubName } = clubs[0];
  console.log(`Adding members to club: ${clubName} (${clubId})\n`);

  // Check columns — credits may live on memberships or a separate table
  const { rows: mCols } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='memberships' ORDER BY ordinal_position"
  );
  const membershipCols = mCols.map((r) => r.column_name);
  const hasCredits = membershipCols.includes('credits_remaining');
  console.log('Membership columns:', membershipCols.join(', '));
  console.log('credits_remaining on memberships:', hasCredits);

  const { rows: uCols } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='users' ORDER BY ordinal_position"
  );
  console.log('User columns:', uCols.map((r) => r.column_name).join(', '));

  for (const name of MEMBERS) {
    const userId = randomUUID();

    // Create user
    await pool.query(
      `INSERT INTO users (id, name, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [userId, name]
    );

    const code = recoveryCode();
    const credits = Math.floor(Math.random() * 16) + 5; // 5–20 credits

    if (hasCredits) {
      await pool.query(
        `INSERT INTO memberships (id, club_id, user_id, role, recovery_code, credits_remaining, created_at, updated_at)
         VALUES ($1, $2, $3, 'member', $4, $5, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [randomUUID(), clubId, userId, code, credits]
      );
    } else {
      await pool.query(
        `INSERT INTO memberships (id, club_id, user_id, role, recovery_code, created_at, updated_at)
         VALUES ($1, $2, $3, 'member', $4, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [randomUUID(), clubId, userId, code]
      );
    }

    console.log(
      `  ✓ ${name}  recovery: ${code}  credits: ${hasCredits ? credits : 'n/a'}`
    );
  }

  console.log('\nDone! 12 test members added.');
}

main()
  .catch((e) => console.error('Error:', e.message))
  .finally(() => pool.end());
