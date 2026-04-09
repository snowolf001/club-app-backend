-- Migration 005: Add capacity to sessions
-- capacity = max number of attendees allowed. NULL means unlimited.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS capacity INTEGER;
