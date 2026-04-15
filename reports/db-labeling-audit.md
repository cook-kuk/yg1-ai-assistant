
# DB 라벨링 전수 조사 — product_recommendation_mv (총 125,342 건)

- MV 컬럼 총 86개 발견

## 조사 1A — NULL/빈값 비율

| 논리 컬럼 | 실제 MV 컬럼 | type | total | null수 | null% | 판정 |
|---|---|---|---:|---:|---:|---|
| brand | edp_brand_name | text | 125342 | 0 | 0.0% | 🟢 |
| brand | series_brand_name | text | 125342 | 38803 | 31.0% | 🟡 |
| material_tags | material_tags | text[] | 125342 | 44147 | 35.2% | 🟡 |
| tool_type | series_tool_type | text | 125342 | 79512 | 63.4% | 🟠 |
| product_type | series_product_type | text | 125342 | 109754 | 87.6% | 🔴 |
| application_shape | series_application_shape | text | 125342 | 72902 | 58.2% | 🟠 |
| cutting_edge_shape | series_cutting_edge_shape | text | 125342 | 76645 | 61.1% | 🟠 |
| cutting_edge_shape | search_subtype | text | 125342 | 55626 | 44.4% | 🟡 |
| shank_type | series_shank_type | text | 125342 | 57793 | 46.1% | 🟡 |
| shank_type | search_shank_type | text | 125342 | 34551 | 27.6% | 🟡 |
| diameter_mm | search_diameter_mm | numeric | 125342 | 23973 | 19.1% | 🟢 |
| diameter_mm | milling_outside_dia | text | 125342 | 76918 | 61.4% | 🟠 |
| diameter_mm | holemaking_outside_dia | text | 125342 | 104406 | 83.3% | 🔴 |
| diameter_mm | threading_outside_dia | text | 125342 | 106364 | 84.9% | 🔴 |
| flute_count | milling_number_of_flute | text | 125342 | 77752 | 62.0% | 🟠 |
| flute_count | holemaking_number_of_flute | text | 125342 | 104757 | 83.6% | 🔴 |
| flute_count | threading_number_of_flute | text | 125342 | 106164 | 84.7% | 🔴 |
| length_of_cut | milling_length_of_cut | text | 125342 | 79143 | 63.1% | 🟠 |
| length_of_cut | holemaking_flute_length | text | 125342 | 104897 | 83.7% | 🔴 |
| overall_length | milling_overall_length | text | 125342 | 78164 | 62.4% | 🟠 |
| overall_length | holemaking_overall_length | text | 125342 | 104405 | 83.3% | 🔴 |
| overall_length | threading_overall_length | text | 125342 | 105736 | 84.4% | 🔴 |
| shank_diameter | milling_shank_dia | text | 125342 | 78852 | 62.9% | 🟠 |
| shank_diameter | holemaking_shank_dia | text | 125342 | 106625 | 85.1% | 🔴 |
| shank_diameter | threading_shank_dia | text | 125342 | 106277 | 84.8% | 🔴 |
| neck_diameter | milling_neck_diameter | text | 125342 | 121972 | 97.3% | 🔴 |
| effective_length | milling_effective_length | text | 125342 | 123442 | 98.5% | 🔴 |
| ball_radius | milling_ball_radius | text | 125342 | 117540 | 93.8% | 🔴 |
| helix_angle | milling_helix_angle | text | 125342 | 78283 | 62.5% | 🟠 |
| helix_angle | holemaking_helix_angle | text | 125342 | 106771 | 85.2% | 🔴 |
| taper_angle | milling_taper_angle | text | 125342 | 124789 | 99.6% | 🔴 |
| taper_angle | holemaking_taper_angle | text | 125342 | 125342 | 100.0% | 🔴 |
| point_angle | holemaking_point_angle | — | — | — | — | ❌MISSING |
| thread_pitch | threading_pitch | — | — | — | — | ❌MISSING |
| thread_tpi | threading_tpi | — | — | — | — | ❌MISSING |
| coating | search_coating | text | 125342 | 43144 | 34.4% | 🟡 |
| coating | milling_coating | text | 125342 | 83211 | 66.4% | 🟠 |
| coating | holemaking_coating | text | 125342 | 104243 | 83.2% | 🔴 |
| coating | threading_coating | text | 125342 | 106374 | 84.9% | 🔴 |
| tool_material | milling_tool_material | text | 125342 | 76620 | 61.1% | 🟠 |
| tool_material | holemaking_tool_material | text | 125342 | 104006 | 83.0% | 🔴 |
| tool_material | threading_tool_material | text | 125342 | 106310 | 84.8% | 🔴 |

