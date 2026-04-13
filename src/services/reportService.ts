import { pool } from '../db/pool';

// ─── Session Attendees ────────────────────────────────────────────────────────

type SessionAttendeeRow = {
  attendance_id: string;
  membership_id: string;
  member_name: string;
  credits_used: number;
  check_in_method: string;
  checked_in_at: string;
  checked_in_by_user_id: string | null;
  checked_in_by_name: string | null;
};

type SessionInfoRow = {
  id: string;
  title: string | null;
  location_id: string;
  location_name: string | null;
  starts_at: string;
  ends_at: string | null;
  club_id: string;
};

export type SessionAttendeeItem = {
  attendanceId: string;
  memberId: string;
  memberName: string;
  creditsUsed: number;
  checkInType: 'live' | 'backfill' | 'manual';
  checkedInAt: string;
  checkedInByUserId: string | null;
  checkedInByName: string | null;
};

export type SessionAttendeesResult = {
  session: {
    id: string;
    clubId: string;
    title: string | null;
    locationId: string;
    locationName: string | null;
    startsAt: string;
    endsAt: string | null;
  };
  attendees: SessionAttendeeItem[];
  summary: {
    totalCheckIns: number;
    totalParticipation: number;
    uniqueMembers: number;
  };
};

function mapCheckInType(method: string): 'live' | 'backfill' | 'manual' {
  if (method === 'manual') return 'manual';
  if (method === 'backfill') return 'backfill';
  return 'live';
}

export async function getSessionAttendees(
  sessionId: string
): Promise<SessionAttendeesResult> {
  const sessionResult = await pool.query<SessionInfoRow>(
    `
      SELECT s.id, s.title, s.location_id, cl.name AS location_name,
             s.starts_at, s.ends_at, s.club_id
      FROM sessions s
      LEFT JOIN club_locations cl ON cl.id = s.location_id
      WHERE s.id = $1
      LIMIT 1
    `,
    [sessionId]
  );

  const sessionRow = sessionResult.rows[0];

  const attendeesResult = await pool.query<SessionAttendeeRow>(
    `
      SELECT
        a.id             AS attendance_id,
        a.membership_id,
        u.name           AS member_name,
        a.credits_used,
        a.check_in_method,
        a.checked_in_at,
        a.checked_in_by_user_id,
        cbu.name         AS checked_in_by_name
      FROM attendances a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN users cbu ON cbu.id = a.checked_in_by_user_id
      WHERE a.session_id = $1
      ORDER BY a.checked_in_at ASC
    `,
    [sessionId]
  );

  const attendees: SessionAttendeeItem[] = attendeesResult.rows.map((row) => ({
    attendanceId: row.attendance_id,
    memberId: row.membership_id,
    memberName: row.member_name,
    creditsUsed: row.credits_used,
    checkInType: mapCheckInType(row.check_in_method),
    checkedInAt: row.checked_in_at,
    checkedInByUserId: row.checked_in_by_user_id,
    checkedInByName: row.checked_in_by_name,
  }));

  const totalParticipation = attendees.reduce(
    (sum, a) => sum + a.creditsUsed,
    0
  );
  const uniqueMembers = new Set(attendees.map((a) => a.memberId)).size;

  return {
    session: {
      id: sessionRow.id,
      clubId: sessionRow.club_id,
      title: sessionRow.title,
      locationId: sessionRow.location_id,
      locationName: sessionRow.location_name,
      startsAt: sessionRow.starts_at,
      endsAt: sessionRow.ends_at,
    },
    attendees,
    summary: {
      totalCheckIns: attendees.length,
      totalParticipation,
      uniqueMembers,
    },
  };
}

// ─── Member History ───────────────────────────────────────────────────────────

type MemberHistoryRow = {
  attendance_id: string;
  session_id: string;
  session_title: string | null;
  location_name: string | null;
  session_starts_at: string;
  session_ends_at: string | null;
  credits_used: number;
  check_in_method: string;
  checked_in_at: string;
  checked_in_by_name: string | null;
};

export type MemberHistoryItem = {
  attendanceId: string;
  sessionId: string;
  sessionTitle: string | null;
  locationName: string | null;
  sessionStartsAt: string;
  sessionEndsAt: string | null;
  creditsUsed: number;
  checkInType: 'live' | 'backfill' | 'manual';
  checkedInAt: string;
  checkedInByName: string | null;
};

export type MemberHistoryResult = {
  member: {
    membershipId: string;
    userId: string;
    name: string;
  };
  items: MemberHistoryItem[];
  summary: {
    totalAttendances: number;
    totalParticipation: number;
  };
};

