# General Question Routing Before / After

기준 질문 예시:

- `slotting 하는데 적절한 공구 형상은 어떤 것인가요`

이 문서는 현재 라우팅/검색 구조가 왜 일반 기술 질문에서도 불필요한 검색과 DB 조회를 유발하는지, 그리고 어떤 구조로 바꿔야 하는지를 `before / after` 기준으로 정리한다.

## 문제 요약

현재 구조에서는 `일반 기술 질문인지 확정하기 전에` V2 orchestrator가 먼저 실행되고, 이 단계에서 질문을 `continue_narrowing` 으로 오판하면 retrieval 과 evidence scoring 이 먼저 수행된다.

그 결과:

- 일반 기술 질문인데도 검색이 실행된다.
- 검색 후보 EDP 코드들에 대해 `findByCode(...)` 가 반복 호출된다.
- evidence 점수 계산이 과도하게 느려진다.
- V2 `displayedOptions` contract 불일치로 legacy fallback 이 발생한다.
- 결국 나중에 가서야 일반 설명 답변으로 처리된다.

## Before

### 현재 실제 흐름

```text
[사용자 질문]
  "slotting 하는데 적절한 공구 형상은 어떤 것인가요"
                 |
                 v
+------------------------------------------------------+
| serve-engine-runtime                                 |
| 목적: 현재 턴의 전체 진입점                          |
| 문제: V2 orchestrator를 먼저 실행                    |
+------------------------------------------------------+
                 |
                 v
+------------------------------------------------------+
| V2 orchestrator                                      |
| 목적: action / answer / surface 결정                 |
| 결과(오판 가능): continue_narrowing                  |
+------------------------------------------------------+
                 |
                 v
+------------------------------------------------------+
| hybrid retrieval 실행                                |
| 목적: 추천 후보 검색                                 |
| 문제: 일반 기술 질문에도 검색 진입                   |
+------------------------------------------------------+
                 |
                 v
+------------------------------------------------------+
| evidence scoring                                     |
| 목적: 후보별 evidence summary 생성                   |
| 동작: EvidenceRepo.buildSummary(candidateCode)       |
+------------------------------------------------------+
                 |
                 v
+------------------------------------------------------+
| product context 보강                                 |
| 목적: seriesName / diameterMm 같은 문맥 보강         |
| 동작: ProductRepo.findByCode(productCode)            |
| 문제: 후보 EDP별 개별 DB 조회 반복                   |
+------------------------------------------------------+
                 |
                 v
+------------------------------------------------------+
| V2 response build / validation                       |
| 목적: displayedOptions + chips + answer 직렬화       |
| 문제: displayedOptions.index / count 누락 가능       |
+------------------------------------------------------+
                 |
                 v
+------------------------------------------------------+
| V2 schema error -> legacy fallback                   |
| 결과: 앞에서 검색/DB 부하가 이미 발생한 뒤 fallback  |
+------------------------------------------------------+
                 |
                 v
+------------------------------------------------------+
| legacy general-chat                                  |
| 목적: 일반 질문 / 설명 질문 응답                     |
| 여기서야 slotting 을 일반 기술 질문으로 처리         |
+------------------------------------------------------+
```

### 현재 구조의 핵심 문제

1. 라우팅보다 검색이 먼저다.
2. 일반 질문 보호가 너무 늦다.
3. `검증` 과 `payload hydrate` 가 분리되어 있지 않다.
4. 후보별 `findByCode(...)` 호출이 evidence 단계에서 반복된다.
5. V2 와 legacy 가 같은 UI surface contract 를 공유하지 않는다.

### 현재 구조에서 DB가 쓰이는 이유

일반 질문 자체를 답하기 위해 DB를 쓰는 것이 아니라, 다음과 같은 이유로 DB가 먼저 섞인다.

1. 추천 검색 후보 생성
2. evidence summary 생성
3. evidence filtering 에 필요한 제품 문맥 보강
4. direct lookup 가능성 확인

