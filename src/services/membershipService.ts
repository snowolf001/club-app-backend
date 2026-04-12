import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { writeAuditLog } from './auditLogService';
import { logger } from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

type MembershipRow = {
  id: string;
  user_id: string;
  club_id: string;
  role: string;
  credits_remaining: number;
  status: string;
  user_name: string;
  display_name: string | null;
  recovery_code: string;
};

export type MembershipItem = {
  membershipId: string;
  clubId: string;
  userId: string;
  userName: string;
  displayName: string;
  recoveryCode: string;
  role: string;
  credits: number;
  active: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapMembership(row: MembershipRow): MembershipItem {
  const displayName = row.display_name ?? row.user_name ?? '';
  return {
    membershipId: row.id,
    clubId: row.club_id,
    userId: row.user_id,
    userName: displayName,
    displayName,
    recoveryCode: row.recovery_code ?? '',
    role: row.role,
    credits: row.credits_remaining,
    active: row.status === 'active',
  };
}

// ─── Exported functions ───────────────────────────────────────────────────────

export async function getMyMembership(
  clubId: string,
  userId: string
): Promise<MembershipItem> {
  const result = await pool.query<MembershipRow>(
    `
      SELECT m.id, m.user_id, m.club_id, m.role, m.credits_remaining, m.status,
             m.recovery_code, m.display_name, u.name AS user_name
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.club_id = $1
        AND m.user_id = $2
      LIMIT 1
    `,
    [clubId, userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership not found.');
  }

  return mapMembership(result.rows[0]);
}

export async function getMembershipById(membershipId: string): Promise<{
  membership: MembershipItem;
  club: { clubId: string; name: string; joinCode: string | null };
}> {
  const result = await pool.query<
    MembershipRow & { club_name: string; club_join_code: string | null }
  >(
    `SELECT m.id, m.user_id, m.club_id, m.role, m.credits_remaining, m.status,
            m.recovery_code, m.display_name, u.name AS user_name,
            c.name AS club_name, c.join_code AS club_join_code
     FROM memberships m
     JOIN clubs c ON c.id = m.club_id
     JOIN users u ON u.id = m.user_id
     WHERE m.id = $1 LIMIT 1`,
    [membershipId]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership not found.');
  }

  const row = result.rows[0];
  return {
    membership: mapMembership(row),
    club: {
      clubId: row.club_id,
      name: row.club_name,
      joinCode: row.club_join_code,
    },
  };
}

export async function getMembershipByRecoveryCode(
  recoveryCode: string
): Promise<{
  membership: MembershipItem;
  club: { clubId: string; name: string; joinCode: string | null };
}> {
  const result = await pool.query<
    MembershipRow & { club_name: string; club_join_code: string | null }
  >(
    `SELECT m.id, m.user_id, m.club_id, m.role, m.credits_remaining, m.status,
            m.recovery_code, m.display_name, u.name AS user_name,
            c.name AS club_name, c.join_code AS club_join_code
     FROM memberships m
     JOIN clubs c ON c.id = m.club_id
     JOIN users u ON u.id = m.user_id
     WHERE LOWER(m.recovery_code) = LOWER($1) LIMIT 1`,
    [recoveryCode]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new AppError(
      404,
      'MEMBERSHIP_NOT_FOUND',
      'No membership found with that recovery code.'
    );
  }

  const row = result.rows[0];

  // Reactivate membership if it was removed
  if (row.status !== 'active') {
    await pool.query(
      `UPDATE memberships SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [row.id]
    );
  }

  return {
    membership: mapMembership(row),
    club: {
      clubId: row.club_id,
      name: row.club_name,
      joinCode: row.club_join_code,
    },
  };
}

export async function addCredits(
  membershipId: string,
  actorMembershipId: string,
  amount: number,
  reason: string
): Promise<MembershipItem> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const membershipResult = await client.query<MembershipRow>(
      `
        SELECT id, user_id, club_id, role, credits_remaining, status
        FROM memberships
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [membershipId]
    );

    if ((membershipResult.rowCount ?? 0) === 0) {
      throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership not found.');
    }

    const membership = membershipResult.rows[0];

    if (membership.status !== 'active') {
      throw new AppError(
        403,
        'MEMBERSHIP_INACTIVE',
        'Membership is not active.'
      );
    }

    // Verify actor is host or owner of the same club
    const actorRow = await client.query<{ role: string; user_id: string }>(
      `SELECT role, user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
      [actorMembershipId]
    );
    if (!['owner', 'host'].includes(actorRow.rows[0]?.role ?? '')) {
      throw new AppError(
        403,
        'UNAUTHORIZED',
        'Only hosts and owners can adjust member credits.'
      );
    }

    const previousCredits = membership.credits_remaining;

    if (amount < 0 && previousCredits + amount < 0) {
      throw new AppError(
        400,
        'INSUFFICIENT_CREDITS',
        `Member only has ${previousCredits} credit${previousCredits === 1 ? '' : 's'}. Cannot deduct ${Math.abs(amount)}.`
      );
    }

    const updatedResult = await client.query<{ credits_remaining: number }>(
      `
        UPDATE memberships
        SET credits_remaining = credits_remaining + $2,
            updated_at = NOW()
        WHERE id = $1
        RETURNING credits_remaining
      `,
      [membershipId, amount]
    );

    const newCredits = updatedResult.rows[0].credits_remaining;

    await client.query(
      `
        INSERT INTO credit_transactions (
          club_id,
          membership_id,
          user_id,
          session_id,
          attendance_id,
          amount,
          transaction_type,
          note,
          actor_user_id,
          created_at
        )
        VALUES ($1, $2, $3, NULL, NULL, $4, $7, $5, $6, NOW())
      `,
      [
        membership.club_id,
        membershipId,
        membership.user_id,
        amount,
        reason,
        actorRow.rows[0].user_id,
        'manual_adjustment',
      ]
    );

    await writeAuditLog(client, {
      clubId: membership.club_id,
      actorUserId: actorRow.rows[0].user_id,
      targetUserId: membership.user_id,
      entityType: 'membership',
      entityId: membershipId,
      action: amount > 0 ? 'credits_added' : 'credits_removed',
      metadata: { amount, reason, previousCredits, newCredits },
    });

    await client.query('COMMIT');

    logger.info('credits added', {
      membershipId,
      actorMembershipId,
      targetUserId: membership.user_id,
      amount,
      previousCredits,
      newCredits,
      reason,
    });

    return mapMembership({ ...membership, credits_remaining: newCredits });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      logger.error('addCredits rollback failed', {
        error: rbErr instanceof Error ? rbErr.message : String(rbErr),
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

// ─── Update member role ───────────────────────────────────────────────────────

export async function updateMemberRole(
  membershipId: string,
  actorMembershipId: string,
  newRole: 'member' | 'host'
): Promise<MembershipItem> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Load the target membership
    const targetResult = await client.query<MembershipRow>(
      `SELECT m.id, m.user_id, m.club_id, m.role, m.credits_remaining, m.status,
              m.recovery_code, u.name AS user_name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE m.id = $1 LIMIT 1 FOR UPDATE`,
      [membershipId]
    );

    if ((targetResult.rowCount ?? 0) === 0) {
      throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership not found.');
    }

    const target = targetResult.rows[0];

    if (target.status !== 'active') {
      throw new AppError(
        403,
        'MEMBERSHIP_INACTIVE',
        'Membership is not active.'
      );
    }

    // Owners cannot be demoted
    if (target.role === 'owner') {
      throw new AppError(
        403,
        'CANNOT_CHANGE_OWNER',
        'Owner role cannot be changed.'
      );
    }

    // Verify actor has permission (must be host or owner in the same club)
    const actorResult = await client.query<{
      role: string;
      id: string;
      user_id: string;
    }>(
      `SELECT id, role, user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
      [actorMembershipId]
    );

    const actorRole = actorResult.rows[0]?.role;
    if (!actorRole || !['host', 'owner'].includes(actorRole)) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only hosts can change member roles.'
      );
    }

    // Only owner can promote/demote host
    if (newRole === 'host' && actorRole !== 'owner') {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only the owner can promote a member to host.'
      );
    }
    if (target.role === 'host' && newRole !== 'host' && actorRole !== 'owner') {
      throw new AppError(403, 'FORBIDDEN', 'Only the owner can demote a host.');
    }

    // Prevent self-change
    if (actorResult.rows[0]?.id === membershipId) {
      throw new AppError(
        403,
        'CANNOT_CHANGE_OWN_ROLE',
        'You cannot change your own role.'
      );
    }

    const previousRole = target.role;

    await client.query(
      `UPDATE memberships SET role = $2, updated_at = NOW() WHERE id = $1`,
      [membershipId, newRole]
    );

    await writeAuditLog(client, {
      clubId: target.club_id,
      actorUserId: actorResult.rows[0].user_id,
      targetUserId: target.user_id,
      entityType: 'membership',
      entityId: membershipId,
      action: 'role_changed',
      metadata: { previousRole, newRole },
    });

    await client.query('COMMIT');

    logger.info('role changed', {
      membershipId,
      actorMembershipId,
      previousRole,
      newRole,
    });

    return mapMembership({ ...target, role: newRole });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      logger.error('updateMemberRole rollback failed', {
        error: rbErr instanceof Error ? rbErr.message : String(rbErr),
      });
    }
    throw error;
  } finally {
    client.release();
  }
}
