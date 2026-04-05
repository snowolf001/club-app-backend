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
  recovery_code: string;
};

export type MembershipItem = {
  membershipId: string;
  clubId: string;
  userId: string;
  userName: string;
  recoveryCode: string;
  role: string;
  credits: number;
  active: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapMembership(row: MembershipRow): MembershipItem {
  return {
    membershipId: row.id,
    clubId: row.club_id,
    userId: row.user_id,
    userName: row.user_name ?? '',
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
             m.recovery_code, u.name AS user_name
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
            m.recovery_code, u.name AS user_name,
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

export async function addCredits(
  membershipId: string,
  actorUserId: string,
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

    const previousCredits = membership.credits_remaining;

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
        VALUES ($1, $2, $3, NULL, NULL, $4, 'add', $5, $6, NOW())
      `,
      [
        membership.club_id,
        membershipId,
        membership.user_id,
        amount,
        reason,
        actorUserId,
      ]
    );

    await writeAuditLog(client, {
      clubId: membership.club_id,
      actorUserId,
      targetUserId: membership.user_id,
      entityType: 'membership',
      entityId: membershipId,
      action: 'add_credits',
      metadata: { amount, reason, previousCredits, newCredits },
    });

    await client.query('COMMIT');

    logger.info('credits added', {
      membershipId,
      actorUserId,
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
