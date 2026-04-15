# DB 라벨링 전수 조사 — 보완편

## A. product_recommendation_mv 실제 컬럼 86개

- `edp_idx` (text)
- `edp_no` (text)
- `edp_brand_name` (text)
- `edp_series_name` (text)
- `edp_series_idx` (text)
- `edp_root_category` (text)
- `edp_unit` (text)
- `option_z` (text)
- `option_numberofflute` (text)
- `option_drill_diameter` (text)
- `option_d1` (text)
- `option_dc` (text)
- `option_d` (text)
- `option_shank_diameter` (text)
- `option_dcon` (text)
- `option_flute_length` (text)
- `option_loc` (text)
- `option_overall_length` (text)
- `option_oal` (text)
- `option_r` (text)
- `option_re` (text)
- `option_tolofmilldia` (text)
- `option_tolofshankdia` (text)
- `option_taperangle` (text)
- `option_coolanthole` (text)
- `series_row_idx` (text)
- `series_brand_name` (text)
- `series_description` (text)
- `series_feature` (text)
- `series_tool_type` (text)
- `series_product_type` (text)
- `series_application_shape` (text)
- `series_cutting_edge_shape` (text)
- `series_shank_type` (text)
- `country` (text)
- `country_codes` (text[])
- `material_tags` (text[])
- `milling_outside_dia` (text)
- `milling_number_of_flute` (text)
- `milling_coating` (text)
- `milling_tool_material` (text)
- `milling_shank_dia` (text)
- `milling_shank_type` (text)
- `milling_length_of_cut` (text)
- `milling_overall_length` (text)
- `milling_helix_angle` (text)
- `milling_ball_radius` (text)
- `milling_diameter_tolerance` (text)
- `milling_shank_diameter_tolerance` (text)
- `milling_taper_angle` (text)
- `milling_neck_diameter` (text)
- `milling_effective_length` (text)
- `milling_coolant_hole` (text)
- `milling_cutting_edge_shape` (text)
- `milling_cutter_shape` (text)
- `holemaking_outside_dia` (text)
- `holemaking_number_of_flute` (text)
- `holemaking_coating` (text)
- `holemaking_tool_material` (text)
- `holemaking_shank_dia` (text)
- `holemaking_flute_length` (text)
- `holemaking_overall_length` (text)
- `holemaking_helix_angle` (text)
- `holemaking_diameter_tolerance` (text)
- `holemaking_shank_diameter_tolerance` (text)
- `holemaking_length_below_shank` (text)
- `holemaking_taper_angle` (text)
- `holemaking_coolant_hole` (text)
- `threading_outside_dia` (text)
- `threading_number_of_flute` (text)
- `threading_coating` (text)
- `threading_tool_material` (text)
- `threading_shank_dia` (text)
- `threading_thread_length` (text)
- `threading_overall_length` (text)
- `threading_l3` (text)
- `threading_coolant_hole` (text)
- `threading_flute_type` (text)
- `threading_thread_shape` (text)
- `tooling_shank_type` (text)
- `tooling_back_bore_l3` (text)
- `normalized_code` (text)
- `search_diameter_mm` (numeric)
- `search_coating` (text)
- `search_subtype` (text)
- `search_shank_type` (text)

### 누락 의혹 컬럼 재확인:
- holemaking_point_angle: ❌ 없음
- threading_pitch: ❌ 없음
- threading_tpi: ❌ 없음
- point_angle: ❌ 없음

## B. ISO material group (P/K/M/N/S/H) × 브랜드 분포


### P — (강/Steel)
- 레코드: 73,198
| brand | count | share |
|---|---:|---:|
| 4G MILL | 14492 | 19.8% |
| GENERAL HSS | 6849 | 9.4% |
| STRAIGHT SHANK DRILLS | 5019 | 6.9% |
| COMBO TAPS | 4029 | 5.5% |
| DREAM DRILLS-GENERAL | 3946 | 5.4% |
| WIDE-CUT for Korean Market | 3231 | 4.4% |
| GENERAL CARBIDE | 2876 | 3.9% |
| SPIRAL POINT TAPS | 2466 | 3.4% |
| DREAM DRILLS-INOX | 1677 | 2.3% |
| V7 PLUS | 1620 | 2.2% |

