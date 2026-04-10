-- Migration 007: create analytics_events table for closed-testing product analytics.
-- No raw identifiers are stored here. club_id and session_id are one-way SHA-256 hashed.

CREATE TABLE IF NOT EXISTS analytics_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  event_name      TEXT        NOT NULL,
  success         BOOLEAN     NULL,
  error_code      TEXT        NULL,
  source_screen   TEXT        NULL,
  platform        TEXT        NULL,
  app_version     TEXT        NULL,
  club_id_hash    TEXT        NULL,
  session_id_hash TEXT        NULL,
  metadata_json   JSONB       NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_created_at   ON analytics_events (created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_event_name   ON analytics_events (event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_success      ON analytics_events (success);
CREATE INDEX IF NOT EXISTS idx_analytics_error_code   ON analytics_events (error_code);
