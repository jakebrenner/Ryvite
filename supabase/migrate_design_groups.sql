-- Design Groups Migration
-- Adds design_group_id to all gallery source tables so that variations/tweaks
-- of the same design are grouped together. The inspiration gallery shows only
-- the best-rated design per group, ensuring visual variety.

-- 1. Add design_group_id to all three gallery sources
ALTER TABLE style_library ADD COLUMN IF NOT EXISTS design_group_id text;
ALTER TABLE prompt_test_runs ADD COLUMN IF NOT EXISTS design_group_id text;
ALTER TABLE event_themes ADD COLUMN IF NOT EXISTS design_group_id text;

-- 2. Backfill style_library: each item is its own group
UPDATE style_library SET design_group_id = id WHERE design_group_id IS NULL;

-- 3. Backfill prompt_test_runs: group by test_session_id when available, else own id
UPDATE prompt_test_runs SET design_group_id = COALESCE(test_session_id, id::text) WHERE design_group_id IS NULL;

-- 4. Backfill event_themes: each theme is its own group (future inserts will set properly)
UPDATE event_themes SET design_group_id = id::text WHERE design_group_id IS NULL;

-- 5. Recreate gallery view with group-based deduplication
-- Uses subqueries with DISTINCT ON to pick the best-rated entry per design group
DROP VIEW IF EXISTS gallery_templates;
CREATE VIEW gallery_templates AS

-- User-generated themes: best per design group
SELECT * FROM (
  SELECT DISTINCT ON (COALESCE(et.design_group_id, et.id::text))
    et.id::text AS id,
    et.html,
    et.css,
    et.config,
    et.admin_rating,
    et.model,
    et.created_at,
    e.event_type,
    'user' AS source
  FROM event_themes et
  JOIN events e ON et.event_id = e.id
  WHERE et.gallery_eligible = true
    AND et.html IS NOT NULL
    AND et.css IS NOT NULL
    AND et.based_on_theme_id IS NULL
  ORDER BY COALESCE(et.design_group_id, et.id::text), et.admin_rating DESC NULLS LAST, et.created_at DESC
) user_themes

UNION ALL

-- Lab-generated themes: best per design group
SELECT * FROM (
  SELECT DISTINCT ON (COALESCE(ptr.design_group_id, ptr.id::text))
    ptr.id::text AS id,
    ptr.result_html AS html,
    ptr.result_css AS css,
    ptr.result_config AS config,
    ptr.score AS admin_rating,
    ptr.model,
    ptr.created_at,
    ptr.event_type,
    'lab' AS source
  FROM prompt_test_runs ptr
  WHERE ptr.score IS NOT NULL
    AND ptr.score >= 4
    AND COALESCE(ptr.exclude_from_gallery, false) = false
    AND ptr.result_html IS NOT NULL
    AND ptr.result_css IS NOT NULL
  ORDER BY COALESCE(ptr.design_group_id, ptr.id::text), ptr.score DESC NULLS LAST, ptr.created_at DESC
) lab_themes

UNION ALL

-- Style library items: best per design group
SELECT * FROM (
  SELECT DISTINCT ON (COALESCE(sl.design_group_id, sl.id))
    sl.id::text AS id,
    sl.html,
    NULL::text AS css,
    NULL::jsonb AS config,
    sl.admin_rating,
    NULL::text AS model,
    sl.created_at,
    sl.event_types[1] AS event_type,
    'style' AS source
  FROM style_library sl
  WHERE sl.admin_rating IS NOT NULL
    AND sl.admin_rating >= 4
    AND COALESCE(sl.exclude_from_gallery, false) = false
    AND sl.html IS NOT NULL
    AND COALESCE(sl.archived_at::text, '') = ''
  ORDER BY COALESCE(sl.design_group_id, sl.id), sl.admin_rating DESC NULLS LAST, sl.created_at DESC
) style_items

ORDER BY admin_rating DESC, created_at DESC;

-- 6. Indexes for group-based queries
CREATE INDEX IF NOT EXISTS idx_style_library_design_group ON style_library (design_group_id);
CREATE INDEX IF NOT EXISTS idx_prompt_test_runs_design_group ON prompt_test_runs (design_group_id);
CREATE INDEX IF NOT EXISTS idx_event_themes_design_group ON event_themes (design_group_id);
