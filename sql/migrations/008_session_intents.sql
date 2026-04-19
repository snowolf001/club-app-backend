-- 008_session_intents.sql
-- Adds enable_session_intents flag to clubs and a session_intents table
-- for planned-attendance ("I'm Going") functionality.

BEGIN;

-- Add the feature flag to clubs (stored alongside the other settings columns)
ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS enable_session_intents BOOLEAN NOT NULL DEFAULT false;

-- Planned-attendance records: one row per member per session
CREATE TABLE IF NOT EXISTS session_intents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID        NOT NULL REFERENCES sessions(id)     ON DELETE CASCADE,
  membership_id  UUID        NOT NULL REFERENCES memberships(id)  ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_session_intent UNIQUE (session_id, membership_id)
);

CREATE INDEX IF NOT EXISTS idx_session_intents_session ON session_intents (session_id);

COMMIT;