### M — (스테인리스/Stainless)
- 레코드: 39,679
| brand | count | share |
|---|---:|---:|
| STRAIGHT SHANK DRILLS | 4891 | 12.3% |
| COMBO TAPS | 4029 | 10.2% |
| DREAM DRILLS-GENERAL | 3946 | 9.9% |
| 4G MILL | 2715 | 6.8% |
| GENERAL CARBIDE | 2155 | 5.4% |
| SPIRAL POINT TAPS | 1975 | 5.0% |
| DREAM DRILLS-INOX | 1677 | 4.2% |
| V7 PLUS | 1620 | 4.1% |
| YG TAP GENERAL | 1436 | 3.6% |
| TANK-POWER | 1360 | 3.4% |

### K — (주철/Cast Iron)
- 레코드: 56,087
| brand | count | share |
|---|---:|---:|
| 4G MILL | 14492 | 25.8% |
| STRAIGHT SHANK DRILLS | 4919 | 8.8% |
| COMBO TAPS | 3947 | 7.0% |
| DREAM DRILLS-GENERAL | 3946 | 7.0% |
| WIDE-CUT for Korean Market | 3231 | 5.8% |
| GENERAL CARBIDE | 2826 | 5.0% |
| V7 PLUS | 1620 | 2.9% |
| K-2 CARBIDE | 1451 | 2.6% |
| YG TAP GENERAL | 1390 | 2.5% |
| SPIRAL POINT TAPS | 1363 | 2.4% |

### N — (비철/Al,Cu)
- 레코드: 31,227
| brand | count | share |
|---|---:|---:|
| STRAIGHT SHANK DRILLS | 5572 | 17.8% |
| COMBO TAPS | 4029 | 12.9% |
| WIDE-CUT for Korean Market | 3663 | 11.7% |
| DREAM DRILLS-INOX | 1677 | 5.4% |
| SPIRAL POINT TAPS | 1480 | 4.7% |
| YG TAP GENERAL | 1436 | 4.6% |
| GOLD-P DRILLS | 1387 | 4.4% |
| DREAM DRILLS-FLAT BOTTOM | 1270 | 4.1% |
| MORSE TAPER SHANK DRILLS | 982 | 3.1% |
| ALU-POWER HPC | 974 | 3.1% |

### S — (내열/Ti,Inconel)
- 레코드: 18,886
| brand | count | share |
|---|---:|---:|
| STRAIGHT SHANK DRILLS | 4891 | 25.9% |
| WIDE-CUT for Korean Market | 1797 | 9.5% |
| DREAM DRILLS-INOX | 1677 | 8.9% |
| V7 PLUS | 1620 | 8.6% |
| GOLD-P DRILLS | 1165 | 6.2% |
| V7 PLUS A | 1164 | 6.2% |
| TitaNox-Power | 1081 | 5.7% |
| MORSE TAPER SHANK DRILLS | 982 | 5.2% |
| MULTI-1 DRILLS | 814 | 4.3% |
| JET-POWER | 614 | 3.3% |

### H — (경질/Hardened)
- 레코드: 37,207
| brand | count | share |
|---|---:|---:|
| 4G MILL | 14492 | 38.9% |
| DREAM DRILLS-GENERAL | 3534 | 9.5% |
| V7 PLUS | 1620 | 4.4% |
| DREAM DRILLS-INOX | 1591 | 4.3% |
| 3S MILL | 1391 | 3.7% |
| X5070 | 1391 | 3.7% |
| GENERAL CARBIDE | 1381 | 3.7% |
| DREAM DRILLS-FLAT BOTTOM | 1270 | 3.4% |
| V7 PLUS A | 1164 | 3.1% |
| K-2 CARBIDE | 1044 | 2.8% |

## C. 세부 피삭재 (prod_series_work_material_status.work_piece_name) 전수

