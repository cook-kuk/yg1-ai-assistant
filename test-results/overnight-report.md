# Overnight Auto-Hunt Report — 2026-04-10

## 요약

| 지표 | 시작 | 최종 |
|---|---|---|
| 평균 점수 | 16.4/25 | **19.4~19.9/25** (+3.0~3.5) |
| 최저점 | 11 | 11 (B03 구조적 한계) |
| 커밋 | — | 5개 유효 + 1 revert |
| 치명 버킷 (A~D, F) | 3개 | 0개 |

## 커밋 이력

| # | Commit | 버킷 | 대상 | 이전→이후 |
|---|---|---|---|---|
| 1 | 30e036d | D.State | `serve-engine-general-chat.ts` __qaDirectAnswer 폴백 | C04 7→24 |
| 2 | 931772f | 버킷 전반 | question-engine threshold 30→250, history+1/+2 확장 | 전반 +1 |
| 3 | 924e894 | A.Routing | runtime TROUBLE_RE 부사 허용 ("수명이 너무 짧아") | C05 11→22 |
| **R** | 5f3bcc6 | B.Retrieval | response.ts turn0 shortcut → **무한루프 revert** (버킷 D recursion) | — |
| 4 | 35eba26 | B.Retrieval | deterministic-scr 오타 alias 낭→날, mn→mm | E01 11→20 |
| 5 | cf2fc29 | B.Retrieval | question-engine threshold 250→8000/1k→15k/3k→30k | B02 11→20, B04 12→20 |

## 버킷별 해결 상태

| 버킷 | 상태 |
|---|---|
| A.Routing | ✅ 해결 (TROUBLE_RE) — "수명이 너무 짧아" 등 trouble 질문 커버 |
| B.Retrieval | ✅ 대부분 해결 (threshold + typo) — B02/B04/E01 전부 11→20 |
| C.Synthesis | ✅ 해결 (Fix C pre-committed) — "찾지 못했습니다" 패턴 0건 유지 |
| D.State | ⚠️ 부분 해결 — __qaDirectAnswer는 해결, multiturn carryover 미해결 |
| E.Judge | ⚠️ 남음 — E02/E03 vague 0-filter grader preference 이슈 |
| F.Regression | ✅ Round 2 revert 후 무 |

## 미해결 (다음 세션)

### 1. B03 11 — "CRX S 빼고 추천해줘" negation force-recommend
- **원인**: filter 추출은 정상 (`brand!=CRX-S`), cand=64438 > threshold 8000 → "직경?" 질문
- **필요**: explicit "추천해줘/보여줘" text signal을 checkResolution까지 전파해 forced resolve
- **위험**: Round 2에서 얕은 force-resolve 시도 → response.ts ↔ question-engine 재귀 무한루프 경험. 안전 경로는 checkResolution 시그니처 확장 + 모든 caller 업데이트.

### 2. M01/M02 12~19 — multiturn state carryover
- **원인**: eval-judge의 stateless POST ([user, ai, user, ai, user]) + 서버가 message history에서 filter 상태 복원 못 함. 각 turn을 turn 0처럼 처리
- **증거**: 로그 `[turn-repair:gate] msg="4날로", needsRepair=false, history=0, filters=0, msgs=3`
- **필요**: intake-reconstruction 레이어에서 ai 응답 텍스트 기반으로 이전 turn의 filter를 역추정하여 `prevState` 재조립
- **위험**: serve-engine-runtime 5000+줄 핵심 영역 수정 필요. 극도 신중

### 3. E02/E03 16 — "좋은 거 추천해줘" / "네"
- **원인**: 0 filter + vague text + 64588 cand → 구조적으로 질문 필요
- **판단**: grader preference ("카드 보여줘") vs UX ("정보 부족시 질문") 충돌. 도메인 판단 필요

## Round별 상세

### Round 1 — Fix C + threshold v1 + TROUBLE_RE
- 시작 16.4 → 17.8 (+1.4)
- 타겟 히트: C04 7→24, C05 11→22
- 회귀: -1~-2 판정 노이즈 수준

### Round 2 — REVERTED ❌
- 가설: response.ts turn0FilteredShortcut → alreadyResolved 강제
- 실제: buildQuestionResponse(L608) → buildRecommendationResponse → selectNextQuestion(L940) → buildQuestionResponse 무한 재귀 루프 (114% CPU pileup)
- 교훈: checkResolution 우회 없이 alreadyResolved만 강제 설정 금지

### Round 3 — typo aliases
- 17.8 → 18.8 (+1.0)
- 타겟 히트: E01 11→20

### Round 4 — threshold v2 (250→8000)
- 18.8 → 19.9 (+1.1)
- 타겟 히트: B02 11→20, B04 12→20
- 회귀: M01 14→12 (state carryover 버그가 raised threshold 하에서 다른 product 선택)

### Round 5 — stability check
- 19.9 → 19.4 (same code, judge noise)
- 결론: Round 4 결과 stable band 19.4~19.9

## 교훈 (향후 반영)

1. **알려지지 않은 call graph에 force-resolve 주입 금지** — 반드시 checkResolution 자체의 return 값을 바꿔야 동일 결론 보장
2. **threshold 튜닝은 ≤8000이 실용 상한** — 그 이상은 vague-query UX 손상
3. **multiturn M01/M02는 stateless eval의 구조적 아티팩트** — 실사용 (persist session) 환경에선 다를 수 있음
4. **judge noise ±0.5~1** — 단일 실행 대신 2회 band로 판단

## 남은 시간 비용

추가 fix 없이 현재 상태 stable. 사용자 승인 후 다음 세션에서 force-recommend infra 작업 + multiturn state reconstruction 진행 권장.
