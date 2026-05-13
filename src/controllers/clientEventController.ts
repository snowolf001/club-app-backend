// src/controllers/clientEventController.ts
//
// Accepts structured client-side diagnostic events and persists them to
// system_events.  This is NOT a general-purpose analytics endpoint — only
// a fixed set of categories is accepted; everything else is silently dropped
// so arbitrary callers cannot pollute the table.
//
// The handler MUST always return a 200-range response.  Logging failures must
// never surface back to the mobile app.

import { Request, Response } from 'express';
import { logger } from '../lib/logger';
import { recordSystemEvent } from '../lib/systemEvents';

// Only these categories are written to system_events.  Unknown categories are
// accepted with a 200 but not stored.
const ALLOWED_CATEGORIES = new Set([
  'app',
  'iap_client',
  'ui_state',
  'api_client',
  'critical_flow',
]);

const ALLOWED_EVENT_STATUSES = new Set<string>(['info', 'success', 'failure']);

/**
 * POST /api/client-events
 *
 * Body:
 *   {
 *     category:     string   — required, must be in ALLOWED_CATEGORIES
 *     eventType:    string   — required
 *     eventStatus?: string   — 'info' | 'success' | 'failure'  (default: 'info')
 *     details?:     object   — arbitrary structured data
 *   }
 *
 * Server enriches with:
 *   - membershipId from x-member-id header (via apiKeyAuth → req.actor)
 *   - platform extracted from details.platform
 *   - _receivedAt timestamp
 */
export async function postClientEvent(
  req: Request,
  res: Response
): Promise<void> {
  // Always respond 200 — logging must never break the calling app.
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    const category =
      typeof body.category === 'string' ? body.category.slice(0, 64) : null;
    const eventType =
      typeof body.eventType === 'string' ? body.eventType.slice(0, 64) : null;

    if (!category || !eventType) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_EVENT',
          message: 'category and eventType are required',
          details: null,
        },
      });
      return;
    }

    // Unknown categories are silently dropped — return 200 so clients don't retry.
    if (!ALLOWED_CATEGORIES.has(category)) {
      res.json({ success: true });
      return;
    }

    const rawStatus =
      typeof body.eventStatus === 'string' ? body.eventStatus : 'info';
    const eventStatus = ALLOWED_EVENT_STATUSES.has(rawStatus)
      ? (rawStatus as 'info' | 'success' | 'failure')
      : 'info';

    // details must be a plain object; arrays / primitives are discarded.
    const rawDetails =
      body.details !== null &&
      typeof body.details === 'object' &&
      !Array.isArray(body.details)
        ? (body.details as Record<string, unknown>)
        : {};

    // Enrich: add server-side timestamp so the row reflects when it was received.
    const enrichedDetails: Record<string, unknown> = {
      ...rawDetails,
      _receivedAt: new Date().toISOString(),
    };

    // Extract optional well-known fields the client may send inside details.
    const membershipId = req.actor?.memberId ?? null;
    const rawPlatform =
      typeof rawDetails.platform === 'string' ? rawDetails.platform : null;
    const platform =
      rawPlatform === 'ios' || rawPlatform === 'android' ? rawPlatform : null;

    const message = `client/${category}/${eventType}`;

    // Fire-and-forget — do NOT await; response must not wait for the DB write.
    void recordSystemEvent({
      category,
      event_type: eventType,
      event_status: eventStatus,
      membership_id: membershipId,
      platform,
      message,
      details: enrichedDetails,
    });

    res.json({ success: true });
  } catch (error) {
    // Last-resort safety net — must still return 200.
    logger.error('[client-events] unexpected handler error', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.json({ success: true });
  }
}