즉 현재는 `질문 타입 확정 이전에 실행 비용이 큰 경로가 열려 있다`.

## After

### 목표 구조

```text
[사용자 질문]
                 |
                 v
+------------------------------------------------------+
| 상류 라우터                                           |
| 목적: 질문 타입을 먼저 확정                           |
| 출력 타입:                                            |
| - general_knowledge                                   |
| - direct_lookup                                       |
| - recommendation_action                               |
+------------------------------------------------------+
                 |
     +-----------+----------------------+----------------------+
     |                                  |                      |
     v                                  v                      v
+-----------------------+   +-----------------------+   +------------------------+
| general_knowledge     |   | direct_lookup         |   | recommendation_action  |
| 예: slotting, ball,   |   | 예: EDP, series,      |   | 예: 조건 좁히기, 비교, |
| taper 설명 질문       |   | brand, 재고, 절삭조건 |   | 추천 계속 진행         |
+-----------------------+   +-----------------------+   +------------------------+
     |                                  |                      |
     v                                  v                      v
+-----------------------+   +-----------------------+   +------------------------+
| retrieval 금지        |   | cheap verify          |   | retrieval 허용         |
| evidence 금지         |   | 목적: 존재 여부 확인  |   | evidence 허용          |
| direct lookup 금지    |   | 방식: exists / limit1 |   | scoring 허용           |
+-----------------------+   +-----------------------+   +------------------------+
     |                                  |                      |
     v                                  v                      v
+-----------------------+   +-----------------------+   +------------------------+
| 일반 설명 응답        |   | hydrate payload       |   | 추천/비교 응답         |
| 필요 시 web search    |   | 목적: 실제 응답 생성  |   |                        |
+-----------------------+   +-----------------------+   +------------------------+
```

## 핵심 설계 원칙

### 1. 질문 타입 확정이 검색보다 먼저 와야 한다

`slotting`, `ball`, `taper`, `blind hole`, `through hole` 같은 질문은 추천 검색이 아니라 일반 기술 설명 질문이다.

이런 질문은:

- retrieval 금지
- evidence scoring 금지
- direct lookup 금지
- 일반 설명 응답 경로로 직행

이어야 한다.

### 2. direct lookup 은 cheap verify -> hydrate 로 분리한다

현재는 `product / series / brand` 검증과 payload 획득을 한 번에 수행한다.

목표는 다음과 같다.

```text
현재:
candidate 추출
  -> product row 조회
  -> series row 조회
  -> brand row 조회

개선:
candidate 추출
  -> cheap verify (exists / limit 1)
  -> direct_lookup 확정 시에만 상세 row hydrate
```

### 3. recommendation_action 에만 retrieval 권한을 준다

retrieval 은 라우팅 결과가 `recommendation_action` 일 때만 실행한다.

즉:

- `general_knowledge` 는 검색 금지
- `direct_lookup` 는 검색 금지
- `recommendation_action` 만 검색 허용

이어야 한다.

### 4. V2 / legacy UI surface contract 를 단일화한다

모든 경로에서 `displayedOptions` 는 동일한 구조를 가져야 한다.

필수 필드:

- `index`
- `label`
- `field`
- `value`
- `count`

현재처럼 일부 경로에서 `{ label, field, value }` 만 쓰면 직렬화 시점에서 깨진다.

## Before / After 비교

| 항목 | Before | After |
|---|---|---|
| 질문 타입 판단 시점 | 검색 이후 또는 검색과 혼재 | 검색 이전 |
| 일반 기술 질문 처리 | V2 오판 시 retrieval 진입 가능 | 상류 라우터에서 즉시 general_knowledge |
| direct lookup 검증 | per-item 상세 row 조회 | cheap verify 후 필요 시 hydrate |
| evidence 단계 product lookup | 후보별 반복 호출 가능 | recommendation_action 에서만 제한적으로 허용 |
| V2 / legacy surface contract | 불일치 가능 | 단일 계약 공유 |
| 실패 시 영향 | 검색/DB 부하 후 fallback | 상류에서 비용 큰 경로 차단 |

