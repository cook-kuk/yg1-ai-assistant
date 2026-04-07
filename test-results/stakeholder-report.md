# YG-1 AI Assistant — 시연 전 최종 검증 리포트

**작성일**: 2026-04-07
**대상**: 내일 시연 (product 탭 자연어 추천)
**검증 환경**: deployed Vercel `https://yg1-ai-assistant.vercel.app/api/recommend`

---

## 1. 한 줄 결론

> **CONDITIONAL GO** — fast layer는 100% 통과(19/19), 배포된 product 탭 E2E도 8/10 PASS. 단, "**국내제품으로만 추천해줘**" 한국어 표현이 country=KOREA 필터로 매핑되지 않는 시연 치명 버그 1건이 발견되어 **수정+재배포 후 GO** 권장.

---

## 2. 고객 피드백 기준 핵심 이슈 (top 5)

피드백 수집 서버(20.119.98.136:3001) → MongoDB → 총 **1,973건** 분석 (245 폼 + 1,728 대화). 부정 평점 비율 **45%**, 부정 응답 비율 **19%**.

| 순위 | 이슈 | 해당 건수 | 시연 영향 |
|----|----|----|----|
| 1 | **후보 과다** (candidateCount ≥ 30) | 1,558건 (90%) | 치명 — 사용자가 선택을 못함 |
| 2 | **0건 결과** | 621건 (36%) | 치명 — 응답이 비어 보임 |
| 3 | **국가 필터 불일치** ("국내제품인데 해외처럼 보임") | 66건 | 치명 — 신뢰도 직격 |
| 4 | **추천/근거 불일치** | 42건 | 중요 |
| 5 | **Edit-intent 실패** | 5건 | 양호 — 최근 패치 효과 |

---

## 3. 테스트 체계 (4계층)

| 계층 | 위치 | 케이스 수 | 결과 |
|----|----|----|----|
| **A. Fast (deterministic)** | `lib/recommendation/core/__tests__/demo-scenarios-fast.test.ts` | 19 | **19 PASS** ✅ |
| **A+. KG country test** | `lib/recommendation/core/__tests__/country-kg.test.ts` | 2 | **수정 후 2 PASS** ✅ |
| **C. E2E (deployed Vercel)** | `test-results/demo-e2e-runner.js` | 10 | **8 PASS / 2 FAIL** |
| **D. 성능 관찰** | E2E 런타임 측정 | — | avg 13.2s, max 33.7s |

> B(DB validation)는 별도 분리하지 않고 E2E의 invariant 안에서 후보 카운트/필터 일치성으로 함께 검증. fast 계층은 LLM 호출 **0회**.

---

## 4. 핵심 시나리오 결과 요약 (시연 그대로)

| # | 시나리오 | 입력 | 시스템 이해 | 후보 변화 | 최종 추천 | 판정 | 메모 |
|---|---|---|---|---|---|---|---|
| S01 | 구리 SQUARE 2날 10mm 추천 | 자연어 1턴 | diameter=10, flute=2 | → 3개 | (CRX S 등) | **PASS** | 좁은 base에 정확히 매칭 |
| S02 | CRX S 가 아닌걸로 | edit (exclude) | brand!=CRX S | 17 → 14 | (다른 브랜드) | **PASS** ✅ | edit-intent 정확 |
| S03 | CRX S 말고 다른 브랜드 | edit (exclude) | brand!=CRX S | 17 → 14 | (다른 브랜드) | **PASS** ✅ | wording variant 견고 |
| S04 | 2날 말고 4날로 | edit (replace) | flute 2→4 | 변경 | 4날 제품 | **PASS** ✅ | replace 정확 |
| S05 | 브랜드는 상관없음 | edit (clear) | brand 필터 제거 | 회복 | 다양 | **PASS** ✅ | clear 정확 |
| S06 | 이전으로 돌아가서 CRX S 제외 | navigation+exclude | go_back+brand≠CRXS | 회복 후 좁힘 | (다른 브랜드) | **PASS** ✅ | 복합 의도 정확 |
| **S07** | **국내제품으로만 추천해줘** | country=KOREA | **❌ 무시됨** | 290 (필터 미적용) | 해외 후보 포함 | **FAIL** | **시연 치명 — KG alias 누락** |
| S08 | 스테인리스 슬로팅 8mm | 기본 추천 | 정상 | 후보 다수 | 정상 | **PASS** | narrowing chips 제공 |
| S09 | 인코넬 헬리컬 10mm | 기본 추천 | 정상 | 후보 다수 | 정상 | **PASS** | 0건 방어 정상 |
| S10 | SGED31 vs SGED30 차이 | comparison | (chat 영역) | — | 응답 빈약 | **FAIL** | **product API 영역 외** — chat 탭에서 처리해야 함 |

---

## 5. 메트릭

### 이해/해석 (fast layer)
- **Edit-intent intent accuracy**: 19/19 = **100%** (5 wording variants × 3 시나리오)
- **Field extraction accuracy**: 100% (brand/flute/clear)

### DB/UI 정합성 (E2E)
- **Filter correctness rate**: 8/10 = **80%**
- **Forbidden result rate** (CRX S 제외 후 CRX S 등장): **0%** ✅
- **Top-card / candidate consistency**: 100% (관찰된 모든 PASS 케이스)
- **Stale recommendation rate**: 0% (관찰)

### 사용자 관점 (피드백 기반)
- **Unresolved broad result rate**: ~90% (candidateCount ≥ 30) — **개선 시급**
- **0건 결과 비율**: 36% — 시연 시 회피 필요

