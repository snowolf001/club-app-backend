-- Migration: 006_updated_at_triggers
-- Description: Automatically maintain updated_at timestamps on mutable tables.

-- ─── Generic trigger function ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── club_subscriptions.updated_at ───────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_club_subscriptions_set_updated_at
  ON club_subscriptions;

CREATE TRIGGER trg_club_subscriptions_set_updated_at
BEFORE UPDATE ON club_subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
