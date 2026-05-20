import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
import { getCurrentUserId, getActorMemberId } from '../lib/auth';
import { pool } from '../db/pool';
import { createAuditLog } from '../services/auditLogService';
import {
  normalizeRole,
  canManageSession,
  canDeleteSession,
  canManualCheckIn,
} from '../lib/permissions';
import {
  checkInToSession,
  manualCheckInToSession,
} from '../services/checkinService';
import {
  getSessionsByClub,
  getSessionById,
  getCheckedInMembers,
  createSession,
  updateSession,
  deleteSession,
  createRecurringSessions,
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
    const {
      clubId,
      title,
      locationId,
      startTime,
      endTime,
      capacity,
      hostMembershipId,
    } = req.body as Record<string, unknown>;

    if (typeof clubId !== 'string' || !isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }

    // Only hosts and owners may create sessions
    const actorMemberId = getActorMemberId(req);
    const actorRow = await pool.query<{ role: string; user_id: string }>(
      `SELECT role, user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
      [actorMemberId]
    );
    if (!canManageSession(normalizeRole(actorRow.rows[0]?.role))) {
      throw new AppError(
        403,
        'UNAUTHORIZED',
        'Only hosts and owners can create sessions.'
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
    if (hostMembershipId !== undefined && hostMembershipId !== null) {
      if (
        typeof hostMembershipId !== 'string' ||
        !isValidUUID(hostMembershipId)
      ) {
        throw new AppError(
          400,
          'INVALID_HOST_ID',
          'hostMembershipId must be a valid UUID.'
        );
      }
    }

    if (typeof startTime !== 'string' || !startTime) {
      throw new AppError(400, 'INVALID_START_TIME', 'startTime is required.');
    }

    if (typeof endTime !== 'string' || !endTime) {
      throw new AppError(400, 'INVALID_END_TIME', 'endTime is required.');
    }

    if (endTime <= startTime) {
      throw new AppError(
        400,
        'INVALID_END_TIME',
        'endTime must be after startTime.'
      );
    }

    const session = await createSession({
      clubId,
      title: typeof title === 'string' ? title.trim() : null,
      locationId,
      startTime,
      endTime,
      capacity:
        typeof capacity === 'number' &&
        Number.isInteger(capacity) &&
        capacity > 0
          ? capacity
          : null,
      hostMembershipId:
        typeof hostMembershipId === 'string' ? hostMembershipId : null,
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

// ─── POST /api/sessions/recurring ────────────────────────────────────────────

export async function createRecurringSessionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      clubId,
      title,
      locationId,
      startTime,
      endTime,
      capacity,
      hostMembershipId,
      repeatCount,
    } = req.body as Record<string, unknown>;

    // Validation
    if (typeof clubId !== 'string' || !isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }

    // Only hosts and owners may create sessions
    const actorMemberId = getActorMemberId(req);
    const actorRow = await pool.query<{ role: string; user_id: string }>(
      `SELECT role, user_id FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
      [actorMemberId]
    );
    if (!canManageSession(normalizeRole(actorRow.rows[0]?.role))) {
      throw new AppError(
        403,
        'UNAUTHORIZED',
        'Only hosts and owners can create sessions.'
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

    // Validate title
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

    // Validate host
    if (hostMembershipId !== undefined && hostMembershipId !== null) {
      if (
        typeof hostMembershipId !== 'string' ||
        !isValidUUID(hostMembershipId)
      ) {
        throw new AppError(
          400,
          'INVALID_HOST_ID',
          'hostMembershipId must be a valid UUID.'
        );
      }
    }

    // Validate times
    if (typeof startTime !== 'string' || !startTime) {
      throw new AppError(400, 'INVALID_START_TIME', 'startTime is required.');
    }

    if (typeof endTime !== 'string' || !endTime) {
      throw new AppError(400, 'INVALID_END_TIME', 'endTime is required.');
    }

    if (endTime <= startTime) {
      throw new AppError(
        400,
        'INVALID_END_TIME',
        'endTime must be after startTime.'
      );
    }

    // Validate repeat count
    if (typeof repeatCount !== 'number' || !Number.isInteger(repeatCount)) {
      throw new AppError(
        400,
        'INVALID_REPEAT_COUNT',
        'repeatCount must be an integer.'
      );
    }

    const sessions = await createRecurringSessions({
      clubId,
      title: typeof title === 'string' ? title.trim() : null,
      locationId,
      startTime,
      endTime,
      capacity:
        typeof capacity === 'number' &&
        Number.isInteger(capacity) &&
        capacity > 0
          ? capacity
          : null,
      hostMembershipId:
        typeof hostMembershipId === 'string' ? hostMembershipId : null,
      repeatCount,
    });

    void createAuditLog({
      clubId,
      actorUserId: actorRow.rows[0].user_id,
      entityType: 'session',
      entityId: sessions[0]?.id ?? '',
      sessionId: sessions[0]?.id ?? '',
      action: 'recurring_sessions_created',
      metadata: {
        title: sessions[0]?.title ?? null,
        locationId,
        repeatCount,
        sessionCount: sessions.length,
      },
    });

    res.status(201).json({ success: true, data: sessions });
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

    // Resolve actor's user_id and role for manual check-in
    const actorRow = await pool.query<{ user_id: string; role: string }>(
      `SELECT user_id, role FROM memberships WHERE id = $1 AND status = 'active' LIMIT 1`,
      [actorMemberId]
    );
    if (!actorRow.rows[0]) {
      throw new AppError(401, 'UNAUTHORIZED', 'Actor membership not found.');
    }
    if (!canManualCheckIn(normalizeRole(actorRow.rows[0].role))) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only hosts and owners can manually check in members.'
      );
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
    const role = normalizeRole(memberRow.rows[0]?.role);
    if (!canDeleteSession(role)) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only owners and hosts can delete sessions.'
      );
    }

    // Only upcoming sessions with no attendance may be deleted
    const now = new Date();
    if (new Date(session.startTime) <= now) {
      throw new AppError(
        409,
        'SESSION_NOT_DELETABLE',
        'Only upcoming sessions can be deleted.'
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

// ─── PATCH /api/sessions/:sessionId ──────────────────────────────────────────

export async function updateSessionHandler(
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

    // Fetch session first so we can scope the actor check to the right club
    const existingSession = await getSessionById(sessionId);

    // Only hosts and owners of THIS club may update sessions
    const actorMemberId = getActorMemberId(req);
    const actorRow = await pool.query<{ role: string }>(
      `SELECT role FROM memberships WHERE id = $1 AND club_id = $2 AND status = 'active' LIMIT 1`,
      [actorMemberId, existingSession.clubId]
    );
    if (!canManageSession(normalizeRole(actorRow.rows[0]?.role))) {
      throw new AppError(
        403,
        'UNAUTHORIZED',
        'Only hosts and owners can update sessions.'
      );
    }

    const {
      hostMembershipId,
      title,
      startTime,
      endTime,
      locationId,
      capacity,
    } = req.body as Record<string, unknown>;

    // hostMembershipId must be a UUID string or explicitly null to clear
    if (hostMembershipId !== undefined && hostMembershipId !== null) {
      if (
        typeof hostMembershipId !== 'string' ||
        !isValidUUID(hostMembershipId)
      ) {
        throw new AppError(
          400,
          'INVALID_HOST_ID',
          'hostMembershipId must be a valid UUID.'
        );
      }
    }

    if (title !== undefined && title !== null && typeof title !== 'string') {
      throw new AppError(400, 'INVALID_TITLE', 'title must be a string.');
    }

    if (startTime !== undefined && typeof startTime !== 'string') {
      throw new AppError(
        400,
        'INVALID_START_TIME',
        'startTime must be an ISO string.'
      );
    }
    if (endTime !== undefined && typeof endTime !== 'string') {
      throw new AppError(
        400,
        'INVALID_END_TIME',
        'endTime must be an ISO string.'
      );
    }

    // ── Status-aware time validation ──────────────────────────────────────────
    const now = new Date();
    const existingStart = new Date(existingSession.startTime);
    const existingEnd = new Date(existingSession.endTime);

    const sessionLifecycle =
      now < existingStart
        ? 'upcoming'
        : now <= existingEnd
          ? 'active'
          : 'ended';

    const resolvedStart = startTime
      ? new Date(startTime as string)
      : existingStart;
    const resolvedEnd = endTime ? new Date(endTime as string) : existingEnd;

    if (sessionLifecycle === 'ended') {
      // Ended sessions: time and host fields are frozen
      if (startTime !== undefined) {
        throw new AppError(
          409,
          'SESSION_ENDED',
          'Cannot change start time of an ended session.'
        );
      }
      if (endTime !== undefined) {
        throw new AppError(
          409,
          'SESSION_ENDED',
          'Cannot change end time of an ended session.'
        );
      }
      if (hostMembershipId !== undefined) {
        throw new AppError(
          409,
          'SESSION_ENDED',
          'Cannot change the host of an ended session.'
        );
      }
    } else if (sessionLifecycle === 'active') {
      // Active sessions: starts_at is frozen; ends_at can be adjusted
      if (startTime !== undefined) {
        throw new AppError(
          409,
          'SESSION_ALREADY_STARTED',
          'Cannot change the start time of a session that is already in progress.'
        );
      }
      if (endTime !== undefined) {
        // New end must be in the future and after existing start
        if (resolvedEnd <= now) {
          throw new AppError(
            400,
            'INVALID_END_TIME',
            'The new end time must be in the future.'
          );
        }
        if (resolvedEnd <= existingStart) {
          throw new AppError(
            400,
            'INVALID_END_TIME',
            'End time must be after the session start time.'
          );
        }
      }
    } else {
      // Upcoming sessions: full time editing allowed
      if (startTime !== undefined && resolvedStart <= now) {
        throw new AppError(
          400,
          'INVALID_START_TIME',
          'Start time must be in the future for upcoming sessions.'
        );
      }
      if (resolvedEnd <= resolvedStart) {
        throw new AppError(
          400,
          'INVALID_TIMES',
          'End time must be after start time.'
        );
      }
    }

    if (
      locationId !== undefined &&
      locationId !== null &&
      typeof locationId !== 'string'
    ) {
      throw new AppError(
        400,
        'INVALID_LOCATION_ID',
        'locationId must be a string.'
      );
    }

    if (capacity !== undefined && capacity !== null) {
      if (
        typeof capacity !== 'number' ||
        !Number.isInteger(capacity) ||
        capacity < 1
      ) {
        throw new AppError(
          400,
          'INVALID_CAPACITY',
          'capacity must be a positive integer.'
        );
      }
    }

    const resolvedHostId: string | null | undefined =
      hostMembershipId === null
        ? null
        : typeof hostMembershipId === 'string'
          ? hostMembershipId
          : undefined;

    const session = await updateSession(sessionId, {
      hostMembershipId: resolvedHostId,
      title: title as string | null | undefined,
      startTime: startTime as string | undefined,
      endTime: endTime as string | undefined,
      locationId: locationId as string | null | undefined,
      capacity: capacity as number | null | undefined,
    });

    res.json({ success: true, data: session });
  } catch (error) {
    next(error);
  }
}
