-- Migration: 005_system_events
-- Description: Durable structured event log for IAP, subscription lifecycle,
--              and webhook observability. Never used for business decisions.

CREATE TABLE IF NOT EXISTS system_events (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What happened
  category                  TEXT         NOT NULL,
  event_type                TEXT         NOT NULL,
  event_status              TEXT         NOT NULL CHECK (event_status IN ('success', 'failure', 'info')),

  -- Who / which club
  club_id                   UUID         REFERENCES clubs(id) ON DELETE SET NULL,
  membership_id             UUID         REFERENCES memberships(id) ON DELETE SET NULL,

  -- IAP context
  platform                  TEXT         CHECK (platform IN ('ios', 'android')),
  plan                      TEXT         CHECK (plan IN ('monthly', 'yearly')),
  product_id                TEXT,
  purchase_token            TEXT,
  transaction_id            TEXT,
  original_transaction_id   TEXT,
  order_id                  TEXT,

  -- Related DB row
  related_subscription_id   UUID         REFERENCES club_subscriptions(id) ON DELETE SET NULL,

  -- Human-readable summary + structured extras
  message                   TEXT,
  details                   JSONB,

  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_se_created_at
  ON system_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_se_category
  ON system_events (category);

CREATE INDEX IF NOT EXISTS idx_se_event_type
  ON system_events (event_type);

CREATE INDEX IF NOT EXISTS idx_se_event_status
  ON system_events (event_status);

CREATE INDEX IF NOT EXISTS idx_se_club_id
  ON system_events (club_id)
  WHERE club_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_se_membership_id
  ON system_events (membership_id)
  WHERE membership_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_se_product_id
  ON system_events (product_id)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_se_purchase_token
  ON system_events (purchase_token)
  WHERE purchase_token IS NOT NULL;
