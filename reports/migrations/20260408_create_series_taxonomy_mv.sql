-- series_taxonomy_mv
-- Purpose: cover prod_category / prod_category_sub / prod_icons / prod_series_icons
-- which are not covered by any existing MV. One row per series with:
--   - category hierarchy (root / parent / self titles)
--   - aggregated icons (type, name, value) as JSONB
-- Keyed on prod_series_idx for JOIN with product_recommendation_mv.edp_series_idx.

DROP MATERIALIZED VIEW IF EXISTS catalog_app.series_taxonomy_mv;

CREATE MATERIALIZED VIEW catalog_app.series_taxonomy_mv AS
WITH cat AS (
  SELECT idx, depth, parent_idx, title, country
  FROM raw_catalog.prod_category
  WHERE COALESCE(flag_del, 'N'::text) <> 'Y'::text
), series_base AS (
  SELECT DISTINCT ON (s.idx)
         s.idx AS series_idx,
         s.series_name,
         s.brand_idx,
         s.brand_name,
         s.root_category,
         s.category_idx,
         s.tool_type,
         s.product_type
  FROM raw_catalog.prod_series s
  WHERE COALESCE(s.flag_del, 'N'::text) <> 'Y'::text
    AND s.idx ~ '^[0-9]+$'
  ORDER BY s.idx, s._row_num DESC NULLS LAST
), series_icons_agg AS (
  SELECT si.prod_series_idx,
         jsonb_agg(DISTINCT jsonb_build_object(
           'icon_type',  si.icon_type,
           'icon_name',  si.icon_name,
           'icon_value', i.icon_value
         )) FILTER (WHERE si.icon_name IS NOT NULL)     AS icons,
         array_remove(array_agg(DISTINCT NULLIF(si.icon_type,'')),  NULL) AS icon_types,
         array_remove(array_agg(DISTINCT NULLIF(si.icon_name,'')),  NULL) AS icon_names,
         array_remove(array_agg(DISTINCT NULLIF(i.icon_value,'')),  NULL) AS icon_values
  FROM raw_catalog.prod_series_icons si
  LEFT JOIN raw_catalog.prod_icons i ON i.idx = si.prod_icons_idx
  WHERE COALESCE(si.flag_del,'N') <> 'Y'
  GROUP BY si.prod_series_idx
)
SELECT
  sb.series_idx,
  sb.series_name,
  sb.brand_idx,
  sb.brand_name,
  sb.root_category,
  sb.category_idx,
  sb.tool_type,
  sb.product_type,
  c_self.title        AS category_title,
  c_self.depth        AS category_depth,
  c_self.parent_idx   AS category_parent_idx,
  c_parent.title      AS category_parent_title,
  c_parent.parent_idx AS category_grandparent_idx,
  c_grand.title       AS category_grandparent_title,
  COALESCE(ia.icons, '[]'::jsonb) AS icons,
  COALESCE(ia.icon_types,  ARRAY[]::text[]) AS icon_types,
  COALESCE(ia.icon_names,  ARRAY[]::text[]) AS icon_names,
  COALESCE(ia.icon_values, ARRAY[]::text[]) AS icon_values
FROM series_base sb
LEFT JOIN cat c_self   ON c_self.idx   = sb.category_idx
LEFT JOIN cat c_parent ON c_parent.idx = c_self.parent_idx
LEFT JOIN cat c_grand  ON c_grand.idx  = c_parent.parent_idx
LEFT JOIN series_icons_agg ia ON ia.prod_series_idx = sb.series_idx;

CREATE UNIQUE INDEX series_taxonomy_mv_series_idx_key
  ON catalog_app.series_taxonomy_mv (series_idx);
CREATE INDEX series_taxonomy_mv_root_idx
  ON catalog_app.series_taxonomy_mv (root_category);
CREATE INDEX series_taxonomy_mv_category_idx
  ON catalog_app.series_taxonomy_mv (category_idx);
CREATE INDEX series_taxonomy_mv_icon_names_idx
  ON catalog_app.series_taxonomy_mv USING gin (icon_names);
CREATE INDEX series_taxonomy_mv_icon_types_idx
  ON catalog_app.series_taxonomy_mv USING gin (icon_types);

ANALYZE catalog_app.series_taxonomy_mv;
