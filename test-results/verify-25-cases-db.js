// 25 케이스 — DB 직접 쿼리로 ground truth 재검증
// suchan_test_v1.xlsx 의 DB 컬럼이 어떻게 산출됐는지 역추적
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: 'postgresql://smart_catalog:smart_catalog@20.119.98.136:5432/smart_catalog' });
  await c.connect();

  const cases = [
    { no: 1, name: '베이스 P 10 Slotting', db: 1100, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 8 AND 12 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 1, name: '베이스 P 10 exact', db: 1100, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm = 10 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 2, name: 'P+M+K 6mm', db: 1084, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P','M','K']::text[] AND search_diameter_mm BETWEEN 4 AND 8 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 3, name: '직경 8~12 Slotting P', db: 3772, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 8 AND 12 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 4, name: 'OAL ≥100 P 10', db: 384, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 8 AND 12 AND COALESCE(milling_overall_length::numeric, option_overall_length::numeric, option_oal::numeric) >= 100 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 5, name: 'OAL ≤80 P 10', db: 568, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 8 AND 12 AND COALESCE(milling_overall_length::numeric, option_overall_length::numeric, option_oal::numeric) <= 80 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 6, name: '4날 P 10 Slotting', db: 467, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 8 AND 12 AND milling_number_of_flute='4' ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 7, name: '5날+ S 12', db: 69, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['S']::text[] AND search_diameter_mm BETWEEN 10 AND 14 AND milling_number_of_flute::int >= 5 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 8, name: 'T-Coating P 8', db: 62, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 6 AND 10 AND search_coating='T-Coating' ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 9, name: 'bright finish N 6', db: 283, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['N']::text[] AND search_diameter_mm BETWEEN 4 AND 8 AND (search_coating='Bright Finish' OR search_coating IS NULL OR search_coating ILIKE '%uncoated%') ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 12, name: 'X5070 brand', db: 84, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND search_diameter_mm BETWEEN 8 AND 12 AND (edp_brand_name ILIKE '%X5070%' OR series_brand_name ILIKE '%X5070%') ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 13, name: 'ALU-POWER 제외 N 8', db: 255, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['N']::text[] AND search_diameter_mm BETWEEN 6 AND 10 AND COALESCE(edp_brand_name,'') NOT ILIKE '%ALU-POWER%' AND COALESCE(series_brand_name,'') NOT ILIKE '%ALU-POWER%' ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 14, name: '4중 P 10 OAL≥100 4F TiAlN', db: 8, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 8 AND 12 AND milling_number_of_flute='4' AND search_coating ILIKE '%TiAlN%' AND COALESCE(milling_overall_length::numeric, option_overall_length::numeric)>=100 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 16, name: '헬릭스 ≥45', db: 106, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 8 AND 12 AND milling_helix_angle::numeric>=45 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 17, name: 'Shank 6~10 P 8', db: 980, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 6 AND 10 AND COALESCE(milling_shank_dia::numeric, option_shank_diameter::numeric) BETWEEN 6 AND 10 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 18, name: 'CL ≥20 P 10', db: 750, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 8 AND 12 AND COALESCE(milling_length_of_cut::numeric, option_loc::numeric)>=20 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 19, name: 'Drill point_angle 140 P 8', db: 70, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Holemaking' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 6 AND 10 AND holemaking_point_angle::numeric=140 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 20, name: 'Drill OAL≥100+coolant P 10', db: 56, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Holemaking' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 8 AND 12 AND COALESCE(holemaking_overall_length::numeric, option_overall_length::numeric)>=100 AND (holemaking_coolant_hole IS NOT NULL AND holemaking_coolant_hole NOT IN ('','N','No','no','false','0')) ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 21, name: 'Tap M10 P1.5 P', db: 287, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Threading' AND material_tags && ARRAY['P']::text[] AND threading_pitch::numeric=1.5 ORDER BY normalized_code, edp_idx DESC) x` },
    { no: 25, name: 'KOREA 5중', db: 1, sql: `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE edp_root_category='Milling' AND material_tags && ARRAY['P']::text[] AND search_diameter_mm BETWEEN 8 AND 12 AND milling_number_of_flute='4' AND search_coating ILIKE '%TiAlN%' AND COALESCE(milling_overall_length::numeric, option_overall_length::numeric)>=100 AND 'KR'=ANY(country_codes) ORDER BY normalized_code, edp_idx DESC) x` },
  ];

  console.log('No  | DB    | 직접쿼리 | match');
  console.log('----+-------+----------+------');
  for (const cs of cases) {
    try {
      const r = await c.query(cs.sql);
      const got = +r.rows[0].count;
      const match = got === cs.db ? '✅' : Math.abs(got - cs.db) <= 5 ? '⚠️' : '❌';
      console.log(String(cs.no).padStart(2) + '  | ' + String(cs.db).padEnd(5) + ' | ' + String(got).padEnd(8) + ' | ' + match + ' ' + cs.name);
    } catch (e) {
      console.log(String(cs.no).padStart(2) + '  | ' + String(cs.db).padEnd(5) + ' | ERR      | ' + e.message.slice(0, 60) + ' — ' + cs.name);
    }
  }
  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
