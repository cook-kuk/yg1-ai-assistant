# ARIA Final Report

Date: 2026-04-11

Scope:
- Production-path verification first
- Local code changes verified on built app (`http://127.0.0.1:3105`)
- Existing broad suites were executed against the current remote baseline (`http://20.119.98.136:3000`)

## 1. 테스트 결과

- `eval-judge`: `10/10` pass, average `22.1/25`
- `hard-20`: `20/20` pass
- `groq-27`: `25/27` pass, `2` fetch timeouts
- `multiturn-4`: qualitative suite, `4` scenarios executed, findings remained in `SUS316L` disclaimer and trouble-shooting carryover wording
- `repro-matrix`: `5/5` pass
- `필터 정확성`: full `30/30` API sweep not completed in this pass
  - Critical production-path spot checks on built app:
  - `CRX S 빼고 스테인리스` => fixed, `brand=neq`, `workPieceName=eq`
  - `스테인리스 4날 10mm -> Y코팅으로 -> 코팅 AlCrN으로 바꿔` => state replacement fixed
  - `직경 range` baseline remained covered by prior `55f6675` scoring fix and regression tests
- `칩/state`: partial smoke only
  - 3-turn built-app smoke confirmed filter carryover and coating replacement in session state
  - full 5-turn chip/state audit still pending
- `CoT`: partial only
  - deep/light/ASK policy was not re-run as a dedicated 3-case matrix in this pass
- `SQL`: partial
  - verified remote `brand != CRX-S` SQL clause via runtime logs
  - verified local production-path retrieval for `CRX S 빼고 스테인리스`
  - full 4-case SQL audit still pending
- `메모리`: partial
  - reset/carryover behavior observed in existing multiturn logs
  - dedicated memory artifact audit still pending
- `insight`: not re-verified in this pass
- `무한루프`: `5/5` repro-matrix pass, same-field ASK runaway not reproduced on current workspace

Latency:
- No new LLM calls were added by the S03 fix.
- The parser change is local and constant-time.
- No material latency regression was observed in targeted built-app smokes.

## 2. 점수 이력 (4/9 → 4/11 최종)

- `4/9`: exact baseline not reconstructed from current workspace logs
- `2026-04-11`:
  - `eval-judge avg 22.1/25`
  - `hard-20 20/20`
  - `groq-27 25/27`
  - `repro-matrix 5/5`

## 3. 컴포넌트 연결 상태 매트릭스

| From \\ To | UI | 칩 | KG | SQL | DSR | CoT | 메모리 | State |
|---|---|---|---|---|---|---|---|---|
| UI | - | partial | n/a | n/a | partial | partial | partial | partial |
| 칩 | partial | - | n/a | connected | partial | partial | partial | partial |
| KG | n/a | n/a | - | partial | partial | partial | n/a | partial |
| SQL Agent | n/a | n/a | partial | - | connected | n/a | n/a | connected |
| DSR | partial | partial | partial | connected | - | partial | partial | partial |
| CoT | partial | partial | partial | n/a | partial | - | partial | partial |
| 메모리 | partial | partial | n/a | n/a | partial | partial | - | connected |
| State | connected | connected | partial | connected | partial | partial | connected | - |

Notes:
- `SQL Agent -> SQL -> State` visibility improved by added production filter pipeline traces.
- `State -> retrieval` remained the source of truth in the verified flows.
- `coating chemical alias (AlCrN -> Y-Coating)` is semantically connected, but response wording can still mislead users.

## 4. 해결된 문제

- `P0 baseline`: existing range-scoring fix from `55f6675` remained intact.
- `P0 runaway ASK loop`: current workspace baseline still blocked same-field ASK re-entry.
- `S09 false series warning`: local fix already removed bogus `SUS316L` hallucination disclaimer in presenter.
- `Production filter instrumentation`: added parsed/normalized/dropped/final-filter and DB-plan traces earlier in this pass.
- `S03 critical negation scope bug`: fixed in deterministic production parser.
  - Before: `CRX S 빼고 스테인리스` could negate the following material token.
  - After: built app returns `brand != CRX S` and `workPieceName = Stainless Steels`.
