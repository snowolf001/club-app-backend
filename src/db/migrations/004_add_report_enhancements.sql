-- Migration 004: Add report enhancements
-- 1. Add checked_in_by_user_id to attendances (who performed the check-in)
-- 2. Add session_id column to audit_logs
-- 3. Add missing performance indexes to audit_logs

-- ── attendances: track who performed the check-in ─────────────────────────────
ALTER TABLE attendances
  ADD COLUMN IF NOT EXISTS checked_in_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Backfill existing self check-ins: the member checked themselves in
UPDATE attendances
  SET checked_in_by_user_id = user_id
  WHERE check_in_method = 'self'
    AND checked_in_by_user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendances_checked_in_by
  ON attendances (checked_in_by_user_id);

-- ── audit_logs: add session_id for direct session linkage ─────────────────────
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(id) ON DELETE SET NULL;

-- ── audit_logs: missing indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_audit_logs_club_id_created_at
  ON audit_logs (club_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON audit_logs (action);

CREATE INDEX IF NOT EXISTS idx_audit_logs_session_id
  ON audit_logs (session_id);
