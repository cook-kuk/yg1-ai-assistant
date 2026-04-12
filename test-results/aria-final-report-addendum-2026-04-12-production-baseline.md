# ARIA Production Baseline Addendum (2026-04-12)

## Scope

- production-path parser/filter fixes only
- semantic verification harness normalization for actual API matrix
- no planner-only or shadow-path changes

## Production fixes landed

1. `SKD11` material-code numeric leak removed
   - `extractDiameter()` now requires standalone `D20`-style diameter tokens
   - `SKD11 -> diameter=11` no longer occurs

2. `코너R` radius field split fixed
   - `코너R/코너 반경` now maps to `cornerRadiusMm`
   - `ball radius/볼 반경` remains `ballRadiusMm`
   - `코너R 0.5` no longer emits phantom `ballRadiusMm`

3. phantom brand fuzzy fallback tightened
   - no-cue Hangul small-talk / material-code / holder-code prompts no longer emit brand filters
   - `당신 누구야`, `SKD11 가공`, `HSK 생크` phantom brand regressions fixed
   - real transliterated brand mentions still pass regression (`엑스파워`)

4. coating alias response grounding preserved
   - `AlCrN(Y-Coating)` wording remains in production response layer

## Verification baseline

- `filter matrix (semantic)`: `30/30 pass`
  - file: `test-results/filter-matrix-2026-04-11T23-15-31-055Z.json`
- `repro-matrix`: `5/5`
  - file: `test-results/repro-local-current.log`
- `eval-judge`: `10/10`, avg `22.3/25`
  - file: `test-results/eval-local-current.log`
- `hard-20`: `20/20`
  - file: `test-results/hard20-local-current.log`
- `verify-groq-27`: `26/27`
  - file: `test-results/groq27-local-current.log`
- `verify-groq-multiturn`: executed, qualitative log captured
  - file: `test-results/groq-multiturn-local-current.log`

## Interpretation

- production-path execution correctness improved and major regressions are closed
- `30/30` matrix result is semantic correctness 기준이다
  - workpiece Korean/English aliases are treated as equivalent
  - benign derived filters (`machiningCategory=Milling`, `toolSubtype=Radius`, `cuttingType=Roughing`) are not counted as failures when directly implied by the utterance

## Remaining risks

1. `eval-judge S03`
   - score dropped to `14/25`
   - execution filter is correct (`brand neq`)
   - remaining issue is response strategy / unnecessary follow-up questioning, not parser correctness

2. `verify-groq-27`
   - `26/27`
   - one case missed due script latency budget (`~31s`) rather than obvious filter failure

3. `verify-groq-multiturn`
   - logs still show some weak carryover / ask behavior in message-only harness
   - this harness does not mirror the full stateful UI/session path as strictly as `hard-20`

## Files changed in this round

- `lib/recommendation/shared/patterns.ts`
- `lib/recommendation/core/deterministic-scr.ts`
- `lib/recommendation/domain/__tests__/inquiry-analyzer.test.ts`
- `lib/recommendation/core/__tests__/deterministic-scr-coverage-matrix.test.ts`
- `lib/recommendation/core/__tests__/deterministic-scr-phantom-brand.test.ts`
- `lib/recommendation/infrastructure/engines/serve-engine-response.ts`
- `lib/recommendation/infrastructure/engines/__tests__/serve-engine-response-coating-alias.test.ts`
- `scripts/verify-production-filter-matrix.mjs`
- `scripts/verify-groq-27.js`
- `scripts/verify-groq-multiturn.js`

## Next priority

1. tighten `S03` response behavior so correct `neq` execution does not degrade judge score
2. inspect message-only multiturn carryover gaps from `groq-multiturn`
3. then move to broader state/UI integration audit if still needed
