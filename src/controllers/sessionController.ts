import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { checkInToSession } from '../services/checkinService';

export async function postSessionCheckIn(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { sessionId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      throw new AppError(401, 'UNAUTHORIZED', 'User is not authenticated.');
    }

    if (!sessionId) {
      throw new AppError(400, 'INVALID_SESSION_ID', 'Session id is required.');
    }

    const result = await checkInToSession({
      sessionId,
      userId,
    });

    res.status(201).json({
      success: true,
      data: {
        attendanceId: result.attendanceId,
        membershipId: result.membershipId,
        remainingCredits: result.remainingCredits,
      },
    });
  } catch (error) {
    next(error);
  }
}