## 조사 1B — 값 정규화 불일치


### brand (edp_brand_name) — distinct 79개
| normalized-key | 표기 변형 (count) |
|---|---|
| `x5070` | `X5070`(1391) / `X5070 S`(927) |
| `titanoxpower` | `TitaNox-Power`(1081) / `TITANOX-POWER`(108) |
- top: `Tooling System`(31497), `4G MILL`(14492), `GENERAL HSS`(6880), `STRAIGHT SHANK DRILLS`(5572), `COMBO TAPS`(4988), `SPIRAL POINT TAPS`(4189), `DREAM DRILLS-GENERAL`(3980), `WIDE-CUT for Korean Market`(3663), `GENERAL CARBIDE`(2997), `HAND TAPS`(2678), `Milling Insert`(2306), `MORSE TAPER SHANK DRILLS`(2004), `DREAM DRILLS-INOX`(1677), `STRAIGHT FLUTE TAPS`(1672), `K-2 CARBIDE`(1638)

### brand(series) (series_brand_name) — distinct 97개
| normalized-key | 표기 변형 (count) |
|---|---|
| `combotap` | `COMBO TAP`(3899) / `COMBO TAPS`(74) |
| `x5070` | `X5070`(1391) / `X5070 S`(927) |
| `morsetapershankdrill` | `MORSE TAPER SHANK DRILL`(1288) / `MORSE TAPER SHANK DRILLS`(39) |
| `titanoxpower` | `TitaNox-Power`(1081) / `TITANOX-POWER`(108) |
| `threadmill` | `THREAD MILL`(539) / `THREAD MILLS`(98) |
| `primetap` | `PRIME TAP`(516) / `PRIME TAPS`(16) |
- top: `4G MILL`(14492), `GENERAL HSS`(6363), `STRAIGHT SHANK DRILL`(5572), `COMBO TAP`(3899), `YG TAP GENERAL`(3470), `WIDE-CUT for Korean Market`(3231), `GENERAL CARBIDE`(2997), `DREAM DRILL-GENERAL`(2492), `Milling Insert`(2306), `K-2 CARBIDE`(1638), `V7 PLUS`(1620), `DREAM DRILLS-INOX`(1572), `3S MILL`(1489), `DREAM DRILLS-GENERAL`(1488), `X5070`(1391)

### tool_type (series_tool_type) — distinct 3개
- ✅ 정규화 이슈 없음
- top: `Solid`(42536), `Indexable_Tools`(2025), `undefined`(1269)

### product_type (series_product_type) — distinct 2개
- ✅ 정규화 이슈 없음
- top: `NONE`(14434), `Center_Drill`(1154)

### application_shape (series_application_shape) — distinct 43개
| normalized-key | 표기 변형 (count) |
|---|---|
| `sidemilling` | `Side Milling`(249) / `Side_Milling`(46) |
- top: `Helical Interpolation`(12184), `Taper Side Milling`(8182), `Slotting`(6666), `Facing`(6115), `Trochoidal`(4868), `Die-Sinking`(2346), `Profiling`(2311), `Small Part`(1632), `Die-Sinking,Facing,Side_Milling,Slotting,Small_Part`(1618), `Side_Milling,Slotting,Die-Sinking,Small_Part,Facing`(1046), `Corner_Radius,Die-Sinking,Facing,Helical_Interpolation,Side_Milling,Slotting,Small_Part`(843), `Die-Sinking,Facing,Side_Milling,Slotting,Small_Part,Trochoidal`(583), `Die-Sinking,Facing,Side_Milling,Slotting`(568), `Profiling,Side_Milling,Small_Part`(511), `Side_Milling,Slotting,Die-Sinking,Corner_Radius,Small_Part,Facing,Helical_Interpolation`(457)

### cutting_edge_shape (series_cutting_edge_shape) — distinct 33개
| normalized-key | 표기 변형 (count) |
|---|---|
| `square` | `Square`(17788) / `SQUARE`(732) |
| `cornerradiu` | `Corner Radius`(10703) / `Corner_Radius`(250) |
| `ball` | `Ball`(7400) / `BALL`(10) |
- top: `Square`(17788), `Corner Radius`(10703), `Ball`(7400), `Roughing`(3363), `RADIUS`(2401), `Taper Radius`(1620), `Taper Square`(1092), `SQUARE`(732), `Taper Ball`(532), `10°`(483), `Roughing & Finishing`(397), `Round`(358), `Side & Face Cutter`(266), `Corner_Radius`(250), `Woodruff Cutter`(228)

