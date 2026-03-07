-- ============================================================
-- Ryvite V2 — Supabase Schema
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- 1. Profiles table (extends Supabase auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  phone text,
  created_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', ''));
  return new;
end;
$$ language plpgsql security definer;

-- Drop trigger if exists then recreate
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Events table
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  event_date timestamptz,
  end_date timestamptz,
  location_name text,
  location_address text,
  dress_code text,
  event_type text,
  slug text unique,
  status text default 'Draft' check (status in ('Draft', 'Published', 'Archived')),
  prompt text,
  theme_html text,
  theme_css text,
  theme_config jsonb default '{}'::jsonb,
  zapier_webhook text,
  custom_fields jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for fast lookups
create index if not exists idx_events_user_id on public.events(user_id);
create index if not exists idx_events_slug on public.events(slug);

-- Auto-update updated_at
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists events_updated_at on public.events;
create trigger events_updated_at
  before update on public.events
  for each row execute function public.update_updated_at();

-- 3. Generation log table
create table if not exists public.generation_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  prompt text,
  model text,
  input_tokens integer default 0,
  output_tokens integer default 0,
  latency_ms integer default 0,
  status text,
  error text,
  created_at timestamptz default now()
);

create index if not exists idx_generation_log_user_id on public.generation_log(user_id);
create index if not exists idx_generation_log_event_id on public.generation_log(event_id);

-- 4. RSVPs table (V2 events only — V1 RSVPs stay in Google Sheets)
create table if not exists public.rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  invite_id text,
  name text not null,
  phone text,
  status text not null check (status in ('yes', 'no', 'maybe')),
  response_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_rsvps_event_id on public.rsvps(event_id);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.generation_log enable row level security;
alter table public.rsvps enable row level security;

-- Profiles: users can read/update their own profile
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Events: owners can CRUD, anyone can read Published events
create policy "Users can manage own events"
  on public.events for all
  using (auth.uid() = user_id);

create policy "Anyone can view published events"
  on public.events for select
  using (status = 'Published');

-- Generation log: users can view their own logs, service role can insert
create policy "Users can view own generation logs"
  on public.generation_log for select
  using (auth.uid() = user_id);

create policy "Service role can insert generation logs"
  on public.generation_log for insert
  with check (true);

-- RSVPs: anyone can insert (public RSVP), event owner can read
create policy "Anyone can submit RSVP"
  on public.rsvps for insert
  with check (true);

create policy "Event owners can view RSVPs"
  on public.rsvps for select
  using (
    event_id in (
      select id from public.events where user_id = auth.uid()
    )
  );

-- Also allow anon to read events by slug (for the public invite page)
-- The "Anyone can view published events" policy above handles this
