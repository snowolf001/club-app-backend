import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
import { getCurrentUserId, getActorMemberId } from '../lib/auth';
import { pool } from '../db/pool';
import { getAuditLogs } from '../services/auditLogService';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ─── GET /api/audit-logs?clubId=...&limit=...&offset=... ─────────────────────

export async function getAuditLogsHandler(
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

    // Host/owner only
    const actorMemberId = getActorMemberId(req);
    const memberRow = await pool.query<{ role: string }>(
      `SELECT role FROM memberships WHERE id = $1 AND club_id = $2 LIMIT 1`,
      [actorMemberId, clubId]
    );
    const role = memberRow.rows[0]?.role;
    if (!role || !['host', 'owner'].includes(role)) {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Only hosts and owners can view audit logs.'
      );
    }

    const rawLimit = parseInt(String(req.query['limit'] ?? DEFAULT_LIMIT), 10);
    const rawOffset = parseInt(String(req.query['offset'] ?? 0), 10);

    const limit =
      isNaN(rawLimit) || rawLimit < 1
        ? DEFAULT_LIMIT
        : Math.min(rawLimit, MAX_LIMIT);
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    const targetUserId =
      typeof req.query['targetUserId'] === 'string' &&
      req.query['targetUserId'].trim()
        ? req.query['targetUserId'].trim()
        : null;
    const startDate =
      typeof req.query['startDate'] === 'string' &&
      req.query['startDate'].trim()
        ? req.query['startDate'].trim()
        : null;
    const endDate =
      typeof req.query['endDate'] === 'string' && req.query['endDate'].trim()
        ? req.query['endDate'].trim()
        : null;

    const logs = await getAuditLogs(clubId, limit, offset, {
      targetUserId,
      startDate,
      endDate,
    });

    res.json({ success: true, data: logs });
  } catch (error) {
    next(error);
  }
}
