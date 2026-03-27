# Recommendation Architecture Map

## Current Active Flow

The active recommendation request path is now:

1. `app/products/page.tsx`
2. `lib/frontend/recommendation/*`
3. `app/api/recommend/route.ts`
4. `lib/recommendation/infrastructure/http/recommendation-http.ts`
5. `lib/recommendation/application/recommendation-service.ts`
6. `lib/recommendation/infrastructure/engines/*`
7. `lib/recommendation/domain/*`
8. `lib/recommendation/infrastructure/presenters/recommendation-presenter.ts`
9. `lib/contracts/recommendation.ts`

## Engine Structure (ASCII)

아래 다이어그램은 "파일이 어떻게 연결되어 있는가"보다 "요청이 들어왔을 때 어떤 판단 순서로 로직이 실행되는가"에 초점을 맞춘다.

### 1. 엔진 선택 구조

```text
[브라우저 화면]
  app/products/page.tsx
          |
          v
[프론트 추천 클라이언트]
  lib/frontend/recommendation/*
  - 요청 DTO 구성
  - 세션 상태 보관
  - API 호출
          |
          v
[API 진입점]
  app/api/recommend/route.ts
          |
          v
[HTTP 조립 레이어]
  infrastructure/http/recommendation-http.ts
  - 요청 body 파싱
  - sessionState 복원
  - runtime dependency 조립
          |
          v
+--------------------------------------------------+
| RecommendationService                            |
| - engineId를 보고 어떤 엔진 포트를 탈지 결정     |
| - intakeForm이 있으면 runSession(...)            |
| - intakeForm이 없으면 runLegacyChat(...)         |
+--------------------------------------------------+
          |
          v
+--------------------------------------------------+
| RecommendationEnginePort                         |
| - 공통 인터페이스                                |
| - runSession(command)                            |
| - runLegacyChat(command)                         |
+--------------------------------------------------+
          |
     +----+------------------+
     |                       |
     v                       v
+------------------+   +------------------+
| serve-engine     |   | main-engine      |
| engineId=serve   |   | engineId=main    |
| 얇은 wrapper     |   | 얇은 wrapper     |
+------------------+   +------------------+
     |                       |
     +-----------+-----------+
                 |
                 v
     현재는 둘 다 같은 runtime 사용
                 |
        +--------+----------------------+
        |                               |
        v                               v
[handleServeExploration(...)]   [handleServeSimpleChat(...)]
추천 세션 / 질의응답 경로        단순 레거시 채팅 경로
```

설명:

- `RecommendationService`는 실제 추천 로직을 직접 수행하지 않고, 어떤 엔진 포트를 부를지 선택하는 서비스 레이어다.
- `serve-engine.ts`, `main-engine.ts`는 엔진처럼 보이지만 현재 구현에서는 거의 "이름표 + 포워더" 역할만 한다.
- 실제 분기와 판단은 대부분 `serve-engine-runtime.ts` 안의 `handleServeExploration(...)`에 집중되어 있다.
- 현재 코드 기준으로 `serve`와 `main`은 서로 다른 `engineId`를 가지지만, `recommendation-http.ts`에서 동일한 runtime callback에 연결되어 있어 동작상 큰 차이가 없다.

### 2. `handleServeExploration`의 실제 판단 순서

