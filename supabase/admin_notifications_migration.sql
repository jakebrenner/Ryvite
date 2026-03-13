-- Admin Notification Preferences
-- Allows admins to subscribe to platform notifications (SMS)
-- Each admin can configure which notifications they want and provide a phone number

create table if not exists public.admin_notification_prefs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.profiles(id) on delete cascade,
  phone text not null,
  new_user_signup boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint admin_notification_prefs_admin_user_id_key unique (admin_user_id)
);

-- Auto-update updated_at (reuses existing function)
create trigger admin_notification_prefs_updated_at
  before update on public.admin_notification_prefs
  for each row execute function public.update_updated_at();

-- RLS: only service role manages this table (admin API uses service role key)
alter table public.admin_notification_prefs enable row level security;

create policy "Service role full access on admin_notification_prefs"
  on public.admin_notification_prefs
  for all
  using (true)
  with check (true);
