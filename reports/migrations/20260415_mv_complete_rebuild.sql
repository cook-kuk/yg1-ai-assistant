-- 20260415 product_recommendation_mv 종합 재빌드
-- Part 1: point_angle / threading_pitch / threading_tpi 복구 (기존 draft 포함)
-- Part 2: 정규화 컬럼 5개 추가 (norm_brand, norm_coating, norm_cutting_edge, norm_application, norm_shank_type)
-- Part 7: 수치 이상값 정리 (Multi Flute/Multiple/R.062/0 → NULL, inch → mm)

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS catalog_app.product_recommendation_mv;

CREATE MATERIALIZED VIEW catalog_app.product_recommendation_mv AS
WITH ranked_edp AS (
  SELECT pe_1.*,
    row_number() OVER (PARTITION BY pe_1.edp_no ORDER BY pe_1.idx DESC) AS edp_rank
  FROM raw_catalog.prod_edp pe_1
  WHERE COALESCE(pe_1.flag_del, 'N') <> 'Y'
    AND COALESCE(pe_1.flag_show, 'Y') = 'Y'
    AND NULLIF(pe_1.edp_no, '') IS NOT NULL
),
dedup_edp AS (
  SELECT * FROM ranked_edp WHERE edp_rank = 1
),
series_materials AS (
  SELECT prod_series_idx,
    array_remove(array_agg(DISTINCT NULLIF(tag_name, '')), NULL) AS material_tags
  FROM raw_catalog.prod_series_work_material_status
  GROUP BY prod_series_idx
),
country_sources AS (
  SELECT raw_country_codes.edp_no,
    btrim(raw_country_codes.country_code) AS country_code
  FROM (
    SELECT pm_1.edp_no, country_row.country_code
    FROM raw_catalog.prod_edp_option_milling pm_1,
      LATERAL unnest(string_to_array(COALESCE(pm_1.country, ''), ',')) country_row(country_code)
    UNION ALL
    SELECT ph_1.edp_no, country_row.country_code
    FROM raw_catalog.prod_edp_option_holemaking ph_1,
      LATERAL unnest(string_to_array(COALESCE(ph_1.country, ''), ',')) country_row(country_code)
    UNION ALL
    SELECT pt_1.edp_no, country_row.country_code
    FROM raw_catalog.prod_edp_option_threading pt_1,
      LATERAL unnest(string_to_array(COALESCE(pt_1.country, ''), ',')) country_row(country_code)
    UNION ALL
    SELECT ptool_1.edp_no, country_row.country_code
    FROM raw_catalog.prod_edp_option_tooling ptool_1,
      LATERAL unnest(string_to_array(COALESCE(ptool_1.country, ''), ',')) country_row(country_code)
    UNION ALL
    SELECT pturn.edp_no, country_row.country_code
    FROM raw_catalog.prod_edp_option_turning pturn,
      LATERAL unnest(string_to_array(COALESCE(pturn.country, ''), ',')) country_row(country_code)
  ) raw_country_codes
  WHERE btrim(raw_country_codes.country_code) <> ''
),
edp_countries AS (
  SELECT country_sources.edp_no,
    string_agg(DISTINCT country_sources.country_code, ',' ORDER BY country_sources.country_code) AS country,
    array_agg(DISTINCT country_sources.country_code ORDER BY country_sources.country_code) AS country_codes
  FROM country_sources
  GROUP BY country_sources.edp_no
)
SELECT
  pe.idx AS edp_idx,
  pe.edp_no,
  pe.brand_name AS edp_brand_name,
  pe.series_name AS edp_series_name,
  pe.series_idx AS edp_series_idx,
  pe.root_category AS edp_root_category,
  pe.unit AS edp_unit,
  pe.option_z,
  pe.option_numberofflute,
  pe.option_drill_diameter,
  pe.option_d1,
  pe.option_dc,
  pe.option_d,
  pe.option_shank_diameter,
  pe.option_dcon,
  pe.option_flute_length,
  pe.option_loc,
  pe.option_overall_length,
  pe.option_oal,
  pe.option_r,
  pe.option_re,
  pe.option_tolofmilldia,
  pe.option_tolofshankdia,
  pe.option_taperangle,
  pe.option_coolanthole,
  ps.idx AS series_row_idx,
  ps.brand_name AS series_brand_name,
  ps.description AS series_description,
  ps.feature AS series_feature,
  ps.tool_type AS series_tool_type,
  ps.product_type AS series_product_type,
  ps.application_shape AS series_application_shape,
  ps.cutting_edge_shape AS series_cutting_edge_shape,
  ps.shank_type AS series_shank_type,
  country_source.country,
  COALESCE(country_source.country_codes, ARRAY[]::text[]) AS country_codes,
  sm.material_tags,

  -- Part 7: milling_outside_dia — "0"/빈문자 → NULL
  CASE
    WHEN BTRIM(COALESCE(pm.option_milling_outsidedia, '')) IN ('', '0', '0.0', '0.00') THEN NULL
    ELSE pm.option_milling_outsidedia
  END AS milling_outside_dia,

  -- Part 7: milling_number_of_flute — "Multi Flute"/"Multiple"/빈문자 → NULL
  CASE
    WHEN BTRIM(COALESCE(pm.option_milling_numberofflute, '')) = '' THEN NULL
    WHEN UPPER(BTRIM(pm.option_milling_numberofflute)) IN ('MULTI FLUTE', 'MULTIFLUTE', 'MULTIPLE', 'MULTI') THEN NULL
    ELSE pm.option_milling_numberofflute
  END AS milling_number_of_flute,

  pm.option_milling_coating AS milling_coating,
  pm.option_milling_toolmaterial AS milling_tool_material,
  pm.option_milling_shankdia AS milling_shank_dia,
  pm.option_milling_shanktype AS milling_shank_type,
  pm.option_milling_lengthofcut AS milling_length_of_cut,
  pm.option_milling_overalllength AS milling_overall_length,

  -- Part 7: milling_helix_angle — "Multiple"/빈문자 → NULL
  CASE
    WHEN BTRIM(COALESCE(pm.option_milling_helixangle, '')) = '' THEN NULL
    WHEN UPPER(BTRIM(pm.option_milling_helixangle)) IN ('MULTIPLE', 'VARIABLE', 'VAR') THEN NULL
    ELSE pm.option_milling_helixangle
  END AS milling_helix_angle,

  -- Part 7: milling_ball_radius — "R.062" 등 R로 시작 → 숫자 추출, 빈문자 → NULL
  CASE
    WHEN BTRIM(COALESCE(pm.option_milling_radiusofballnose, '')) = '' THEN NULL
    WHEN pm.option_milling_radiusofballnose ~* '^R\s*\.?[0-9]' THEN
      NULLIF(SUBSTRING(pm.option_milling_radiusofballnose, '(-?[0-9]+(?:\.[0-9]+)?)'), '')
    ELSE pm.option_milling_radiusofballnose
  END AS milling_ball_radius,

  pm.option_milling_tolofmilldia AS milling_diameter_tolerance,
  pm.option_milling_tolofshankdia AS milling_shank_diameter_tolerance,
  pm.option_milling_taperangle AS milling_taper_angle,
  pm.option_milling_neckdiameter AS milling_neck_diameter,
  pm.option_milling_effective_length AS milling_effective_length,
  pm.option_milling_coolanthole AS milling_coolant_hole,
  pm.option_milling_cuttingedgeshape AS milling_cutting_edge_shape,
  pm.option_milling_cuttershape AS milling_cutter_shape,
  ph.option_holemaking_outsidedia AS holemaking_outside_dia,
  ph.option_holemaking_numberofflute AS holemaking_number_of_flute,
  ph.option_holemaking_coating AS holemaking_coating,
  ph.option_holemaking_toolmaterial AS holemaking_tool_material,
  ph.option_holemaking_shankdia AS holemaking_shank_dia,
  ph.option_holemaking_flutelength AS holemaking_flute_length,
  ph.option_holemaking_overalllength AS holemaking_overall_length,
  ph.option_holemaking_helixangle AS holemaking_helix_angle,
  ph.option_holemaking_tolofdrilldia AS holemaking_diameter_tolerance,
  ph.option_holemaking_tolofshankdia AS holemaking_shank_diameter_tolerance,
  ph.option_holemaking_length_below_shank AS holemaking_length_below_shank,
  ph.option_holemaking_taper_angle AS holemaking_taper_angle,
  ph.option_holemaking_coolanthole AS holemaking_coolant_hole,
  pt.option_threading_outsidedia AS threading_outside_dia,
  pt.option_threading_numberofflute AS threading_number_of_flute,
  pt.option_threading_coating AS threading_coating,
  pt.option_threading_toolmaterial AS threading_tool_material,
  pt.option_threading_shankdia AS threading_shank_dia,
  pt.option_threading_threadlength AS threading_thread_length,
  pt.option_threading_overalllength AS threading_overall_length,
  pt.option_threading_l3 AS threading_l3,
  pt.option_threading_coolanthole AS threading_coolant_hole,
  pt.option_threading_flutetype AS threading_flute_type,
  pt.option_threading_threadshape AS threading_thread_shape,
  ptool.option_tooling_shanktype AS tooling_shank_type,
  ptool.option_tooling_back_bore_l3 AS tooling_back_bore_l3,
  replace(replace(upper(pe.edp_no), ' ', ''), '-', '') AS normalized_code,

  -- search_diameter_mm: 기존 inch → mm 환산 로직 유지 + 입력 "0" 필터링
  CASE
    WHEN upper(COALESCE(pe.unit, '')) LIKE '%INCH%' THEN
      NULLIF(SUBSTRING(
        COALESCE(
          NULLIF(pm.option_milling_outsidedia, ''),
          NULLIF(ph.option_holemaking_outsidedia, ''),
          NULLIF(pt.option_threading_outsidedia, ''),
          NULLIF(pe.option_drill_diameter, ''),
          NULLIF(pe.option_d1, ''),
          NULLIF(pe.option_dc, ''),
          NULLIF(pe.option_d, '')
        ), '(-?[0-9]+(?:\.[0-9]+)?)'), '')::numeric * 25.4
    ELSE
      NULLIF(SUBSTRING(
        COALESCE(
          NULLIF(pm.option_milling_outsidedia, ''),
          NULLIF(ph.option_holemaking_outsidedia, ''),
          NULLIF(pt.option_threading_outsidedia, ''),
          NULLIF(pe.option_drill_diameter, ''),
          NULLIF(pe.option_d1, ''),
          NULLIF(pe.option_dc, ''),
          NULLIF(pe.option_d, '')
        ), '(-?[0-9]+(?:\.[0-9]+)?)'), '')::numeric
  END AS search_diameter_mm,

  COALESCE(
    NULLIF(pm.option_milling_coating, ''),
    NULLIF(ph.option_holemaking_coating, ''),
    NULLIF(pt.option_threading_coating, '')
  ) AS search_coating,
  COALESCE(
    NULLIF(pm.option_milling_cuttingedgeshape, ''),
    NULLIF(ps.cutting_edge_shape, ''),
    NULLIF(pm.option_milling_cuttershape, ''),
    NULLIF(pt.option_threading_flutetype, ''),
    NULLIF(pt.option_threading_threadshape, '')
  ) AS search_subtype,
  COALESCE(
    NULLIF(pm.option_milling_shanktype, ''),
    NULLIF(ptool.option_tooling_shanktype, ''),
    NULLIF(ps.shank_type, '')
  ) AS search_shank_type,

  -- Part 1: 복구 컬럼
  ph.option_holemaking_pointangle AS holemaking_point_angle,
  pt.option_threading_pitch AS threading_pitch,
  pt.option_threading_tpi AS threading_tpi,

  -- Part 2: 정규화 컬럼 (LLM 매칭용 UPPER+TRIM SSOT)
  UPPER(BTRIM(pe.brand_name)) AS norm_brand,
  UPPER(BTRIM(COALESCE(
    NULLIF(pm.option_milling_coating, ''),
    NULLIF(ph.option_holemaking_coating, ''),
    NULLIF(pt.option_threading_coating, '')
  ))) AS norm_coating,
  UPPER(BTRIM(COALESCE(
    NULLIF(pm.option_milling_cuttingedgeshape, ''),
    NULLIF(ps.cutting_edge_shape, ''),
    NULLIF(pm.option_milling_cuttershape, '')
  ))) AS norm_cutting_edge,
  UPPER(BTRIM(ps.application_shape)) AS norm_application,
  UPPER(BTRIM(COALESCE(
    NULLIF(pm.option_milling_shanktype, ''),
    NULLIF(ptool.option_tooling_shanktype, ''),
    NULLIF(ps.shank_type, '')
  ))) AS norm_shank_type

