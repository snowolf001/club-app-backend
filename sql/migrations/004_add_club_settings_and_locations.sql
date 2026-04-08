-- Migration 004: Add join_code + backfill settings to clubs; add club_locations table

-- ── clubs: join code + backfill settings ─────────────────────────────────────
ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS join_code              TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS allow_member_backfill  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS member_backfill_hours  INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS host_backfill_hours    INTEGER NOT NULL DEFAULT 72;

-- ── club_locations ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS club_locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_club_locations_club ON club_locations (club_id);
