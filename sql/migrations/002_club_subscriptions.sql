-- Migration: 002_club_subscriptions
-- Club-level subscription infrastructure for Pro entitlement.

-- ─── club_subscriptions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS club_subscriptions (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id                    UUID        NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  platform                   TEXT        NOT NULL CHECK (platform IN ('ios', 'android')),
  plan                       TEXT        NOT NULL CHECK (plan IN ('monthly', 'yearly')),
  status                     TEXT        NOT NULL CHECK (status IN ('active', 'scheduled', 'expired', 'canceled')),
  product_id                 TEXT        NOT NULL,

  -- Actor who triggered this purchase (any club member)
  purchased_by_membership_id UUID        NOT NULL REFERENCES memberships(id) ON DELETE RESTRICT,

  -- Entitlement window (business time, NOT provider transaction time)
  starts_at                  TIMESTAMPTZ NOT NULL,
  ends_at                    TIMESTAMPTZ NOT NULL,

  -- iOS provider fields
  transaction_id             TEXT,         -- unique per payment; used for idempotency
  original_transaction_id    TEXT,         -- shared across all renewals of one subscription
  receipt_data               TEXT,         -- raw receipt blob sent by client

  -- Android provider fields
  purchase_token             TEXT,         -- unique per purchase; used for idempotency
  order_id                   TEXT,

  -- Parsed provider response (stored as JSONB for querying/debugging)
  verification_payload       JSONB,

  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT club_subscriptions_valid_window CHECK (ends_at > starts_at)
);

-- Query indexes
CREATE INDEX IF NOT EXISTS idx_csub_club_id
  ON club_subscriptions(club_id);

CREATE INDEX IF NOT EXISTS idx_csub_status
  ON club_subscriptions(status);

CREATE INDEX IF NOT EXISTS idx_csub_ends_at
  ON club_subscriptions(ends_at);

CREATE INDEX IF NOT EXISTS idx_csub_club_status_starts_ends
  ON club_subscriptions(club_id, status, starts_at, ends_at);

-- Lookup index for iOS restore flow
CREATE INDEX IF NOT EXISTS idx_csub_orig_tx
  ON club_subscriptions(original_transaction_id)
  WHERE original_transaction_id IS NOT NULL;

-- Idempotency: iOS — each payment has a unique transaction_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_csub_transaction_id
  ON club_subscriptions(transaction_id)
  WHERE transaction_id IS NOT NULL;

-- Idempotency: Android — each purchase has a unique purchase_token
CREATE UNIQUE INDEX IF NOT EXISTS idx_csub_purchase_token
  ON club_subscriptions(purchase_token)
  WHERE purchase_token IS NOT NULL;

-- ─── clubs Pro cache columns ───────────────────────────────────────────────
-- Denormalized cache — source of truth is always club_subscriptions.
ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS pro_status     TEXT        DEFAULT 'free' CHECK (pro_status IN ('free', 'pro')),
  ADD COLUMN IF NOT EXISTS pro_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pro_updated_at TIMESTAMPTZ;

-- Backfill + tighten nullability for pro_status
UPDATE clubs
SET pro_status = 'free'
WHERE pro_status IS NULL;

ALTER TABLE clubs
  ALTER COLUMN pro_status SET NOT NULL;
