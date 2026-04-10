import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
import { getActorMemberId } from '../lib/auth';
import { pool } from '../db/pool';
import {
  getSessionAttendees,
  getMemberHistory,
  getAttendanceReport,
  getSessionsBreakdown,
} from '../services/reportService';

// ─── Permission helpers ───────────────────────────────────────────────────────

async function requireReportAccess(
  membershipId: string,
  clubId: string
): Promise<void> {
  const result = await pool.query<{ role: string }>(
    `SELECT role FROM memberships WHERE id = $1 AND club_id = $2 LIMIT 1`,
    [membershipId, clubId]
  );
  const role = result.rows[0]?.role;
  if (!role || !['host', 'admin', 'owner'].includes(role)) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Reports are only accessible to hosts and admins.'
    );
  }
}

// ─── GET /api/reports/sessions/:sessionId/attendees ───────────────────────────

export async function getSessionAttendeesHandler(
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

    // Look up club_id from session so we can check membership
    const sessionRow = await pool.query<{ club_id: string }>(
      `SELECT club_id FROM sessions WHERE id = $1 LIMIT 1`,
      [sessionId]
    );
    if ((sessionRow.rowCount ?? 0) === 0) {
      throw new AppError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    }
    const clubId = sessionRow.rows[0].club_id;

    const actorId = getActorMemberId(req);
    await requireReportAccess(actorId, clubId);

    const data = await getSessionAttendees(sessionId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/reports/members/:membershipId/history ───────────────────────────

export async function getMemberHistoryHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const membershipId = req.params['membershipId'] as string;

    if (!isValidUUID(membershipId)) {
      throw new AppError(
        400,
        'INVALID_MEMBERSHIP_ID',
        'membershipId must be a valid UUID.'
      );
    }

    // Look up membership to get club_id
    const memRow = await pool.query<{ club_id: string }>(
      `SELECT club_id FROM memberships WHERE id = $1 LIMIT 1`,
      [membershipId]
    );
    if ((memRow.rowCount ?? 0) === 0) {
      throw new AppError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership not found.');
    }
    const clubId = memRow.rows[0].club_id;

    const actorId = getActorMemberId(req);
    await requireReportAccess(actorId, clubId);

    const startDate =
      typeof req.query['startDate'] === 'string'
        ? req.query['startDate']
        : undefined;
    const endDate =
      typeof req.query['endDate'] === 'string'
        ? req.query['endDate']
        : undefined;
    const rawLimit = parseInt(String(req.query['limit'] ?? '100'), 10);
    const limit =
      isNaN(rawLimit) || rawLimit < 1 ? 100 : Math.min(rawLimit, 500);

    const data = await getMemberHistory({
      membershipId,
      startDate,
      endDate,
      limit,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/reports/attendance?clubId=...&startDate=...&endDate=... ─────────

export async function getAttendanceReportHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.query['clubId'];

    if (typeof clubId !== 'string' || !clubId.trim()) {
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

    const actorId = getActorMemberId(req);
    await requireReportAccess(actorId, clubId);

    const startDate =
      typeof req.query['startDate'] === 'string'
        ? req.query['startDate']
        : undefined;
    const endDate =
      typeof req.query['endDate'] === 'string'
        ? req.query['endDate']
        : undefined;

    const rawSessionIds = req.query['sessionIds'];
    const sessionIds: string[] | undefined =
      typeof rawSessionIds === 'string'
        ? rawSessionIds
            .split(',')
            .map((s) => s.trim())
            .filter(isValidUUID)
        : Array.isArray(rawSessionIds)
          ? (rawSessionIds as string[]).filter(isValidUUID)
          : undefined;

    const memberId =
      typeof req.query['memberId'] === 'string' &&
      isValidUUID(req.query['memberId'])
        ? (req.query['memberId'] as string)
        : undefined;

    const locationId =
      typeof req.query['locationId'] === 'string' &&
      isValidUUID(req.query['locationId'])
        ? (req.query['locationId'] as string)
        : undefined;

    const rawLimit = parseInt(String(req.query['limit'] ?? '500'), 10);
    const limit =
      isNaN(rawLimit) || rawLimit < 1 ? 500 : Math.min(rawLimit, 1000);

    const data = await getAttendanceReport({
      clubId,
      startDate,
      endDate,
      sessionIds,
      memberId,
      locationId,
      limit,
    });

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/reports/sessions/breakdown?clubId=&startDate=&endDate=&last=true

export async function getSessionsBreakdownHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const clubId = req.query['clubId'];

    if (typeof clubId !== 'string' || !clubId.trim()) {
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

    const actorId = getActorMemberId(req);
    await requireReportAccess(actorId, clubId);

    const lastOnly = req.query['last'] === 'true';
    const startDate =
      typeof req.query['startDate'] === 'string'
        ? req.query['startDate']
        : undefined;
    const endDate =
      typeof req.query['endDate'] === 'string'
        ? req.query['endDate']
        : undefined;

    const data = await getSessionsBreakdown({
      clubId,
      startDate,
      endDate,
      lastOnly,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}