- distinct work_piece_name: 40
| work_piece_name | series_cnt | rows |
|---|---:|---:|
| Alloy Steels | 14120 | 14228 |
| Carbon Steels | 13866 | 14211 |
| Prehardened Steels | 11784 | 11874 |
| Cast Iron | 9729 | 9837 |
| Stainless Steels | 9154 | 9273 |
| Hardened Steels(HRc40~45) | 6031 | 6031 |
| Titanium | 5372 | 5420 |
| Inconel | 4883 | 4885 |
| Hardened Steels(HRc45~55) | 3563 | 3563 |
| Aluminum | 2583 | 2583 |
| High Hardened Steels(HRc55~70) | 2217 | 2217 |
| Copper | 1765 | 1870 |
| CFRP | 1069 | 1077 |
| Structural Steels | 992 | 992 |
| Graphite | 988 | 988 |
| Mild & Free Machining | 916 | 916 |
| Bronze | 762 | 762 |
| Non-ferrous | 725 | 726 |
| Acrylic | 711 | 711 |
| High Alloyed | 617 | 617 |
| Tool Steels | 479 | 479 |
| Structural & Low Carbon Steels | 312 | 417 |
| High Carbon Steels | 309 | 398 |
| High Alloy Steels | 302 | 387 |
| Aluminum & Aluminum alloy | 261 | 366 |
| Brass Bronze | 237 | 342 |
| Magnesium & Magnesium Alloys | 207 | 312 |
| Plastics | 189 | 294 |
| Plastic | 267 | 267 |
| Hardened Steels(HRc30~45) | 254 | 254 |
| Super Alloy All | 182 | 182 |
| Nickel | 122 | 122 |
| Hardened Steels(HRc45~) | 118 | 118 |
| Hardened Steels(HRc35~40) | 66 | 114 |
| Heat-Resistant Super Alloy (HRSA) | 91 | 91 |
| High Hardened Steels (CRH 60~65) | 3 | 3 |
| Steels All | 3 | 3 |
| High Hardened Steels (CRH 65~70 | 3 | 3 |
| High Hardened Steels (CRH 50~55) | 1 | 1 |
| Hardened Steels (CRH 45~50) | 1 | 1 |

## D. 세부 피삭재 → 브랜드 top (series_idx 조인)


### 구리 (기대: CRX S / CRX-S)
- 매칭된 work_piece_name: `Copper`
- 전체 (브랜드 있는 건) 합계: 17,328
| brand | count | share |
|---|---:|---:|
| STRAIGHT SHANK DRILLS | 4463 | 25.8% |
| COMBO TAPS | 4029 | 23.3% |
| YG TAP GENERAL | 1436 | 8.3% |
| SPIRAL POINT TAPS | 1435 | 8.3% |
| DREAM DRILLS-FLAT BOTTOM | 1270 | 7.3% |
| MORSE TAPER SHANK DRILLS | 982 | 5.7% |
| STRAIGHT FLUTE TAPS | 728 | 4.2% |
| HAND TAPS | 690 | 4.0% |
| PRIME TAPS | 532 | 3.1% |
| THREAD MILLS | 465 | 2.7% |
| CRX S | 447 | 2.6% |
| YG TAP ALU | 238 | 1.4% |
| ALU-POWER HPC | 234 | 1.4% |
| TANK-POWER | 190 | 1.1% |
| SCREW THREAD INSERT TAPS | 189 | 1.1% |
- 판정: 🔴 기대 브랜드 top3 에 없음

### 알루미늄 (기대: Alu-Cut / Alu-Power)
- 매칭된 work_piece_name: `Aluminum`, `Aluminum & Aluminum alloy`
- 전체 (브랜드 있는 건) 합계: 28,314
| brand | count | share |
|---|---:|---:|
| STRAIGHT SHANK DRILLS | 9760 | 34.5% |
| COMBO TAPS | 3947 | 13.9% |
| MORSE TAPER SHANK DRILLS | 1964 | 6.9% |
| DREAM DRILLS-INOX | 1677 | 5.9% |
| MULTI-1 DRILLS | 1628 | 5.7% |
| GOLD-P DRILLS | 1508 | 5.3% |
| YG TAP GENERAL | 1329 | 4.7% |
| DREAM DRILLS-FLAT BOTTOM | 1270 | 4.5% |
| SPIRAL POINT TAPS | 1214 | 4.3% |
| ALU-POWER HPC | 974 | 3.4% |
| ALU-POWER | 969 | 3.4% |
| ALU-CUT for Korean Market | 543 | 1.9% |
| HAND TAPS | 540 | 1.9% |
| STRAIGHT FLUTE TAPS | 504 | 1.8% |
| DREAM DRILLS-ALU | 487 | 1.7% |
- 판정: 🔴 기대 브랜드 top3 에 없음

### 티타늄 (기대: Titanox Power)
- 매칭된 work_piece_name: `Titanium`
- 전체 (브랜드 있는 건) 합계: 18,310
| brand | count | share |
|---|---:|---:|
| STRAIGHT SHANK DRILLS | 4891 | 26.7% |
| WIDE-CUT for Korean Market | 1797 | 9.8% |
| DREAM DRILLS-INOX | 1677 | 9.2% |
| V7 PLUS | 1620 | 8.8% |
| GOLD-P DRILLS | 1165 | 6.4% |
| V7 PLUS A | 1164 | 6.4% |
| TitaNox-Power | 1081 | 5.9% |
| MORSE TAPER SHANK DRILLS | 982 | 5.4% |
| MULTI-1 DRILLS | 814 | 4.4% |
| JET-POWER | 730 | 4.0% |
| V7 MILL-INOX | 605 | 3.3% |
| K-2 CARBIDE | 565 | 3.1% |
| GENERAL CARBIDE | 482 | 2.6% |
| THREAD MILLS | 445 | 2.4% |
| YG TAP Ti Ni | 292 | 1.6% |
- 판정: 🔴 기대 브랜드 top3 에 없음

### 스테인리스 (기대: (검증))
- 매칭된 work_piece_name: `Stainless Steels`
- 전체 (브랜드 있는 건) 합계: 31,584
| brand | count | share |
|---|---:|---:|
| STRAIGHT SHANK DRILLS | 4891 | 15.5% |
| COMBO TAPS | 4029 | 12.8% |
| DREAM DRILLS-GENERAL | 3946 | 12.5% |
| 4G MILL | 2715 | 8.6% |
| GENERAL CARBIDE | 2155 | 6.8% |
| SPIRAL POINT TAPS | 1975 | 6.3% |
| DREAM DRILLS-INOX | 1677 | 5.3% |
| V7 PLUS | 1620 | 5.1% |
| YG TAP GENERAL | 1436 | 4.5% |
| TANK-POWER | 1360 | 4.3% |
| DREAM DRILLS-FLAT BOTTOM | 1270 | 4.0% |
| K-2 CARBIDE | 1201 | 3.8% |
| V7 PLUS A | 1164 | 3.7% |
| TitaNox-Power | 1081 | 3.4% |
| GOLD-P DRILLS | 1064 | 3.4% |

### 주철 (기대: (검증))
- 매칭된 work_piece_name: `Cast Iron`
- 전체 (브랜드 있는 건) 합계: 45,300
| brand | count | share |
|---|---:|---:|
| 4G MILL | 14492 | 32.0% |
| STRAIGHT SHANK DRILLS | 4919 | 10.9% |
| COMBO TAPS | 3947 | 8.7% |
| DREAM DRILLS-GENERAL | 3946 | 8.7% |
| WIDE-CUT for Korean Market | 3231 | 7.1% |
| GENERAL CARBIDE | 2826 | 6.2% |
| V7 PLUS | 1620 | 3.6% |
| K-2 CARBIDE | 1451 | 3.2% |
| YG TAP GENERAL | 1390 | 3.1% |
| SPIRAL POINT TAPS | 1363 | 3.0% |
| TANK-POWER | 1360 | 3.0% |
| DREAM DRILLS-FLAT BOTTOM | 1270 | 2.8% |
| GOLD-P DRILLS | 1164 | 2.6% |
| V7 PLUS A | 1164 | 2.6% |
| MORSE TAPER SHANK DRILLS | 1157 | 2.6% |

### 열처리강/경화강 (기대: (검증))
- 매칭된 work_piece_name: `Prehardened Steels`, `Hardened Steels(HRc40~45)`, `Hardened Steels(HRc45~55)`, `High Hardened Steels(HRc55~70)`, `Hardened Steels(HRc30~45)`, `Hardened Steels(HRc45~)`, `Hardened Steels(HRc35~40)`, `High Hardened Steels (CRH 60~65)`, `High Hardened Steels (CRH 65~70`, `High Hardened Steels (CRH 50~55)`, `Hardened Steels (CRH 45~50)`
- 전체 (브랜드 있는 건) 합계: 91,888
| brand | count | share |
|---|---:|---:|
| 4G MILL | 43476 | 47.3% |
| GENERAL HSS | 5693 | 6.2% |
| X5070 | 5564 | 6.1% |
| 3S MILL | 5373 | 5.8% |
| V7 PLUS | 4860 | 5.3% |
| GENERAL CARBIDE | 4326 | 4.7% |
| DREAM DRILLS-GENERAL | 3534 | 3.8% |
| DREAM DRILLS-PRO | 3476 | 3.8% |
| X-POWER PRO | 2876 | 3.1% |
| K-2 CARBIDE | 2746 | 3.0% |
| DREAM DRILLS-FLAT BOTTOM | 2540 | 2.8% |
| V7 PLUS A | 2380 | 2.6% |
| X5070 S | 1854 | 2.0% |
| TANK-POWER | 1599 | 1.7% |
| DREAM DRILLS-INOX | 1591 | 1.7% |

### 탄소강 (기대: (검증))
- 매칭된 work_piece_name: `Carbon Steels`, `Structural & Low Carbon Steels`, `High Carbon Steels`
- 전체 (브랜드 있는 건) 합계: 77,836
| brand | count | share |
|---|---:|---:|
| 4G MILL | 21628 | 27.8% |
| STRAIGHT SHANK DRILLS | 13393 | 17.2% |
| DREAM DRILLS-GENERAL | 10088 | 13.0% |
| GENERAL HSS | 7073 | 9.1% |
| COMBO TAPS | 3947 | 5.1% |
| MORSE TAPER SHANK DRILLS | 3471 | 4.5% |
| WIDE-CUT for Korean Market | 3231 | 4.2% |
| GENERAL CARBIDE | 2964 | 3.8% |
| SPIRAL POINT TAPS | 2209 | 2.8% |
| DREAM DRILLS-PRO | 1738 | 2.2% |
| DREAM DRILLS-INOX | 1677 | 2.2% |
| GOLD-P DRILLS | 1629 | 2.1% |
| MULTI-1 DRILLS | 1628 | 2.1% |
| V7 PLUS | 1620 | 2.1% |
| i-ONE DRILLS | 1540 | 2.0% |

### 인코넬 (기대: (검증))
- 매칭된 work_piece_name: `Inconel`
- 전체 (브랜드 있는 건) 합계: 8,207
| brand | count | share |
|---|---:|---:|
| WIDE-CUT for Korean Market | 1797 | 21.9% |
| V7 PLUS | 1526 | 18.6% |
| V7 PLUS A | 1164 | 14.2% |
| TitaNox-Power | 1081 | 13.2% |
| V7 MILL-INOX | 605 | 7.4% |
| K-2 CARBIDE | 565 | 6.9% |
| GENERAL CARBIDE | 432 | 5.3% |
| JET-POWER | 394 | 4.8% |
| STRAIGHT SHANK DRILLS | 232 | 2.8% |
| MORSE TAPER SHANK DRILLS | 137 | 1.7% |
| TitaNox-Power HPC | 132 | 1.6% |
| TITANOX-POWER | 108 | 1.3% |
| SUS-CUT for Korean Market | 34 | 0.4% |

### 합금강 (기대: (검증))
- 매칭된 work_piece_name: `Alloy Steels`, `High Alloy Steels`
- 전체 (브랜드 있는 건) 합계: 61,177
| brand | count | share |
|---|---:|---:|
| 4G MILL | 14492 | 23.7% |
| STRAIGHT SHANK DRILLS | 9463 | 15.5% |
| GENERAL HSS | 6849 | 11.2% |
| DREAM DRILLS-GENERAL | 6273 | 10.3% |
| COMBO TAPS | 4029 | 6.6% |
| WIDE-CUT for Korean Market | 3231 | 5.3% |
| GENERAL CARBIDE | 2876 | 4.7% |
| MORSE TAPER SHANK DRILLS | 2314 | 3.8% |
| SPIRAL POINT TAPS | 2039 | 3.3% |
| DREAM DRILLS-PRO | 1738 | 2.8% |
| DREAM DRILLS-INOX | 1677 | 2.7% |
| V7 PLUS | 1620 | 2.6% |
| i-ONE DRILLS | 1540 | 2.5% |
| K-2 CARBIDE | 1528 | 2.5% |
| GOLD-P DRILLS | 1508 | 2.5% |