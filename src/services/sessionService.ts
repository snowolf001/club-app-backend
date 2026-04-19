import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { getClubProStatus } from './subscriptionService';

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
  capacity: number | null;
  status: 'active' | 'closed';
  host_membership_id: string | null;
  host_display_name: string | null;
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
  capacity: number | null;
  status: 'active' | 'closed';
  host: { membershipId: string; displayName: string } | null;
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
    capacity: row.capacity,
    status: row.status,
    host: row.host_membership_id
      ? {
          membershipId: row.host_membership_id,
          displayName: row.host_display_name ?? '',
        }
      : null,
  };
}

const SESSION_SELECT = `
  SELECT s.id, s.club_id, s.title, s.starts_at, s.ends_at, s.created_at,
         s.location_id, cl.name AS location_name, s.capacity, s.status,
         s.host_membership_id, hm.display_name AS host_display_name
  FROM sessions s
  LEFT JOIN club_locations cl ON cl.id = s.location_id
  LEFT JOIN memberships hm ON hm.id = s.host_membership_id
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

export async function deleteSession(sessionId: string): Promise<void> {
  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM attendances WHERE session_id = $1`,
    [sessionId]
  );
  const count = parseInt(countResult.rows[0].count, 10);
  if (count > 0) {
    throw new AppError(
      409,
      'SESSION_NOT_DELETABLE',
      'This session cannot be deleted because it already has attendance records.'
    );
  }

  await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

async function assertHostInClub(
  hostMembershipId: string,
  clubId: string
): Promise<void> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM memberships
     WHERE id = $1 AND club_id = $2 AND role IN ('owner', 'host') AND status = 'active'
     LIMIT 1`,
    [hostMembershipId, clubId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new AppError(
      400,
      'INVALID_HOST',
      'Host must be an active owner or host member of this club.'
    );
  }
}

export async function createSession(params: {
  clubId: string;
  title?: string | null;
  locationId: string;
  startTime: string;
  endTime?: string | null;
  capacity?: number | null;
  hostMembershipId?: string | null;
}): Promise<SessionItem> {
  const {
    clubId,
    title,
    locationId,
    startTime,
    endTime,
    capacity,
    hostMembershipId,
  } = params;

  if (hostMembershipId) {
    await assertHostInClub(hostMembershipId, clubId);
  }

  // ─── Session limit check ───────────────────────────────────────────────────
  // Disabled: flip `false` to the real condition when limit enforcement is ready.
  // To enable: query session count for this club and compare against the plan limit.
  //
  // const sessionCountResult = await pool.query<{ count: string }>(
  //   `SELECT COUNT(*) AS count FROM sessions WHERE club_id = $1`,
  //   [clubId]
  // );
  // const sessionCount = parseInt(sessionCountResult.rows[0].count, 10);
  // const sessionLimit = getClubSessionLimit(clubId); // fetch from plan/db
  // if (sessionCount >= sessionLimit) {
  if (false) {
    throw new AppError(
      403,
      'SESSION_LIMIT_REACHED',
      "You've reached the free session limit. Upgrade to Pro to create more sessions."
    );
  }

  // ─── Capacity Pro gate ────────────────────────────────────────────────────
  if ((capacity ?? 0) > 0) {
    const proStatus = await getClubProStatus(clubId);
    if (!proStatus.isPro) {
      throw new AppError(
        403,
        'PRO_REQUIRED',
        'Custom session capacity is a Pro feature. Upgrade to Pro to use capacity limits.'
      );
    }
  }

  // ─── Capacity enforcement (check-in) is out of scope here ─────────────────
  // if (false /* session full */) {
  //   throw new AppError(403, 'CAPACITY_FULL', 'This session is full.');
  // }

  const result = await pool.query<{ id: string }>(
    `INSERT INTO sessions (club_id, title, location_id, starts_at, ends_at, capacity, host_membership_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      clubId,
      title?.trim() || null,
      locationId,
      startTime,
      endTime ?? null,
      capacity ?? null,
      hostMembershipId ?? null,
    ]
  );
  return getSessionById(result.rows[0].id);
}

export async function updateSession(
  sessionId: string,
  params: { hostMembershipId?: string | null }
): Promise<SessionItem> {
  const session = await getSessionById(sessionId);

  if (params.hostMembershipId !== undefined) {
    if (params.hostMembershipId !== null) {
      await assertHostInClub(params.hostMembershipId, session.clubId);
    }
    await pool.query(
      `UPDATE sessions SET host_membership_id = $1, updated_at = NOW() WHERE id = $2`,
      [params.hostMembershipId, sessionId]
    );
  }

  return getSessionById(sessionId);
}