### search_subtype (search_subtype) — distinct 53개
| normalized-key | 표기 변형 (count) |
|---|---|
| `square` | `Square`(18956) / `SQUARE`(548) |
| `cornerradiu` | `Corner Radius`(13355) / `Corner_Radius`(22) |
| `ball` | `Ball`(7872) / `BALL`(16) |
| `spiralflute` | `Spiral Flute`(7093) / `SPIRAL_FLUTE`(44) / `Spiral flute`(43) |
| `gunpoint` | `Gun Point`(6629) / `GUN_POINT`(33) |
| `straightflute` | `Straight Flute`(2627) / `STRAIGHT_FLUTE`(33) |
| `radiu` | `Radius`(572) / `RADIUS`(26) |
| `roughing` | `ROUGHING`(266) / `Roughing`(78) |
| `43°` | `43° `(36) / `43°`(4) |
- top: `Square`(18956), `Corner Radius`(13355), `Ball`(7872), `Spiral Flute`(7093), `Gun Point`(6629), `Roughing Normal`(2751), `Straight Flute`(2627), `Hand Tap`(1729), `Taper Radius`(1380), `Taper Square`(1092), `Normal Thread Mill`(710), `Radius`(572), `SQUARE`(548), `10°`(483), `Roughing & Finishing`(362)

### search_coating (search_coating) — distinct 42개
| normalized-key | 표기 변형 (count) |
|---|---|
| `steamhomo` | `Steam Homo`(6454) / `Steam homo`(945) / `Steam Homo `(884) |
| `altin` | `AlTiN`(1915) / `ALTIN`(453) |
| `diamond` | `Diamond`(1035) / `DIAMOND`(97) / `Diamond `(66) |
| `nitride,steamhomo` | `Nitride, Steam Homo`(172) / `Nitride, Steam Homo `(151) |
| `bright` | `Bright`(50) / ` Bright`(21) |
- top: `Y-Coating`(19821), `Bright Finish`(15739), `TiAlN`(12483), `Steam Homo`(6454), `X-Coating`(2447), `Blue-Coating`(2318), `TiN Coating`(1992), `AlTiN`(1915), `Coloring`(1683), `T-Coating`(1472), `Hardslick Coating`(1389), `TiN Tip`(1387), `H-Coating`(1335), `DLC`(1315), `TiAlN Coating`(1259)

### milling_coating (milling_coating) — distinct 19개
| normalized-key | 표기 변형 (count) |
|---|---|
| `altin` | `AlTiN`(1915) / `ALTIN`(453) |
| `diamond` | `Diamond`(1035) / `Diamond `(66) |
- top: `Y-Coating`(19821), `Bright Finish`(5914), `TiAlN`(4347), `Blue-Coating`(2318), `AlTiN`(1915), `T-Coating`(1472), `X-Coating`(1376), `DLC`(1137), `Diamond`(1035), `TiCN`(943), `Steam Homo`(474), `ALTIN`(453), `TiN`(448), `UNCOATED`(149), `Z-Coating`(96)

### milling_tool_material (milling_tool_material) — distinct 11개
- ✅ 정규화 이슈 없음
- top: `Carbide`(44427), `NGHM`(1818), `HSS`(1209), `HSS-PM`(431), `HSS-Co8`(373), `Alloy Steel`(301), `PCD`(58), `CBN`(42), `HSS-CO8(M42)`(29), `PM60`(18), `T15`(16)

### search_shank_type (search_shank_type) — distinct 71개
| normalized-key | 표기 변형 (count) |
|---|---|
| `morsetaper` | `Morse_Taper`(310) / `Morse Taper`(39) |
| `din69893iso121641hskforme` | `DIN69893/ISO12164-1-HSK FORM E`(259) / `DIN69893/ISO12164-1-HSK FORM E `(143) |
- top: `Plain (YG-1 Standard)`(37336), `Plain`(15840), `0`(8011), `Slot`(3856), `JISB6339/MAS403-BT`(3698), `Flat (DIN 1835B)`(3593), `Flat (YG-1 Standard)`(2673), `DIN69893/ISO12164-1-HSK FORM A`(2580), `DIN69871-SK`(2390), `CBT (BT DUAL CONTACT)`(2134), `NONE`(1280), `Plain (DIN 6535HA)`(896), `Accessory`(774), `Flat (DIN 6535HB)`(750), `Flat (BS)`(593)

