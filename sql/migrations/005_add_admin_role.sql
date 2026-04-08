-- Migration 005: Add 'admin' to memberships role constraint
-- Required to support the admin role in the club role hierarchy (owner > admin > host > member)

-- Drop and recreate constraint to include 'admin'
ALTER TABLE memberships
  DROP CONSTRAINT IF EXISTS memberships_role_check;

ALTER TABLE memberships
  ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('member', 'host', 'admin', 'owner'));

-- Also add recovery_code column if not present (added in production from earlier work)
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS recovery_code TEXT;

-- Add member_code column if not present
ALTER TABLE memberships
  ADD COLUMN IF NOT EXISTS member_code TEXT;

-- Add actor_user_id to credit_transactions if not already present
ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