export async function getMemberHistory(params: {
  membershipId: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}): Promise<MemberHistoryResult> {
  const { membershipId, startDate, endDate, limit = 100 } = params;

  // Look up membership info
  const memberResult = await pool.query<{
    id: string;
    user_id: string;
    user_name: string;
  }>(
    `SELECT m.id, m.user_id, u.name AS user_name
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.id = $1 LIMIT 1`,
    [membershipId]
  );

  const memberRow = memberResult.rows[0];

  const conditions: string[] = ['a.membership_id = $1'];
  const values: unknown[] = [membershipId];
  let paramIdx = 2;

  if (startDate) {
    conditions.push(`s.starts_at >= $${paramIdx++}`);
    values.push(startDate);
  }
  if (endDate) {
    conditions.push(`s.starts_at <= $${paramIdx++}`);
    values.push(endDate);
  }

  values.push(limit);

  const historyResult = await pool.query<MemberHistoryRow>(
    `
      SELECT
        a.id             AS attendance_id,
        a.session_id,
        s.title          AS session_title,
        cl.name          AS location_name,
        s.starts_at      AS session_starts_at,
        s.ends_at        AS session_ends_at,
        a.credits_used,
        a.check_in_method,
        a.checked_in_at,
        cbu.name         AS checked_in_by_name
      FROM attendances a
      JOIN sessions s ON s.id = a.session_id
      LEFT JOIN club_locations cl ON cl.id = s.location_id
      LEFT JOIN users cbu ON cbu.id = a.checked_in_by_user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.starts_at DESC
      LIMIT $${paramIdx}
    `,
    values
  );

  const items: MemberHistoryItem[] = historyResult.rows.map((row) => ({
    attendanceId: row.attendance_id,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    locationName: row.location_name,
    sessionStartsAt: row.session_starts_at,
    sessionEndsAt: row.session_ends_at,
    creditsUsed: row.credits_used,
    checkInType: mapCheckInType(row.check_in_method),
    checkedInAt: row.checked_in_at,
    checkedInByName: row.checked_in_by_name,
  }));

  const totalParticipation = items.reduce((sum, i) => sum + i.creditsUsed, 0);

  return {
    member: {
      membershipId: memberRow.id,
      userId: memberRow.user_id,
      name: memberRow.user_name,
    },
    items,
    summary: {
      totalAttendances: items.length,
      totalParticipation,
    },
  };
}

// ─── Attendance Report (multi-session) ───────────────────────────────────────

type AttendanceReportRow = {
  attendance_id: string;
  session_id: string;
  session_title: string | null;
  session_starts_at: string;
  location_name: string | null;
  membership_id: string;
  member_name: string;
  credits_used: number;
  check_in_method: string;
  checked_in_at: string;
  checked_in_by_name: string | null;
};

export type AttendanceReportItem = {
  attendanceId: string;
  sessionId: string;
  sessionTitle: string | null;
  sessionStartsAt: string;
  locationName: string | null;
  memberId: string;
  memberName: string;
  creditsUsed: number;
  checkInType: string;
  checkedInAt: string;
  checkedInByName: string | null;
};

export type AttendanceReportResult = {
  items: AttendanceReportItem[];
  summary: {
    totalCheckIns: number;
    totalParticipation: number;
    uniqueMembers: number;
    totalSessions: number;
  };
};

