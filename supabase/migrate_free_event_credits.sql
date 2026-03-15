-- Add free_event_credits to profiles for admin-granted free events
-- Run in Supabase SQL editor

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS free_event_credits integer NOT NULL DEFAULT 0;
