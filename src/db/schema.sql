-- Club App PostgreSQL Schema
-- Generated for production-quality MVP

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CLUBS
-- ============================================================
CREATE TABLE clubs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MEMBERSHIPS
-- ============================================================
CREATE TABLE memberships (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    club_id         UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('member', 'host', 'owner')),
    credits_balance INT  NOT NULL DEFAULT 0 CHECK (credits_balance >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, club_id)
);

CREATE INDEX idx_memberships_user_id ON memberships(user_id);
CREATE INDEX idx_memberships_club_id ON memberships(club_id);

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE TABLE sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id     UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ,
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_time IS NULL OR end_time > start_time)
);

CREATE INDEX idx_sessions_club_id    ON sessions(club_id);
CREATE INDEX idx_sessions_created_by ON sessions(created_by);
CREATE INDEX idx_sessions_start_time ON sessions(start_time);

-- ============================================================
-- ATTENDANCES
-- ============================================================
CREATE TABLE attendances (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    credits_used    INT  NOT NULL CHECK (credits_used > 0),
    checked_in_by   UUID NOT NULL REFERENCES users(id),
    check_in_type   TEXT NOT NULL CHECK (check_in_type IN ('self', 'manual', 'backfill')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, session_id)
);

CREATE INDEX idx_attendances_user_id    ON attendances(user_id);
CREATE INDEX idx_attendances_session_id ON attendances(session_id);

-- ============================================================
-- CREDIT TRANSACTIONS
-- ============================================================
CREATE TABLE credit_transactions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    membership_id        UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
    amount               INT  NOT NULL CHECK (amount <> 0),
    type                 TEXT NOT NULL CHECK (type IN ('add', 'deduct', 'checkin')),
    related_attendance_id UUID REFERENCES attendances(id) ON DELETE SET NULL,
    created_by           UUID NOT NULL REFERENCES users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credit_transactions_membership_id        ON credit_transactions(membership_id);
CREATE INDEX idx_credit_transactions_related_attendance_id ON credit_transactions(related_attendance_id);
CREATE INDEX idx_credit_transactions_created_by           ON credit_transactions(created_by);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE audit_logs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id        UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    action         TEXT NOT NULL,
    actor_id       UUID NOT NULL REFERENCES users(id),
    target_user_id UUID REFERENCES users(id),
    entity_type    TEXT,
    entity_id      UUID,
    metadata       JSONB NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_club_id        ON audit_logs(club_id);
CREATE INDEX idx_audit_logs_actor_id       ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_target_user_id ON audit_logs(target_user_id);
CREATE INDEX idx_audit_logs_entity_type_id ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created_at     ON audit_logs(created_at);
