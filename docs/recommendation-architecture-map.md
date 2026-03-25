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

### 1. Top-level engine topology

```text
[Browser / app/products/page.tsx]
              |
              v
[lib/frontend/recommendation/*]
              |
              v
[app/api/recommend/route.ts]
              |
              v
[infrastructure/http/recommendation-http.ts]
              |
              v
      +-----------------------------------+
      | RecommendationService             |
      | defaultEngineId = "serve"         |
      | engines = ["serve", "main"]       |
      +-----------------------------------+
              |
              v
   +-------------------------------+
   | RecommendationEnginePort      |
   | - runSession(...)             |
   | - runLegacyChat(...)          |
   +-------------------------------+
              |
      +-------+--------+
      |                |
      v                v
+-------------+   +-------------+
| serve-engine|   | main-engine |
| engineId=   |   | engineId=   |
| "serve"     |   | "main"      |
+-------------+   +-------------+
      |                |
      +-------+--------+
              |
              v
   same runtime wiring today
              |
      +-------+------------------------------+
      |                                      |
      v                                      v
[handleServeExploration(...)]       [handleServeSimpleChat(...)]
 session/intake path                legacy chat path
```

Current code note:

- `serve` and `main` are separate engine IDs, but both are currently wired to the same runtime callbacks in `recommendation-http.ts`.
- The real behavioral center is `serve-engine-runtime.ts`, not the thin `main-engine.ts` / `serve-engine.ts` wrappers.

### 2. `handleServeExploration` runtime structure

```text
[handleServeExploration]
          |
          v
+----------------------------------------------+
| bootstrap                                    |
| - map intake -> input                        |
| - load prevState / filters / pagination      |
| - prepareRequest(...)                        |
+----------------------------------------------+
          |
          v
  message exists?
    | yes
    v
+----------------------------------------------+
| pre-routing guards                           |
| - pending action cleanup                     |
| - explicit compare detection                 |
| - explicit filter revision detection         |
| - classifyPreSearchRoute(...)                |
+----------------------------------------------+
          |
          +------------------------------+
          | non-recommendation           |
          v                              |
[handleServeGeneralChatAction]           |
                                         |
                                         v
+----------------------------------------------+
| optional V2 bridge                           |
| - shouldUseV2ForPhase(...)                   |
| - orchestrateTurnV2(...)                     |
| - either return V2 response directly         |
|   or bridge into legacy action               |
+----------------------------------------------+
          |
          v
+----------------------------------------------+
| early action decision                        |
| - pending selection -> continue/skip         |
| - otherwise orchestrateTurn(...)             |
|   or orchestrateTurnWithTools(...)           |
+----------------------------------------------+
          |
          v
+----------------------------------------------+
| retrieval gate                               |
| - skip retrieval for:                        |
|   compare / explain / answer_general /       |
|   refine_condition / filter_by_stock         |
| - else runHybridRetrieval(...)               |
+----------------------------------------------+
          |
          v
+----------------------------------------------+
| action execution                             |
| - reset_session                              |
| - go_back_one_step / go_back_to_filter       |
| - show_recommendation                        |
| - filter_by_stock                            |
| - refine_condition                           |
| - compare_products                           |
| - explain_product / answer_general           |
| - redirect_off_topic                         |
| - skip_field                                 |
| - replace_existing_filter                    |
| - continue_narrowing                         |
+----------------------------------------------+
          |
          v
   +-------------------------------+   +-------------------------------+
   | buildQuestionResponse(...)    |   | buildRecommendationResponse(...)|
   | question / narrowing surface  |   | resolved recommendation surface |
   +-------------------------------+   +-------------------------------+
```

### 3. Module relationship around the runtime

```text
serve-engine-runtime.ts
  |
  +-- pre-search-route.ts
  |     general-vs-recommendation guard
  |
  +-- infrastructure/agents/orchestrator.ts
  |     legacy action routing
  |
  +-- core/turn-orchestrator.ts
  |     V2 single-turn orchestrator bridge
  |
  +-- domain/recommendation-domain.ts
  |     prepareRequest / retrieval / restore helpers
  |
  +-- serve-engine-general-chat.ts
  |     general answer / explanation handling
  |
  +-- serve-engine-response.ts
  |     question/recommendation response builders
  |
  +-- serve-engine-option-first.ts
  |     displayedOptions / chips builders
  |
  +-- presenters/recommendation-presenter.ts
        final DTO serialization
```

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