## 조사 1B-2 — material_tags (array) 값 분포

- distinct tags: 6
| tag | count |
|---|---:|
| P | 73198 |
| K | 56087 |
| M | 39679 |
| H | 37207 |
| N | 31227 |
| S | 18886 |

## 조사 1C — 수치 이상값

| 컬럼 | 유효범위 | numeric 변환 실패 | 범위 밖 | 샘플 이상값 |
|---|---|---:|---:|---|
| search_diameter_mm | (0, 1000) | 0 | 371 | 1048.3850, 1048.3850, 1129.030, 1129.030, 1209.6750 |
| milling_outside_dia | (0, 1000) | 0 | 320 | `0`, `0`, `0`, `0`, `0` |
| holemaking_outside_dia | (0, 1000) | 0 | 0 |  |
| milling_number_of_flute | (0, 20) | 79 | 166 | `Multi Flute`, `Multi Flute`, `Multi Flute`, `Multi Flute`, `Multi Flute` |
| holemaking_number_of_flute | (0, 20) | 0 | 0 |  |
| milling_overall_length | (0, 2000) | 0 | 0 |  |
| holemaking_overall_length | (0, 2000) | 0 | 0 |  |
| milling_length_of_cut | (0, 2000) | 0 | 0 |  |
| milling_shank_dia | (0, 1000) | 0 | 0 |  |
| milling_neck_diameter | (0, 1000) | 1 | 59 | `-`, `0`, `0`, `0`, `0` |
| milling_ball_radius | (-0.01, 50) | 0 | 127 | `R.062`, `R.062`, `R.062`, `R.062`, `R.062` |
| milling_helix_angle | (-0.01, 90) | 1526 | 0 | `Multiple`, `Multiple`, `Multiple`, `Multiple`, `Multiple` |
| milling_taper_angle | (-0.01, 360) | 0 | 0 |  |
| holemaking_point_angle | — | MISSING | | |
| threading_pitch | — | MISSING | | |

## 조사 2A — MV가 참조하는 소스 테이블

- MV definition 참조: 13개
  - `country_sources`
  - `dedup_edp`
  - `edp_countries`
  - `ranked_edp`
  - `raw_catalog.prod_edp`
  - `raw_catalog.prod_edp_option_holemaking`
  - `raw_catalog.prod_edp_option_milling`
  - `raw_catalog.prod_edp_option_threading`
  - `raw_catalog.prod_edp_option_tooling`
  - `raw_catalog.prod_edp_option_turning`
  - `raw_catalog.prod_series`
  - `raw_catalog.prod_series_work_material_status`
  - `series_materials`

## 조사 2B — 조인 가능 후보 테이블 (raw_catalog + catalog_app 전수)

