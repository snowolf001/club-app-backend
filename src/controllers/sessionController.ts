import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
import { getCurrentUserId, getActorMemberId } from '../lib/auth';
import { pool } from '../db/pool';
import { createAuditLog } from '../services/auditLogService';
import {
  checkInToSession,
  manualCheckInToSession,
} from '../services/checkinService';
import {
  getSessionsByClub,
  getSessionById,
  getCheckedInMembers,
  createSession,
  deleteSession,
} from '../services/sessionService';

// ─── GET /api/sessions?clubId=... ─────────────────────────────────────────────

export async function getSessionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.query['clubId'];

    if (typeof clubId !== 'string' || clubId.trim() === '') {
      throw new AppError(
        400,
        'MISSING_CLUB_ID',
        'clubId query parameter is required.'
      );
    }

    if (!isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }

    const sessions = await getSessionsByClub(clubId);

    res.json({ success: true, data: sessions });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/sessions/:sessionId ─────────────────────────────────────────────

export async function getSessionHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.params['sessionId'] as string;

    if (!isValidUUID(sessionId)) {
      throw new AppError(
        400,
        'INVALID_SESSION_ID',
        'sessionId must be a valid UUID.'
      );
    }

    const session = await getSessionById(sessionId);

    res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/sessions/:sessionId/checkin ────────────────────────────────────

