-- users
INSERT INTO users (id, name, email, updated_at)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Test Member',
  'member@example.com',
  NOW()
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  updated_at = NOW();

-- clubs
INSERT INTO clubs (id, name, updated_at)
VALUES (
  '22222222-2222-2222-2222-222222222222',
  'Demo Club',
  NOW()
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  updated_at = NOW();

-- memberships
INSERT INTO memberships (
  id,
  club_id,
  user_id,
  role,
  status,
  credits_remaining,
  updated_at
)
VALUES (
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'member',
  'active',
  5,
  NOW()
)
ON CONFLICT (id) DO UPDATE
SET
  role = EXCLUDED.role,
  status = EXCLUDED.status,
  credits_remaining = EXCLUDED.credits_remaining,
  updated_at = NOW();

-- sessions（关键：时间每次刷新）
INSERT INTO sessions (
  id,
  club_id,
  title,
  starts_at,
  ends_at,
  updated_at
)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  '22222222-2222-2222-2222-222222222222',
  'Saturday Morning Session',
  NOW() - INTERVAL '30 minutes',
  NOW() + INTERVAL '90 minutes',
  NOW()
)
ON CONFLICT (id) DO UPDATE
SET
  title = EXCLUDED.title,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  updated_at = NOW();
