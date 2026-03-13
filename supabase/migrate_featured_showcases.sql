-- Featured Showcases — admin-curated invite demos for the landing page
-- Run in Supabase SQL editor

-- ============================================================
-- FEATURED_SHOWCASES — curated invite demos shown on homepage
-- ============================================================

create table if not exists public.featured_showcases (
  id              uuid primary key default gen_random_uuid(),
  source_type     text not null check (source_type in ('user_theme', 'lab_theme')),
  event_theme_id  uuid references public.event_themes(id) on delete cascade,
  test_run_id     uuid references public.prompt_test_runs(id) on delete cascade,
  prompt_text     text not null,
  display_order   integer not null default 0,
  html            text not null,
  css             text not null,
  config          jsonb not null default '{}'::jsonb,
  event_title     text not null default '',
  event_type      text not null default 'other',
  created_by      text not null default '',
  created_at      timestamptz not null default now(),
  constraint source_ref_check check (
    (source_type = 'user_theme' and event_theme_id is not null) or
    (source_type = 'lab_theme' and test_run_id is not null)
  )
);

create index if not exists idx_featured_showcases_order
  on public.featured_showcases (display_order);

comment on table public.featured_showcases is 'Admin-curated invite demos displayed on the landing page homepage carousel.';

-- RLS: public read, service role full access
alter table public.featured_showcases enable row level security;

create policy "Public read access to featured_showcases"
  on public.featured_showcases for select
  using (true);

create policy "Service role full access to featured_showcases"
  on public.featured_showcases for all
  using (true)
  with check (true);
