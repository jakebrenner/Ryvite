-- Migration: Add free_generation_used flag to events
-- Fixes: Free events were blocked from their first generation because the limit check
-- counted ALL generation_log entries (including pre-migration ones). Now we use a
-- simple boolean flag that only gets set after a generation under the new pricing model.

-- 1. Add the column (safe to re-run)
ALTER TABLE events ADD COLUMN IF NOT EXISTS free_generation_used boolean DEFAULT false;

-- 2. All existing free events get their free generation reset (false)
-- This ensures migrated events with pre-pricing-change generations still get 1 free generation
UPDATE events SET free_generation_used = false WHERE payment_status = 'free';