- 총 41개
| schema.table | type | 조인키 존재 | 키 |
|---|---|---|---|
| catalog_app.brand_reference | BASE TABLE | ✅ | brand_name, series_name |
| catalog_app.conversations | BASE TABLE | — |  |
| catalog_app.inventory_snapshot | BASE TABLE | ✅ | edp, normalized_edp |
| catalog_app.iso_detail_reference | BASE TABLE | — |  |
| catalog_app.loader_file_state | BASE TABLE | — |  |
| catalog_app.new_brand_reference | BASE TABLE | ✅ | brand_name |
| catalog_app.tool_memory | BASE TABLE | — |  |
| raw_catalog.cutting_condition_table | BASE TABLE | ✅ | series_name |
| raw_catalog.feedback_general_entries_20260324t063916z | BASE TABLE | — |  |
| raw_catalog.feedback_general_entries_20260325t185511z | BASE TABLE | — |  |
| raw_catalog.feedback_general_entries_with_conversation_20260325t190511z | BASE TABLE | — |  |
| raw_catalog.iso_detail_list | BASE TABLE | — |  |
| raw_catalog.kennametal_alu_cut_data_clean | BASE TABLE | ✅ | series_code |
| raw_catalog.kennametal_alu_cut_to_product_recommendation_mv_mapping | BASE TABLE | — |  |
| raw_catalog.new_brand | BASE TABLE | ✅ | brand_name |
| raw_catalog.opinion_entries_20260324t064044z | BASE TABLE | — |  |
| raw_catalog.opinion_entries_20260325t185511z | BASE TABLE | — |  |
| raw_catalog.opinion_entries_with_conversation_20260325t190511z | BASE TABLE | — |  |
| raw_catalog.prod_brand | BASE TABLE | ✅ | brand_name |
| raw_catalog.prod_brand_sub | BASE TABLE | ✅ | brand_name |
| raw_catalog.prod_category | BASE TABLE | — |  |
| raw_catalog.prod_category_sub | BASE TABLE | — |  |
| raw_catalog.prod_edp | BASE TABLE | ✅ | brand_name, series_idx, series_name, edp_no |
| raw_catalog.prod_edp_option_holemaking | BASE TABLE | ✅ | edp_no, brand_name, series_idx, series_name |
| raw_catalog.prod_edp_option_milling | BASE TABLE | ✅ | edp_no, brand_name, series_idx, series_name |
| raw_catalog.prod_edp_option_threading | BASE TABLE | ✅ | edp_no, brand_name, series_idx, series_name |
| raw_catalog.prod_edp_option_tooling | BASE TABLE | ✅ | edp_no, brand_name, series_idx, series_name |
| raw_catalog.prod_edp_option_turning | BASE TABLE | ✅ | edp_no, brand_name, series_idx, series_name |
| raw_catalog.prod_edp_sub_name | BASE TABLE | — |  |
| raw_catalog.prod_icons | BASE TABLE | — |  |
| raw_catalog.prod_series | BASE TABLE | ✅ | brand_name, series_name |
| raw_catalog.prod_series_icons | BASE TABLE | — |  |
| raw_catalog.prod_series_sub | BASE TABLE | ✅ | series_name |
| raw_catalog.prod_series_work_material_status | BASE TABLE | — |  |
| raw_catalog.prod_sub_category | BASE TABLE | — |  |
| raw_catalog.prod_sub_category_sub | BASE TABLE | — |  |
| raw_catalog.prod_type_manage_item | BASE TABLE | — |  |
| raw_catalog.prod_type_manage_list | BASE TABLE | ✅ | series_idx |
| raw_catalog.prod_work_piece_by_category | BASE TABLE | — |  |
| raw_catalog.yg1_stock_data | BASE TABLE | ✅ | edp |
| raw_catalog.yg_1_reference_brand | BASE TABLE | ✅ | brand_name, series_name |

## 조사 2C — 주요 보조 테이블 매칭률

- MV distinct edp_no: 64,589
- MV distinct series_idx: 1,938

### raw_catalog.cutting_condition_table — 절삭조건 (RPM/feed)
- 컬럼 (14): _row_num, application_shape, series_name, tag_name, hardness_min_hrc, hardness_max_hrc, work_piece_name, diameter_mm, radial_depth_of_cut, axial_depth_of_cut, feed_rate, feed_per_tooth, spindle_speed, cutting_speed
- 총 레코드: 158
- MV→cutting_condition 매칭 (by series_name): 5/1936 = 0.3%

### catalog_app.inventory_snapshot — 재고 스냅샷
- 컬럼 (14): raw_row_num, edp, normalized_edp, description, spec, warehouse_or_region, quantity, snapshot_date, snapshot_date_text, price, currency, unit, source_file, created_at
- 총 레코드: 115,111
- MV→이 테이블 매칭 (by edp): 24705/64589 = 38.2%

### raw_catalog.yg1_stock_data — YG-1 재고
- 컬럼 (10): _row_num, edp, description, spec, price, currency, unit, warehouse_or_region, snapshot_date, quantity
- 총 레코드: 115,111
- MV→이 테이블 매칭 (by edp): 24705/64589 = 38.2%

### raw_catalog.prod_edp — 기본 EDP
- 컬럼 (90): _row_num, idx, root_category, category_idx, brand_idx, brand_name, series_idx, series_name, edp_no, your_code, file1, file2, file3, dxf, dxf_name, stp, stp_name, unit, option_od, option_r, option_sd, option_loc, option_oal, option_flute, option_z, option_dc, option_dcx, option_lf, option_dcon, option_cbdp, option_dcsfms, option_apmx, option_drill_diameter, option_shank_diameter, option_flute_length, option_overall_length, option_length, option_depth_of_hole, option_d1, option_size, option_pitch, option_tpi, option_designation, option_re, option_l, option_ic, option_s, option_lbs, option_chip_breaker, option_model_no, option_grade, option_d, option_clamping_range, option_nut_collet, option_taper_no, flag_del, flag_save, flag_show, reg_id, reg_dtm, modi_id, modi_dtm, option_thread_shape, option_pitch_tpi, option_thread_tolerance_class, option_chamfer_length, option_coolant, option_hand, option_dmin, option_h, option_b, option_wf, option_insert, option_cw, option_cdx, option_series, option_series_description, option_series_filter, option_chip_breaker_description, option_loc_1, option_lbs_1, option_tolofmilldia, option_tolofshankdia, option_taperangle, option_coolanthole, option_threadlength, option_shankdia, option_squaresize, option_numberofflute, option_connection_type
- 총 레코드: 656,543
- MV→이 테이블 매칭 (by edp_no): 64589/64589 = 100.0%