```text
[handleServeExploration]
          |
          v
+------------------------------------------------------+
| 1. 초기 준비                                         |
| - intake form -> recommendation input 변환          |
| - prevState에서 appliedFilters, resolvedInput 복원  |
| - pagination 계산                                   |
| - prepareRequest(...) 실행                           |
+------------------------------------------------------+
          |
          v
  [메시지가 있는가?]
          |
     +----+----+
     |         |
    no        yes
     |         |
     |         v
     |   +--------------------------------------------------+
     |   | 2. 사전 보호 분기                                |
     |   | - pendingAction 만료/override 정리               |
     |   | - 명시적 비교 요청 감지                          |
     |   |   예: "1번이랑 2번 비교"                         |
     |   | - 명시적 필터 교체 요청 감지                     |
     |   |   예: "TiAlN 말고 DLC로 바꿔줘"                  |
     |   | - classifyPreSearchRoute(...)                    |
     |   |   일반 설명 질문이면 검색 전에 차단              |
     |   +--------------------------------------------------+
     |                     |
     |                     v
     |          [추천 액션이 아닌가?]
     |                     |
     |               +-----+------+
     |               |            |
     |              yes          no
     |               |            |
     |               v            v
     |   [handleServeGeneralChatAction]   계속 진행
     |   - 일반 질문 답변
     |   - 제품 설명/회사 정보/설명형 응답
     |   - retrieval 없이 처리 시도
     | 
     +----------------------------------------------+
                                                    |
                                                    v
+------------------------------------------------------+
| 3. V2 오케스트레이터 브리지 시도                      |
| - shouldUseV2ForPhase(...)로 phase 확인              |
| - orchestrateTurnV2(...) 호출                        |
| - 경우 A: V2가 searchPayload까지 만들면 즉시 응답     |
| - 경우 B: V2 결과를 legacy action으로 변환해 계속     |
| - 경우 C: 에러면 legacy path로 fallback              |
+------------------------------------------------------+
          |
          v
+------------------------------------------------------+
| 4. early action 결정                                 |
| - pending selection이면 continue_narrowing/skip_field|
| - 아니면 orchestrateTurn(...) 또는                    |
|   orchestrateTurnWithTools(...) 실행                  |
| - 여기서 현재 턴의 action.type이 정해짐               |
+------------------------------------------------------+
          |
          v
+------------------------------------------------------+
| 5. retrieval 실행 여부 결정                          |
| - 다음 액션이면 검색 생략                            |
|   compare_products                                   |
|   explain_product                                    |
|   answer_general                                     |
|   refine_condition                                   |
|   filter_by_stock                                    |
| - 그 외 액션이면 runHybridRetrieval(...) 실행        |
+------------------------------------------------------+
          |
          v
+------------------------------------------------------+
| 6. action 실행                                       |
| - reset_session                                      |
| - go_back_one_step / go_back_to_filter               |
| - show_recommendation                                |
| - filter_by_stock                                    |
| - refine_condition                                   |
| - compare_products                                   |
| - explain_product / answer_general                   |
| - redirect_off_topic                                 |
| - skip_field                                         |
| - replace_existing_filter                            |
| - continue_narrowing                                 |
+------------------------------------------------------+
          |
          v
   [질문 상태인가?] ------------------- yes --> buildQuestionResponse(...)
          |
          no
          |
          v
 buildRecommendationResponse(...)
```

설명:

- 이 함수의 핵심은 "사용자 입력을 바로 검색으로 보내지 않고, 먼저 어떤 종류의 턴인지 판별한다"는 점이다.
- 특히 `classifyPreSearchRoute(...)`는 일반 질문을 추천 검색 경로에서 먼저 분리하는 보호막 역할을 한다.
- 이후 V2가 켜져 있으면 V2 오케스트레이터를 먼저 시도하지만, 실패하거나 legacy 액션으로 연결이 필요하면 다시 기존 runtime 흐름으로 돌아온다.
- 최종적으로는 `action.type`이 무엇인지가 중요하다. 이 값이 정해져야 검색이 필요한지, 비교인지, 질문 응답인지, 추천 결과를 보여줘야 하는지가 결정된다.

### 3. retrieval 관점에서 다시 본 로직

```text
[사용자 입력]
      |
      v
[pre-search route]
      |
      +------------------------------+
      | general / explain 성격       |
      | "이 코팅 차이가 뭐예요?"      |
      | "부산영업소 알려줘"           |
      +------------------------------+
      |                              |
      v                              |
[검색 진입 금지]                     |
      |                              |
      v                              |
[general chat handler]               |
                                     |
                                     v
                         +------------------------------+
                         | recommendation action 성격   |
                         | "2날로 좁혀줘"               |
                         | "이전 단계로"               |
                         | "추천 결과 보여줘"          |
                         +------------------------------+
                                     |
                                     v
                           [orchestrator action 결정]
                                     |
                                     v
                           [retrieval 필요 여부 판단]
                                     |
                         +-----------+-----------+
                         |                       |
                        no                      yes
                         |                       |
                         v                       v
                [기존 state 기반 응답]   [runHybridRetrieval(...)]
                예: 비교, 설명, 재고필터     후보 재조회 + evidence 계산
```

설명:

