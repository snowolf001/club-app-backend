-- Migration 006: Club-scoped unique display names
-- Adds display_name column to memberships and enforces uniqueness across
-- all members (active + removed) within a club using a case-insensitive index.
-- Also renames the 'inactive' removal status to 'removed' for clarity.

-- 1. Add display_name column (nullable initially so existing rows don't fail)
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- 2. Backfill display_name from users.name for existing rows
UPDATE memberships m
SET display_name = u.name
FROM users u
WHERE u.id = m.user_id
  AND m.display_name IS NULL;

-- 3. Enforce NOT NULL after backfill
ALTER TABLE memberships
  ALTER COLUMN display_name SET NOT NULL;

-- 4. Drop and recreate the status CHECK constraint to include 'removed'
--    (keeps 'inactive' for any legacy rows that may exist)
ALTER TABLE memberships
  DROP CONSTRAINT IF EXISTS memberships_status_check;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_status_check
  CHECK (status IN ('active', 'inactive', 'removed'));

-- 5. Migrate existing 'inactive' removal records to 'removed'
UPDATE memberships SET status = 'removed' WHERE status = 'inactive';

-- 6. Add the case-insensitive unique index across all rows (active + removed)
--    This prevents any name from being reused in the same club.
CREATE UNIQUE INDEX IF NOT EXISTS unique_display_name_per_club
  ON memberships (club_id, lower(display_name));
