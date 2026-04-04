CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_club_user
ON memberships (club_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendances_session_user
ON attendances (session_id, user_id);

CREATE INDEX IF NOT EXISTS idx_memberships_user
ON memberships (user_id);

CREATE INDEX IF NOT EXISTS idx_memberships_club
ON memberships (club_id);

CREATE INDEX IF NOT EXISTS idx_sessions_club
ON sessions (club_id);

CREATE INDEX IF NOT EXISTS idx_sessions_starts_at
ON sessions (starts_at);

CREATE INDEX IF NOT EXISTS idx_attendances_user
ON attendances (user_id);

CREATE INDEX IF NOT EXISTS idx_attendances_session
ON attendances (session_id);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_membership
ON credit_transactions (membership_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_club
ON audit_logs (club_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
ON audit_logs (created_at);
