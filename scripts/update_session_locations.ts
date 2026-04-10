import { db } from './src/db';
async function update() {
  const result = await db.query(\
    UPDATE sessions s
    SET location_id = (
      SELECT id FROM club_locations cl WHERE cl.club_id = s.club_id ORDER BY created_at ASC LIMIT 1
    )
    WHERE s.location_id IS NULL;
  \);
  console.log('Updated ' + result.rowCount + ' sessions');
  process.exit(0);
}
update().catch(console.error);