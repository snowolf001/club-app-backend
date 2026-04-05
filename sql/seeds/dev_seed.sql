-- ============================================================
-- DEV SEED — Club App
-- Safe to re-run (uses ON CONFLICT DO UPDATE / DO NOTHING)
-- ============================================================

-- ============================================================
-- USERS
-- ============================================================
INSERT INTO users (id, name, email, updated_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Test Member',  'member@example.com',  NOW()),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alice Host',   'alice@example.com',   NOW()),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Bob Owner',    'bob@example.com',     NOW()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Carol Member', 'carol@example.com',   NOW())
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = NOW();

-- ============================================================
-- CLUBS
-- ============================================================
INSERT INTO clubs (id, name, join_code, updated_at)
VALUES
  ('22222222-2222-2222-2222-222222222222', 'Demo Club', 'DEMO01', NOW())
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name, join_code = EXCLUDED.join_code, updated_at = NOW();

-- ============================================================
-- MEMBERSHIPS
-- ============================================================
INSERT INTO memberships (id, club_id, user_id, role, status, credits_remaining, updated_at)
VALUES
  -- Test Member (member, 5 credits)
  ('33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   'member', 'active', 5, NOW()),
  -- Alice (host, 10 credits)
  ('44444444-4444-4444-4444-444444444444',
   '22222222-2222-2222-2222-222222222222',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'host', 'active', 10, NOW()),
  -- Bob (owner, 20 credits)
  ('55555555-5555-5555-5555-555555555555',
   '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'owner', 'active', 20, NOW()),
  -- Carol (member, 3 credits)
  ('66666666-6666-6666-6666-666666666666',
   '22222222-2222-2222-2222-222222222222',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'member', 'active', 3, NOW())
ON CONFLICT (id) DO UPDATE
SET role = EXCLUDED.role,
    status = EXCLUDED.status,
    credits_remaining = EXCLUDED.credits_remaining,
    updated_at = NOW();

-- ============================================================
-- SESSIONS
-- Timestamps are recalculated each run so check-in is always possible.
-- ============================================================
INSERT INTO sessions (id, club_id, title, starts_at, ends_at, updated_at)
VALUES
  -- Active session (in progress right now)
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '22222222-2222-2222-2222-222222222222',
   'Saturday Morning Session',
   NOW() - INTERVAL '30 minutes',
   NOW() + INTERVAL '90 minutes',
   NOW()),
  -- Future session
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',
   '22222222-2222-2222-2222-222222222222',
   'Wednesday Evening Session',
   NOW() + INTERVAL '2 days',
   NOW() + INTERVAL '2 days 2 hours',
   NOW()),
  -- Past session (ended last week)
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '22222222-2222-2222-2222-222222222222',
   'Last Week Session',
   NOW() - INTERVAL '7 days',
   NOW() - INTERVAL '7 days' + INTERVAL '2 hours',
   NOW()),
  -- Past: 3 days ago
  ('a1b2c3d4-a1b2-a1b2-a1b2-a1b2c3d4e5f6',
   '22222222-2222-2222-2222-222222222222',
   'Monday Morning Stretch',
   NOW() - INTERVAL '3 days' + INTERVAL '7 hours',
   NOW() - INTERVAL '3 days' + INTERVAL '9 hours',
   NOW()),
  -- Past: 4 days ago
  ('b2c3d4e5-b2c3-b2c3-b2c3-b2c3d4e5f6a1',
   '22222222-2222-2222-2222-222222222222',
   'Thursday Circuits',
   NOW() - INTERVAL '4 days' + INTERVAL '18 hours',
   NOW() - INTERVAL '4 days' + INTERVAL '20 hours',
   NOW()),
  -- Past: 11 days ago
  ('c3d4e5f6-c3d4-c3d4-c3d4-c3d4e5f6a1b2',
   '22222222-2222-2222-2222-222222222222',
   'Tuesday Yoga Flow',
   NOW() - INTERVAL '11 days' + INTERVAL '9 hours',
   NOW() - INTERVAL '11 days' + INTERVAL '10 hours 30 minutes',
   NOW()),
  -- Past: 18 days ago
  ('d4e5f6a1-d4e5-d4e5-d4e5-d4e5f6a1b2c3',
   '22222222-2222-2222-2222-222222222222',
   'Friday HIIT Blast',
   NOW() - INTERVAL '18 days' + INTERVAL '17 hours',
   NOW() - INTERVAL '18 days' + INTERVAL '18 hours 45 minutes',
   NOW()),
  -- Future: 3 days from now
  ('e5f6a1b2-e5f6-e5f6-e5f6-e5f6a1b2c3d4',
   '22222222-2222-2222-2222-222222222222',
   'Sunday Recovery Session',
   NOW() + INTERVAL '3 days' + INTERVAL '9 hours',
   NOW() + INTERVAL '3 days' + INTERVAL '10 hours 30 minutes',
   NOW()),
  -- Future: 5 days from now
  ('f6a1b2c3-f6a1-f6a1-f6a1-f6a1b2c3d4e5',
   '22222222-2222-2222-2222-222222222222',
   'Friday Evening Cardio',
   NOW() + INTERVAL '5 days' + INTERVAL '18 hours',
   NOW() + INTERVAL '5 days' + INTERVAL '20 hours',
   NOW()),
  -- Future: 7 days from now
  ('a0b1c2d3-a0b1-a0b1-a0b1-a0b1c2d3e4f5',
   '22222222-2222-2222-2222-222222222222',
   'Next Saturday Morning Session',
   NOW() + INTERVAL '7 days' + INTERVAL '8 hours',
   NOW() + INTERVAL '7 days' + INTERVAL '10 hours',
   NOW())
