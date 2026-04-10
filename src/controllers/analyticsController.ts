import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/AppError';
import { ALLOWED_EVENTS, trackEvent } from '../services/analyticsService';

/**
 * POST /api/track
 *
 * Accepts a safe analytics event from the frontend.
 * Requires x-api-key (handled by the apiKeyAuth middleware in app.ts).
 * x-member-id is NOT required — events may arrive before a membership exists
 * (e.g. app_opened, join_club_attempt).
 *
 * All payload fields are validated against an explicit allowlist before insert.
 */
export async function postTrackEvent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const eventName = body['eventName'];
    if (typeof eventName !== 'string' || !eventName) {
      throw new AppError(400, 'INVALID_EVENT', 'eventName is required.');
    }
    if (!ALLOWED_EVENTS.has(eventName)) {
      // Return 200 anyway so the client doesn't retry; event is just dropped.
      res.json({ success: true });
      return;
    }

    // Validate and sanitise each allowed field individually.
    const success =
      typeof body['success'] === 'boolean' ? body['success'] : null;
    const errorCode =
      typeof body['errorCode'] === 'string' ? body['errorCode'] : null;
    const sourceScreen =
      typeof body['sourceScreen'] === 'string' ? body['sourceScreen'] : null;
    const platform =
      typeof body['platform'] === 'string' ? body['platform'] : null;
    const appVersion =
      typeof body['appVersion'] === 'string' ? body['appVersion'] : null;
    const clubId =
      typeof body['clubId'] === 'string' ? body['clubId'] : null;
    const sessionId =
      typeof body['sessionId'] === 'string' ? body['sessionId'] : null;

    // trackEvent is fire-and-forget; it never throws.
    await trackEvent({
      eventName,
      success,
      errorCode,
      sourceScreen,
      platform,
      appVersion,
      clubId,
      sessionId,
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