- 이 구조를 이해할 때 가장 중요한 기준은 "모든 턴이 검색으로 가는 것이 아니다"라는 점이다.
- 비교, 일반 설명, 일부 후속 응답은 이미 가진 세션 상태와 화면 snapshot만으로 처리할 수 있다.
- 반대로 필터가 실제로 바뀌거나, 후보군을 다시 계산해야 하는 경우에만 `runHybridRetrieval(...)`이 실행된다.
- 즉 runtime은 "항상 검색하는 엔진"이 아니라 "필요할 때만 검색을 여는 세션 오케스트레이터"에 가깝다.

### 4. 액션별 실행 로직 요약

```text
action.type = reset_session
  -> 세션 초기화 응답 반환

action.type = go_back_one_step / go_back_to_filter
  -> 이전 filter 상태 복원
  -> retrieval 재실행
  -> 다시 question surface 구성

action.type = show_recommendation
  -> 현재 후보/상태로 recommendation surface 구성

action.type = filter_by_stock
  -> 기존 displayedCandidates만 후처리
  -> 전체 retrieval는 다시 돌리지 않음

action.type = refine_condition
  -> 어떤 필드를 다시 물을지 정함
  -> displayedOptions / chips 재구성
  -> question mode 유지

action.type = compare_products
  -> 비교 대상 해석
  -> 비교 텍스트 생성
  -> comparison mode 전환

action.type = explain_product / answer_general
  -> general chat handler로 위임
  -> 필요 시 side-question suspend 처리

action.type = skip_field
  -> 현재 pending field를 skip filter로 반영
  -> retrieval 재실행

action.type = replace_existing_filter
  -> 기존 filter 제거 후 새 filter로 교체
  -> retrieval 재실행

action.type = continue_narrowing
  -> 새 filter 적용
  -> retrieval 재실행
  -> resolved 여부에 따라 질문/추천 응답 분기
```

설명:

- `filter_by_stock`이 특이한 이유는 "이미 보여준 후보"를 후처리하는 액션이라서 전체 검색을 다시 하지 않는다는 점이다.
- `skip_field`, `replace_existing_filter`, `continue_narrowing`은 모두 세션의 필터 상태를 바꾸므로 검색을 다시 돌릴 가능성이 높다.
- `answer_general`, `explain_product`, `compare_products`는 상대적으로 "세션 이해 + 응답 생성" 중심이고, 항상 retrieval이 필요한 것은 아니다.

### 5. runtime 주변 모듈 관계

```text
serve-engine-runtime.ts
  |
  +-- recommendation-http.ts
  |     runtime dependency를 조립해서 주입
  |
  +-- recommendation-service.ts
  |     어떤 엔진 포트를 탈지 결정
  |
  +-- pre-search-route.ts
  |     검색 전에 일반 질문을 차단하는 상류 라우터
  |
  +-- infrastructure/agents/orchestrator.ts
  |     legacy action routing
  |
  +-- core/turn-orchestrator.ts
  |     V2 판단 및 searchPayload 생성 가능
  |
  +-- domain/recommendation-domain.ts
  |     prepareRequest, retrieval, restore helper 제공
  |
  +-- serve-engine-general-chat.ts
  |     일반 답변 / 설명형 응답 처리
  |
  +-- serve-engine-response.ts
  |     최종 question / recommendation 응답 surface 생성
  |
  +-- serve-engine-option-first.ts
  |     chips, displayedOptions 생성
  |
  +-- recommendation-presenter.ts
        DTO 직렬화 및 응답 포맷 정리
```

설명:

- `serve-engine-runtime.ts`는 혼자서 모든 일을 하지 않는다. 다만 "누구를 언제 호출할지"를 가장 많이 결정하는 조정자다.
- `recommendation-domain.ts`는 계산과 상태 복원 쪽, `serve-engine-general-chat.ts`는 설명형 응답 쪽, `serve-engine-response.ts`는 화면에 내려줄 payload 조립 쪽 책임이 강하다.
- 따라서 엔진 구조를 볼 때는 "runtime이 중심이고, 나머지 모듈은 runtime이 호출하는 전문 처리기들"이라고 이해하는 편이 가장 정확하다.

## Boundary Rules

### Frontend

Frontend should depend on:

