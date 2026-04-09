import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { AppError } from '../errors/AppError';
import { logger } from '../lib/logger';
import { writeAuditLog } from './auditLogService';

type CheckInParams = {
  sessionId: string;
  membershipId: string;
  creditsUsed: number;
};

type CheckInResult = {
  attendanceId: string;
  remainingCredits: number;
  membershipId: string;
  creditsUsed: number;
  checkedInAt: string;
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
  checked_in_at: string;
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

  if ((result.rowCount ?? 0) > 0) {
    throw new AppError(
      409,
      'ALREADY_CHECKED_IN',
      'User has already checked in to this session.'
    );
  }
}

export async function checkInToSession({
  sessionId,
  membershipId,
  creditsUsed,
}: CheckInParams): Promise<CheckInResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const session = await getSessionForCheckin(client, sessionId);

    // Reject check-in if the session hasn't started yet
    const startsAt = new Date(session.starts_at).getTime();
    if (startsAt > Date.now()) {
      throw new AppError(
        409,
        'SESSION_NOT_STARTED',
        'This session has not started yet.'
      );
    }

    // Look up membership by ID (same pattern as manualCheckInToSession)
    const membershipResult = await client.query<MembershipRow>(
      `SELECT id, user_id, club_id, role, credits_remaining, status
       FROM memberships WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [membershipId]
    );
    if ((membershipResult.rowCount ?? 0) === 0) {
      throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership not found.');
    }
    const membership = membershipResult.rows[0];
    if (membership.club_id !== session.club_id) {
      throw new AppError(
        403,
        'MEMBERSHIP_NOT_FOUND',
        'Membership does not belong to this club.'
      );
    }
    if (membership.status !== 'active') {
      throw new AppError(
        403,
        'MEMBERSHIP_INACTIVE',
        'Membership is not active.'
      );
    }
    const userId = membership.user_id;

    await ensureNoDuplicateAttendance(client, sessionId, userId);

    if (membership.credits_remaining < creditsUsed) {
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
        SET credits_remaining = credits_remaining - $2,
            updated_at = NOW()
        WHERE id = $1
          AND credits_remaining >= $2
        RETURNING credits_remaining
      `,
      [membership.id, creditsUsed]
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
            checked_in_by_user_id,
            credits_used,
            checked_in_at,
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
          RETURNING id, checked_in_at
        `,
        [
          sessionId,
          session.club_id,
          userId,
          membership.id,
          'self',
          userId,
          creditsUsed,
        ]
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
        -creditsUsed,
        'checkin',
        'Credit deducted for session check-in',
      ]
    );

    await writeAuditLog(client, {
      clubId: session.club_id,
      actorUserId: userId,
      targetUserId: userId,
      entityType: 'attendance',
      entityId: attendance.id,
      sessionId,
      action: 'member_checked_in',
      metadata: {
        sessionId,
        membershipId: membership.id,
        creditsUsed,
        creditDelta: -creditsUsed,
        remainingCredits,
        checkInType: 'live',
      },
    });

    await client.query('COMMIT');

    logger.info('check-in success', {
      sessionId,
      userId,
      membershipId: membership.id,
      creditsUsed,
      remainingCredits,
      attendanceId: attendance.id,
    });

    return {
      attendanceId: attendance.id,
      remainingCredits,
      membershipId: membership.id,
      creditsUsed,
      checkedInAt: attendance.checked_in_at,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('check-in rollback failed', {
        error:
          rollbackError instanceof Error
            ? rollbackError.message
            : String(rollbackError),
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

// ─── Manual check-in (host checks in a specific member) ───────────────────────

type ManualCheckInParams = {
  sessionId: string;
  actorUserId: string;
  targetMembershipId: string;
  creditsUsed: number;
};

export async function manualCheckInToSession({
  sessionId,
  actorUserId,
  targetMembershipId,
  creditsUsed,
}: ManualCheckInParams): Promise<CheckInResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const session = await getSessionForCheckin(client, sessionId);

    // Look up target membership by its ID
    const targetResult = await client.query<MembershipRow>(
      `SELECT id, user_id, club_id, role, credits_remaining, status
       FROM memberships WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [targetMembershipId]
    );
    if ((targetResult.rowCount ?? 0) === 0) {
      throw new AppError(
        404,
        'MEMBERSHIP_NOT_FOUND',
        'Target membership not found.'
      );
    }
    const membership = targetResult.rows[0];

    if (membership.club_id !== session.club_id) {
      throw new AppError(
        403,
        'MEMBERSHIP_NOT_FOUND',
        'Target member does not belong to this club.'
      );
    }
    if (membership.status !== 'active') {
      throw new AppError(
        403,
        'MEMBERSHIP_INACTIVE',
        'Target membership is not active.'
      );
    }

    await ensureNoDuplicateAttendance(client, sessionId, membership.user_id);

    if (membership.credits_remaining < creditsUsed) {
      throw new AppError(
        409,
        'INSUFFICIENT_CREDITS',
        'Target member does not have enough credits.'
      );
    }

    const updatedResult = await client.query<{ credits_remaining: number }>(
      `UPDATE memberships SET credits_remaining = credits_remaining - $2, updated_at = NOW()
       WHERE id = $1 AND credits_remaining >= $2 RETURNING credits_remaining`,
      [membership.id, creditsUsed]
    );
    if (updatedResult.rowCount === 0) {
      throw new AppError(
        409,
        'INSUFFICIENT_CREDITS',
        'Not enough credits remaining.'
      );
    }
    const remainingCredits = updatedResult.rows[0].credits_remaining;

    let attendance: AttendanceRow;
    try {
      const attendanceResult = await client.query<AttendanceRow>(
        `INSERT INTO attendances (session_id, club_id, user_id, membership_id, check_in_method, checked_in_by_user_id, credits_used, checked_in_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'manual', $5, $6, NOW(), NOW(), NOW()) RETURNING id, checked_in_at`,
        [
          sessionId,
          session.club_id,
          membership.user_id,
          membership.id,
          actorUserId,
          creditsUsed,
        ]
      );
      attendance = attendanceResult.rows[0];
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AppError(
          409,
          'ALREADY_CHECKED_IN',
          'Member has already checked in.'
        );
      }
      throw error;
    }

    await client.query(
      `INSERT INTO credit_transactions (club_id, membership_id, user_id, session_id, attendance_id, amount, transaction_type, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'checkin', 'Manual check-in by host', NOW())`,
      [
        session.club_id,
        membership.id,
        membership.user_id,
        sessionId,
        attendance.id,
        -creditsUsed,
      ]
    );

    await writeAuditLog(client, {
      clubId: session.club_id,
      actorUserId,
      targetUserId: membership.user_id,
      entityType: 'attendance',
      entityId: attendance.id,
      sessionId,
      action: 'member_checked_in',
      metadata: {
        sessionId,
        membershipId: membership.id,
        creditsUsed,
        remainingCredits,
        checkInType: 'manual',
      },
    });

    await client.query('COMMIT');

    return {
      attendanceId: attendance.id,
      remainingCredits,
      membershipId: membership.id,
      creditsUsed,
      checkedInAt: attendance.checked_in_at,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}
