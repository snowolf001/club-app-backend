-- Migration 009: Session Assigned Host
-- Adds a nullable host_membership_id column to sessions so a specific
-- member (owner or host role) can be designated as the session host.
--
-- NOTE: The FK below only guarantees host_membership_id points to a valid
-- membership row.  It does NOT enforce that the membership belongs to the same
-- club as the session.  Same-club validation MUST be performed in the
-- application layer (sessionService.createSession / updateSession).

BEGIN;

-- 1. Add column (idempotent)
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS host_membership_id UUID NULL;

-- 2. Foreign key — wrapped in a DO block so it is safe to re-run
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'sessions_host_membership_id_fkey'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_host_membership_id_fkey
      FOREIGN KEY (host_membership_id)
      REFERENCES memberships(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Index for FK lookups
CREATE INDEX IF NOT EXISTS idx_sessions_host_membership_id
  ON sessions (host_membership_id);

-- 4. No backfill — sessions does not store created_by, so there is no reliable
--    way to derive the original host from existing rows.
--    Existing sessions will have host_membership_id = NULL, which the API
--    returns as host: null.

COMMIT;
