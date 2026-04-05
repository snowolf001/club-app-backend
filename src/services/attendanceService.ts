import { pool } from '../db/pool';

// ─── Types ────────────────────────────────────────────────────────────────────

type AttendanceRow = {
  attendance_id: string;
  session_id: string;
  session_title: string;
  checked_in_at: string;
  credits_used: number;
  starts_at: string;
  ends_at: string | null;
};

export type AttendanceItem = {
  attendanceId: string;
  sessionId: string;
  sessionTitle: string;
  checkedInAt: string;
  creditsUsed: number;
  sessionStartTime: string;
  sessionEndTime: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ATTENDANCE_SELECT = `
  SELECT
    a.id         AS attendance_id,
    a.session_id,
    s.title      AS session_title,
    a.checked_in_at,
    a.credits_used,
    s.starts_at,
    s.ends_at
  FROM attendances a
  JOIN sessions s ON s.id = a.session_id
`;

function mapRow(row: AttendanceRow): AttendanceItem {
  return {
    attendanceId: row.attendance_id,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    checkedInAt: row.checked_in_at,
    creditsUsed: row.credits_used,
    sessionStartTime: row.starts_at,
    sessionEndTime: row.ends_at,
  };
}

// ─── Exported functions ───────────────────────────────────────────────────────

export async function getAttendanceForUser(
  userId: string
): Promise<AttendanceItem[]> {
  const result = await pool.query<AttendanceRow>(
    `${ATTENDANCE_SELECT}
     WHERE a.user_id = $1
     ORDER BY a.checked_in_at DESC`,
    [userId]
  );

  return result.rows.map(mapRow);
}

export async function getAttendanceForMembership(
  membershipId: string
): Promise<AttendanceItem[]> {
  const result = await pool.query<AttendanceRow>(
    `${ATTENDANCE_SELECT}
     WHERE a.membership_id = $1
     ORDER BY a.checked_in_at DESC`,
    [membershipId]
  );

  return result.rows.map(mapRow);
}
