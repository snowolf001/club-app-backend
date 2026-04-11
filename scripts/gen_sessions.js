require('dotenv').config();
const { Client } = require('pg');

const CLUB_ID = 'b4c3f62d-e713-45d6-b7f4-511800a4e6c3';

const LOCATIONS = [
  'f611f5fc-c744-4de1-b7ef-ed65b1b99d40', // Main Gym
  '2e77e29f-00af-4624-b967-ddac5e6af8a9', // Downtown Studio
  '1ac3d92e-1cbd-4688-9c70-1878042b70d5', // Outdoor Court
  'b0d79d04-5278-4225-8205-46fe6d5a619b', // Community Center
  '401ef903-3140-432c-97a6-625dc632b21f', // East Side Hall
  '611827d1-a7cf-4edb-8377-f87fcf8351b8', // West End Field
];

const TITLES = [
  'Power Hour',
  'HIIT Class',
  'Yoga Flow',
  'Circuit Training',
  'Endurance Run',
  'Evening Workout',
  'Morning Burn',
  'Skills Workshop',
  'Recovery Session',
  'Strength Training',
  'Cardio Blast',
  'Core & Flex',
];

// Random start hours: 6am, 7am, 8am, 9am, 10am, 12pm, 5pm, 6pm, 7pm
const START_HOURS = [6, 7, 8, 9, 10, 12, 17, 18, 19];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Build set of dates for next 30 days (today inclusive)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    dates.push(toDateStr(d));
  }

  // Get existing session dates in this range
  const res = await client.query(
    `SELECT DISTINCT DATE(starts_at AT TIME ZONE 'UTC') as d
     FROM sessions
     WHERE club_id = $1
       AND starts_at >= $2
       AND starts_at < $3`,
    [CLUB_ID, dates[0], new Date(today.getTime() + 30 * 86400000).toISOString()]
  );
  const existing = new Set(res.rows.map((r) => toDateStr(new Date(r.d))));

  const missing = dates.filter((d) => !existing.has(d));
  console.log(
    `Existing sessions on ${existing.size} days, generating ${missing.length} new sessions...`
  );

  for (const dateStr of missing) {
    const hour = pick(START_HOURS);
    const startsAt = new Date(
      `${dateStr}T${String(hour).padStart(2, '0')}:00:00Z`
    );
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000); // 1 hour later
    const title = pick(TITLES);
    const locationId = pick(LOCATIONS);
    const capacity = [10, 15, 20, 25, 30][Math.floor(Math.random() * 5)];

    await client.query(
      `INSERT INTO sessions (club_id, location_id, title, starts_at, ends_at, capacity, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
      [CLUB_ID, locationId, title, startsAt, endsAt, capacity]
    );
    console.log(`  + ${dateStr}  ${title}  ${hour}:00`);
  }

  console.log('\nDone.');
  await client.end();
}

main().catch(console.error);
