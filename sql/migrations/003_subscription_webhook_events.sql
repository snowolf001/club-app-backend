-- Migration: 004_subscription_webhook_events
-- Stores incoming Google Play RTDN webhook events for audit/debugging.

CREATE TABLE IF NOT EXISTS subscription_webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  provider          TEXT NOT NULL CHECK (provider IN ('google')),

  -- Pub/Sub message identity
  message_id        TEXT,

  -- Basic provider routing fields
  package_name      TEXT,
  product_id        TEXT,
  purchase_token    TEXT,

  -- Google RTDN metadata
  notification_type INTEGER,
  event_time        TIMESTAMPTZ,

  -- Full decoded provider payload
  payload           JSONB NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent duplicate inserts for the same Pub/Sub message
CREATE UNIQUE INDEX IF NOT EXISTS idx_swe_message_id
  ON subscription_webhook_events(message_id)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_swe_purchase_token
  ON subscription_webhook_events(purchase_token);

CREATE INDEX IF NOT EXISTS idx_swe_product_id
  ON subscription_webhook_events(product_id);

CREATE INDEX IF NOT EXISTS idx_swe_event_time
  ON subscription_webhook_events(event_time);
