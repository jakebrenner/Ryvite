-- ============================================================
-- Admin Ratings — Supabase Migration
-- Run this in your Supabase SQL Editor (Dashboard > SQL Editor)
--
-- Adds admin quality ratings to:
--   1. style_library — rate inspiration templates so higher-rated
--      ones are preferred during auto-selection
--   2. event_themes — rate ALL generated invites across all events
--      so admins can continuously review and improve quality
--
-- These are ADMIN ratings (internal quality tracking), separate from:
--   - prompt_test_runs.score (lab test ratings)
--   - invite_ratings (end-user ratings)
-- ============================================================

-- ============================================================
-- 1. STYLE LIBRARY — add admin rating + usage tracking
-- ============================================================

alter table public.style_library
  add column if not exists admin_rating integer check (admin_rating >= 1 and admin_rating <= 5),
  add column if not exists admin_notes text default '',
  add column if not exists times_used integer not null default 0,
  add column if not exists rated_by text default '',
  add column if not exists rated_at timestamptz;

comment on column public.style_library.admin_rating is 'Admin quality rating 1-5. Used to weight style selection — higher-rated styles are preferred.';
comment on column public.style_library.times_used is 'Number of times this style was used as a reference in generation. Incremented at generation time.';

-- Index for weighted selection: rated styles first, ordered by rating desc
create index if not exists idx_style_library_rating
  on public.style_library (admin_rating desc nulls last);

-- ============================================================
-- 2. EVENT THEMES — add admin rating for quality review
-- ============================================================

alter table public.event_themes
  add column if not exists admin_rating integer check (admin_rating >= 1 and admin_rating <= 5),
  add column if not exists admin_notes text default '',
  add column if not exists rated_by text default '',
  add column if not exists rated_at timestamptz,
  add column if not exists prompt_version_id uuid references public.prompt_versions(id) on delete set null;

comment on column public.event_themes.admin_rating is 'Admin quality rating 1-5. Used for tracking generation quality across events.';
comment on column public.event_themes.prompt_version_id is 'Which prompt version was used to generate this theme. Null = hardcoded default.';

-- Index for admin review: unrated themes first, then by creation date
create index if not exists idx_event_themes_admin_rating
  on public.event_themes (admin_rating nulls first, created_at desc);

-- Index for prompt version analysis
create index if not exists idx_event_themes_prompt_version
  on public.event_themes (prompt_version_id) where prompt_version_id is not null;

-- ============================================================
-- 3. AGGREGATE VIEW — admin quality metrics across all themes
-- ============================================================

create or replace view public.admin_theme_quality as
select
  prompt_version_id,
  model,
  count(*)::integer as total_themes,
  count(admin_rating)::integer as rated_count,
  round(avg(admin_rating)::numeric, 2) as avg_admin_rating,
  count(*) filter (where admin_rating >= 4)::integer as high_quality_count,
  count(*) filter (where admin_rating <= 2)::integer as low_quality_count,
  round(avg(latency_ms)::numeric, 0) as avg_latency_ms,
  round(avg(input_tokens + output_tokens)::numeric, 0) as avg_total_tokens
from public.event_themes
group by prompt_version_id, model;

comment on view public.admin_theme_quality is 'Aggregated admin quality ratings across all generated themes, grouped by prompt version and model.';

-- ============================================================
-- DONE! Run this in Supabase SQL editor, then deploy.
-- ============================================================
