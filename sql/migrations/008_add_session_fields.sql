ALTER TABLE sessions ADD COLUMN location_id UUID REFERENCES club_locations(id) ON DELETE SET NULL;
ALTER TABLE sessions ADD COLUMN capacity INTEGER;
ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'canceled'));