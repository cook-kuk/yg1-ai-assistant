# Performance / Concurrency Note — 병렬 처리 검토

**작성일**: 2026-04-07
**원칙**: 병렬 처리는 정확성을 해치지 않는 범위에서만, feature flag 기반 제한 적용. 이번 턴에서 새로 구현한 병렬 처리는 **없음** — 후보 지점 식별 + 안전성 평가만 수행.

---

## 1. 현재 상태 (이미 구현 vs 검토만 함)

| 항목 | 상태 |
|---|---|
| 추천 파이프라인 자체의 병렬 처리 | **미구현 (직렬 흐름)** |
| Schema/manifest prefetch | 일부 lazy load — dedupe 미적용 |
| Cold start warmup | 명시적 warmup 호출 없음 |
| Concurrent warmup dedupe | 없음 (race condition 노출) |
| Read-only trace aggregation | 직렬 |
| 비동기 logging | 일부 fire-and-forget |
| Planner/Compiler/E2E latency 측정 | 미분리 (E2E total만 측정) |

---

## 2. E2E latency 관찰 (deployed Vercel, 10 scenarios)

| 항목 | ms |
|---|---|
| 평균 | **13,235** |
| 최대 | **33,747** (S06 멀티턴 3 turn) |
| 최소 | 1,309 (S10 짧은 응답) |
| 총 10 시나리오 런타임 | 132,179 |

> 계측한 것은 HTTP 왕복 + 서버 처리 합계. cold start vs warm vs planner vs DB 분리 측정은 다음 단계.

---

## 3. 병렬 처리 후보 지점 식별

### A. 병렬화에 적합한 후보 (LOW RISK)

| 지점 | 이유 | 예상 효과 |
|---|---|---|
| **Schema/manifest prefetch** (`lib/recommendation/core/sql-agent-schema-cache.ts`) | read-only, 한 번 로드 후 캐시 | cold start -1~2 s |
| **Brand list prefetch** (DB schema cache의 brands) | KG와 SQL Agent 양쪽이 사용 | 병렬 fetch로 단축 가능 |
| **Concurrent warmup dedupe** | 첫 요청 2개 동시 도착 시 중복 schema fetch 방지 | 콜드스타트 race 제거 |
| **Trace/log aggregation** | side-effect 무관 | latency 무영향, 일관성 향상 |
| **Embedding & BM25 retrieval** (`runHybridRetrieval` 내부) | 두 검색이 독립적 | retrieval 단계 -30~50% |

### B. 병렬화 부적합 / 매우 조심해야 할 곳 (HIGH RISK)

| 지점 | 이유 |
|---|---|
| **Edit-intent apply** (filters mutation) | 직렬 의존 — splice + push 순서 중요 |
| **State mutation in `serve-engine-runtime.ts:1654-1784`** | 필터 배열의 turn-by-turn 일관성 |
| **Top recommendation card recompute** | 필터 적용 직후 결과여야 함 — race 시 stale 카드 위험 |
| **DB filter apply 직전 단계** | 고객 피드백 카테고리 A/C의 근원 — 절대 race 금지 |
| **resolveExplicitRevisionRequest** | 사용자 의도 해석은 turn 단위 직렬 |

### C. 검토만 한 항목 (이번 턴 미실행)

- 동일 query 5회 반복 stress test → 안정성 측정
- planner-only / DB-only latency 분리 instrumentation
- LLM 호출(Haiku) 병렬화 vs 단일 호출 비교

---

## 4. 권장 (제한적 적용 / feature flag)

| 단계 | 권장 행동 |
|---|---|
| **1. 즉시 (low risk, 정확도 무영향)** | Schema/brand prefetch를 앱 부팅 시 1회 비동기 트리거 (await 없음). dedupe Promise singleton. |
| **2. 단기 (옵트인)** | `runHybridRetrieval` 내 BM25/embedding `Promise.all` — feature flag `RETRIEVAL_PARALLEL=1` |
| **3. 중기 (관찰 후)** | E2E latency를 planner/compiler/retrieval/render로 분리 instrumentation. 진짜 병목 식별. |
| **4. 절대 금지** | edit-intent apply, filter splice, top card recompute 어떤 것도 race 처리 금지 |

---

## 5. 보고 형식 요약

| 항목 | 상태 |
|---|---|
| 구현한 것 | **없음** |
| 실험만 한 것 | E2E latency 관찰 (10 시나리오) |
| 새로 제안한 것 | Schema/brand prefetch dedupe + retrieval BM25/embedding 병렬 (flag) |
| 성능 개선 기대치 | cold start -1~2 s, retrieval -30% |
| 정확도/정합성 리스크 | 0 (read-only 영역만) |
| 적용 조건 | feature flag + rollback 가능 + dedupe 단위 테스트 |

---

## 6. 다음 단계

1. planner / compiler / retrieval / render 단위로 trace timing 분리 (정확도 영향 0)
2. 동일 query 5회 consistency test (top1 변화율 측정)
3. cold vs warm 첫 호출 latency 분리 측정
4. 위 측정 결과로 진짜 병목 정해진 후 1단계 제한 병렬 적용
