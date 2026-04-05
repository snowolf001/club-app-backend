import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
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

    const rawLimit = parseInt(String(req.query['limit'] ?? DEFAULT_LIMIT), 10);
    const rawOffset = parseInt(String(req.query['offset'] ?? 0), 10);

    const limit =
      isNaN(rawLimit) || rawLimit < 1
        ? DEFAULT_LIMIT
        : Math.min(rawLimit, MAX_LIMIT);
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    const logs = await getAuditLogs(clubId, limit, offset);

    res.json({ success: true, data: logs });
  } catch (error) {
    next(error);
  }
}
