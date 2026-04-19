import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { isValidUUID } from '../utils/validators';
import { getActorMemberId } from '../lib/auth';
import {
  getSessionIntentSummary,
  upsertSessionIntent,
  removeSessionIntent,
} from '../services/intentService';

// ─── GET /api/sessions/:sessionId/intents ─────────────────────────────────────

export async function getSessionIntentsHandler(
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

    const membershipId = getActorMemberId(req);
    const summary = await getSessionIntentSummary(sessionId, membershipId);
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
}

// ─── PUT /api/sessions/:sessionId/intent ──────────────────────────────────────
// Body: { going: boolean }

export async function putSessionIntentHandler(
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

    const { going } = req.body as Record<string, unknown>;
    if (typeof going !== 'boolean') {
      throw new AppError(400, 'INVALID_BODY', '"going" must be a boolean.');
    }

    const membershipId = getActorMemberId(req);

    if (going) {
      await upsertSessionIntent(sessionId, membershipId);
    } else {
      await removeSessionIntent(sessionId, membershipId);
    }

    res.json({ success: true, data: { going } });
  } catch (error) {
    next(error);
  }
}