FROM dedup_edp pe
  LEFT JOIN raw_catalog.prod_series ps ON ps.idx = pe.series_idx
  LEFT JOIN series_materials sm ON sm.prod_series_idx = pe.series_idx
  LEFT JOIN edp_countries country_source ON country_source.edp_no = pe.edp_no
  LEFT JOIN raw_catalog.prod_edp_option_milling pm ON pm.edp_no = pe.edp_no
  LEFT JOIN raw_catalog.prod_edp_option_holemaking ph ON ph.edp_no = pe.edp_no
  LEFT JOIN raw_catalog.prod_edp_option_threading pt ON pt.edp_no = pe.edp_no
  LEFT JOIN raw_catalog.prod_edp_option_tooling ptool ON ptool.edp_no = pe.edp_no;

-- 기존 인덱스 복구
CREATE INDEX product_recommendation_mv_code_idx ON catalog_app.product_recommendation_mv USING btree (normalized_code);
CREATE INDEX product_recommendation_mv_diameter_idx ON catalog_app.product_recommendation_mv USING btree (search_diameter_mm);
CREATE INDEX product_recommendation_mv_material_tags_idx ON catalog_app.product_recommendation_mv USING gin (material_tags);
CREATE INDEX product_recommendation_mv_country_codes_idx ON catalog_app.product_recommendation_mv USING gin (country_codes);
CREATE INDEX product_recommendation_mv_series_trgm_idx ON catalog_app.product_recommendation_mv USING gin (edp_series_name gin_trgm_ops);
CREATE INDEX product_recommendation_mv_coating_trgm_idx ON catalog_app.product_recommendation_mv USING gin (search_coating gin_trgm_ops);
CREATE INDEX product_recommendation_mv_subtype_trgm_idx ON catalog_app.product_recommendation_mv USING gin (search_subtype gin_trgm_ops);
CREATE INDEX product_recommendation_mv_appshape_trgm_idx ON catalog_app.product_recommendation_mv USING gin (series_application_shape gin_trgm_ops);

-- Part 2: 정규화 컬럼 trgm 인덱스
CREATE INDEX product_recommendation_mv_norm_brand_idx ON catalog_app.product_recommendation_mv USING btree (norm_brand);
CREATE INDEX product_recommendation_mv_norm_coating_idx ON catalog_app.product_recommendation_mv USING btree (norm_coating);
CREATE INDEX product_recommendation_mv_norm_application_idx ON catalog_app.product_recommendation_mv USING btree (norm_application);

COMMIT;
