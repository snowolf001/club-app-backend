-- Migration: add actor_user_id to credit_transactions
-- Run once against the Railway database:
--   psql $DATABASE_URL -f src/db/migrations/001_add_actor_user_id_to_credit_transactions.sql

ALTER TABLE credit_transactions
  ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_credit_transactions_actor
  ON credit_transactions (actor_user_id);
