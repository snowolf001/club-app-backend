const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  const migrationsDir = path.join(process.cwd(), 'sql', 'migrations');

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    console.log(`Running migration: ${file}`);

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    await pool.query(sql);
  }

  console.log('Migrations complete');

  await pool.end();
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