export async function getAttendanceReport(params: {
  clubId: string;
  startDate?: string;
  endDate?: string;
  sessionIds?: string[];
  memberId?: string;
  locationId?: string;
  limit?: number;
}): Promise<AttendanceReportResult> {
  const {
    clubId,
    startDate,
    endDate,
    sessionIds,
    memberId,
    locationId,
    limit = 500,
  } = params;

  const conditions: string[] = ['a.club_id = $1'];
  const values: unknown[] = [clubId];
  let paramIdx = 2;

  if (startDate) {
    conditions.push(`s.starts_at >= $${paramIdx++}`);
    values.push(startDate);
  }
  if (endDate) {
    conditions.push(`s.starts_at <= $${paramIdx++}`);
    values.push(endDate);
  }
  if (sessionIds && sessionIds.length > 0) {
    conditions.push(`a.session_id = ANY($${paramIdx++}::uuid[])`);
    values.push(sessionIds);
  }
  if (memberId) {
    conditions.push(`a.membership_id = $${paramIdx++}`);
    values.push(memberId);
  }
  if (locationId) {
    conditions.push(`s.location_id = $${paramIdx++}`);
    values.push(locationId);
  }

  values.push(limit);

  const result = await pool.query<AttendanceReportRow>(
    `
      SELECT
        a.id             AS attendance_id,
        a.session_id,
        s.title          AS session_title,
        s.starts_at      AS session_starts_at,
        cl.name          AS location_name,
        a.membership_id,
        u.name           AS member_name,
        a.credits_used,
        a.check_in_method,
        a.checked_in_at,
        cbu.name         AS checked_in_by_name
      FROM attendances a
      JOIN sessions s ON s.id = a.session_id
      JOIN users u ON u.id = a.user_id
      LEFT JOIN club_locations cl ON cl.id = s.location_id
      LEFT JOIN users cbu ON cbu.id = a.checked_in_by_user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY s.starts_at DESC, a.checked_in_at ASC
      LIMIT $${paramIdx}
    `,
    values
  );

  const items: AttendanceReportItem[] = result.rows.map((row) => ({
    attendanceId: row.attendance_id,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    sessionStartsAt: row.session_starts_at,
    locationName: row.location_name,
    memberId: row.membership_id,
    memberName: row.member_name,
    creditsUsed: row.credits_used,
    checkInType: mapCheckInType(row.check_in_method),
    checkedInAt: row.checked_in_at,
    checkedInByName: row.checked_in_by_name,
  }));

  const uniqueMembers = new Set(items.map((i) => i.memberId)).size;
  const totalSessions = new Set(items.map((i) => i.sessionId)).size;
  const totalParticipation = items.reduce((sum, i) => sum + i.creditsUsed, 0);

  return {
    items,
    summary: {
      totalCheckIns: items.length,
      totalParticipation,
      uniqueMembers,
      totalSessions,
    },
  };
}

// ─── Sessions Breakdown (grouped by session) ─────────────────────────────────

type SessionSummaryRow = {
  session_id: string;
  title: string | null;
  location_name: string | null;
  starts_at: string;
  ends_at: string | null;
  attendee_count: string;
  total_credits_used: string;
};

type SessionAttendeeDetailRow = {
  session_id: string;
  attendance_id: string;
  membership_id: string;
  member_name: string;
  credits_used: number;
  check_in_method: string;
  checked_in_at: string;
  checked_in_by_user_id: string | null;
  checked_in_by_name: string | null;
};

export type SessionBreakdownItem = {
  sessionId: string;
  title: string | null;
  locationName: string | null;
  startsAt: string;
  endsAt: string | null;
  totalCheckIns: number;
  totalParticipation: number;
  attendees: SessionAttendeeItem[];
};

export type SessionsBreakdownResult = {
  sessions: SessionBreakdownItem[];
  summary: {
    totalSessions: number;
    totalCheckIns: number;
    uniqueMembers: number;
    totalParticipation: number;
  };
};