### raw_catalog.prod_series — 시리즈 마스터
- 컬럼 (42): _row_num, idx, root_category, category_idx, brand_idx, brand_name, series_name, description, feature, file1, file1_name, series_icon_idx, application_shape_icon_idx, work_piece_idx, tool_type, sales, application_shape, cutting_edge_shape, shank_type, product_type, cooling_type, hole_type, thread_direction, geometry, machining_condition, country, category, sti, file_pic, file_pic_name, file_dra, file_dra_name, unit, type_idx, flag_del, flag_save, flag_show_ecatalog, flag_show, reg_id, reg_dtm, modi_id, modi_dtm
- 총 레코드: 23,193
- ⚠️ 조인키 없음 / 수동 검토 필요

### raw_catalog.prod_series_work_material_status — 피삭재 상태
- 컬럼 (14): _row_num, idx, prod_series_idx, prod_work_piece_idx, tag_name, work_piece_name, status, flag_del, flag_save, flag_show, reg_id, reg_dtm, modi_id, modi_dtm
- 총 레코드: 96,976
- ⚠️ 조인키 없음 / 수동 검토 필요

### raw_catalog.prod_edp_option_milling — 밀링 옵션(이미 조인)
- 컬럼 (104): _row_num, idx, category_type, country, edp_no, option_milling_uncoatingno, option_milling_cuttingedgeshape, option_milling_roughingfinishtype, option_milling_outsidedia, option_milling_shankdia, option_milling_lengthofcut, option_milling_overalllength, option_milling_numberofflute, option_milling_radiusall, option_milling_radius1, option_milling_radius2, option_milling_radiusofballnose, option_milling_lengthbelowshank, option_milling_singledoubleend, option_milling_shanktype, option_milling_taperangle, option_milling_odsizeofset, option_milling_qtyofset, option_milling_internaldia, option_milling_widthofcutter, option_milling_toolmaterial, option_milling_helixangle, option_milling_tolofradius, option_milling_tolofmilldia, option_milling_tolofshankdia, option_milling_coating, option_milling_geometrystandard, option_milling_cuttershape, option_milling_neckdiameter, option_milling_underneckparallellength, option_milling_extracuttingedgelength_lz, option_milling_jpg_select, option_milling_app_cc, option_milling_app_ts, option_milling_app_dxf, option_milling_app_tr, option_milling_cuttingdirection, option_milling_thread, option_milling_wrenchwidth, option_milling_coolanthole, option_milling_thickness, option_milling_torx, option_milling_match, option_milling_screw, option_milling_isdel, option_milling_outsidedia_1, option_milling_shankdia_1, option_milling_lengthofcut_1, option_milling_overalllength_1, option_milling_radiusall_1, option_milling_radius1_1, option_milling_lengthbelowshank_1, option_milling_numberofflute_img, option_milling_coolant, option_milling_oil_mist, option_milling_air, option_milling_dry, option_milling_connection_type, option_milling_number_of_effective_teeth, option_milling_cutter_diameter, option_milling_cutter_diameter_external, option_milling_effective_length, option_milling_connection_size, option_milling_connection_bore_depth, option_milling_flange_diameter, option_milling_maximum_cutting_depth, option_milling_designation, option_milling_re_mm, option_milling_bs_mm, option_milling_le, option_milling_insd, option_milling_krins, option_milling_as, option_milling_ic, option_milling_s, option_milling_chipbreaker, option_milling_yg602, option_milling_yg200, option_milling_cfrp, option_milling_gfrp, option_milling_kfrp, option_milling_honeycomb, option_milling_gantry, option_milling_robot, brand_idx, brand_name, series_idx, series_name, dxf, dxf_name, stp, stp_name, yourcode, unit, flag_del, reg_id, reg_dtm, modi_id, modi_dtm
- 총 레코드: 95,557
- MV→이 테이블 매칭 (by edp_no): 33728/64589 = 52.2%

