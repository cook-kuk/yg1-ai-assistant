# cook-forge MVP

This repository is the current reconstructed MVP snapshot of the YG-1 industrial recommendation system. It is not a generic chatbot. The product goal is a stateful recommendation workflow where deterministic session state drives UI behavior, narrowing, restore flows, and artifact generation.

The framing in this README is an estimate based on the repository layout and checked files as of 2026-04-22:

- Frontend shell: root-level Next.js app (`app/`, `components/`, `lib/frontend/`)
- Recommendation runtime: root-level TypeScript domain modules (`lib/recommendation/`)
- Backend service: FastAPI app in [`python-api/`](python-api)
- Data, knowledge, and eval assets: `data/`, `knowledge/`, `testset/`, `benchmark-results/`, `reports/`

## MVP Scope

The MVP currently appears to cover:

- Conversational product recommendation with persisted session state
- Next.js proxy routes that forward product/filter requests to FastAPI
- Candidate ranking, narrowing, restore semantics, and comparison artifacts
- QA coverage with Playwright, Vitest, goldens, probes, and benchmark outputs

State continuity is the core contract. The important persisted fields called out by project guidance are:

- `displayedProducts`
- `displayedOptions`
- `displayedSeriesGroups`
- `lastRecommendationArtifact`
- `lastComparisonArtifact`
- `uiNarrowingPath`
- checkpoint history

Related implementation references:

- [`lib/recommendation/session-kernel.ts`](lib/recommendation/session-kernel.ts)
- [`e2e/13-recommendation-artifact-persistence.spec.ts`](e2e/13-recommendation-artifact-persistence.spec.ts)
- [`e2e/14-recommendation-state-regressions.spec.ts`](e2e/14-recommendation-state-regressions.spec.ts)

## Estimated Reconstruction Framing

This repo does not currently use `backend/` and `frontend/` directories. For local work, the practical split is:

- "Frontend": the root Next.js app
- "Backend": `python-api/`

That matters because browser calls hit same-origin Next.js routes first, then proxy to the FastAPI service through `PYTHON_API_URL`.

Relevant files:

- [`app/api/_lib/python-proxy.ts`](app/api/_lib/python-proxy.ts)
- [`app/api/products/route.ts`](app/api/products/route.ts)
- [`app/api/products/stream/route.ts`](app/api/products/stream/route.ts)
- [`app/api/filter-options/route.ts`](app/api/filter-options/route.ts)
- [`python-api/main.py`](python-api/main.py)

## Local Setup

### Prerequisites

- Node.js compatible with this repo's current toolchain
- `pnpm` available
- Python 3.11+ recommended
- PostgreSQL reachable from the app using values in `.env`
- Optional LLM API keys if you need live model-backed flows

### 1. Configure Environment

```bash
cp .env.example .env
```

Important values from `.env.example`:

- `DATABASE_URL` or `PG*` connection values
- `PYTHON_API_URL=http://127.0.0.1:8010`
- `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` if live model calls are needed

### 2. Start the Backend Service

```bash
cd /home/seungho/cook-forge/python-api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8010
```

Sanity check:

```bash
curl http://127.0.0.1:8010/health
```

### 3. Start the Frontend Shell

From the repository root:

```bash
cd /home/seungho/cook-forge
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3000`.

### 4. Production-like Frontend Startup

If you need the Next standalone launcher already included in the repo:

```bash
pnpm build
node scripts/start-standalone.mjs
```

## Sample MVP Workflow

1. Start PostgreSQL, FastAPI, and Next.js.
2. Open the app and issue a recommendation request such as "stainless 4 flute 10mm end mill".
3. Confirm the initial result list is backed by `displayedProducts`, not just chat text.
4. Narrow by series or subtype and confirm `displayedSeriesGroups` and `uiNarrowingPath` update together.
5. Trigger restore behavior and verify the action boundary:
   `undo_step`, `restore_previous_group`, and `resume_previous_task` should behave distinctly.
6. Compare products and confirm any comparison UI aligns with `lastComparisonArtifact`.
7. Reopen the flow or continue the conversation and confirm prior recommendation state is restored instead of silently reset.

Sample placeholder artifacts for this workflow live under [`fixtures/`](fixtures).

## Fixtures And Artifact References

New illustrative fixtures:

- [`fixtures/README.md`](fixtures/README.md)
- [`fixtures/sample-session/request.json`](fixtures/sample-session/request.json)
- [`fixtures/sample-session/session-state.json`](fixtures/sample-session/session-state.json)
- [`fixtures/sample-session/recommendation-artifact.json`](fixtures/sample-session/recommendation-artifact.json)
- [`fixtures/sample-session/comparison-artifact.json`](fixtures/sample-session/comparison-artifact.json)
- [`fixtures/sample-session/workflow-notes.md`](fixtures/sample-session/workflow-notes.md)

Existing repo artifact references:

- Benchmark outputs: [`benchmark-results/`](benchmark-results)
- Curated regression inputs: [`testset/`](testset)
- Release-gate and state regression tests: [`e2e/`](e2e)
- Investigation notes: [`eval/INVESTIGATION.md`](eval/INVESTIGATION.md)

## Verification

Core checks from the root:

```bash
pnpm test
pnpm test:e2e
node scripts/qa-full-runner.js --cases ./test_input.xlsx --limit 10
```

Backend-focused checks:

```bash
cd python-api
pytest
```

For recommendation-state work, prioritize the Playwright and session-kernel coverage around artifact persistence and restore flows.

## Current Limitations

- The repo layout is mixed rather than cleanly split into `backend/` and `frontend/`.
- Local startup depends on external infrastructure, especially PostgreSQL.
- Some flows appear to depend on API keys and production-like data availability.
- Generated reports, screenshots, and benchmark outputs exist in several locations, so provenance is not yet centralized.
- There is active parallel work in the tree; treat the current branch as collaborative and avoid broad cleanup or destructive resets.

## Roadmap

- Normalize the repository structure and make the backend/frontend boundary explicit.
- Add a single documented dev bootstrap path for DB, FastAPI, and Next.js.
- Promote session-state invariants into a short release checklist for every recommendation change.
- Consolidate sample fixtures, generated artifacts, and replay inputs into a clearer top-level convention.
- Expand restore-flow and UI/state-sync regression coverage where production bugs have occurred.

## Additional Documentation

- [`docs/MVP_RECONSTRUCTION.md`](docs/MVP_RECONSTRUCTION.md)
- [`docs/recommendation-architecture-map.md`](docs/recommendation-architecture-map.md)
- [`docs/test-matrix.md`](docs/test-matrix.md)
- [`docs/V3_CURRENT_STATE_AUDIT.md`](docs/V3_CURRENT_STATE_AUDIT.md)
