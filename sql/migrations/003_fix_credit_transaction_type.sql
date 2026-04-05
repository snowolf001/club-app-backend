-- Migration 003: Fix credit_transaction_type constraint to include 'add'
-- Needed by POST /api/memberships/:membershipId/credits (addCredits)

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_transaction_type_check;

ALTER TABLE credit_transactions
  ADD CONSTRAINT credit_transactions_transaction_type_check
  CHECK (transaction_type IN ('checkin', 'add', 'manual_adjustment', 'refund', 'backfill'));