### 안정성
- 동일 입력 5회 반복 테스트는 시간상 미수행 (다음 단계). 단, 5개 wording variant가 모두 동일 invariant 통과 → wording-robustness OK.

### 성능 (deployed Vercel)
| 항목 | 값 |
|----|----|
| 평균 E2E 응답 시간 | **13.2 s** |
| 최대 E2E 응답 시간 | **33.7 s** (S06 멀티턴) |
| 총 10 시나리오 런타임 | 132 s |

> Cold start, planner/compiler latency 분리 측정은 미수행 — 다음 단계로 위임. 평균 13초는 시연 시 체감상 **개선 권장**.

---

## 6. 발견된 시연 치명 이슈와 처치

### 🔴 BUG-1: "국내제품으로만 추천해줘" → country 필터 미적용 (S07)

- **원인 (분류)**: **entity grounding** 문제. KG의 country 노드 alias에 "국내"는 있지만, `matchesAsWord` 함수가 2자 한글 alias에 대해 word boundary를 강제하기 때문에 "**국내제품**"의 "내제" 경계가 매칭 실패.
- **위치**: `lib/recommendation/core/knowledge-graph.ts:81`
- **수정 (이번 턴 적용)**:
  ```diff
  - aliases: ["한국", "korea", "국내", "코리아"]
  + aliases: ["한국", "korea", "국내", "코리아", "국내제품", "국내산", "국산", "국내용", "국내전용"]
  ```
- **검증**: 새 fast 테스트 `country-kg.test.ts` 2/2 PASS.
- **남은 작업**: **commit + Vercel 재배포** 후 deployed에서 S07 재실행 필요.
- **원칙 준수**: KG regex를 추가하지 않고 entity alias만 보강 — `[절대 원칙 1, 2]` 준수.

### 🟡 BUG-2: comparison(S10)은 product API에서 처리 안 됨

- **원인 (분류)**: 시나리오 분류 오류. comparison/explanation은 chat 탭 영역.
- **처치**: 시연 시나리오 라우팅에서 비교 질문은 chat 탭으로 보내거나, product 탭 응답에 "비교는 chat 탭에서 가능합니다" graceful fallback.
- **시연 치명도**: 중간 — 시나리오만 옮기면 됨.

---

## 7. 시연 전 반드시 막아야 할 이슈

1. **BUG-1 수정 commit 후 Vercel 재배포** — 가장 중요.
2. **후보 과다 (>30)** 케이스에서 narrowing chips가 항상 제공되는지 한 번 더 확인 (S08에서는 OK).
3. 시연 시나리오에서 base 후보가 0~3 정도로 매우 좁은 케이스는 피하기 (S02 원안처럼 0건 폭포 위험).

---

## 8. 오늘 넘겨도 되는 개선 과제

- 평균 E2E latency 13초 → 목표 5초 (성능 튜닝)
- 동일 입력 5회 consistency 측정
- DB layer 단독 validation 분리
- chat 탭 SGED 비교 응답 품질
- 후보 과다 시 narrowing UX 자동 제안 강화 (피드백 90% 사례)

---

## 9. 수정 파일 목록

| 파일 | 변경 |
|----|----|
| `lib/recommendation/core/knowledge-graph.ts` | KOREA aliases 5개 추가 (시연 치명 fix) |
| `lib/recommendation/core/__tests__/demo-scenarios-fast.test.ts` | 신규 — 19개 fast invariant 테스트 |
| `lib/recommendation/core/__tests__/country-kg.test.ts` | 신규 — country alias 회귀 |
| `test-results/test-cases.json` | 신규 — 핵심 10개 시나리오 |
| `test-results/feedback-replay.json` | 신규 — 피드백 15건 재현 |
| `test-results/demo-e2e-runner.js` | 신규 — invariant 기반 E2E 러너 |
| `test-results/demo-e2e-results.{tsv,json}` | 신규 — 실행 결과 |
| `test-results/feedback-critical-issues.json` | 신규 — 1973건 분석 |
| `test-results/feedback-full-dump.json` | 신규 — 원본 백업 (25 MB) |
| `test-results/performance-note.md` | 신규 — 병렬 처리 검토 |

---

## 10. 남은 리스크

| 리스크 | 영향 | 대응 |
|----|----|----|
| BUG-1 재배포 누락 | 시연 중 country 필터 무시 노출 | **반드시 commit+deploy** |
| 평균 13초 응답 시간 | 시연 체감 답답 | warmup 미리 1회 호출 |
| 후보 과다 시연 케이스 | 사용자 혼동 | narrowing chips 강조하는 멘트 준비 |
| 동일 입력 비결정성 | top1 흔들림 가능 | 시연 직전 동일 입력 1회 dry run |

---

## 11. 최종 판단

| 조건 | 상태 |
|----|----|
| Fast layer 19+2 PASS | ✅ |
| E2E 8/10 (BUG-1 수정 반영 시 9/10) | ⚠ → 수정 후 ✅ |
| Edit-intent 5개 wording variant 견고 | ✅ |
| Forbidden 위반 0% | ✅ |
| 평균 13초 응답 | ⚠ |

### 결론: **CONDITIONAL GO**

> ✅ KG country alias 5개 추가 commit + Vercel 재배포 즉시 → **GO**.
> ❌ 미배포 상태로 시연 → **NO-GO** (S07 노출 시 신뢰 직격).
