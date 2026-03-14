-- Migration: Pricing Model Update — $4.99 Flat Per-Event
-- Replaces complex two-tier pricing (per-event + pay-as-you-go) with simple $4.99/event model
-- Free tier: 1 event, 1 AI generation, email/link only (no SMS)
-- Paid tier: $4.99/event, unlimited AI (soft cap 10), SMS up to 1000/event

-- 1. Add payment columns to events
ALTER TABLE events ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid';
ALTER TABLE events ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sms_limit integer DEFAULT 1000;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sms_sent_count integer DEFAULT 0;

-- 2. Add global admin flag to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_global_admin boolean DEFAULT false;

-- Set Jake as global admin (by email — update with actual user ID if known)
UPDATE profiles SET is_global_admin = true
WHERE id IN (SELECT id FROM auth.users WHERE email = 'jakebrennan54@gmail.com');

-- 3. Create SMS approvals table
CREATE TABLE IF NOT EXISTS sms_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email text,
  event_title text,
  current_sms_sent integer DEFAULT 0,
  current_limit integer DEFAULT 1000,
  requested_count integer,
  guest_count integer,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  approved_limit integer,
  approved_at timestamptz,
  approved_by uuid,
  reason text
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_sms_approvals_event ON sms_approvals(event_id);
CREATE INDEX IF NOT EXISTS idx_sms_approvals_status ON sms_approvals(status);

-- 4. Deactivate old plans
UPDATE plans SET is_active = false WHERE name IN ('per_event', 'pay_as_you_go');

-- 5. Insert new $4.99 flat plan
INSERT INTO plans (name, display_name, description, price_cents, currency, billing_type, max_events, max_generations, features, is_active, sort_order)
VALUES (
  'event_499',
  'Per Event',
  'AI-designed custom invitation with unlimited guests, SMS + email delivery, and RSVP tracking.',
  499,
  'usd',
  'fixed',
  1,
  999,
  '["Unlimited AI designs (soft cap 10)", "SMS delivery (up to 1,000)", "Email delivery unlimited", "Full RSVP tracking", "Guest management", "Custom RSVP fields", "Calendar links (ICS, Google, Outlook)"]',
  true,
  1
)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  price_cents = EXCLUDED.price_cents,
  billing_type = EXCLUDED.billing_type,
  max_events = EXCLUDED.max_events,
  max_generations = EXCLUDED.max_generations,
  features = EXCLUDED.features,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order;

-- 6. Set existing events' payment_status based on whether they have a subscription
-- Events with a paid subscription → 'paid'
-- First event per user (oldest) with no subscription → 'free'
-- Others → 'unpaid'
-- This is a one-time data migration — run manually and verify

-- Mark events that have an associated active subscription as paid
UPDATE events e SET payment_status = 'paid', paid_at = s.created_at
FROM subscriptions s
WHERE s.user_id = e.user_id
  AND s.status = 'active'
  AND e.payment_status = 'unpaid';

-- Mark the first event per user as free (if not already paid)
WITH first_events AS (
  SELECT DISTINCT ON (user_id) id
  FROM events
  WHERE payment_status = 'unpaid'
  ORDER BY user_id, created_at ASC
)
UPDATE events SET payment_status = 'free', sms_limit = 0
WHERE id IN (SELECT id FROM first_events);
