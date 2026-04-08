# 25 케이스 finder 테스트 이력 (recommend path)

**무조건 기억**: 모든 추천 흐름은 `/api/recommend` 단일 entry. UI 챗과 25 케이스 테스트 동일.

## 케이스 정의 (suchan_test_v1.xlsx 기준)

| # | 케이스 | DB | 메시지 | intake (form) |
|---|---|---|---|---|
| 1 | 베이스 | 1100 | "추천해줘" | P, Slotting, Milling, 10mm |
| 2 | P+M+K 6mm | 1084 | "다양한 소재 다 가능한 거 추천" | P,M,K, Side_Milling, Milling, 6mm |
| 3 | 직경 8~12 | 3772 | "직경 8mm 이상 12mm 이하 제품만 보여줘" | P, Slotting, Milling, 10mm |
| 4 | OAL ≥100 | 384 | "전체 길이 100mm 이상인 것만" | P, Side_Milling, Milling, 10mm |
| 5 | OAL ≤80 | 568 | "전체 길이 80mm 이하 짧은 거" | P, Side_Milling, Milling, 10mm |
| 6 | 4날 | 467 | "4날만" | P, Slotting, Milling, 10mm |
| 7 | 날수 ≥5 | 69 | "날수 5개 이상" | S, Slotting, Milling, 12mm |
| 8 | T-Coating | 62 | "T-Coating만" | P, Side_Milling, Milling, 8mm |
| 9 | bright finish | 283 | "비철용인데 코팅 없는 거 (bright finish)" | N, Side_Milling, Milling, 6mm |
| 10 | 재고 | 547 | "재고 있는 거만 보여줘" | P, Slotting, Milling, 10mm |
| 11 | 재고+납기 | 212 | "재고 있고 빠른 납기 가능한 거" | M, Side_Milling, Milling, 8mm |
| 12 | X5070 | 84 | "X5070 브랜드로만" | -, -, Milling, 10mm |
| 13 | ALU-POWER 제외 | 255 | "ALU-POWER는 빼고" | N, Side_Milling, Milling, 8mm |
| 14 | 4중 | 8 | "직경 10mm 4날 전장 100 이상 TiAlN 코팅" | P, -, Milling, 10mm |
| 15 | 5중+범위 | 31 | "직경 8~12mm, 전장 80 이상, 4날, TiAlN 코팅, 재고 있는 거" | P/M, -, Milling, 8-12 |
| 16 | 헬릭스 ≥45 | 106 | "헬릭스 각도 45도 이상" | P, Side_Milling, Milling, 10mm |
| 17 | Shank 6~10 | 980 | "샹크 직경 6에서 10 사이" | P, Slotting, Milling, 8mm |
| 18 | CL ≥20 | 750 | "절삭 길이 20mm 이상" | P, Slotting, Milling, 10mm |
| 19 | Drill point 140 | 70 | "포인트 각도 140도" | P, Drilling, Holemaking, 8mm |
| 20 | Drill OAL+coolant | 56 | "전장 100 이상이고 쿨런트홀 있는 거" | P, Drilling, Holemaking, 10mm |
| 21 | Tap M10 P1.5 | 287 | "M10 P1.5 관통탭" | P, Threading_Through, Threading, 10mm |
| 22 | 직경 999 | 0 | "직경 999mm 추천" | -, -, Milling, - |
| 23 | 모순 ≥20 ≤5 | 0 | "직경 20 이상이면서 5 이하" | -, -, Milling, - |
| 24 | 1/4인치 | 2 | "1/4인치 4날 추천" | P, Side_Milling, Milling, 1/4인치 |
| 25 | KOREA 5중 | 1 | "한국 재고로 4날 TiAlN 전장 100 이상" | P, Slotting, Milling, 10mm, KOREA |

## 실행 이력

### Baseline (2026-04-07T22:50, sonnet, no det SCR)
정확 4 / 근접 0

| # | result |
|---|---|
| 1 | 290 ❌ |
| 2 | 1000 ❌ |
| 3 | 0 ❌ |
| 4 | 0 ❌ |
| 5 | 0 ❌ |
| 6 | 162 ❌ |
| 7 | 12 ❌ |
| 8 | 200 ❌ |
| 9 | 111 ❌ |
| 10 | 0 ❌ |
| 11 | 0 ❌ |
| 12 | 12 ❌ |
| 13 | 110 ❌ |
| 14 | 5 ❌ |
| 15 | 0 ❌ |
| 16 | 267 ❌ |
| 17 | 0 ❌ |
| 18 | 0 ❌ |
| 19 | 1000 ❌ |
| 20 | 0 ❌ |
| 21 | 0 ❌ |
| 22 | 0 ✅ |
| 23 | 0 ✅ |
| 24 | 2 ✅ |
| 25 | 0 ❌ |

