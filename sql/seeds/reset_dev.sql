-- 清数据（顺序很重要）
DELETE FROM audit_logs;
DELETE FROM credit_transactions;
DELETE FROM attendances;

-- 重置 credits
UPDATE memberships
SET credits_remaining = 5,
    status = 'active',
    updated_at = NOW()
WHERE id = '33333333-3333-3333-3333-333333333333';

-- 重置 session 时间（保证 always 可 check-in）
UPDATE sessions
SET starts_at = NOW() - INTERVAL '30 minutes',
    ends_at = NOW() + INTERVAL '90 minutes',
    updated_at = NOW()
WHERE id = '44444444-4444-4444-4444-444444444444';
