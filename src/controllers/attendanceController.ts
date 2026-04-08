import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
import { getCurrentUserId } from '../lib/auth';
import {
  getAttendanceForUser,
  getAttendanceForMembership,
  getCreditTransactionsForUser,
  getCreditTransactionsForMembership,
} from '../services/attendanceService';

// ─── GET /api/attendance/me ───────────────────────────────────────────────────

export async function getMyAttendanceHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getCurrentUserId(req);
    const attendance = await getAttendanceForUser(userId);

    res.json({ success: true, data: attendance });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/memberships/:membershipId/attendance ────────────────────────────

export async function getMemberAttendanceHandler(
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

    const attendance = await getAttendanceForMembership(membershipId);

    res.json({ success: true, data: attendance });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/credits/me ──────────────────────────────────────────────────────

export async function getMyCreditTransactionsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getCurrentUserId(req);
    const transactions = await getCreditTransactionsForUser(userId);

    res.json({ success: true, data: transactions });
  } catch (error) {
    next(error);
  }
}

// ─── GET /api/memberships/:membershipId/credits ───────────────────────────────

export async function getMemberCreditTransactionsHandler(
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

    const transactions = await getCreditTransactionsForMembership(membershipId);
    res.json({ success: true, data: transactions });
  } catch (error) {
    next(error);
  }
}