### raw_catalog.prod_edp_option_holemaking — 홀메이킹(이미 조인)
- 컬럼 (101): _row_num, idx, category_type, country, edp_no, option_holemaking_uncoatingno, option_holemaking_outsidedia, option_holemaking_wireguage, option_holemaking_letter, option_holemaking_fractional, option_holemaking_shankdia, option_holemaking_mtno, option_holemaking_overalllength, option_holemaking_flutelength, option_holemaking_flutelengthtype, option_holemaking_numberofflute, option_holemaking_shanktype, option_holemaking_odsizeofset, option_holemaking_qtyofset, option_holemaking_toolmaterial, option_holemaking_helixangle, option_holemaking_tolofdrilldia, option_holemaking_tolofshankdia, option_holemaking_coating, option_holemaking_standarddrilltype, option_holemaking_csinkangle, option_holemaking_pointangle, option_holemaking_thinningtype, option_holemaking_coolanthole, option_holemaking_jpg_select, option_holemaking_app_cc, option_holemaking_app_ts, option_holemaking_app_dxf, option_holemaking_app_tr, option_holemaking_holeshape, option_holemaking_radius, option_holemaking_cutting_direction, option_holemaking_drilling_depth, option_holemaking_outsidedia_1, option_holemaking_shankdia_1, option_holemaking_overalllength_1, option_holemaking_flutelength_1, option_holemaking_pointtood, option_holemaking_maxdrillingdepth, option_holemaking_flutelengthdecimal, option_holemaking_qmetricodinch, option_holemaking_centerdshape, option_holemaking_wireguageorder, option_holemaking_designation, option_holemaking_chipbreaker, option_holemaking_yg602, option_holemaking_ic, option_holemaking_s, option_holemaking_pilotdia, option_holemaking_csinkdia, option_holemaking_holder_shank_length, option_holemaking_holder_flange_dia, option_holemaking_cfrp, option_holemaking_gfrp, option_holemaking_cfrp_alu, option_holemaking_cfrp_tita, option_holemaking_gantry, option_holemaking_hand_held, option_holemaking_power_feed, option_holemaking_robot, option_holemaking_outsidedia_text, option_holemaking_outsidedia_inch, option_holemaking_standard, option_holemaking_reamer_diameter, option_holemaking_decimal_equivalent, option_holemaking_large_diameter, option_holemaking_small_diameter, option_holemaking_shank_diameter, option_holemaking_cutting_edge_length, option_holemaking_over_all_length, option_holemaking_length_below_shank, option_holemaking_no_of_flute, option_holemaking_shank_type, option_holemaking_taper_angle, option_holemaking_tool_material, option_holemaking_surface_finish, option_holemaking_helix_direction, option_holemaking_tol_of_od, option_holemaking_tol_of_shank_dia, option_holemaking_chamfer_angle, option_holemaking_chamfer_length, brand_idx, brand_name, series_idx, series_name, dxf, dxf_name, stp, stp_name, yourcode, unit, flag_del, reg_id, reg_dtm, modi_id, modi_dtm
- 총 레코드: 52,249
- MV→이 테이블 매칭 (by edp_no): 12158/64589 = 18.8%

### raw_catalog.prod_edp_option_threading — 쓰레딩(이미 조인)
- 컬럼 (66): _row_num, idx, category_type, country, edp_no, option_threading_size, option_threading_outsidedia, option_threading_pitch, option_threading_tpi, option_threading_coarsefine, option_threading_geometrystandard, option_threading_threadshape, option_threading_flutetype, option_threading_pitch_tpi, option_threading_sti, option_threading_squaresize, option_threading_squarelength, option_threading_tappingdrilldia, option_threading_chamferlength, option_threading_threadangle, option_threading_threadclass, option_threading_threaddirection, option_threading_flutedirection, option_threading_holeshape, option_threading_shankdia, option_threading_threadlength, option_threading_necklength, option_threading_overalllength, option_threading_oilgroove, option_threading_numberofflute, option_threading_longdesc, option_threading_toolmaterial, option_threading_spiralangle, option_threading_coating, option_threading_coolanthole, option_threading_projectionlength, option_threading_jpg_select, option_threading_app_cc, option_threading_app_ts, option_threading_app_dxf, option_threading_app_tr, option_threading_ds, option_threading_d3, option_threading_d4, option_threading_ls, option_threading_l3, option_threading_sizeorder, option_threading_internal_external, option_threading_cuttingdirection, option_threading_angle, option_threading_flutetypeorder, brand_idx, brand_name, series_idx, series_name, dxf, dxf_name, stp, stp_name, yourcode, unit, flag_del, reg_id, reg_dtm, modi_id, modi_dtm
- 총 레코드: 33,044
- MV→이 테이블 매칭 (by edp_no): 15452/64589 = 23.9%

