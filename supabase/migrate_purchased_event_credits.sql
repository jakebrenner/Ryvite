-- Add purchased_event_credits to profiles for pre-purchased event credits
-- Run in Supabase SQL editor

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS purchased_event_credits integer NOT NULL DEFAULT 0;
