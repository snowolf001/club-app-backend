-- Migration 001: Initial Baseline Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  email      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CLUBS
-- ============================================================
CREATE TABLE clubs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  join_code             TEXT UNIQUE,
  allow_member_backfill BOOLEAN NOT NULL DEFAULT true,
  member_backfill_hours INTEGER NOT NULL DEFAULT 24,
  host_backfill_hours   INTEGER NOT NULL DEFAULT 72,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CLUB LOCATIONS
-- ============================================================
CREATE TABLE club_locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id    UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  is_hidden  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_club_locations_club ON club_locations (club_id);

-- ============================================================
-- MEMBERSHIPS
-- ============================================================
CREATE TABLE memberships (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id           UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name      TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('member', 'host', 'owner')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  credits_remaining INTEGER NOT NULL DEFAULT 0 CHECK (credits_remaining >= 0),
  recovery_code     TEXT NOT NULL UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_memberships_club_user ON memberships (club_id, user_id);
CREATE UNIQUE INDEX uq_memberships_display_name ON memberships (club_id, lower(display_name));
CREATE INDEX idx_memberships_user ON memberships (user_id);
CREATE INDEX idx_memberships_club ON memberships (club_id);

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  location_id UUID REFERENCES club_locations(id) ON DELETE SET NULL,
  title       TEXT,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ,
  capacity    INTEGER,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'canceled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_club ON sessions (club_id);
CREATE INDEX idx_sessions_starts_at ON sessions (starts_at);

-- ============================================================
-- ATTENDANCES
-- ============================================================
CREATE TABLE attendances (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  club_id               UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id         UUID NOT NULL REFERENCES memberships(id) ON DELETE RESTRICT,
  checked_in_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  check_in_method       TEXT NOT NULL CHECK (check_in_method IN ('self', 'manual', 'backfill')),
  checked_in_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  credits_used          INTEGER NOT NULL DEFAULT 1 CHECK (credits_used > 0),
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_attendances_session_user ON attendances (session_id, user_id);
CREATE INDEX idx_attendances_user ON attendances (user_id);
CREATE INDEX idx_attendances_session ON attendances (session_id);
CREATE INDEX idx_attendances_membership ON attendances (membership_id);

-- ============================================================
-- CREDIT TRANSACTIONS
-- ============================================================
CREATE TABLE credit_transactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  membership_id    UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id       UUID REFERENCES sessions(id) ON DELETE SET NULL,
  attendance_id    UUID REFERENCES attendances(id) ON DELETE SET NULL,
  amount           INTEGER NOT NULL CHECK (amount <> 0),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('checkin', 'add', 'manual_adjustment', 'refund', 'backfill')),
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credit_transactions_membership ON credit_transactions (membership_id);
CREATE INDEX idx_credit_transactions_session ON credit_transactions (session_id);
CREATE INDEX idx_credit_transactions_user ON credit_transactions (user_id);
CREATE INDEX idx_credit_transactions_actor ON credit_transactions (actor_user_id);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE audit_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        UUID REFERENCES clubs(id) ON DELETE CASCADE,
  actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  session_id     UUID REFERENCES sessions(id) ON DELETE SET NULL,
  entity_type    TEXT NOT NULL,
  entity_id      UUID,
  action         TEXT NOT NULL,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_club_id_created_at ON audit_logs (club_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);
CREATE INDEX idx_audit_logs_session_id ON audit_logs (session_id);

-- ============================================================
-- ANALYTICS EVENTS
-- ============================================================
CREATE TABLE analytics_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id        UUID REFERENCES clubs(id) ON DELETE CASCADE,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  event_name     TEXT NOT NULL,
  properties     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analytics_events_club_id ON analytics_events (club_id);
