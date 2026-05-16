-- Migration 012: Add Club Info and Logo Support

-- Add club information fields to clubs table
-- All fields are nullable for backwards compatibility with published app
ALTER TABLE clubs
  ADD COLUMN IF NOT EXISTS club_info_text TEXT,
  ADD COLUMN IF NOT EXISTS credit_purchase_instructions TEXT,
  ADD COLUMN IF NOT EXISTS contact_info TEXT,
  ADD COLUMN IF NOT EXISTS payment_methods JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS club_logo_url TEXT;

-- Add index on payment_methods for JSONB queries
CREATE INDEX IF NOT EXISTS idx_clubs_payment_methods ON clubs USING GIN (payment_methods);

-- Add comment for documentation
COMMENT ON COLUMN clubs.club_info_text IS 'General information about the club';
COMMENT ON COLUMN clubs.credit_purchase_instructions IS 'Instructions for purchasing credits';
COMMENT ON COLUMN clubs.contact_info IS 'Contact information for the club';
COMMENT ON COLUMN clubs.payment_methods IS 'Array of payment methods (max 5): [{id, type, label, qrImageUrl, paymentLink, note}]';
COMMENT ON COLUMN clubs.club_logo_url IS 'URL to club logo image';
