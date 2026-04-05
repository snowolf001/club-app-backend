import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';

// ─── Row types ────────────────────────────────────────────────────────────────

type SessionRow = {
  id: string;
  club_id: string;
  title: string | null;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
  location_id: string | null;
  location_name: string | null;
};

type CheckedInRow = {
  membership_id: string;
  user_id: string;
  user_name: string;
  role: string;
  checked_in_at: string;
  credits_used: number;
};

// ─── Public types ─────────────────────────────────────────────────────────────

export type SessionItem = {
  id: string;
  clubId: string;
  title: string | null;
  startTime: string;
  endTime: string | null;
  createdAt: string;
  locationId: string | null;
  locationName: string | null;
};

export type CheckedInMember = {
  membershipId: string;
  userId: string;
  userName: string;
  role: string;
  checkedInAt: string;
  creditsUsed: number;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapSessionRow(row: SessionRow): SessionItem {
  return {
    id: row.id,
    clubId: row.club_id,
    title: row.title,
    startTime: row.starts_at,
    endTime: row.ends_at,
    createdAt: row.created_at,
    locationId: row.location_id,
    locationName: row.location_name,
  };
}

const SESSION_SELECT = `
  SELECT s.id, s.club_id, s.title, s.starts_at, s.ends_at, s.created_at,
         s.location_id, cl.name AS location_name
  FROM sessions s
  LEFT JOIN club_locations cl ON cl.id = s.location_id
`;

// ─── Exported functions ───────────────────────────────────────────────────────

export async function getSessionsByClub(
  clubId: string
): Promise<SessionItem[]> {
  const result = await pool.query<SessionRow>(
    `${SESSION_SELECT}
     WHERE s.club_id = $1
     ORDER BY s.starts_at ASC`,
    [clubId]
  );

  return result.rows.map(mapSessionRow);
}

export async function getSessionById(sessionId: string): Promise<SessionItem> {
  const result = await pool.query<SessionRow>(
    `${SESSION_SELECT}
     WHERE s.id = $1
     LIMIT 1`,
    [sessionId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  }

  return mapSessionRow(result.rows[0]);
}

export async function getCheckedInMembers(
  sessionId: string
): Promise<CheckedInMember[]> {
  const result = await pool.query<CheckedInRow>(
    `
      SELECT
        a.membership_id,
        a.user_id,
        u.name    AS user_name,
        m.role,
        a.checked_in_at,
        a.credits_used
      FROM attendances a
      JOIN users u ON u.id = a.user_id
      JOIN memberships m ON m.id = a.membership_id
      WHERE a.session_id = $1
      ORDER BY a.checked_in_at ASC
    `,
    [sessionId]
  );

  return result.rows.map((row) => ({
    membershipId: row.membership_id,
    userId: row.user_id,
    userName: row.user_name,
    role: row.role,
    checkedInAt: row.checked_in_at,
    creditsUsed: row.credits_used,
  }));
}

export async function createSession(params: {
  clubId: string;
  title?: string | null;
  locationId: string;
  startTime: string;
  endTime?: string | null;
}): Promise<SessionItem> {
  const { clubId, title, locationId, startTime, endTime } = params;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO sessions (club_id, title, location_id, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      clubId,
      title ? title.trim() : null,
      locationId,
      startTime,
      endTime ?? null,
    ]
  );
  return getSessionById(result.rows[0].id);
}
