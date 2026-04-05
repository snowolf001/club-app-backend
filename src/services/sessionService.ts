import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';

// ─── Row types ────────────────────────────────────────────────────────────────

type SessionRow = {
  id: string;
  club_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  created_at: string;
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
  title: string;
  startTime: string;
  endTime: string | null;
  createdAt: string;
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
  };
}

const SESSION_SELECT = `
  SELECT id, club_id, title, starts_at, ends_at, created_at
  FROM sessions
`;

// ─── Exported functions ───────────────────────────────────────────────────────

export async function getSessionsByClub(
  clubId: string
): Promise<SessionItem[]> {
  const result = await pool.query<SessionRow>(
    `${SESSION_SELECT}
     WHERE club_id = $1
     ORDER BY starts_at ASC`,
    [clubId]
  );

  return result.rows.map(mapSessionRow);
}

export async function getSessionById(sessionId: string): Promise<SessionItem> {
  const result = await pool.query<SessionRow>(
    `${SESSION_SELECT}
     WHERE id = $1
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
  title: string;
  startTime: string;
  endTime?: string | null;
}): Promise<SessionItem> {
  const { clubId, title, startTime, endTime } = params;
  const result = await pool.query<SessionRow>(
    `INSERT INTO sessions (club_id, title, starts_at, ends_at)
     VALUES ($1, $2, $3, $4) RETURNING id, club_id, title, starts_at, ends_at, created_at`,
    [clubId, title.trim(), startTime, endTime ?? null]
  );
  return mapSessionRow(result.rows[0]);
}