### After all fixes (det SCR + GPT-5 + stock fix attempt) — 2026-04-08T05:47
정확 6 / 근접 1

| # | result | 비고 |
|---|---|---|
| 1 | 1100 ✅ | operationType skip |
| 2 | 64588 ❌ | LLM removes material on "다양한" |
| 3 | 1031 | det SCR between 작동, but downstream layer reduce |
| 4 | 241 | gte 작동 |
| 5 | 199 | lte 작동 |
| 6 | 467 ✅ | 4F NL filter |
| 7 | 23 | gte 작동, but cap |
| 8 | 636 ❌ | coating filter loose |
| 9 | 368 | bright finish |
| 10 | 0 ❌ | stock SQL OK but post-filter rejects |
| 11 | 0 ❌ | same |
| 12 | 36 | brand filter |
| 13 | 291 | neq brand |
| 14 | 99 ❌ | 4중 over |
| 15 | 0 ❌ | 5중 |
| 16 | 98 | 헬릭스 gte (was 267) |
| 17 | 0 ❌ | shank between |
| 18 | 257 | CL gte (was 0) |
| 19 | 70 ✅ | toolType=Holemaking + det |
| 20 | 0 ❌ | drill OAL+coolant |
| 21 | 287 ✅ | tap toolType + threadPitch |
| 22 | 0 ✅ | |
| 23 | 680 ❌ | det extracted "20" first |
| 24 | 2 ✅ | 1/4인치 inch fraction |
| 25 | 0 (≈) | KOREA 복합 |

## 핵심 발견

1. **`/api/recommend` 단일 entry** — UI도 테스트도 동일 path
2. **KG layer가 SCR 보다 먼저 실행** — KG NUMERIC_PATTERNS는 op 감지 없음 → eq 디폴트
3. **post-filter loop가 stockStatus를 candidate.stockStatus로 검사** → SQL에서 EXISTS 통과한 row 모두 reject
4. **det SCR는 routeSingleCall에만 통합** — KG에 의해 우회 가능
5. **inputHandledFields conflict** — intake diameterMm=10 과 NL between 8-12 충돌 시 intake 우선

### After stock fix v3 (post-filter skip + EXISTS) — 2026-04-08T06:00
**정확 8 / 근접 1**

| # | result | 비고 |
|---|---|---|
| 1 | 1100 ✅ | |
| 2 | 64588 ❌ | LLM 다양한 → material 제거 (regression) |
| 3 | 1031 | downstream layer reduce |
| 4 | 241 | |
| 5 | 199 | |
| 6 | 467 ✅ | |
| 7 | 23 | gte but cap |
| 8 | 636 ❌ | coating loose |
| 9 | 368 | |
| 10 | **547 ✅** 🆕 | inventory_summary_mv EXISTS join + post-filter skip |
| 11 | **212 ✅** 🆕 | 동일 |
| 12 | 36 | |
| 13 | 291 | neq |
| 14 | 99 ❌ | over |
| 15 | 250 | |
| 16 | 98 | gte 작동 |
| 17 | 0 ❌ | shank between |
| 18 | 257 | gte 작동 |
| 19 | 70 ✅ | |
| 20 | 0 ❌ | drill OAL+coolant |
| 21 | 287 ✅ | |
| 22 | 0 ✅ | |
| 23 | 680 ❌ | det첫 숫자만 |
| 24 | 2 ✅ | |
| 25 | 0 (≈) | |

## 진행 중 fix
- KG에 op 감지 추가 OR det SCR을 KG보다 먼저 실행
- 케이스 17 (shank between), 20 (drill OAL+coolant), 23 (모순 detection) 남음

## 안 잡힌 케이스
- ❌ 2 (다양한→material drop), 8 (coating loose), 14 (over), 17 (shank between), 20 (drill OAL+coolant), 23 (모순)
- ⬇ 3, 4, 5, 7, 12, 15, 16, 18 (downstream layer)
- ⬆ 9, 13