## 개선 포인트

### 1. 상류 질문 타입 라우터 도입

책임:

- general knowledge
- direct lookup
- recommendation action

셋 중 하나를 먼저 결정

### 2. retrieval gate 도입

책임:

- `recommendation_action` 이 아닐 때 retrieval 금지
- evidence scoring 진입 금지

### 3. direct lookup resolver 분리

책임:

- candidate extraction
- cheap verify
- hydrate

세 단계를 분리

### 4. surface contract 공통화

책임:

- V2 buildSurface
- V2 validateSurface
- legacy reply builder
- presenter

전부 같은 `DisplayedOption` 형식을 공유

## 이 문서의 결론

현재 문제의 핵심은 `정규식이 부족해서` 가 아니라, 구조적으로 `질문 타입 확정보다 검색/검증이 먼저 실행되는 순서`에 있다.

따라서 개선 방향은 다음과 같다.

1. 상류에서 질문 타입을 먼저 확정한다.
2. 일반 기술 질문에는 retrieval/evidence/lookup 을 열지 않는다.
3. direct lookup 은 cheap verify 와 hydrate 를 분리한다.
4. V2 와 legacy 의 UI surface contract 를 단일화한다.

이 네 가지가 우선순위다.

## Regression Timeline

이번 문제는 한 번에 생긴 것이 아니라, 2026-03-25 하루 동안 V2 관련 변경이 빠르게 누적되면서 잠복 결함이 실사용 경로로 올라온 케이스다.

### 1. V2 뼈대 도입

- 커밋: `7e670b2`
- 시각: `2026-03-25 12:25:56 +0900`
- 메시지: `feat: Phase 1 — V2 Core Types + Turn Orchestrator Skeleton`

의미:

- V2 `turn-orchestrator` 와 `core/types` 가 처음 들어왔다.
- 이 시점은 아직 feature flag 기본값이 false 였고, 기존 코드 영향은 제한적이었다.

정리:

- 문제를 바로 폭발시킨 시점은 아님
- 다만 이후 V2 경로가 확장될 기반이 만들어진 시점

### 2. V2 validator 도입 + surface contract 결함 유입

- 커밋: `29bdc09`
- 시각: `2026-03-25 12:44:31 +0900`
- 메시지: `feat: Phase 2 Validator — 5개 fact safety 검증 구현`

이 시점에 들어온 핵심:

- `response-validator.ts` 추가
- `displayedOptions` 를 `{ label, field?, value? }` 수준으로 다룸
- empty fallback 에서 `index`, `count` 없는 option 생성

왜 중요한가:

- API / presenter 쪽은 `displayedOptions.index`, `count` 를 필수로 요구한다.
- 따라서 이 시점에 V2 surface contract 와 API contract 가 어긋났다.

즉:

- 현재 보이는 `displayedOptions[0].index undefined`
- `displayedOptions[0].count undefined`

는 이 시점에 유입된 결함이다.

### 3. V2가 실제 검색을 타기 시작한 시점

- 커밋: `2dfaa5c`
- 시각: `2026-03-25 12:47:54 +0900`
- 메시지: `feat: Phase 2 Search Planner — hybrid-retrieval 실제 연결`

이 시점에 들어온 핵심:

- `executeSearchIfNeeded(...)` 가 stub 에서 실제 `hybrid-retrieval` 호출로 연결됨
- `shouldSearch(...)` 기준으로 V2 decision 이 검색 실행 권한을 가짐

왜 중요한가:

- 이 시점부터 V2 decision 이 잘못되면 실제 검색과 evidence scoring 이 돈다.
- 즉 일반 질문이 `continue_narrowing` 으로 오판되면 비용 큰 검색 경로에 진입할 수 있게 되었다.

정리:

- V2 contract bug 는 이미 있었고
- 이 시점부터 그 bug 가 실제 expensive path 와 결합될 준비가 완료되었다.

### 4. refinement / result follow-up surface 확대

