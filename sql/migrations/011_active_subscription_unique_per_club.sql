-- Migration 011: Enforce at most one active/entitled subscription per club
--
-- Business rule: a club subscription is club-level, not member-level.
-- At any given moment only one entitlement window should be active.
--
-- 'active'   = Pro billing current (auto-renews or manually active)
-- 'canceled' = user disabled auto-renew but the paid period has not ended yet
--
-- Both statuses represent an unexpired Pro entitlement, so both are covered.
--
-- This partial unique index acts as a database-level safety net that backs up
-- the code-level guard in createOrScheduleSubscriptionForClub. If two members
-- somehow race past the application guard, the INSERT will fail with a 23505
-- unique violation, which the service catches and converts to HTTP 409.
--
-- Why a partial index rather than a full unique constraint on club_id:
--   - A club legitimately accumulates multiple rows over time (expired ones).
--   - 'scheduled' rows (future entitlement windows) are allowed alongside
--     an active row; the index only covers the two entitled statuses.
--   - Status transitions (active→expired, scheduled→active) always happen
--     inside a serialised transaction, so the index is never transiently
--     violated during a legitimate lifecycle event.

CREATE UNIQUE INDEX IF NOT EXISTS idx_csub_one_active_per_club
  ON club_subscriptions (club_id)
  WHERE status IN ('active', 'canceled');