- Added regression coverage:
  - `lib/recommendation/core/__tests__/deterministic-scr-negation-scope.test.ts`

## 5. 남은 문제 + 우선순위

P0:
- none newly reproduced in this pass for runaway loop

P1:
- full `30/30` actual-API filter matrix still needs to be executed and fixed to completion
- negation full bucket still needs broader sweep beyond the repaired `CRX S 빼고 스테인리스`

P2:
- schema-driven SQL filtering still needs a dedicated 4-case audit with saved `WHERE` evidence for:
  - negation
  - range
  - between
  - tool-forge / cutting-condition driven SQL

P3:
- response wording around coating alias equivalence is still misleading
  - built-app smoke showed `coating=AlCrN` in state while returned candidates are `Y-Coating` products via alias mapping
  - this appears semantically acceptable for execution, but the narrative currently says the condition "changed", which is misleading

P4:
- smart fallback / ask / verify was not fully re-audited in this pass

P5:
- `verify-groq-multiturn` still showed qualitative conversation issues on remote baseline

## 6. 4/20 데모 준비 상태

- Demo blocker fixed:
  - `CRX S 빼고 스테인리스` production-path negation scope
- Demo-safe enough for:
  - basic recommendation
  - range baseline
  - reset / carryover basics
- Not yet demo-safe for claiming:
  - full `30/30` execution correctness
  - full chip/state/memory/integration closure

## 7. MVP 로드맵

1. Run the full `30/30` actual-API filter matrix on the built app and save machine-readable results.
2. Close any remaining negation/range/canonicalization failures with regression tests.
3. Execute the 5-turn chip/state scenario on the built app and verify state artifacts explicitly.
4. Audit SQL evidence for the 4 required cases and pin a reproducible log bundle.
5. Normalize coating alias presentation so response wording matches execution semantics.

## 8. 아키텍처 장기 방향

- Keep production truth in deterministic state and filter execution, not generated chat.
- Keep parser and execution semantics auditable with persisted traces:
  - parsed filters
  - normalized filters
  - dropped filters
  - final SQL / post-filter semantics
  - candidate counts
- Preserve alias/canonicalization at the execution layer, but expose the mapping explicitly in response text to avoid semantic drift.
- Continue separating:
  - state transition correctness
  - retrieval correctness
  - narrative quality

## Change Summary

Files changed in this pass:
- `lib/recommendation/core/deterministic-scr.ts`
- `lib/recommendation/core/__tests__/deterministic-scr-negation-scope.test.ts`

Minimal fix:
- `negNear()` now distinguishes prefix-negation from suffix-negation.
- postposed exclusion tokens like `빼고` no longer leak onto the next token.
- coating/brand negation checks now reuse the same directional negation helper.

Verification run for this fix:
- `npx vitest run lib/recommendation/core/__tests__/deterministic-scr-negation-scope.test.ts`
- `npx vitest run lib/recommendation/core/__tests__/deterministic-scr-real-feedback.test.ts`
- `npx vitest run lib/recommendation/core/__tests__/deterministic-scr-coverage-matrix.test.ts`
- `npx vitest run lib/recommendation/infrastructure/engines/__tests__/filter-replace-coverage.test.ts`
- `npx vitest run lib/recommendation/infrastructure/engines/__tests__/j06-pending-detscr-fallback.test.ts lib/recommendation/infrastructure/engines/__tests__/pending-selection-resolver.test.ts`
- `npm run build`

Critical built-app re-checks:
- `CRX S 빼고 스테인리스`
- `스테인리스 4날 10mm 추천해줘 -> Y코팅으로 -> 코팅 AlCrN으로 바꿔`