ON CONFLICT (id) DO UPDATE
SET title     = EXCLUDED.title,
    starts_at = EXCLUDED.starts_at,
    ends_at   = EXCLUDED.ends_at,
    updated_at = NOW();

-- ============================================================
-- ATTENDANCES
-- Carol and Alice checked in to the past session.
-- ============================================================
INSERT INTO attendances (
  id, session_id, club_id, user_id, membership_id,
  check_in_method, checked_in_at, credits_used, notes, updated_at
)
VALUES
  -- Carol checked herself in
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '22222222-2222-2222-2222-222222222222',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   '66666666-6666-6666-6666-666666666666',
   'self',
   NOW() - INTERVAL '7 days' + INTERVAL '5 minutes',
   1, NULL, NOW()),
  -- Alice was manually checked in by Bob
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   '22222222-2222-2222-2222-222222222222',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '44444444-4444-4444-4444-444444444444',
   'manual',
   NOW() - INTERVAL '7 days' + INTERVAL '8 minutes',
   1, 'Checked in by owner', NOW())
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- CREDIT TRANSACTIONS
-- Deductions matching the attendance rows above.
-- ============================================================
INSERT INTO credit_transactions (
  id, club_id, membership_id, user_id,
  session_id, attendance_id, amount, transaction_type, note, created_at
)
VALUES
  -- Carol's deduction for past session
  ('c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3',
   '22222222-2222-2222-2222-222222222222',
   '66666666-6666-6666-6666-666666666666',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
   -1, 'checkin', 'Credit deducted for session check-in',
   NOW() - INTERVAL '7 days' + INTERVAL '5 minutes'),
  -- Alice's deduction for past session
  ('d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4',
   '22222222-2222-2222-2222-222222222222',
   '44444444-4444-4444-4444-444444444444',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
   -1, 'checkin', 'Credit deducted for session check-in',
   NOW() - INTERVAL '7 days' + INTERVAL '8 minutes'),
  -- Bob added credits to Carol (admin action)
  ('e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5',
   '22222222-2222-2222-2222-222222222222',
   '66666666-6666-6666-6666-666666666666',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   NULL, NULL,
   5, 'add', 'Welcome credits',
   NOW() - INTERVAL '10 days')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- AUDIT LOGS
-- ============================================================
INSERT INTO audit_logs (
  id, club_id, actor_user_id, target_user_id,
  entity_type, entity_id, action, metadata, created_at
)
VALUES
  -- Carol self check-in
  ('f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6',
   '22222222-2222-2222-2222-222222222222',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'attendance', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
   'session_checkin',
   '{"sessionId":"dddddddd-dddd-dddd-dddd-dddddddddddd","creditsUsed":1,"method":"self"}',
   NOW() - INTERVAL '7 days' + INTERVAL '5 minutes'),
  -- Alice manual check-in by Bob
  ('a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7',
   '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'attendance', 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2',
   'session_checkin',
   '{"sessionId":"dddddddd-dddd-dddd-dddd-dddddddddddd","creditsUsed":1,"method":"manual"}',
   NOW() - INTERVAL '7 days' + INTERVAL '8 minutes'),
  -- Bob added credits to Carol
  ('b8b8b8b8-b8b8-b8b8-b8b8-b8b8b8b8b8b8',
   '22222222-2222-2222-2222-222222222222',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'membership', '66666666-6666-6666-6666-666666666666',
   'add_credits',
   '{"amount":5,"reason":"Welcome credits","previousCredits":0,"newCredits":5}',
   NOW() - INTERVAL '10 days')
ON CONFLICT (id) DO NOTHING;