- 커밋: `3b6cbae`
- 시각: `2026-03-25 12:55:25 +0900`
- 메시지: `feat: Phase 3 Result Refinement — 추천 후 날수/코팅으로 실제 좁히기`

이 시점에 들어온 핵심:

- `refine_current_results`
- refinement option surface
- V2 결과 surface 가 더 복잡해짐

왜 중요한가:

- V2가 생성해야 하는 `displayedOptions` 경로가 늘었다.
- contract mismatch 가 터질 표면적도 같이 커졌다.

### 5. 문제의 실사용 폭발 시점

- 커밋: `7a318f6`
- 시각: `2026-03-25 14:21:15 +0900`
- 메시지: `feat: Phase 6 — V2 Orchestrator 기본 전환 + 레거시 fallback`

이 시점에 들어온 핵심:

- `USE_NEW_ORCHESTRATOR` 기본값 true
- runtime 최상단에서 V2 먼저 실행
- 실패 시 legacy fallback

왜 중요한가:

- 이전까지는 잠복해 있던 V2 경로가 기본 실행 경로가 되었다.
- 그래서:
  - 일반 질문도 먼저 V2 판단을 타고
  - V2가 `continue_narrowing` 으로 오판하면 retrieval/evidence 경로에 진입하고
  - 이후 contract mismatch 로 에러가 나며
  - legacy fallback 이 발생한다.

즉:

- 이번 문제를 사용자 체감 수준으로 터뜨린 결정적 시점은 이 커밋이다.

### 6. 증상 증폭 시점

- 커밋: `c879e18`
- 시각: `2026-03-25 14:36:22 +0900`
- 메시지: `feat: Phase 7 — 성능 최적화 (LLM 1회 통합, DB 캐시, 타이밍 로그)`

이 시점에 들어온 핵심:

- V2 LLM prompt 강화
- 최근 6턴 문맥 전달
- 1회 호출 통합
- perf logging 추가

왜 중요한가:

- 이 커밋이 contract mismatch 자체를 만든 것은 아니다.
- 하지만 V2 오판과 expensive search 가 더 뚜렷하게 보이게 만들었다.
- 현재 로그의 `hybrid timings`, `v2_orchestrator=...ms` 는 이 시점 이후 관측된다.

### 7. 오늘 추가된 별도 부하 요인

- 상태: `uncommitted`
- 날짜: `2026-03-26`
- 위치: `serve-engine-assist.ts`

내용:

- `resolveDirectLookupEntities(...)`
- 후보별 `ProductRepo.findByCode(...)`
- 후보별 `EntityProfileRepo.findSeriesProfiles(...)`
- 후보별 `EntityProfileRepo.findBrandProfiles(...)`

의미:

- 이번 `slotting` 로그의 주된 `P277...` evidence 부하의 직접 원인은 아니다.
- 하지만 direct lookup 질문에서 per-item fan-out 부하를 추가로 만들 수 있는 별도 위험 요소다.

## Timeline Summary

```text
2026-03-25 12:25  V2 뼈대 도입
2026-03-25 12:44  V2 validator 도입 + displayedOptions contract 결함 유입
2026-03-25 12:47  V2 search planner 실제 연결
2026-03-25 12:55  refinement/result-followup surface 확대
2026-03-25 14:21  V2 기본 활성화 -> 실사용에서 문제 폭발
2026-03-25 14:36  성능 계측/문맥 통합 -> 증상 가시화/증폭
2026-03-26       direct lookup fan-out 변경 추가 (uncommitted)
```

## 결론

이번 문제를 가장 직접적으로 터뜨린 커밋은:

- `7a318f6`
- `feat: Phase 6 — V2 Orchestrator 기본 전환 + 레거시 fallback`

다만 근본 원인은 그 전에 이미 들어와 있었다.

- `29bdc09`: V2 surface contract mismatch 유입
- `2dfaa5c`: V2 search actual execution 연결

즉 현재 증상은:

1. contract bug
2. early search execution
3. default V2 enable

이 세 가지가 합쳐져서 나타난 결과다.
