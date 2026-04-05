-- Migration: add recovery_code to memberships
-- Run once against the Railway database:
--   psql $DATABASE_URL -f src/db/migrations/002_add_recovery_code_to_memberships.sql

-- 1. Add column (nullable initially so the backfill can run)
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS recovery_code TEXT;

-- 2. Backfill existing rows with a unique code derived from their UUID
--    Format: XXXX-XXXX-XXXX (12 uppercase hex chars in 3 groups)
UPDATE memberships
SET recovery_code = concat(
  upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)), '-',
  upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)), '-',
  upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4))
)
WHERE recovery_code IS NULL;

-- 3. Enforce NOT NULL and uniqueness going forward
ALTER TABLE memberships
  ALTER COLUMN recovery_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_recovery_code
  ON memberships (recovery_code);
