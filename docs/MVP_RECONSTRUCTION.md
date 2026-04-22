# MVP Reconstruction Notes

This document explains the current MVP framing from the checked repository state. It is intentionally conservative: where the structure is inferred rather than explicitly declared, that is stated directly.

## What This Repo Looks Like Today

Observed on 2026-04-22:

- Root Next.js application and UI routes live directly at the repository root.
- FastAPI recommendation/search service lives in `python-api/`.
- Recommendation domain and session-state logic live in `lib/recommendation/`.
- Regression and release-gate coverage live primarily in `e2e/` and Vitest suites under `lib/`.

In practice, this behaves like a two-service MVP:

1. Next.js frontend and proxy layer
2. FastAPI backend for recommendation and product/filter endpoints

## Why "Reconstruction" Is The Right Framing

Several signals suggest this is a reconstructed or accreted MVP snapshot rather than a freshly organized greenfield codebase:

- Root-level frontend code instead of a dedicated `frontend/` app directory
- Separate `python-api/` service with its own dependency graph
- Large top-level collections of data, docs, reports, screenshots, scripts, and archived materials
- Existing benchmark, eval, and probe outputs spread across multiple folders

That does not make the system unreliable. It means onboarding and support artifacts need to explain the practical runtime shape clearly instead of assuming idealized structure.

## Runtime Boundary

The current request path is:

1. Browser calls same-origin Next.js routes such as `/api/products`.
2. Next.js proxy code forwards to `PYTHON_API_URL`.
3. FastAPI handles recommendation/product/filter logic.
4. Response data is rendered into UI while session state is preserved in the recommendation runtime.

Key files:

- `app/api/_lib/python-proxy.ts`
- `app/api/products/route.ts`
- `app/api/products/stream/route.ts`
- `app/api/filter-options/route.ts`
- `python-api/main.py`

## MVP State Contract

The recommendation system is stateful. Raw chat history is not the source of truth.

The fields that matter most for reconstruction, restore, and UI consistency are:

- `displayedProducts`
- `displayedOptions`
- `displayedSeriesGroups`
- `lastRecommendationArtifact`
- `lastComparisonArtifact`
- `uiNarrowingPath`
- checkpoint history

The restore semantics that must remain distinct are:

- `undo_step`
- `restore_previous_group`
- `resume_previous_task`

Useful code references:

- `lib/recommendation/session-kernel.ts`
- `e2e/recommendation-test-helpers.ts`
- `e2e/13-recommendation-artifact-persistence.spec.ts`
- `e2e/14-recommendation-state-regressions.spec.ts`

## Practical Local Dev Model

Because there is no top-level `backend/` or `frontend/` directory split, use this convention:

- Backend work: `python-api/`
- Frontend work: repository root

Recommended boot order:

1. Provision `.env` from `.env.example`
2. Start PostgreSQL dependency
3. Start FastAPI on `127.0.0.1:8010`
4. Start Next.js on `127.0.0.1:3000`
5. Verify `/health` on FastAPI and a simple `/api/products` flow from the app

## Limits Of This Documentation

This document does not claim:

- that every script is current
- that every report is canonical
- that all generated artifacts are reproducible without the original data/services

It does document the minimum framing needed to understand and operate the MVP safely without silently breaking the session-state model.
