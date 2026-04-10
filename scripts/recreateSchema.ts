import fs from 'fs';
import path from 'path';
import { db } from '../src/db/index';

async function main() {
  console.log('--- DB SCHEMA RECREATION (DANGER) ---');
  try {
    console.log('1. Dropping existing sub-schemas and recreating...');
    await db.query(`DROP SCHEMA public CASCADE;`);
    await db.query(`CREATE SCHEMA public;`);
    await db.query(`GRANT ALL ON SCHEMA public TO postgres;`);
    await db.query(`GRANT ALL ON SCHEMA public TO public;`);

    console.log('2. Running 001_initial_schema.sql...');
    const schemaPath = path.join(
      __dirname,
      '../sql/migrations/001_initial_schema.sql'
    );
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Split statements or run directly; pg pool.query handles multiple statements ok.
    await db.query(schemaSql);

    console.log('✅ Base schema successfully generated and columns verified!');
  } catch (error) {
    console.error('❌ Failed to run schema reset:', error);
    process.exit(1);
  } finally {
    // End the pool so the script exits
    await db.end();
    process.exit(0);
  }
}

main();
