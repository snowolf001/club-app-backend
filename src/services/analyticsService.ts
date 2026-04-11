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

    const properties = {
      success: params.success ?? null,
      error_code: params.errorCode ?? null,
      source_screen: params.sourceScreen ?? null,
      platform: params.platform ?? null,
      app_version: params.appVersion ?? null,
      club_id_hash: params.clubId ? hashId(params.clubId) : null,
      session_id_hash: params.sessionId ? hashId(params.sessionId) : null,
    };

    await pool.query(
      `INSERT INTO analytics_events
         (event_name, properties)
       VALUES ($1, $2)`,
      [params.eventName, properties]
    );
  } catch (err) {
    // Never throw — analytics is best-effort only.
    logger.warn('[analytics] insert failed (ignored)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export async function getDashboardStats() {
  try {
    const dauRes = await pool.query(
      `SELECT count(DISTINCT actor_user_id) as count FROM audit_logs WHERE created_at > now() - interval '1 day'`
    );
    const wauRes = await pool.query(
      `SELECT count(DISTINCT actor_user_id) as count FROM audit_logs WHERE created_at > now() - interval '7 days'`
    );
    const mauRes = await pool.query(
      `SELECT count(DISTINCT actor_user_id) as count FROM audit_logs WHERE created_at > now() - interval '30 days'`
    );

    const eventsRes = await pool.query(
      `SELECT event_name, count(*) as count FROM analytics_events GROUP BY event_name ORDER BY count DESC LIMIT 10`
    );

    const screensRes = await pool.query(
      `SELECT properties->>'source_screen' as screen_name, count(*) as count
       FROM analytics_events
       WHERE properties->>'source_screen' IS NOT NULL
       GROUP BY properties->>'source_screen'
       ORDER BY count DESC LIMIT 10`
    );

    return {
      dau: parseInt(dauRes.rows[0]?.count || '0', 10),
      wau: parseInt(wauRes.rows[0]?.count || '0', 10),
      mau: parseInt(mauRes.rows[0]?.count || '0', 10),
      topEvents: eventsRes.rows.map((r) => ({
        event_name: r.event_name,
        count: parseInt(r.count, 10),
      })),
      topScreens: screensRes.rows.map((r) => ({
        screen_name: r.screen_name,
        count: parseInt(r.count, 10),
      })),
    };
  } catch (err) {
    logger.error('Failed to get dashboard stats', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
