-- Migration 011: Account Deletion Support
-- Adds soft-delete capability so users can delete their accounts while
-- preserving anonymised historical attendance/report data.
-- Safe and idempotent via IF EXISTS / IF NOT EXISTS guards.
--
-- Deletion strategy:
--   memberships: display_name = 'Deleted Member', recovery_code = NULL,
--                status = 'removed', deleted_at = NOW()
--   users:       name = 'Deleted Member', email = NULL, deleted_at = NOW()
--
-- Historical rows (attendances, credit_transactions, audit_logs) are kept
-- intact. Report queries detect deleted_at and display 'Deleted Member'.

-- ─── 1. Soft-delete timestamp columns ────────────────────────────────────────

ALTER TABLE users       ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- ─── 2. Relax NOT NULL on anonymised columns ─────────────────────────────────

-- display_name: made nullable as a defensive measure. The deletion service sets
-- it to 'Deleted Member', not NULL, but keeping nullable allows future flexibility.
ALTER TABLE memberships ALTER COLUMN display_name DROP NOT NULL;

-- recovery_code: set to NULL when a membership is deleted so the recovery code
-- can no longer be used to restore or authenticate the deleted account.
ALTER TABLE memberships ALTER COLUMN recovery_code DROP NOT NULL;

-- ─── 3. Replace unique indexes with partial indexes (active rows only) ────────

-- recovery_code: drop the original inline UNIQUE constraint (auto-named by PG),
-- then create a partial unique index that ignores deleted/null rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'memberships_recovery_code_key'
      AND conrelid = 'memberships'::regclass
  ) THEN
    ALTER TABLE memberships DROP CONSTRAINT memberships_recovery_code_key;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_recovery_code_active
  ON memberships (recovery_code)
  WHERE deleted_at IS NULL AND recovery_code IS NOT NULL;

-- display_name: replace the global partial unique index with one scoped to
-- non-deleted memberships so multiple deleted rows can share 'Deleted Member'.
DROP INDEX IF EXISTS uq_memberships_display_name;

CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_display_name_active
  ON memberships (club_id, lower(display_name))
  WHERE deleted_at IS NULL AND display_name IS NOT NULL;

-- ─── 4. Performance indexes ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_memberships_deleted_at
  ON memberships (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON users (deleted_at)
  WHERE deleted_at IS NOT NULL;
