-- ============================================================
-- RESET DEV — Club App
-- Clears transactional data and resets memberships/sessions
-- to a clean, checkable state. Run before re-seeding.
-- ============================================================

-- Clear transactional tables (FK-safe order)
DELETE FROM audit_logs;
DELETE FROM credit_transactions;
DELETE FROM attendances;

-- Reset all membership credits and status
UPDATE memberships SET
  credits_remaining = 5,
  status            = 'active',
  updated_at        = NOW()
WHERE id = '33333333-3333-3333-3333-333333333333';  -- Test Member

UPDATE memberships SET
  credits_remaining = 10,
  status            = 'active',
  updated_at        = NOW()
WHERE id = '44444444-4444-4444-4444-444444444444';  -- Alice Host

UPDATE memberships SET
  credits_remaining = 20,
  status            = 'active',
  updated_at        = NOW()
WHERE id = '55555555-5555-5555-5555-555555555555';  -- Bob Owner

UPDATE memberships SET
  credits_remaining = 3,
  status            = 'active',
  updated_at        = NOW()
WHERE id = '66666666-6666-6666-6666-666666666666';  -- Carol Member

-- Reset session times so check-in is always possible
UPDATE sessions SET
  starts_at  = NOW() - INTERVAL '30 minutes',
  ends_at    = NOW() + INTERVAL '90 minutes',
  updated_at = NOW()
WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';  -- Active session

UPDATE sessions SET
  starts_at  = NOW() + INTERVAL '2 days',
  ends_at    = NOW() + INTERVAL '2 days 2 hours',
  updated_at = NOW()
WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';  -- Future session

UPDATE sessions SET
  starts_at  = NOW() - INTERVAL '7 days',
  ends_at    = NOW() - INTERVAL '7 days' + INTERVAL '2 hours',
  updated_at = NOW()
WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';  -- Past session
