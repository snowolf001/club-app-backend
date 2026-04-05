const { Pool } = require('pg');

const pool = new Pool({
  connectionString:
    'postgresql://postgres:EMELqsDeAhRVyEVNYwlcSieDYQsVCllY@interchange.proxy.rlwy.net:18496/railway',
  ssl: { rejectUnauthorized: false },
});

async function main() {
  // Use the first club in the DB
  const clubResult = await pool.query('SELECT id, name FROM clubs LIMIT 1');
  if (clubResult.rowCount === 0) {
    console.error('No clubs found.');
    return;
  }
  const { id: clubId, name: clubName } = clubResult.rows[0];
  console.log(`Seeding sessions for club: ${clubName} (${clubId})`);

  const sessions = [
    {
      title: 'Monday Morning Session',
      starts_at: '2026-03-30 09:00:00+00',
      ends_at: '2026-03-30 10:30:00+00',
    },
    {
      title: 'Wednesday Evening Session',
      starts_at: '2026-04-01 18:00:00+00',
      ends_at: '2026-04-01 19:30:00+00',
    },
    {
      title: 'Friday Strength Class',
      starts_at: '2026-04-03 07:00:00+00',
      ends_at: '2026-04-03 08:00:00+00',
    },
    {
      title: 'Saturday Open Session',
      starts_at: '2026-04-04 10:00:00+00',
      ends_at: '2026-04-04 11:30:00+00',
    },
  ];

  for (const s of sessions) {
    const result = await pool.query(
      `INSERT INTO sessions (club_id, title, starts_at, ends_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, starts_at`,
      [clubId, s.title, s.starts_at, s.ends_at]
    );
    console.log('Created:', result.rows[0]);
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error('Error:', e.message);
    pool.end();
  });