- `lib/frontend/recommendation/*`
- `lib/contracts/recommendation.ts`

Frontend should not depend on:

- `lib/domain/*`
- `lib/types/exploration.ts`
- raw repository modules
- recommendation engine internals

### Recommendation Backend

Recommendation backend should depend on:

- `lib/recommendation/domain/*`
- `lib/recommendation/application/*`
- `lib/recommendation/infrastructure/*`
- `lib/contracts/recommendation.ts`

Recommendation backend should avoid direct imports from:

- `lib/domain/*`
- `lib/types/exploration.ts`

unless the module is still explicitly treated as legacy compatibility code.

### Contracts

`lib/contracts/recommendation.ts` is the public API contract between frontend and backend.

It should contain:

- request DTOs
- response DTOs
- public session DTOs
- zod validation

It should not contain:

- mutable engine state logic
- repository logic
- UI-only view logic

## Current Recommendation Structure

### UI and client state

- `lib/frontend/recommendation/use-product-recommendation-page.ts`
- `lib/frontend/recommendation/recommendation-client.ts`
- `lib/frontend/recommendation/recommendation-view-model.ts`
- `lib/frontend/recommendation/exploration-flow.tsx`

### Application layer

- `lib/recommendation/application/recommendation-service.ts`
- `lib/recommendation/application/ports/recommendation-engine-port.ts`

### Domain layer

- `lib/recommendation/domain/session-manager.ts`
- `lib/recommendation/session-kernel.ts`
- `lib/recommendation/domain/context/*`
- `lib/recommendation/domain/options/*`
- `lib/recommendation/domain/memory/*`

### Infrastructure layer

- `lib/recommendation/infrastructure/http/*`
- `lib/recommendation/infrastructure/engines/*`
- `lib/recommendation/infrastructure/engines/serve-engine-general-chat.ts`
- `lib/recommendation/infrastructure/engines/serve-engine-simple-chat.ts`
- `lib/recommendation/infrastructure/agents/*`
- `lib/recommendation/infrastructure/presenters/*`
- `lib/recommendation/infrastructure/repositories/*`
- `lib/recommendation/infrastructure/llm/*`

## Source Of Truth Rules

For recommendation restore/back behavior, the durable source of truth remains engine session state, especially:

- `displayedProducts`
- `displayedOptions`
- `displayedSeriesGroups`
- `lastRecommendationArtifact`
- `lastComparisonArtifact`
- `uiNarrowingPath`
- checkpoint history

Any refactor touching these fields must verify:

- slot replacement consistency
- candidate count consistency
- displayed product persistence
- displayed series group persistence
- UI/session synchronization
- restore target correctness

## Refactor Status

Completed in this pass:

- active recommendation session kernel imports now point to `lib/recommendation/domain/*`
- active option bridge imports now point to `lib/recommendation/domain/types`
- regression coverage added for persisted `displayedSeriesGroups` and rebuilt `uiNarrowingPath`
- `serve-engine-runtime.ts` now delegates general/explain handling to `serve-engine-general-chat.ts`
- legacy simple-chat flow moved out to `serve-engine-simple-chat.ts`
- regression coverage added for pending-question explanation preserving `question` mode and `lastAskedField`

## Next Refactor Candidates

### Candidate 1: reduce duplicate legacy type surfaces

There are still compatibility exports around:

- `lib/types/exploration.ts`
- `lib/recommendation/domain/types.ts`

Next step is to decide whether `lib/types/*` remains a pure compatibility layer or gets fully retired.

### Candidate 2: isolate session artifacts

`lib/recommendation/session-kernel.ts` owns artifact repair and persistence logic.

If it keeps growing, split it into:

- session artifact accessors
- session repair/finalization
- restore question state helpers

### Candidate 3: shrink `serve-engine-runtime.ts`

`lib/recommendation/infrastructure/engines/serve-engine-runtime.ts` is still the densest active file.

Good extraction targets:

- restore/back handlers
- action-specific response builders

Status:

- general chat overlay handlers extracted
- simple chat extracted

### Candidate 4: retire old `lib/agents/*` path

There is still a legacy agent tree outside `lib/recommendation/infrastructure/agents/*`.

If it is no longer used by active routes, it should be frozen as compatibility-only or removed in a later pass.
