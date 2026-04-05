import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
import { getCurrentUserId } from '../lib/auth';
import {
  checkInToSession,
  manualCheckInToSession,
} from '../services/checkinService';
import {
  getSessionsByClub,
  getSessionById,
  getCheckedInMembers,
  createSession,
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
    const userId = getCurrentUserId(req);

    if (!isValidUUID(sessionId)) {
      throw new AppError(
        400,
        'INVALID_SESSION_ID',
        'sessionId must be a valid UUID.'
      );
    }

    const rawCreditsUsed = req.body?.creditsUsed;
    const creditsUsed: number =
      rawCreditsUsed === undefined ? 1 : rawCreditsUsed;

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

    const result = await checkInToSession({ sessionId, userId, creditsUsed });

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
    const { clubId, title, locationId, startTime, endTime } =
      req.body as Record<string, unknown>;

    if (typeof clubId !== 'string' || !isValidUUID(clubId)) {
      throw new AppError(
        400,
        'INVALID_CLUB_ID',
        'clubId must be a valid UUID.'
      );
    }
    if (typeof locationId !== 'string' || !isValidUUID(locationId)) {
      throw new AppError(
        400,
        'INVALID_LOCATION_ID',
        'locationId must be a valid UUID.'
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
    const actorUserId = getCurrentUserId(req);

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
