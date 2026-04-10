import { db } from '../src/db/index';
async function q() {
  const r = await db.query('SELECT COUNT(*) FROM sessions');
  console.log('Total sessions:', r.rows[0].count);
  process.exit();
}
q().catch(console.error);
