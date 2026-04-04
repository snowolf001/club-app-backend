import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';

type CheckInParams = {
  sessionId: string;
  userId: string;
};

type CheckInResult = {
  attendanceId: string;
  remainingCredits: number;
  membershipId: string;
};

type SessionRow = {
  id: string;
  club_id: string;
  starts_at: string;
  ends_at: string | null;
};

type MembershipRow = {
  id: string;
  user_id: string;
  club_id: string;
  role: string;
  credits_remaining: number;
  status: string;
};

type AttendanceRow = {
  id: string;
};

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

async function getSessionForCheckin(
  client: PoolClient,
  sessionId: string
): Promise<SessionRow> {
  const result = await client.query<SessionRow>(
    `
      SELECT id, club_id, starts_at, ends_at
      FROM sessions
      WHERE id = $1
      LIMIT 1
    `,
    [sessionId]
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
  }

  return result.rows[0];
}

async function getMembershipForUpdate(
  client: PoolClient,
  clubId: string,
  userId: string
): Promise<MembershipRow> {
  const result = await client.query<MembershipRow>(
    `
      SELECT id, user_id, club_id, role, credits_remaining, status
      FROM memberships
      WHERE club_id = $1
        AND user_id = $2
      LIMIT 1
      FOR UPDATE
    `,
    [clubId, userId]
  );

  if (result.rowCount === 0) {
    throw new AppError(
      403,
      'MEMBERSHIP_NOT_FOUND',
      'User is not a member of this club.'
    );
  }

  const membership = result.rows[0];

  if (membership.status !== 'active') {
    throw new AppError(403, 'MEMBERSHIP_INACTIVE', 'Membership is not active.');
  }

  return membership;
}

async function ensureNoDuplicateAttendance(
  client: PoolClient,
  sessionId: string,
  userId: string
): Promise<void> {
  const result = await client.query(
    `
      SELECT id
      FROM attendances
      WHERE session_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [sessionId, userId]
  );

  if (result.rowCount > 0) {
    throw new AppError(
      409,
      'ALREADY_CHECKED_IN',
      'User has already checked in to this session.'
    );
  }
}

export async function checkInToSession({
  sessionId,
  userId,
}: CheckInParams): Promise<CheckInResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const session = await getSessionForCheckin(client, sessionId);
    const membership = await getMembershipForUpdate(
      client,
      session.club_id,
      userId
    );

    await ensureNoDuplicateAttendance(client, sessionId, userId);

    if (membership.credits_remaining < 1) {
      throw new AppError(
        409,
        'INSUFFICIENT_CREDITS',
        'Not enough credits remaining.'
      );
    }

    const updatedMembershipResult = await client.query<{
      credits_remaining: number;
    }>(
      `
        UPDATE memberships
        SET credits_remaining = credits_remaining - 1,
            updated_at = NOW()
        WHERE id = $1
          AND credits_remaining >= 1
        RETURNING credits_remaining
      `,
      [membership.id]
    );

    if (updatedMembershipResult.rowCount === 0) {
      throw new AppError(
        409,
        'INSUFFICIENT_CREDITS',
        'Not enough credits remaining.'
      );
    }

    const remainingCredits = updatedMembershipResult.rows[0].credits_remaining;

    let attendance: AttendanceRow;

    try {
      const attendanceResult = await client.query<AttendanceRow>(
        `
          INSERT INTO attendances (
            session_id,
            club_id,
            user_id,
            membership_id,
            check_in_method,
            checked_in_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
          RETURNING id
        `,
        [sessionId, session.club_id, userId, membership.id, 'self']
      );

      attendance = attendanceResult.rows[0];
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          409,
          'ALREADY_CHECKED_IN',
          'User has already checked in to this session.'
        );
      }
      throw error;
    }

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
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `,
      [
        session.club_id,
        membership.id,
        userId,
        sessionId,
        attendance.id,
        -1,
        'checkin',
        'Credit deducted for session check-in',
      ]
    );

    await client.query(
      `
        INSERT INTO audit_logs (
          club_id,
          actor_user_id,
          target_user_id,
          entity_type,
          entity_id,
          action,
          metadata,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
      `,
      [
        session.club_id,
        userId,
        userId,
        'attendance',
        attendance.id,
        'session_checkin',
        JSON.stringify({
          sessionId,
          membershipId: membership.id,
          creditDelta: -1,
          remainingCredits,
          method: 'self',
        }),
      ]
    );

    await client.query('COMMIT');

    return {
      attendanceId: attendance.id,
      remainingCredits,
      membershipId: membership.id,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('[checkInToSession] rollback failed:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}