### raw_catalog.prod_edp_option_turning — 터닝 (MV에서 누락)
- 컬럼 (56): _row_num, idx, category_type, country, edp_no, option_turning_grade, option_turning_grade_order, option_turning_chip_breaker, option_turning_chipbreaker_order, option_turning_p_n, option_turning_designation, option_turning_size, option_turning_full_designation, option_turning_re, option_turning_l, option_turning_le, option_turning_insd, option_turning_ic, option_turning_s, option_turning_chip_breaker_description, option_turning_work_piece, option_turning_external_internal, option_turning_category, option_turning_series_description, option_turning_series_filter, option_turning_series_drawing, option_turning_series_image, option_turning_coolant, option_turning_hand, option_turning_dmin, option_turning_dcon, option_turning_h, option_turning_b, option_turning_wf, option_turning_lf, option_turning_insert, option_turning_cw, option_turning_cdx, option_turning_re_1, option_turning_cw_1, option_turning_cdx1, brand_idx, brand_name, series_idx, series_name, dxf, dxf_name, stp, stp_name, yourcode, unit, flag_del, reg_id, reg_dtm, modi_id, modi_dtm
- 총 레코드: 78,754
- MV→이 테이블 매칭 (by edp_no): 0/64589 = 0.0%

### raw_catalog.prod_icons — 아이콘
- 컬럼 (17): _row_num, idx, root_category, icon_type, icon_name, icon_value, icon_value2, icon_value3, file1, order, flag_del, flag_save, flag_show, reg_id, reg_dtm, modi_id, modi_dtm
- 총 레코드: 832
- ⚠️ 조인키 없음 / 수동 검토 필요

### raw_catalog.prod_series_icons — 시리즈 아이콘
- 컬럼 (13): _row_num, idx, prod_series_idx, prod_icons_idx, icon_type, icon_name, flag_del, flag_save, flag_show, reg_id, reg_dtm, modi_id, modi_dtm
- 총 레코드: 103,888
- ⚠️ 조인키 없음 / 수동 검토 필요

### raw_catalog.iso_detail_list — ISO 상세
- 컬럼 (3): _row_num, work_piece_name, tag_name
- 총 레코드: 37
- ⚠️ 조인키 없음 / 수동 검토 필요

### raw_catalog.kennametal_alu_cut_data_clean — 경쟁사 Kennametal Alu-Cut
- 컬럼 (35): _row_num, source_type, page, table_index, row_index, product_line, series_code, end_type, neck_type, coolant_type, flute_count, length_type, shank_type, table_context, page_title, pdf_file, image_path, markdown_path, catalog_number, d1, d, ap1_max, l, k600, grade, p, m, k, n, s, h, r, d3, l3, re
- 총 레코드: 134
- ⚠️ 조인키 없음 / 수동 검토 필요

### raw_catalog.prod_work_piece_by_category — 피삭재-카테고리
- 컬럼 (28): _row_num, idx, root_category, tag_name, file1, name, name_kor, name_deu, name_pol, name_prt, name_rus, name_jpn, name_chn, name_ita, name_fra, name_tur, name_cze, name_hun, name_tha, name_vnm, name_esp, flag_del, flag_save, flag_show, reg_id, reg_dtm, modi_id, modi_dtm
- 총 레코드: 73
- ⚠️ 조인키 없음 / 수동 검토 필요

## 조사 3 — 피삭재 ↔ 브랜드 매핑 실태 (material_tags 기반)


### 구리/Copper (기대 브랜드: CRX S / CRX-S)
- 매칭 태그: 없음

### 알루미늄/Aluminum (기대 브랜드: Alu-Cut / Alu-Power)
- 매칭 태그: 없음

### 티타늄/Titanium (기대 브랜드: Titanox Power)
- 매칭 태그: 없음

### 스테인리스/Stainless (기대 브랜드: (검증대상))
- 매칭 태그: 없음

### 주철/Cast Iron (기대 브랜드: (검증대상))
- 매칭 태그: 없음

### 열처리강/Hardened (기대 브랜드: (검증대상))
- 매칭 태그: 없음

### 탄소강/Carbon Steel (기대 브랜드: (검증대상))
- 매칭 태그: 없음

# 끝
