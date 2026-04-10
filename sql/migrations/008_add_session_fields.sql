-- Add session columns (Idempotent)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES club_locations(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS capacity INTEGER;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'canceled'));