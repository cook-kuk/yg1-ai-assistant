-- entity_i18n_mv
-- Purpose: cover prod_series_sub / prod_brand_sub (multilingual names/descriptions)
-- which are not in any existing MV. Unified UNION by (entity_type, entity_idx, lang).
-- Use for localized search and display.

DROP MATERIALIZED VIEW IF EXISTS catalog_app.entity_i18n_mv;

CREATE MATERIALIZED VIEW catalog_app.entity_i18n_mv AS
SELECT
  'series'::text                       AS entity_type,
  ss.prod_series_idx                   AS entity_idx,
  NULLIF(lower(btrim(ss.lang)), '')    AS lang,
  NULLIF(btrim(ss.series_name), '')    AS name,
  NULLIF(btrim(ss.description), '')    AS description,
  NULLIF(btrim(ss.feature), '')        AS feature,
  regexp_replace(upper(btrim(COALESCE(ss.series_name,''))),
                 '[\s\-·∙ㆍ./(),]+', '', 'g') AS normalized_name
FROM raw_catalog.prod_series_sub ss
WHERE COALESCE(ss.flag_del, 'N') <> 'Y'
  AND NULLIF(btrim(ss.series_name), '') IS NOT NULL

UNION ALL

SELECT
  'brand'::text                        AS entity_type,
  bs.prod_brand_idx                    AS entity_idx,
  NULLIF(lower(btrim(bs.lang)), '')    AS lang,
  NULLIF(btrim(bs.brand_name), '')     AS name,
  NULLIF(btrim(bs.description), '')    AS description,
  NULLIF(btrim(bs.description_work_piece), '') AS feature,
  regexp_replace(upper(btrim(COALESCE(bs.brand_name,''))),
                 '[\s\-·∙ㆍ./(),]+', '', 'g') AS normalized_name
FROM raw_catalog.prod_brand_sub bs
WHERE COALESCE(bs.flag_del, 'N') <> 'Y'
  AND NULLIF(btrim(bs.brand_name), '') IS NOT NULL;

CREATE INDEX entity_i18n_mv_type_idx_lang
  ON catalog_app.entity_i18n_mv (entity_type, entity_idx, lang);
CREATE INDEX entity_i18n_mv_normalized_name_idx
  ON catalog_app.entity_i18n_mv (normalized_name);
CREATE INDEX entity_i18n_mv_name_trgm_idx
  ON catalog_app.entity_i18n_mv USING gin (name gin_trgm_ops);
CREATE INDEX entity_i18n_mv_lang_idx
  ON catalog_app.entity_i18n_mv (lang);

ANALYZE catalog_app.entity_i18n_mv;
