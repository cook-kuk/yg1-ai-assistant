-- product_turning_options_mv
-- Purpose: cover prod_edp_option_turning (missing from product_recommendation_mv).
-- Keyed on edp_no for 1:1 LEFT JOIN against product_recommendation_mv.
-- Safe to re-run: DROP + CREATE.

DROP MATERIALIZED VIEW IF EXISTS catalog_app.product_turning_options_mv;

CREATE MATERIALIZED VIEW catalog_app.product_turning_options_mv AS
WITH dedup_turning AS (
  SELECT
    pturn.*,
    row_number() OVER (PARTITION BY pturn.edp_no ORDER BY pturn.idx DESC) AS rn
  FROM raw_catalog.prod_edp_option_turning pturn
  WHERE COALESCE(pturn.flag_del, 'N'::text) <> 'Y'::text
    AND NULLIF(pturn.edp_no, ''::text) IS NOT NULL
)
SELECT
  t.idx                                   AS turning_row_idx,
  t.edp_no,
  t.brand_name                            AS turning_brand_name,
  t.series_idx                            AS turning_series_idx,
  t.series_name                           AS turning_series_name,
  t.unit                                  AS turning_unit,
  t.country                               AS turning_country,
  t.category_type                         AS turning_category_type,
  t.option_turning_grade                  AS turning_grade,
  t.option_turning_grade_order            AS turning_grade_order,
  t.option_turning_chip_breaker           AS turning_chip_breaker,
  t.option_turning_chipbreaker_order      AS turning_chip_breaker_order,
  t.option_turning_chip_breaker_description AS turning_chip_breaker_description,
  t.option_turning_p_n                    AS turning_p_n,
  t.option_turning_designation            AS turning_designation,
  t.option_turning_full_designation       AS turning_full_designation,
  t.option_turning_size                   AS turning_size,
  t.option_turning_re                     AS turning_re,
  t.option_turning_l                      AS turning_l,
  t.option_turning_le                     AS turning_le,
  t.option_turning_insd                   AS turning_insd,
  t.option_turning_ic                     AS turning_ic,
  t.option_turning_s                      AS turning_s,
  t.option_turning_work_piece             AS turning_work_piece,
  t.option_turning_external_internal      AS turning_external_internal,
  t.option_turning_category               AS turning_category,
  t.option_turning_coolant                AS turning_coolant,
  t.option_turning_hand                   AS turning_hand,
  t.option_turning_dmin                   AS turning_dmin,
  t.option_turning_dcon                   AS turning_dcon,
  t.option_turning_h                      AS turning_h,
  t.option_turning_b                      AS turning_b,
  t.option_turning_wf                     AS turning_wf,
  t.option_turning_lf                     AS turning_lf,
  t.option_turning_insert                 AS turning_insert,
  t.option_turning_cw                     AS turning_cw,
  t.option_turning_cdx                    AS turning_cdx,
  -- normalized numeric helpers (nullable)
  NULLIF(substring(COALESCE(t.option_turning_ic, ''::text),
         '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric
                                          AS turning_ic_mm,
  NULLIF(substring(COALESCE(t.option_turning_re, ''::text),
         '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric
                                          AS turning_corner_radius_mm,
  NULLIF(substring(COALESCE(t.option_turning_s, ''::text),
         '(-?[0-9]+(?:\.[0-9]+)?)'::text), ''::text)::numeric
                                          AS turning_thickness_mm,
  -- searchable tags for work_piece (ISO group-ish)
  array_remove(string_to_array(
      regexp_replace(upper(COALESCE(t.option_turning_work_piece, ''::text)),
                     '[^A-Z0-9,]+', ',', 'g'),
      ','::text), ''::text)               AS turning_work_piece_tags,
  replace(replace(upper(t.edp_no), ' '::text, ''::text), '-'::text, ''::text)
                                          AS normalized_code
FROM dedup_turning t
WHERE t.rn = 1;

CREATE UNIQUE INDEX product_turning_options_mv_edp_idx
  ON catalog_app.product_turning_options_mv (edp_no);
CREATE INDEX product_turning_options_mv_code_idx
  ON catalog_app.product_turning_options_mv USING btree (normalized_code);
CREATE INDEX product_turning_options_mv_grade_trgm_idx
  ON catalog_app.product_turning_options_mv USING gin (turning_grade gin_trgm_ops);
CREATE INDEX product_turning_options_mv_chip_breaker_trgm_idx
  ON catalog_app.product_turning_options_mv USING gin (turning_chip_breaker gin_trgm_ops);
CREATE INDEX product_turning_options_mv_work_piece_tags_idx
  ON catalog_app.product_turning_options_mv USING gin (turning_work_piece_tags);
CREATE INDEX product_turning_options_mv_ic_mm_idx
  ON catalog_app.product_turning_options_mv USING btree (turning_ic_mm);
CREATE INDEX product_turning_options_mv_corner_radius_idx
  ON catalog_app.product_turning_options_mv USING btree (turning_corner_radius_mm);

ANALYZE catalog_app.product_turning_options_mv;