export async function getSessionsBreakdown(params: {
  clubId: string;
  startDate?: string;
  endDate?: string;
  lastOnly?: boolean;
}): Promise<SessionsBreakdownResult> {
  const { clubId, startDate, endDate, lastOnly } = params;

  const conditions: string[] = ['s.club_id = $1'];
  const values: unknown[] = [clubId];
  let paramIdx = 2;

  if (lastOnly) {
    // Only show sessions that have already started
    conditions.push(`s.starts_at <= NOW()`);
  } else {
    if (startDate) {
      conditions.push(`s.starts_at >= $${paramIdx++}`);
      values.push(startDate);
    }
    if (endDate) {
      conditions.push(`s.starts_at <= $${paramIdx++}`);
      values.push(endDate);
    }
  }

  const limitClause = lastOnly ? 'LIMIT 1' : '';

  const sessionsResult = await pool.query<SessionSummaryRow>(
    `
      SELECT
        s.id AS session_id,
        s.title,
        cl.name AS location_name,
        s.starts_at,
        s.ends_at,
        COUNT(a.id) AS attendee_count,
        COALESCE(SUM(a.credits_used), 0) AS total_credits_used
      FROM sessions s
      LEFT JOIN attendances a ON a.session_id = s.id
      LEFT JOIN club_locations cl ON cl.id = s.location_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY s.id, s.title, cl.name, s.starts_at, s.ends_at
      ORDER BY s.starts_at DESC
      ${limitClause}
    `,
    values
  );

  if (sessionsResult.rows.length === 0) {
    return {
      sessions: [],
      summary: {
        totalSessions: 0,
        totalCheckIns: 0,
        uniqueMembers: 0,
        totalParticipation: 0,
      },
    };
  }

  const sessionIds = sessionsResult.rows.map((r) => r.session_id);

  const attendeesResult = await pool.query<SessionAttendeeDetailRow>(
    `
      SELECT
        a.session_id,
        a.id AS attendance_id,
        a.membership_id,
        u.name AS member_name,
        a.credits_used,
        a.check_in_method,
        a.checked_in_at,
        a.checked_in_by_user_id,
        cbu.name AS checked_in_by_name
      FROM attendances a
      JOIN users u ON u.id = a.user_id
      LEFT JOIN users cbu ON cbu.id = a.checked_in_by_user_id
      WHERE a.session_id = ANY($1::uuid[])
      ORDER BY a.checked_in_at ASC
    `,
    [sessionIds]
  );

  // Group attendees by session
  const attendeesBySession = new Map<string, SessionAttendeeItem[]>();
  for (const row of attendeesResult.rows) {
    if (!attendeesBySession.has(row.session_id)) {
      attendeesBySession.set(row.session_id, []);
    }
    attendeesBySession.get(row.session_id)!.push({
      attendanceId: row.attendance_id,
      memberId: row.membership_id,
      memberName: row.member_name,
      creditsUsed: row.credits_used,
      checkInType: mapCheckInType(row.check_in_method),
      checkedInAt: row.checked_in_at,
      checkedInByUserId: row.checked_in_by_user_id,
      checkedInByName: row.checked_in_by_name,
    });
  }

  const sessions: SessionBreakdownItem[] = sessionsResult.rows.map((row) => ({
    sessionId: row.session_id,
    title: row.title,
    locationName: row.location_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    totalCheckIns: parseInt(row.attendee_count, 10),
    totalParticipation: parseFloat(row.total_credits_used),
    attendees: attendeesBySession.get(row.session_id) ?? [],
  }));

  const allRows = attendeesResult.rows;
  const uniqueMembers = new Set(allRows.map((a) => a.membership_id)).size;
  const totalParticipation = allRows.reduce(
    (sum, a) => sum + Number(a.credits_used),
    0
  );

  return {
    sessions,
    summary: {
      totalSessions: sessions.length,
      totalCheckIns: allRows.length,
      uniqueMembers,
      totalParticipation,
    },
  };
}

// ─── Report Summary (GET /reports/summary) ────────────────────────────────────

export type ReportSummaryResult = {
  totalSessions: number;
  totalCheckIns: number;
  totalParticipation: number;
  uniqueMembers: number;
  activeMemberCount: number;
  period: { from: string | null; to: string | null };
};

export async function getReportSummary(params: {
  clubId: string;
  from?: string;
  to?: string;
}): Promise<ReportSummaryResult> {
  const { clubId, from, to } = params;

  const conditions: string[] = ['s.club_id = $1'];
  const values: unknown[] = [clubId];
  let paramIdx = 2;

  if (from) {
    conditions.push(`s.starts_at >= $${paramIdx++}::date`);
    values.push(from);
  }
  if (to) {
    // inclusive: sessions starting on or before end-of-day `to`
    conditions.push(`s.starts_at < ($${paramIdx++}::date + interval '1 day')`);
    values.push(to);
  }

  const summaryResult = await pool.query<{
    total_sessions: string;
    total_check_ins: string;
    total_participation: string;
    unique_members: string;
  }>(
    `SELECT
       COUNT(DISTINCT s.id)             AS total_sessions,
       COUNT(a.id)                      AS total_check_ins,
       COALESCE(SUM(a.credits_used), 0) AS total_participation,
       COUNT(DISTINCT a.membership_id)  AS unique_members
     FROM sessions s
     LEFT JOIN attendances a ON a.session_id = s.id
     WHERE ${conditions.join(' AND ')}`,
    values
  );

  const activeMemberResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM memberships
     WHERE club_id = $1 AND status = 'active'`,
    [clubId]
  );

  const row = summaryResult.rows[0];
  return {
    totalSessions: parseInt(row?.total_sessions ?? '0', 10),
    totalCheckIns: parseInt(row?.total_check_ins ?? '0', 10),
    totalParticipation: parseInt(row?.total_participation ?? '0', 10),
    uniqueMembers: parseInt(row?.unique_members ?? '0', 10),
    activeMemberCount: parseInt(activeMemberResult.rows[0]?.count ?? '0', 10),
    period: { from: from ?? null, to: to ?? null },
  };
}
