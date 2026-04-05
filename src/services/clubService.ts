import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { randomBytes } from 'crypto';

function generateJoinCode(): string {
  return randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars
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
};

type LocationRow = {
  id: string;
  club_id: string;
  name: string;
  address: string;
};

type ClubMemberRow = {
  membership_id: string;
  user_id: string;
  user_name: string;
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
};

export type ClubLocation = {
  id: string;
  clubId: string;
  name: string;
  address: string;
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
  };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

async function fetchClubRow(clubId: string): Promise<ClubRow> {
  const result = await pool.query<ClubRow>(
    `SELECT id, name, join_code, allow_member_backfill, member_backfill_hours, host_backfill_hours
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
    `SELECT m.id AS membership_id, m.user_id, u.name AS user_name,
            m.role, m.credits_remaining, m.status
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.club_id = $1
     ORDER BY u.name`,
    [clubId]
  );
  return result.rows.map((row) => ({
    membershipId: row.membership_id,
    userId: row.user_id,
    userName: row.user_name,
    role: row.role,
    credits: row.credits_remaining,
    active: row.status === 'active',
  }));
}

export async function getClubLocations(
  clubId: string
): Promise<ClubLocation[]> {
  const result = await pool.query<LocationRow>(
    `SELECT id, club_id, name, address FROM club_locations WHERE club_id = $1 ORDER BY name`,
    [clubId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    clubId: row.club_id,
    name: row.name,
    address: row.address,
  }));
}

export async function addClubLocation(
  clubId: string,
  name: string,
  address: string
): Promise<ClubLocation> {
  const result = await pool.query<LocationRow>(
    `INSERT INTO club_locations (club_id, name, address) VALUES ($1, $2, $3)
     RETURNING id, club_id, name, address`,
    [clubId, name, address]
  );
  const row = result.rows[0];
  return {
    id: row.id,
    clubId: row.club_id,
    name: row.name,
    address: row.address,
  };
}

export async function joinClub(
  joinCode: string,
  userId: string,
  firstName: string,
  lastName: string
): Promise<{ membershipId: string; clubId: string }> {
  const clubResult = await pool.query<{ id: string }>(
    `SELECT id FROM clubs WHERE UPPER(join_code) = UPPER($1) LIMIT 1`,
    [joinCode.trim()]
  );
  if ((clubResult.rowCount ?? 0) === 0) {
    throw new AppError(404, 'CLUB_NOT_FOUND', 'Invalid join code.');
  }
  const clubId = clubResult.rows[0].id;

  // Normalize name regardless of whether this is a new or returning member.
  const fullName = `${toTitleCase(firstName)} ${toTitleCase(lastName)}`;

  // Already a member? Update their name and return the existing membership.
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM memberships WHERE club_id = $1 AND user_id = $2 LIMIT 1`,
    [clubId, userId]
  );
  if ((existing.rowCount ?? 0) > 0) {
    await pool.query(
      `UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2`,
      [fullName, userId]
    );
    return { membershipId: existing.rows[0].id, clubId };
  }

  // Duplicate name check: block if any member in this club shares the same
  // normalized first + last name. Name matching is ONLY for conflict detection —
  // never for identity confirmation. Recovery code is the only restore path.
  const normFirst = normalizePart(firstName);
  const normLast = normalizePart(lastName);
  const normFull = `${normFirst} ${normLast}`;
  const duplicate = await pool.query<{ id: string }>(
    `SELECT m.id FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.club_id = $1
       AND m.user_id <> $2
       AND LOWER(REGEXP_REPLACE(TRIM(u.name), '\\s+', ' ', 'g')) = $3
     LIMIT 1`,
    [clubId, userId, normFull]
  );
  if ((duplicate.rowCount ?? 0) > 0) {
    throw new AppError(
      409,
      'POSSIBLE_EXISTING_MEMBER',
      'A member with this name may already exist in this club. Please use your recovery code instead.'
    );
  }

  // Update this user's display name.
  await pool.query(
    `UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2`,
    [fullName, userId]
  );

  const recoveryCode = generateRecoveryCode();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO memberships (club_id, user_id, role, status, credits_remaining, recovery_code)
     VALUES ($1, $2, 'member', 'active', 0, $3) RETURNING id`,
    [clubId, userId, recoveryCode]
  );
  return { membershipId: result.rows[0].id, clubId };
}

export async function createClub(
  name: string,
  userId: string
): Promise<{ membershipId: string; clubId: string }> {
  const trimmed = name.trim();
  if (!trimmed)
    throw new AppError(400, 'INVALID_NAME', 'Club name cannot be empty.');

  const joinCode = generateJoinCode();

  const clubResult = await pool.query<{ id: string }>(
    `INSERT INTO clubs (name, join_code) VALUES ($1, $2) RETURNING id`,
    [trimmed, joinCode]
  );
  const clubId = clubResult.rows[0].id;

  const recoveryCode = generateRecoveryCode();
  const memberResult = await pool.query<{ id: string }>(
    `INSERT INTO memberships (club_id, user_id, role, status, credits_remaining, recovery_code)
     VALUES ($1, $2, 'owner', 'active', 0, $3) RETURNING id`,
    [clubId, userId, recoveryCode]
  );
  return { membershipId: memberResult.rows[0].id, clubId };
}
