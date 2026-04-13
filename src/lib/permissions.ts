/**
 * Shared permission helpers.
 *
 * Backward compatibility: legacy DB rows may still carry role='admin'.
 * normalizeRole() maps 'admin' → 'host' so all checks remain safe for
 * existing closed-testing users. New writes always use 'host', never 'admin'.
 */

import { AppError } from '../errors/AppError';
import { pool } from '../db/pool';

// ─── Role normalisation ───────────────────────────────────────────────────────

export type NormalizedRole = 'owner' | 'host' | 'member';

/**
 * Maps any raw DB role value to a NormalizedRole.
 * 'admin' (legacy) → 'host'
 * Anything unrecognised → 'member' (safest default).
 */
export function normalizeRole(raw: string | undefined | null): NormalizedRole {
  if (raw === 'owner') return 'owner';
  if (raw === 'host' || raw === 'admin') return 'host'; // admin is legacy alias
  return 'member';
}

// ─── Boolean helpers ──────────────────────────────────────────────────────────

export function isOwner(role: string | undefined | null): boolean {
  return normalizeRole(role) === 'owner';
}

export function isHost(role: string | undefined | null): boolean {
  return normalizeRole(role) === 'host';
}

export function isOwnerOrHost(role: string | undefined | null): boolean {
  const r = normalizeRole(role);
  return r === 'owner' || r === 'host';
}

// ─── Feature-level helpers ────────────────────────────────────────────────────

export function canManageMembers(role: string | null | undefined): boolean {
  return isOwnerOrHost(role);
}

export function canAdjustCredits(role: string | null | undefined): boolean {
  return isOwnerOrHost(role);
}

export function canManageSession(role: string | null | undefined): boolean {
  return isOwnerOrHost(role);
}

export function canManualCheckIn(role: string | null | undefined): boolean {
  return isOwnerOrHost(role);
}

export function canViewReports(role: string | null | undefined): boolean {
  return isOwnerOrHost(role);
}

export function canViewAuditLog(role: string | null | undefined): boolean {
  return isOwnerOrHost(role);
}

/**
 * Pro-only: PDF export.
 * Currently any host/owner passes. When a plan column is added to clubs,
 * also gate on club plan here — no contract change needed for callers.
 */
export function canExportPdf(role: string | null | undefined): boolean {
  return isOwnerOrHost(role);
}

export function canChangeClubSettings(
  role: string | null | undefined
): boolean {
  return isOwner(role);
}

export function canChangeCheckInPolicy(
  role: string | null | undefined
): boolean {
  return isOwner(role);
}

export function canDeleteLocation(role: string | null | undefined): boolean {
  return isOwner(role);
}

export function canDeleteSession(role: string | null | undefined): boolean {
  return isOwnerOrHost(role);
}

// ─── Guard helpers (throw AppError on denial) ─────────────────────────────────

export function requireOwnerOrHost(
  role: string | undefined | null,
  message = 'Hosts and owners only.'
): void {
  if (!isOwnerOrHost(role)) {
    throw new AppError(403, 'FORBIDDEN', message);
  }
}

export function requireOwner(
  role: string | undefined | null,
  message = 'Owner only.'
): void {
  if (!isOwner(role)) {
    throw new AppError(403, 'FORBIDDEN', message);
  }
}

/**
 * Pro feature gate.
 *
 * Currently: any active host/owner in the club passes.
 * Future: also check club plan column here without touching call sites.
 */
export async function requirePro(
  membershipId: string,
  clubId: string,
  feature: string
): Promise<void> {
  const result = await pool.query<{ role: string }>(
    `SELECT role FROM memberships
     WHERE id = $1 AND club_id = $2 AND status = 'active'
     LIMIT 1`,
    [membershipId, clubId]
  );
  const role = result.rows[0]?.role;
  if (!isOwnerOrHost(role)) {
    throw new AppError(
      403,
      'PRO_REQUIRED',
      `The '${feature}' feature requires Pro plan access.`
    );
  }
  // TODO: when plan column is added to clubs table, also check:
  // SELECT plan FROM clubs WHERE id = clubId
  // and throw PRO_REQUIRED if plan !== 'pro'
}
