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
