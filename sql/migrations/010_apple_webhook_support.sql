-- Migration: 010_apple_webhook_support
-- Extends the subscription schema to fully support Apple iOS subscriptions.
--
-- Changes:
--   1. club_subscriptions: add auto_renews column for accurate billing state
--   2. subscription_webhook_events: extend provider CHECK to include 'apple'
--   3. subscription_webhook_events: add columns for Apple notification fields
--   4. Indexes for efficient Apple webhook lookups

-- ─── 1. club_subscriptions: add auto_renews ──────────────────────────────────
-- Tracks whether the subscription is set to auto-renew.
-- NULL = unknown (existing rows / Android, where we don't yet track this)
-- TRUE = auto-renewing (default for new active subscriptions)
-- FALSE = user turned off auto-renew (subscription remains active until ends_at)

ALTER TABLE club_subscriptions
  ADD COLUMN IF NOT EXISTS auto_renews BOOLEAN;

-- ─── 2. subscription_webhook_events: extend provider to include 'apple' ─────
-- The original constraint only allowed 'google'. Drop and recreate.

ALTER TABLE subscription_webhook_events
  DROP CONSTRAINT IF EXISTS subscription_webhook_events_provider_check;

ALTER TABLE subscription_webhook_events
  ADD CONSTRAINT subscription_webhook_events_provider_check
  CHECK (provider IN ('google', 'apple'));

-- ─── 3. subscription_webhook_events: Apple notification metadata columns ─────
-- These mirror the integer notification_type / purchase_token columns used by
-- Google, but use Apple's string-based types.

-- Apple's notificationType string (e.g. 'DID_RENEW', 'EXPIRED')
ALTER TABLE subscription_webhook_events
  ADD COLUMN IF NOT EXISTS notification_type_text TEXT;

-- Apple's subtype string (e.g. 'AUTO_RENEW_DISABLED', 'VOLUNTARY')
ALTER TABLE subscription_webhook_events
  ADD COLUMN IF NOT EXISTS notification_subtype TEXT;

-- Apple's originalTransactionId — stable across all renewals of one subscription.
-- Used for efficient lookup when processing lifecycle notifications.
ALTER TABLE subscription_webhook_events
  ADD COLUMN IF NOT EXISTS original_transaction_id TEXT;

-- ─── 4. Indexes ───────────────────────────────────────────────────────────────

-- Efficient lookup of Apple webhook events by original_transaction_id
CREATE INDEX IF NOT EXISTS idx_swe_original_transaction_id
  ON subscription_webhook_events(original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;
