BEGIN;

ALTER TABLE subscription_webhook_events
ADD COLUMN IF NOT EXISTS message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_webhook_events_message_id
ON subscription_webhook_events (message_id);

COMMIT;
