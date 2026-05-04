import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { logger } from '../lib/logger';

/**
 * Soft-deletes / anonymises every trace of a user's personal identity.
 *
 * Rules:
 *  - Actor is identified by their membershipId (from x-member-id header).
 *  - The user_id is resolved from that membership (any non-deleted membership,
 *    including status='removed' so users who left all clubs can still delete).
 *  - If the user owns any active (non-deleted) club, 409 OWNER_TRANSFER_REQUIRED.
 *  - Otherwise all memberships for this user are anonymised:
 *      display_name = 'Deleted Member', recovery_code = NULL,
 *      status = 'removed', deleted_at = NOW()
 *  - The user row is anonymised:
 *      name = 'Deleted Member', email = NULL, deleted_at = NOW()
 *  - Historical attendance/credit/audit rows are NOT deleted (foreign keys kept).
 *    Report queries detect deleted_at on membership/user and show 'Deleted Member'.
 *  - A system_event row is written for audit purposes (no PII logged after deletion).
 */
export async function deleteUserAccount(
  actorMembershipId: string
): Promise<void> {
  // ── 1. Resolve user_id from the actor membership ──────────────────────────
  // We accept both active and removed memberships so users who previously left
  // all clubs can still invoke account deletion.
  const memberResult = await pool.query<{ user_id: string }>(
    `SELECT user_id
     FROM memberships
     WHERE id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [actorMembershipId]
  );

  if ((memberResult.rowCount ?? 0) === 0) {
    throw new AppError(
      404,
      'MEMBERSHIP_NOT_FOUND',
      'No active membership found for this identity. It may have already been deleted.'
    );
  }

  const userId = memberResult.rows[0].user_id;

  // ── 2. Block if user owns any active club ────────────────────────────────
  const ownerResult = await pool.query<{ id: string }>(
    `SELECT id
     FROM memberships
     WHERE user_id   = $1
       AND role      = 'owner'
       AND status    = 'active'
       AND deleted_at IS NULL
     LIMIT 1`,
    [userId]
  );

  if ((ownerResult.rowCount ?? 0) > 0) {
    throw new AppError(
      409,
      'OWNER_TRANSFER_REQUIRED',
      'You are the owner of one or more clubs. Please transfer ownership before deleting your account.'
    );
  }

  // ── 3. Soft-delete everything inside a transaction ────────────────────────
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Anonymise all memberships for this user that haven't already been deleted.
    // Set display_name to the safe sentinel label so historical reports always
    // have a readable value; the partial unique index (WHERE deleted_at IS NULL)
    // means multiple deleted memberships can share 'Deleted Member' in a club.
    await client.query(
      `UPDATE memberships
       SET display_name  = 'Deleted Member',
           recovery_code = NULL,
           status        = 'removed',
           deleted_at    = NOW(),
           updated_at    = NOW()
       WHERE user_id    = $1
         AND deleted_at IS NULL`,
      [userId]
    );

    // Anonymise the user row.
    await client.query(
      `UPDATE users
       SET name       = 'Deleted Member',
           email      = NULL,
           deleted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    // Write a durable audit event (no personal identifiers).
    await client.query(
      `INSERT INTO system_events
         (category, event_type, event_status, message, details)
       VALUES
         ('account', 'account_deleted', 'success',
          'User account deleted and anonymised.',
          $1::jsonb)`,
      [JSON.stringify({ userId })]
    );

    await client.query('COMMIT');

    logger.info('[userService] Account deleted and anonymised', { userId });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[userService] Account deletion failed, rolling back', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    client.release();
  }
}
