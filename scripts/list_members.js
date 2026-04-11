require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  const res = await client.query(
    `SELECT display_name, role, credits_remaining, recovery_code
     FROM memberships
     WHERE status = 'active'
     ORDER BY role, display_name`
  );
  console.log(`\nTotal members: ${res.rows.length}\n`);
  console.log(
    'Name'.padEnd(30) +
      'Role'.padEnd(12) +
      'Credits'.padEnd(10) +
      'Recovery Code'
  );
  console.log('-'.repeat(80));
  for (const row of res.rows) {
    console.log(
      row.display_name.padEnd(30) +
        row.role.padEnd(12) +
        String(row.credits_remaining).padEnd(10) +
        row.recovery_code
    );
  }
  await client.end();
}

main().catch(console.error);
