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
  check_in_method: string;
};

export type AttendanceItem = {
  attendanceId: string;
  sessionId: string;
  sessionTitle: string;
  checkedInAt: string;
  creditsUsed: number;
  sessionStartTime: string;
  sessionEndTime: string | null;
  checkInMethod: string;
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
    s.ends_at,
    a.check_in_method
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
    checkInMethod: row.check_in_method,
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

// ─── Credit transactions ──────────────────────────────────────────────────────

export type CreditTransactionItem = {
  transactionId: string;
  amount: number; // negative = deducted, positive = added
  transactionType: string; // 'checkin' | 'add'
  note: string | null;
  sessionTitle: string | null;
  actorName: string | null; // name of who added credits (null for self check-ins)  createdAt: string;
};

export async function getCreditTransactionsForUser(
  userId: string
): Promise<CreditTransactionItem[]> {
  const result = await pool.query<{
    id: string;
    amount: number;
    transaction_type: string;
    note: string | null;
    session_title: string | null;
    actor_name: string | null;
    created_at: string;
  }>(
    `
      SELECT
        ct.id,
        ct.amount,
        ct.transaction_type,
        ct.note,
        s.title AS session_title,
        u.name  AS actor_name,
        ct.created_at
      FROM credit_transactions ct
      LEFT JOIN sessions s ON s.id = ct.session_id
      LEFT JOIN users   u ON u.id = ct.actor_user_id
      WHERE ct.user_id = $1
      ORDER BY ct.created_at DESC
    `,
    [userId]
  );

  return result.rows.map((row) => ({
    transactionId: row.id,
    amount: row.amount,
    transactionType: row.transaction_type,
    note: row.note,
    sessionTitle: row.session_title,
    actorName: row.actor_name,
    createdAt: row.created_at,
  }));
}
