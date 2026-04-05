-- Migration 003: Make session title optional, add location_id to sessions

-- Allow title to be NULL (it was NOT NULL before)
ALTER TABLE sessions ALTER COLUMN title DROP NOT NULL;

-- Add location_id referencing club_locations
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES club_locations(id) ON DELETE RESTRICT;
