# YG-1 Recommendation System

This repository contains the stateful YG-1 industrial tool recommendation runtime, the Next.js UI and API surface around it, and the QA/regression harnesses used to validate releases.

## Working Agreements

- Deterministic recommendation session state is the source of truth.
- Keep UI state and session state synchronized.
- Never invent product data.
- Every bug fix should land with a regression test.

## Key Directories

- `app/`: Next.js routes and pages.
- `components/`: application UI.
- `lib/recommendation/`: recommendation runtime, domain logic, presenters, and shared execution utilities.
- `e2e/`: Playwright release-gate and session-state coverage.
- `scripts/`, `tools/`: QA runners, deploy helpers, and local verification utilities.
- `test-results/`: generated eval/probe artifacts and scratch outputs.
- `testset/`: curated fixtures, golden sets, and reusable regression inputs.

Keep curated replay inputs in `testset/` and generated outputs in `test-results/`.

## Verification

```bash
npx vitest run
npx playwright test
node scripts/qa-full-runner.js --cases ./test_input.xlsx --limit 10
```
