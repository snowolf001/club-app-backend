require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  const res = await client.query(
    "SELECT memberships.recovery_code, memberships.display_name FROM memberships WHERE role = 'owner' LIMIT 1"
  );
  console.log('OWNER NAME:', res.rows[0].display_name);
  console.log('RECOVERY CODE:', res.rows[0].recovery_code);
  await client.end();
}

main().catch(console.error);
