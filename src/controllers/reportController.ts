import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
import { getActorMemberId } from '../lib/auth';
import { pool } from '../db/pool';
import { logger } from '../lib/logger';
import { normalizeRole, canViewReports, requirePro } from '../lib/permissions';
import {
  getSessionAttendees,
  getMemberHistory,
  getAttendanceReport,
  getSessionsBreakdown,
  getReportSummary,
} from '../services/reportService';
import { getAuditLogs } from '../services/auditLogService';

// ─── Helper: parse date param — accepts ?from= and ?startDate= aliases ────────

function parseDateParam(
  query: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    if (typeof query[key] === 'string' && (query[key] as string).trim()) {
      return (query[key] as string).trim();
    }
  }
  return undefined;
}

// ─── Permission guard ─────────────────────────────────────────────────────────

async function requireReportAccess(
  membershipId: string,
  clubId: string
): Promise<void> {
  const result = await pool.query<{ role: string }>(
    `SELECT role FROM memberships WHERE id = $1 AND club_id = $2 AND status = 'active' LIMIT 1`,
    [membershipId, clubId]
  );
  const role = normalizeRole(result.rows[0]?.role);
  if (!canViewReports(role)) {
    throw new AppError(
      403,
      'FORBIDDEN',
      'Reports are only accessible to hosts and owners.'
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

    logger.info('[report] session-attendees request', { sessionId, actorId });
    const data = await getSessionAttendees(sessionId);
    logger.info('[report] session-attendees result', {
      sessionId,
      attendeeCount: data.attendees.length,
    });
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

    // Accept ?from= / ?to= as aliases for ?startDate= / ?endDate=
    const startDate = parseDateParam(
      req.query as Record<string, unknown>,
      'startDate',
      'from'
    );
    const endDate = parseDateParam(
      req.query as Record<string, unknown>,
      'endDate',
      'to'
    );
    const rawLimit = parseInt(String(req.query['limit'] ?? '100'), 10);
    const limit =
      isNaN(rawLimit) || rawLimit < 1 ? 100 : Math.min(rawLimit, 500);

    logger.info('[report] member-history request', {
      membershipId,
      startDate,
      endDate,
    });
    const data = await getMemberHistory({
      membershipId,
      startDate,
      endDate,
      limit,
    });
    logger.info('[report] member-history result', {
      membershipId,
      itemCount: data.items.length,
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

    // Accept ?from= / ?to= as aliases for ?startDate= / ?endDate=
    const startDate = parseDateParam(
      req.query as Record<string, unknown>,
      'startDate',
      'from'
    );
    const endDate = parseDateParam(
      req.query as Record<string, unknown>,
      'endDate',
      'to'
    );

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

    logger.info('[report] attendance-report request', {
      clubId,
      startDate,
      endDate,
    });
    const data = await getAttendanceReport({
      clubId,
      startDate,
      endDate,
      sessionIds,
      memberId,
      locationId,
      limit,
    });
    logger.info('[report] attendance-report result', {
      clubId,
      itemCount: data.items.length,
      totalSessions: data.summary.totalSessions,
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
    // Accept ?from= / ?to= as aliases for ?startDate= / ?endDate=
    const startDate = parseDateParam(
      req.query as Record<string, unknown>,
      'startDate',
      'from'
    );
    const endDate = parseDateParam(
      req.query as Record<string, unknown>,
      'endDate',
      'to'
    );

    logger.info('[report] sessions-breakdown request', {
      clubId,
      startDate,
      endDate,
      lastOnly,
    });
    const data = await getSessionsBreakdown({
      clubId,
      startDate,
      endDate,
      lastOnly,
    });
    logger.info('[report] sessions-breakdown result', {
      clubId,
      sessionCount: data.sessions.length,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/reports/summary?clubId=&from=&to= ───────────────────────────────

export async function getReportSummaryHandler(
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
    // Summary report is Pro-only
    await requirePro(actorId, clubId, 'report-summary');

    const from = parseDateParam(
      req.query as Record<string, unknown>,
      'from',
      'startDate'
    );
    const to = parseDateParam(
      req.query as Record<string, unknown>,
      'to',
      'endDate'
    );

    logger.info('[report] summary request', { clubId, from, to, actorId });
    const data = await getReportSummary({ clubId, from, to });
    logger.info('[report] summary result', {
      clubId,
      totalSessions: data.totalSessions,
      totalCheckIns: data.totalCheckIns,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/reports/session?clubId=&from=&to= ───────────────────────────────
// Alias for sessions/breakdown — UI-friendly single-session-report endpoint.

export async function getReportSessionHandler(
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
    const from = parseDateParam(
      req.query as Record<string, unknown>,
      'from',
      'startDate'
    );
    const to = parseDateParam(
      req.query as Record<string, unknown>,
      'to',
      'endDate'
    );

    logger.info('[report] session request', {
      clubId,
      from,
      to,
      lastOnly,
      actorId,
    });
    const data = await getSessionsBreakdown({
      clubId,
      startDate: from,
      endDate: to,
      lastOnly,
    });
    logger.info('[report] session result', {
      clubId,
      sessionCount: data.sessions.length,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/reports/audit?clubId=&from=&to= — Pro-only ──────────────────────

export async function getReportAuditHandler(
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

    // Pro-only: requirePro checks both host/owner role and active Pro subscription.
    await requirePro(actorId, clubId, 'audit-report');

    const from = parseDateParam(
      req.query as Record<string, unknown>,
      'from',
      'startDate'
    );
    const to = parseDateParam(
      req.query as Record<string, unknown>,
      'to',
      'endDate'
    );
    const rawLimit = parseInt(String(req.query['limit'] ?? '200'), 10);
    const limit =
      isNaN(rawLimit) || rawLimit < 1 ? 200 : Math.min(rawLimit, 1000);
    const rawOffset = parseInt(String(req.query['offset'] ?? '0'), 10);
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    logger.info('[report] audit request', { clubId, from, to, actorId });
    const data = await getAuditLogs(clubId, limit, offset, {
      startDate: from ?? null,
      endDate: to ?? null,
    });
    logger.info('[report] audit result', { clubId, count: data.length });
    res.json({
      success: true,
      data: {
        items: data,
        summary: {
          totalItems: data.length,
          from: from ?? null,
          to: to ?? null,
        },
      },
    });
  } catch (error) {
    next(error);
  }
}
