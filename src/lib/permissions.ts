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
 * Checks two things in order:
 *   1. Actor is an active owner or host of the club (role check).
 *   2. Club actually has Pro status (subscription check).
 *
 * Both must pass. This is the single enforcement point for all Pro-gated APIs.
 */
export async function requirePro(
  membershipId: string,
  clubId: string,
  feature: string
): Promise<void> {
  // ── 1. Role check ──────────────────────────────────────────────────────────
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
      `The '${feature}' feature requires a host or owner role.`
    );
  }

  // ── 2. Club Pro status check ───────────────────────────────────────────────
  // Import lazily to avoid circular dependency at module load time.
  const { getClubProStatus } = await import('../services/subscriptionService');
  const proStatus = await getClubProStatus(clubId);
  if (!proStatus.isPro) {
    throw new AppError(
      403,
      'PRO_REQUIRED',
      `The '${feature}' feature requires an active Pro subscription.`
    );
  }
}
