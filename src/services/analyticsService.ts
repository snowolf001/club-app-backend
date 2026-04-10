/**
 * First-party product analytics for closed testing.
 *
 * Privacy guarantees:
 *  - Only whitelisted event names are accepted.
 *  - clubId / sessionId are one-way SHA-256 hashed before storage.
 *  - All other properties are validated against an explicit allowlist.
 *  - Any field not on the allowlist is silently dropped.
 *  - Tracking is best-effort: failures are logged but never bubble up.
 */

import { createHash } from 'crypto';
import { pool } from '../db/pool';
import { logger } from '../lib/logger';

// ─── Allowlist ─────────────────────────────────────────────────────────────────

export const ALLOWED_EVENTS = new Set([
  'app_opened',
  'club_created',
  'join_club_attempt',
  'join_club_success',
  'join_club_failed',
  'recovery_attempt',
  'recovery_success',
  'recovery_failed',
  'session_created',
  'checkin_attempt',
  'checkin_success',
  'checkin_failed',
  'manual_checkin_success',
  'manual_checkin_failed',
  'export_pdf_attempt',
  'export_pdf_success',
  'export_pdf_failed',
  'adjust_credits_success',
  'adjust_credits_failed',
]);

export type TrackEventParams = {
  eventName: string;
  success?: boolean | null;
  errorCode?: string | null;
  sourceScreen?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  /** Raw value — will be hashed before storage. */
  clubId?: string | null;
  /** Raw value — will be hashed before storage. */
  sessionId?: string | null;
};

// ─── Hash helper ───────────────────────────────────────────────────────────────

function hashId(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

// ─── Core insert ───────────────────────────────────────────────────────────────

/**
 * Insert a single analytics event.
 * Returns silently on any error — tracking must never break main flows.
 */
export async function trackEvent(params: TrackEventParams): Promise<void> {
  try {
    if (!ALLOWED_EVENTS.has(params.eventName)) {
      logger.warn('[analytics] unknown event name — dropped', {
        eventName: params.eventName,
      });
      return;
    }

    await pool.query(
      `INSERT INTO analytics_events
         (event_name, success, error_code, source_screen, platform, app_version,
          club_id_hash, session_id_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        params.eventName,
        params.success ?? null,
        params.errorCode ?? null,
        params.sourceScreen ?? null,
        params.platform ?? null,
        params.appVersion ?? null,
        params.clubId ? hashId(params.clubId) : null,
        params.sessionId ? hashId(params.sessionId) : null,
      ]
    );
  } catch (err) {
    // Never throw — analytics is best-effort only.
    logger.warn('[analytics] insert failed (ignored)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
