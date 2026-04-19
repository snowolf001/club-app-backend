import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { recordSystemEvent } from '../lib/systemEvents';

// ─── Public types ─────────────────────────────────────────────────────────────

export type IntentMember = {
  membershipId: string;
  displayName: string;
};

export type SessionIntentSummary = {
  enabled: boolean;
  count: number;
  currentMemberGoing: boolean;
  members: IntentMember[];
};

// ─── Row types ────────────────────────────────────────────────────────────────

type IntentRow = {
  membership_id: string;
  display_name: string | null;
  user_name: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Verifies the session exists and returns its club_id and starts_at.
 * Throws 404 if not found.
 */
async function fetchSessionMeta(
  sessionId: string
): Promise<{ clubId: string; startsAt: Date }> {
  const result = await pool.query<{ club_id: string; starts_at: Date }>(
    `SELECT club_id, starts_at FROM sessions WHERE id = $1 LIMIT 1`,
    [sessionId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  }
  const row = result.rows[0];
  return { clubId: row.club_id, startsAt: row.starts_at };
}

/**
 * Checks whether session intents are enabled for the club that owns this session.
 * Throws 403 if the feature is not enabled.
 */
async function assertIntentsEnabled(clubId: string): Promise<void> {
  const result = await pool.query<{ enable_session_intents: boolean }>(
    `SELECT enable_session_intents FROM clubs WHERE id = $1 LIMIT 1`,
    [clubId]
  );
  if (!(result.rows[0]?.enable_session_intents ?? false)) {
    throw new AppError(
      403,
      'FEATURE_DISABLED',
      'Session intents are not enabled for this club.'
    );
  }
}

/**
 * Verifies the membership belongs to this club.
 */
async function assertMembershipInClub(
  membershipId: string,
  clubId: string
): Promise<void> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM memberships WHERE id = $1 AND club_id = $2 AND status = 'active' LIMIT 1`,
    [membershipId, clubId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new AppError(
      403,
      'NOT_CLUB_MEMBER',
      'You are not an active member of this club.'
    );
  }
}

/**
 * Throws if the session has already started (or has passed).
 * Intent changes are only allowed before the session begins.
 */
function assertSessionNotStarted(startsAt: Date): void {
  if (startsAt <= new Date()) {
    throw new AppError(
      409,
      'SESSION_ALREADY_STARTED',
      'You cannot change your attendance intent after the session has started.'
    );
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Returns the intent summary for a session:
 * - Whether the feature is enabled for the club
 * - Total planned-going count
 * - Whether the requesting member has marked themselves as going
 * - List of going members (name + membershipId)
 */
export async function getSessionIntentSummary(
  sessionId: string,
  membershipId: string
): Promise<SessionIntentSummary> {
  const { clubId } = await fetchSessionMeta(sessionId);

  // Check if feature is enabled (no throw — we just report disabled)
  const flagResult = await pool.query<{ enable_session_intents: boolean }>(
    `SELECT enable_session_intents FROM clubs WHERE id = $1 LIMIT 1`,
    [clubId]
  );
  const enabled = flagResult.rows[0]?.enable_session_intents ?? false;

  if (!enabled) {
    return { enabled: false, count: 0, currentMemberGoing: false, members: [] };
  }

  const rows = await pool.query<IntentRow>(
    `SELECT si.membership_id,
            m.display_name,
            u.name AS user_name
     FROM session_intents si
     JOIN memberships m ON m.id = si.membership_id AND m.status = 'active'
     JOIN users u       ON u.id = m.user_id
     WHERE si.session_id = $1
     ORDER BY si.created_at`,
    [sessionId]
  );

  const members: IntentMember[] = rows.rows.map((r) => ({
    membershipId: r.membership_id,
    displayName: r.display_name ?? r.user_name ?? 'Unknown',
  }));

  const currentMemberGoing = members.some(
    (m) => m.membershipId === membershipId
  );

  return {
    enabled: true,
    count: members.length,
    currentMemberGoing,
    members,
  };
}

/**
 * Marks a member as going to a session.
 * Idempotent — safe to call if already marked.
 * Validates: feature enabled, membership in club.
 */
export async function upsertSessionIntent(
  sessionId: string,
  membershipId: string
): Promise<void> {
  const { clubId, startsAt } = await fetchSessionMeta(sessionId);
  assertSessionNotStarted(startsAt);
  await assertIntentsEnabled(clubId);
  await assertMembershipInClub(membershipId, clubId);

  await pool.query(
    `INSERT INTO session_intents (session_id, membership_id)
     VALUES ($1, $2)
     ON CONFLICT (session_id, membership_id) DO NOTHING`,
    [sessionId, membershipId]
  );

  void recordSystemEvent({
    category: 'session_intent',
    event_type: 'session_intent_updated',
    event_status: 'info',
    club_id: clubId,
    membership_id: membershipId,
    details: { sessionId, going: true },
  });
}

/**
 * Removes a member's intent to attend a session.
 * Idempotent — safe to call if not marked.
 * Validates: feature enabled, membership in club.
 */
export async function removeSessionIntent(
  sessionId: string,
  membershipId: string
): Promise<void> {
  const { clubId, startsAt } = await fetchSessionMeta(sessionId);
  assertSessionNotStarted(startsAt);
  await assertIntentsEnabled(clubId);
  await assertMembershipInClub(membershipId, clubId);

  await pool.query(
    `DELETE FROM session_intents WHERE session_id = $1 AND membership_id = $2`,
    [sessionId, membershipId]
  );

  void recordSystemEvent({
    category: 'session_intent',
    event_type: 'session_intent_updated',
    event_status: 'info',
    club_id: clubId,
    membership_id: membershipId,
    details: { sessionId, going: false },
  });
}
