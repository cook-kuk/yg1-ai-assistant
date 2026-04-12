# ARIA Final Report Addendum

Date: 2026-04-11

## Phase: Coating Alias Grounding

### Goal

Align response wording with production alias semantics for chemical coating names such as `AlCrN`.

### Production impact

- Execution semantics unchanged.
- No new LLM call, no DB round-trip added.
- Question responses now expose alias mapping explicitly when the latest coating filter is a chemical name but returned candidates use the DB alias label.

### Files changed

- `lib/recommendation/infrastructure/engines/serve-engine-response.ts`
- `lib/recommendation/infrastructure/engines/__tests__/serve-engine-response-coating-alias.test.ts`

### Root cause

The execution layer already treated `AlCrN` and `Y-Coating` as the same coating family, but narrative text could frame `Y-Coating` as if it were a different coating after replacement.

### Minimal fix

- Added alias-group detection from `COATING_CHEMICAL_DB_ALIASES`
- Added deterministic question-text grounding:
  - `코팅은 AlCrN(Y-Coating) 기준으로 그대로 좁혀졌습니다.`
- Scoped the rewrite to the latest turn when a coating filter was just applied/replaced and returned candidates expose an alias-equivalent coating label.

### Verification

- `npx vitest run lib/recommendation/infrastructure/engines/__tests__/serve-engine-response-coating-alias.test.ts lib/recommendation/infrastructure/engines/__tests__/field-consistency.test.ts`
- `npm run build`
- Built app smoke on `http://127.0.0.1:3105`
  - Turn 1: `스테인리스 4날 10mm 추천해줘`
  - Turn 2: `Y코팅으로`
  - Turn 3: `코팅 AlCrN으로 바꿔`

Verified response text:

`코팅은 AlCrN(Y-Coating) 기준으로 그대로 좁혀졌습니다. 현재 후보는 143개입니다. 날 수는 몇 날이 좋으실까요? 2·3·4날이 가장 많이 쓰입니다.`

### Regression result

- New alias-grounding test passed
- Existing `field-consistency` test passed
- Production build passed

### Risks

- This fix only grounds the coating alias response path.
- Full `30/30` actual API filter matrix is still pending.

### Commit message

`fix(recommendation): ground coating alias responses to production semantics`