export async function postSessionCheckIn(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.params['sessionId'] as string;
    const membershipId = getActorMemberId(req);
    const { creditsUsed: rawCreditsUsed } = req.body as Record<string, unknown>;

    if (!isValidUUID(sessionId)) {
      throw new AppError(
        400,
        'INVALID_SESSION_ID',
        'sessionId must be a valid UUID.'
      );
    }

    if (!isValidUUID(membershipId)) {
      throw new AppError(
        400,
        'INVALID_MEMBERSHIP_ID',
        'x-member-id header must be a valid UUID.'
      );
    }

    const creditsUsed: number =
      rawCreditsUsed === undefined ? 1 : (rawCreditsUsed as number);

    if (
      typeof creditsUsed !== 'number' ||
      !Number.isInteger(creditsUsed) ||
      creditsUsed < 1
    ) {
      throw new AppError(
        400,
        'INVALID_CREDITS_USED',
        'creditsUsed must be a positive integer.'
      );
    }

    const result = await checkInToSession({
      sessionId,
      membershipId,
      creditsUsed,
    });

    res.status(201).json({
      success: true,
      data: {
        attendanceId: result.attendanceId,
        sessionId,
        membershipId: result.membershipId,
        creditsUsed: result.creditsUsed,
        creditsRemaining: result.remainingCredits,
        checkedInAt: result.checkedInAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/sessions/:sessionId/checked-in ──────────────────────────────────

export async function getCheckedInHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.params['sessionId'] as string;

    if (!isValidUUID(sessionId)) {
      throw new AppError(
        400,
        'INVALID_SESSION_ID',
        'sessionId must be a valid UUID.'
      );
    }

    const members = await getCheckedInMembers(sessionId);

    res.json({ success: true, data: members });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/sessions ───────────────────────────────────────────────────────

export async function createSessionHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { clubId, title, locationId, startTime, endTime, capacity } =
      req.body as Record<string, unknown>;

    if (typeof clubId !== 'string' || !isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }

    // Only hosts, admins, and owners may create sessions
    const actorMemberId = getActorMemberId(req);
    const actorRow = await pool.query<{ role: string; user_id: string }>(
      `SELECT role, user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
      [actorMemberId]
    );
    if (!['host', 'admin', 'owner'].includes(actorRow.rows[0]?.role ?? '')) {
      throw new AppError(
        403,
        'UNAUTHORIZED',
        'Only hosts, admins, and owners can create sessions.'
      );
    }

    // locationId is required
    if (locationId === undefined || locationId === null || locationId === '') {
      throw new AppError(
        400,
        'LOCATION_ID_REQUIRED',
        'locationId is required.'
      );
    }
    if (typeof locationId !== 'string' || !isValidUUID(locationId)) {
      throw new AppError(
        400,
        'INVALID_LOCATION_ID',
        'locationId must be a valid UUID.'
      );
    }

    // Validate location exists and belongs to this club
    const locRow = await pool.query<{ id: string }>(
      `SELECT id FROM club_locations WHERE id = $1 AND club_id = $2 LIMIT 1`,
      [locationId, clubId]
    );
    if ((locRow.rowCount ?? 0) === 0) {
      throw new AppError(
        404,
        'LOCATION_NOT_FOUND',
        'Location does not exist or does not belong to this club.'
      );
    }
    // title is optional; if provided it must be non-empty
    if (
      title !== undefined &&
      title !== null &&
      (typeof title !== 'string' || !title.trim())
    ) {
      throw new AppError(
        400,
        'INVALID_TITLE',
        'title must be a non-empty string if provided.'
      );
    }
    if (typeof startTime !== 'string' || !startTime) {
      throw new AppError(400, 'INVALID_START_TIME', 'startTime is required.');
    }

    const session = await createSession({
      clubId,
      title: typeof title === 'string' ? title.trim() : null,
      locationId,
      startTime,
      endTime: typeof endTime === 'string' ? endTime : null,
      capacity:
        typeof capacity === 'number' &&
        Number.isInteger(capacity) &&
        capacity > 0
          ? capacity
          : null,
    });

    void createAuditLog({
      clubId,
      actorUserId: actorRow.rows[0].user_id,
      entityType: 'session',
      entityId: session.id,
      sessionId: session.id,
      action: 'session_created',
      metadata: {
        title: session.title,
        locationId: session.locationId,
        locationName: session.locationName,
        startsAt: session.startTime,
        endsAt: session.endTime,
      },
    });

    res.status(201).json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
}

// ─── POST /api/sessions/:sessionId/checkin-manual ────────────────────────────

export async function postManualCheckIn(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.params['sessionId'] as string;
    const actorMemberId = getActorMemberId(req);

    // Resolve actor's user_id for manual check-in audit trail
    const actorRow = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
      [actorMemberId]
    );
    if (!actorRow.rows[0]) {
      throw new AppError(401, 'UNAUTHORIZED', 'Actor membership not found.');
    }
    const actorUserId = actorRow.rows[0].user_id;

    if (!isValidUUID(sessionId)) {
      throw new AppError(
        400,
        'INVALID_SESSION_ID',
        'sessionId must be a valid UUID.'
      );
    }

    const { targetMembershipId, creditsUsed: rawCredits } = req.body as Record<
      string,
      unknown
    >;

    if (
      typeof targetMembershipId !== 'string' ||
      !isValidUUID(targetMembershipId)
    ) {
      throw new AppError(
        400,
        'INVALID_MEMBERSHIP_ID',
        'targetMembershipId must be a valid UUID.'
      );
    }
    const creditsUsed: number =
      rawCredits === undefined ? 1 : (rawCredits as number);
    if (
      typeof creditsUsed !== 'number' ||
      !Number.isInteger(creditsUsed) ||
      creditsUsed < 1
    ) {
      throw new AppError(
        400,
        'INVALID_CREDITS_USED',
        'creditsUsed must be a positive integer.'
      );
    }

    const result = await manualCheckInToSession({
      sessionId,
      actorUserId,
      targetMembershipId,
      creditsUsed,
    });

    res.status(201).json({
      success: true,
      data: {
        attendanceId: result.attendanceId,
        sessionId,
        membershipId: result.membershipId,
        creditsUsed: result.creditsUsed,
        creditsRemaining: result.remainingCredits,
        checkedInAt: result.checkedInAt,
      },
    });
  } catch (error) {
    next(error);
  }
}

// ─── DELETE /api/sessions/:sessionId ─────────────────────────────────────────

export async function deleteSessionHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = req.params['sessionId'] as string;
    const actorMemberId = getActorMemberId(req);

    if (!isValidUUID(sessionId)) {
      throw new AppError(
        400,
        'INVALID_SESSION_ID',
        'sessionId must be a valid UUID.'
      );
    }

    // Load session (also validates it exists)
    const session = await getSessionById(sessionId);

    // Check caller's membership role in the club
    const memberRow = await pool.query<{ role: string; user_id: string }>(
      `SELECT role, user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
      [actorMemberId]
    );
    const role = memberRow.rows[0]?.role;
    if (!role || !['owner', 'admin', 'host'].includes(role)) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only owners, admins, and hosts can delete sessions.'
      );
    }

    await deleteSession(sessionId);

    void createAuditLog({
      clubId: session.clubId,
      actorUserId: memberRow.rows[0].user_id,
      entityType: 'session',
      entityId: sessionId,
      sessionId,
      action: 'session_deleted',
      metadata: {
        title: session.title,
        locationId: session.locationId,
        locationName: session.locationName,
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
