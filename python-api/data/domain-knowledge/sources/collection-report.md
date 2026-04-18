# 도메인 지식 수집 보고서

- 수집 일시: 2026-04-09
- 수집 방식: 8개 서브에이전트 병렬 실행 (WebSearch + WebFetch)
- 총 파일: 9개
- 총 엔트리: 256개
- 원본(raw) 캐시 파일: 57개

## 파일별 현황

| 파일 | 엔트리 수 | 웹 출처 수 | 비고 |
|---|---:|---:|---|
| coating-properties.json | 13 | 30 | TiN/TiCN/TiAlN/AlTiN/AlCrN/TiSiN/nACo/CrN/ZrN/DLC/Diamond/TiB2/AlCrSiN — 모두 ≥2소스 교차검증 |
| material-properties.json | 80 | 11 | JIS 30 + AISI 20 + 초내열/특수 15 + 비철 15 (68개 verified=true) |
| iso-standards.json | 3 | 9 | ISO 513 (P/M/K/N/S/H + 18 subgroups) + ISO 1832 10-position + VDI 3323 |
| competitor-cross-reference.json | 65 | 20 | 20개 브랜드 (Sandvik, Kennametal, OSG, Mitsubishi, Walter, ISCAR, Seco, Dormer, Guhring, Nachi, Kyocera, TaeguTec, Korloy, Harvey, Helical, YMW, Emuge, MOLDINO, Ingersoll, Niagara) → YG-1 매핑 |
| machining-knowhow.json | 34 | 32 | 소재/operation/문제/전략 4 카테고리 (Sandvik, Kennametal, Harvey, MMS) |
| tap-drill-chart.json | 8 | 6 | metric coarse 21 + fine 9 + UNC 14 + UNF 12 + NPT 9 + BSP 6 + formula |
| troubleshooting.json | 22 | 9 | 기존 KO 10개 + 신규 12개 (chatter/BUE/burr/edge chip/thin wall/drill walking/tap break 등) |
| operation-guide.json | 20 | 12 | 기존 KO 8개 + 신규 12개 (pocket/side/slot/3D/face/ramp/thread mill/chamfer/plunge/drill/ream/tap) |
| material-coating-guide.json | 11 | (기존) | 14번 prompt 이전부터 있던 소재×코팅 적합도 매트릭스 |

## 주요 출처

| 사이트 | 용도 |
|---|---|
| matweb.com / azom.com / makeitfrom.com | 소재 물성 (hardness, UTS, thermal_k) |
| oerlikon.com / ionbond.com / brycoat.com / eifeler.com | 코팅 물성 (HV, max temp, friction) |
| sandvik.coromant.com | ISO 분류, 가공 노하우, 트러블슈팅 |
| kennametal.com / harveyperformance.com / helicaltool.com | 가공 전략, operation guide |
| fractory.com / engineersedge.com / britishmetrics | 탭 드릴 차트 |
| 각 경쟁사 공식 카탈로그 | competitor cross-reference |

## 미수집 / 추가 가능

- [ ] iso_513 P50/M40/K40/N30/S40/H30 등 거친가공 subgroup
- [ ] 1회용 비철 확장 (Be-Cu, AZ91, ZK60 시리즈)
- [ ] 한국 KS D 4000번대 강재 더 많이
- [ ] YG-1 series-knowledge 보강 (Phase B 미실행 — 기존 데이터 충분 판단)

## 통합 검증

- 9/9 파일 JSON.parse OK
- semantic-search.ts가 자동 스캔 — 새 JSON 추가시 코드 수정 0
- vitest semantic-search.test.ts 7/7 pass
- vitest stock-filter-regression 18/18 pass
