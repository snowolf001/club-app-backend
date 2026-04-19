import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { randomBytes, randomUUID } from 'crypto';
import { writeAuditLog, createAuditLog } from './auditLogService';
import { logger } from '../lib/logger';
import { normalizeRole, isOwner, isOwnerOrHost } from '../lib/permissions';

function generateJoinCode(): string {
  return randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars
}

/**
 * Ensures a user record exists for the given userId.
 * Uses ON CONFLICT DO NOTHING so existing rows are untouched.
 * This is the correct hook point for auth integration: when a real auth
 * middleware is added, it will call this (or equivalent) after verifying
 * the JWT to guarantee a users row exists before any FK-dependent inserts.
 */
async function ensureUserExists(userId: string, name: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [userId, name]
  );
}

function generateRecoveryCode(): string {
  // Format: XXXX-XXXX-XXXX (12 uppercase hex chars in 3 groups)
  const hex = randomBytes(6).toString('hex').toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

function toTitleCase(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizePart(str: string): string {
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ─── Row types ────────────────────────────────────────────────────────────────

type ClubRow = {
  id: string;
  name: string;
  join_code: string | null;
  allow_member_backfill: boolean;
  member_backfill_hours: number;
  host_backfill_hours: number;
  enable_session_intents: boolean;
};

type LocationRow = {
  id: string;
  club_id: string;
  name: string;
  address: string;
  is_hidden: boolean;
};

type ClubMemberRow = {
  membership_id: string;
  user_id: string;
  user_name: string;
  display_name: string;
  role: string;
  credits_remaining: number;
  status: string;
};

// ─── Public types ─────────────────────────────────────────────────────────────

export type ClubItem = {
  clubId: string;
  name: string;
  joinCode: string | null;
};

export type ClubSettings = {
  allowMemberBackfill: boolean;
  memberBackfillHours: number;
  hostBackfillHours: number;
  enableSessionIntents: boolean;
};

export type ClubLocation = {
  id: string;
  clubId: string;
  name: string;
  address: string;
  isHidden: boolean;
};

export type ClubMember = {
  membershipId: string;
  userId: string;
  userName: string;
  role: string;
  credits: number;
  active: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapClub(row: ClubRow): ClubItem {
  return { clubId: row.id, name: row.name, joinCode: row.join_code };
}

function mapSettings(row: ClubRow): ClubSettings {
  return {
    allowMemberBackfill: row.allow_member_backfill,
    memberBackfillHours: row.member_backfill_hours,
    hostBackfillHours: row.host_backfill_hours,
    enableSessionIntents: row.enable_session_intents ?? false,
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

async function fetchClubRow(clubId: string): Promise<ClubRow> {
  const result = await pool.query<ClubRow>(
    `SELECT id, name, join_code, allow_member_backfill, member_backfill_hours, host_backfill_hours, enable_session_intents
     FROM clubs WHERE id = $1 LIMIT 1`,
    [clubId]
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new AppError(404, 'CLUB_NOT_FOUND', 'Club not found.');
  }
  return result.rows[0];
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export async function getClub(clubId: string): Promise<ClubItem> {
  return mapClub(await fetchClubRow(clubId));
}

export async function getClubSettings(clubId: string): Promise<ClubSettings> {
  return mapSettings(await fetchClubRow(clubId));
}

export async function updateClubSettings(
  clubId: string,
  settings: Partial<ClubSettings>
): Promise<ClubSettings> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (settings.allowMemberBackfill !== undefined) {
    updates.push(`allow_member_backfill = $${idx++}`);
    values.push(settings.allowMemberBackfill);
  }
  if (settings.memberBackfillHours !== undefined) {
    updates.push(`member_backfill_hours = $${idx++}`);
    values.push(settings.memberBackfillHours);
  }
  if (settings.hostBackfillHours !== undefined) {
    updates.push(`host_backfill_hours = $${idx++}`);
    values.push(settings.hostBackfillHours);
  }
  if (settings.enableSessionIntents !== undefined) {
    updates.push(`enable_session_intents = $${idx++}`);
    values.push(settings.enableSessionIntents);
  }

  if (updates.length === 0) {
    return getClubSettings(clubId);
  }

  values.push(clubId);
  await pool.query(
    `UPDATE clubs SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`,
    values
  );
  return getClubSettings(clubId);
}

export async function getClubMembers(clubId: string): Promise<ClubMember[]> {
  const result = await pool.query<ClubMemberRow>(
    `SELECT m.id AS membership_id, m.user_id,
            COALESCE(m.display_name, u.name) AS user_name,
            m.display_name, m.role, m.credits_remaining, m.status
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.club_id = $1
     ORDER BY COALESCE(m.display_name, u.name)`,
    [clubId]
  );
  return result.rows.map((row) => ({
    membershipId: row.membership_id,
    userId: row.user_id,
    userName: row.display_name ?? row.user_name,
    role: row.role,
    credits: row.credits_remaining,
    active: row.status === 'active',
  }));
}

export async function getClubLocations(
  clubId: string,
  includeHidden: boolean = false
): Promise<ClubLocation[]> {
  const result = await pool.query<LocationRow>(
    `SELECT id, club_id, name, address, is_hidden
     FROM club_locations
     WHERE club_id = $1 ${!includeHidden ? 'AND is_hidden = false' : ''}
     ORDER BY name`,
    [clubId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    clubId: row.club_id,
    name: row.name,
    address: row.address,
    isHidden: row.is_hidden,
  }));
}

export async function addClubLocation(
  clubId: string,
  name: string,
  address: string
): Promise<ClubLocation> {
  const result = await pool.query<LocationRow>(
    `INSERT INTO club_locations (club_id, name, address) VALUES ($1, $2, $3)
     RETURNING id, club_id, name, address, is_hidden`,
    [clubId, name, address]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    clubId: row.club_id,
    name: row.name,
    address: row.address,
    isHidden: row.is_hidden,
  };
}

export async function deleteClubLocation(
  clubId: string,
  locationId: string
): Promise<{ success: boolean; mode: 'deleted' | 'hidden' }> {
  // Verify location exists and belongs to this club
  const locRow = await pool.query<{ id: string }>(
    `SELECT id FROM club_locations WHERE id = $1 AND club_id = $2 LIMIT 1`,
    [locationId, clubId]
  );
  if ((locRow.rowCount ?? 0) === 0) {
    throw new AppError(404, 'LOCATION_NOT_FOUND', 'Location not found.');
  }

  // Check if any session references this location
  const sessionCount = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM sessions WHERE location_id = $1`,
    [locationId]
  );

  if (parseInt(sessionCount.rows[0].count, 10) > 0) {
    await pool.query(
      `UPDATE club_locations SET is_hidden = true, updated_at = NOW() WHERE id = $1`,
      [locationId]
    );
    return { success: true, mode: 'hidden' };
  }

  await pool.query(`DELETE FROM club_locations WHERE id = $1`, [locationId]);
  return { success: true, mode: 'deleted' };
}

export async function joinClub(
  joinCode: string,
  firstName: string,
  lastName: string
): Promise<{ membershipId: string; clubId: string; userId: string }> {
  const clubResult = await pool.query<{ id: string }>(
    `SELECT id FROM clubs WHERE UPPER(join_code) = UPPER($1) LIMIT 1`,
    [joinCode.trim()]
  );
  if ((clubResult.rowCount ?? 0) === 0) {
    throw new AppError(404, 'CLUB_NOT_FOUND', 'Invalid join code.');
  }
  const clubId = clubResult.rows[0].id;

  const userId = randomUUID();
  const displayName = `${toTitleCase(firstName)} ${toTitleCase(lastName)}`;

  // Ensure a users row exists for this userId before any FK-dependent inserts.
  await ensureUserExists(userId, displayName);

  // Check if the display_name is already taken by any row (active or removed).
  // The unique index enforces this at DB level too; we check first for a clean error.
  const duplicate = await pool.query<{ id: string }>(
    `SELECT id FROM memberships
     WHERE club_id = $1
       AND lower(display_name) = lower($2)
     LIMIT 1`,
    [clubId, displayName]
  );
  if ((duplicate.rowCount ?? 0) > 0) {
    throw new AppError(
      409,
      'DISPLAY_NAME_CONFLICT',
      'This name already exists in this club. If you already joined this club before, please use your recovery code. Otherwise, choose a different name.'
    );
  }

  // ─── Member limit check ────────────────────────────────────────────────────
  // Disabled: flip `false` to the real condition when limit enforcement is ready.
  // To enable: query active member count and compare against the club's plan limit.
  //
  // const activeMemberCount = await pool.query<{ count: string }>(
  //   `SELECT COUNT(*) AS count FROM memberships WHERE club_id = $1 AND status = 'active'`,
  //   [clubId]
  // );
  // const memberCount = parseInt(activeMemberCount.rows[0].count, 10);
  // const memberLimit = getClubMemberLimit(clubId); // fetch from plan/db
  // if (memberCount >= memberLimit) {
  if (true) {
    throw new AppError(
      403,
      'MEMBER_LIMIT_REACHED',
      "You've reached the free member limit. Upgrade to Pro to add more members."
    );
  }

  const recoveryCode = generateRecoveryCode();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO memberships (club_id, user_id, role, status, credits_remaining, recovery_code, display_name)
     VALUES ($1, $2, 'member', 'active', 0, $3, $4) RETURNING id`,
    [clubId, userId, recoveryCode, displayName]
  );
  return { membershipId: result.rows[0].id, clubId, userId };
}

export async function createClub(
  name: string,
  firstName: string,
  lastName: string
): Promise<{ membershipId: string; clubId: string; userId: string }> {
  const trimmed = name.trim();
  if (!trimmed)
    throw new AppError(400, 'INVALID_NAME', 'Club name cannot be empty.');

  const userId = randomUUID();
  const ownerDisplayName = `${toTitleCase(firstName)} ${toTitleCase(lastName)}`;

  logger.info('[createClub] start', { name: trimmed });

  const joinCode = generateJoinCode();

  await ensureUserExists(userId, ownerDisplayName);
  logger.info('[createClub] ensureUserExists done', { ownerDisplayName });

  const clubResult = await pool.query<{ id: string }>(
    `INSERT INTO clubs (name, join_code) VALUES ($1, $2) RETURNING id`,
    [trimmed, joinCode]
  );
  const clubId = clubResult.rows[0].id;
  logger.info('[createClub] club inserted', { clubId });

  const recoveryCode = generateRecoveryCode();
  const memberResult = await pool.query<{ id: string }>(
    `INSERT INTO memberships (club_id, user_id, role, status, credits_remaining, recovery_code, display_name)
     VALUES ($1, $2, 'owner', 'active', 0, $3, $4) RETURNING id`,
    [clubId, userId, recoveryCode, ownerDisplayName]
  );
  logger.info('[createClub] membership inserted', {
    membershipId: memberResult.rows[0].id,
  });
  return { membershipId: memberResult.rows[0].id, clubId, userId };
}

// ─── Regenerate join code ─────────────────────────────────────────────────────

export async function regenerateJoinCode(
  clubId: string,
  actorMembershipId: string
): Promise<{ joinCode: string }> {
  const actorResult = await pool.query<{ role: string; user_id: string }>(
    `SELECT role, user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
    [actorMembershipId]
  );
  const actorRow = actorResult.rows[0];
  if (!actorRow || !isOwner(normalizeRole(actorRow.role))) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Only the owner can regenerate the join code.'
    );
  }

  const newCode = generateJoinCode();
  await pool.query(
    `UPDATE clubs SET join_code = $1, updated_at = NOW() WHERE id = $2`,
    [newCode, clubId]
  );

  void createAuditLog({
    clubId,
    actorUserId: actorRow.user_id,
    entityType: 'club',
    entityId: clubId,
    action: 'join_code_regenerated',
    metadata: {},
  });

  return { joinCode: newCode };
}

// ─── Transfer ownership ───────────────────────────────────────────────────────

export async function transferOwnership(
  clubId: string,
  actorMembershipId: string,
  targetMembershipId: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const actorResult = await client.query<{
      id: string;
      role: string;
      user_id: string;
    }>(
      `SELECT id, role, user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
      [actorMembershipId]
    );
    const actor = actorResult.rows[0];
    if (!actor || !isOwner(normalizeRole(actor.role))) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only the owner can transfer ownership.'
      );
    }

    const targetResult = await client.query<{
      id: string;
      user_id: string;
      role: string;
    }>(
      `SELECT id, user_id, role FROM memberships WHERE id = $1 AND club_id = $2 AND status = 'active' LIMIT 1`,
      [targetMembershipId, clubId]
    );
    const target = targetResult.rows[0];
    if (!target) {
      throw new AppError(
        404,
        'MEMBERSHIP_NOT_FOUND',
        'Target membership not found.'
      );
    }
    if (normalizeRole(target.role) !== 'host') {
      throw new AppError(
        400,
        'INVALID_TARGET',
        'Ownership can only be transferred to an existing host.'
      );
    }

    // Atomic swap
    await client.query(
      `UPDATE memberships SET role = 'owner', updated_at = NOW() WHERE id = $1`,
      [target.id]
    );
    await client.query(
      `UPDATE memberships SET role = 'host', updated_at = NOW() WHERE id = $1`,
      [actor.id]
    );

    await writeAuditLog(client, {
      clubId,
      actorUserId: actor.user_id,
      targetUserId: target.user_id,
      entityType: 'club',
      entityId: clubId,
      action: 'ownership_transferred',
      metadata: { fromMembershipId: actor.id, toMembershipId: target.id },
    });

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ─── Leave club ───────────────────────────────────────────────────────────────

export async function leaveClub(membershipId: string): Promise<void> {
  const memberRow = await pool.query<{
    id: string;
    role: string;
    user_id: string;
    club_id: string;
  }>(
    `SELECT id, role, user_id, club_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
    [membershipId]
  );
  const member = memberRow.rows[0];
  if (!member) {
    throw new AppError(
      404,
      'MEMBERSHIP_NOT_FOUND',
      'Active membership not found.'
    );
  }

  if (member.role === 'owner') {
    // Check if another active host exists
    const hostRow = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM memberships
       WHERE club_id = $1 AND role = 'host' AND status = 'active'`,
      [member.club_id]
    );
    const hostCount = parseInt(hostRow.rows[0].count, 10);
    if (hostCount > 0) {
      throw new AppError(
        403,
        'OWNER_TRANSFER_REQUIRED',
        'You must transfer ownership before leaving this club.'
      );
    } else {
      throw new AppError(
        403,
        'OWNER_PROMOTE_AND_TRANSFER_REQUIRED',
        'Please promote another member to host first, then transfer ownership before leaving.'
      );
    }
  }

  await pool.query(
    `UPDATE memberships SET status = 'removed', updated_at = NOW() WHERE id = $1`,
    [member.id]
  );

  void createAuditLog({
    clubId: member.club_id,
    actorUserId: member.user_id,
    entityType: 'membership',
    entityId: member.id,
    action: 'member_left',
    metadata: { role: member.role },
  });
}

// ─── Remove member ────────────────────────────────────────────────────────────

export async function removeMember(
  clubId: string,
  membershipId: string,
  actorMembershipId: string
): Promise<void> {
  const targetResult = await pool.query<{
    user_id: string;
    role: string;
    club_id: string;
  }>(`SELECT user_id, role, club_id FROM memberships WHERE id = $1 LIMIT 1`, [
    membershipId,
  ]);
  const target = targetResult.rows[0];
  if (!target || target.club_id !== clubId) {
    throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership not found.');
  }
  if (target.role === 'owner') {
    throw new AppError(
      403,
      'CANNOT_REMOVE_OWNER',
      'Cannot remove the club owner.'
    );
  }

  const actorResult = await pool.query<{ role: string; user_id: string }>(
    `SELECT role, user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
    [actorMembershipId]
  );
  const actorRow = actorResult.rows[0];
  const actorRole = actorRow?.role;
  const normalizedActorRole = normalizeRole(actorRole);
  if (!isOwnerOrHost(normalizedActorRole)) {
    throw new AppError(403, 'FORBIDDEN', 'Only hosts can remove members.');
  }
  if (normalizeRole(target.role) === 'host' && !isOwner(normalizedActorRole)) {
    throw new AppError(403, 'FORBIDDEN', 'Only the owner can remove a host.');
  }

  await pool.query(
    `UPDATE memberships SET status = 'removed', updated_at = NOW() WHERE id = $1`,
    [membershipId]
  );

  void createAuditLog({
    clubId,
    actorUserId: actorRow.user_id,
    targetUserId: target.user_id,
    entityType: 'membership',
    entityId: membershipId,
    action: 'member_removed',
    metadata: { removedRole: target.role },
  });
}

// ─── Recover membership by display name + recovery code ───────────────────────

export type RecoveredMembership = {
  membershipId: string;
  clubId: string;
  userId: string;
  displayName: string;
  role: string;
  credits: number;
};

export async function recoverMemberByDisplayName(
  clubId: string,
  displayName: string,
  recoveryCode: string
): Promise<RecoveredMembership> {
  const result = await pool.query<{
    id: string;
    user_id: string;
    club_id: string;
    display_name: string;
    role: string;
    credits_remaining: number;
    status: string;
  }>(
    `SELECT id, user_id, club_id, display_name, role, credits_remaining, status
     FROM memberships
     WHERE club_id = $1
       AND lower(display_name) = lower($2)
       AND lower(recovery_code) = lower($3)
     LIMIT 1`,
    [clubId, displayName, recoveryCode]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new AppError(
      404,
      'RECOVERY_FAILED',
      'No membership found. Check your name and recovery code.'
    );
  }

  const row = result.rows[0];

  // Reactivate if currently removed
  if (row.status !== 'active') {
    await pool.query(
      `UPDATE memberships SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [row.id]
    );
  }

  return {
    membershipId: row.id,
    clubId: row.club_id,
    userId: row.user_id,
    displayName: row.display_name,
    role: row.role,
    credits: row.credits_remaining,
  };
}
