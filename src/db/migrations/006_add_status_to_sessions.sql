-- Migration 006: Add status column to sessions
-- Allows sessions to be explicitly closed (blocking further check-ins)

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed'));
