import { db } from '../src/db/index';
async function q() {
  const r = await db.query('SELECT starts_at, ends_at FROM sessions ORDER BY starts_at ASC LIMIT 5');
  console.log(r.rows);
  const r2 = await db.query('SELECT starts_at, ends_at FROM sessions ORDER BY starts_at DESC LIMIT 5');
  console.log(r2.rows);
  process.exit();
}
q().catch(console.error);
