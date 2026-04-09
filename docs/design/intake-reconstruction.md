# Intake Reconstruction (Stateless Multi-Turn Filter Recovery)

## 문제

`/api/recommend` 는 stateful session 이 있으면 `prevState.appliedFilters` 로
이전 turn 필터를 그대로 이어간다. 그러나 다음 경우엔 session 이 **없다**:

- Eval harness (`scripts/eval-judge.mjs`) — 각 call 에 `session` 미포함
- Curl 재현, 외부 smoke test, 외부 통합
- UI 가 첫 mount 직후 쿠키 복원 실패

이때 서버는 `messages: [user, ai, user, ai, user]` 만 받고 `prevState = null`
인 상태에서 마지막 user turn 만 해석한다. 결과:

- M01 `"스테인리스" → "4날" → "10mm"` → `diameterMm=10` 만 적용, material/flutes 유실
- M02 `"스테인리스 4날 스퀘어" → "아니 볼로 바꿔"` → 직전 material/flutes 유실, 교체만 남음
- 평균 M 시나리오 13~17 점 (총점 25 기준)

## 현재 우회로 (한계)

### ❌ det pre-pass 에서 prior user turn 조인
`serve-engine-runtime.ts:2103` 부근에서 `prevState == null` 일 때 prior user
turn text 를 전부 join 해 `parseDeterministic()` 에 던지는 시도.

**한계**:
- det parser 가 revision ("아니", "바꿔", "말고") 을 cross-turn 에서 구분 못 함
  → M02 는 square + ball 둘 다 추출하는 충돌
- LLM 레이어 (single-call-router) 는 별도 경로라 여전히 last turn 만 봄
- orchestrator 의 `turnCount`, `narrowingHistory`, `lastAskedField`
  등 session 메타데이터는 복원 안 됨 (entropy-based question selection 이
  "같은 질문 반복" 을 탐지 못해 rep-loop 회귀 위험)

## 설계: Intake Reconstruction Layer

### 위치
`lib/recommendation/domain/intake-reconstruction.ts` (신규)

진입점: `serve-engine-runtime.ts` L1862 직후
```ts
const lastUserMsg = ...
if (!prevState && messages.length > 1) {
  prevState = await reconstructSession(messages, deps)
}
```

### 입력
- `messages: ChatMessage[]` — 전체 conversation (user + ai interleaved)
- `deps` — applyFilterToInput, parseDeterministic, routeSingleCall, filter-field-registry 등

### 출력
부분 복원된 `ExplorationSessionState`:
```ts
{
  appliedFilters: AppliedFilter[],   // turn-by-turn 순차 적용 후 최종 상태
  narrowingHistory: NarrowingTurn[], // 각 user turn = 1 entry
  turnCount: messages.filter(m=>m.role==="user").length - 1,
  lastAskedField: (ai 마지막 메시지에서 역추정),
  resolutionStatus: "narrowing",
  // 나머지는 기본값 — displayedProducts/candidateCount 은 runtime 이 다시 계산
}
```

### 알고리즘 (turn-by-turn replay)

```
filters = []
narrowingHistory = []
lastAskedField = null
userTurns = messages.filter(role === "user")

for (i, userText) in userTurns:
  aiPrev = messages 상에서 이 user turn 직전 ai 메시지
  lastAskedField = extractAskedField(aiPrev)   // "날 수는?" → "fluteCount"

  // 1. Edit intent 검사 (revision)
  if hasEditSignal(userText):
    editResult = parseEditIntent(userText, filters)
    if editResult:
      filters = applyEdit(filters, editResult)
      continue

  // 2. Deterministic 추출 (single turn only)
  detActions = parseDeterministic(userText)

  // 3. Pending-question resolve
  //    "4날" 같은 bare 답변은 lastAskedField 있을 때만 filter 로 승격
  if detActions.length === 0 && lastAskedField:
    chipFilter = parseFieldAnswerToFilter(lastAskedField, userText)
    if chipFilter: detActions = [chipFilter]

  // 4. Apply (skip virtual fields, skip conflicts preferring later)
  for action in detActions:
    filters = replaceFieldFilter(filters, buildAppliedFilter(action, i))

  narrowingHistory.push({ turnNumber: i, userText, extractedFilters: detActions, ... })

return buildSessionState({ appliedFilters: filters, narrowingHistory, turnCount: userTurns.length-1, lastAskedField, ... })
```

### extractAskedField 규칙
Ai 메시지 텍스트에서 마지막 물음에 해당하는 field 역매핑. registry 기반
label → field:

```ts
const LABEL_TO_FIELD = buildLabelToFieldMap(filterFieldRegistry)
// "날 수는?" → "fluteCount"
// "직경은?" → "diameterMm"
// "코팅은?" → "coating"
```

레이블 매치 실패 시 `null` (이 턴은 free-form).

### 경계 / 안전장치

1. **LLM-free**: replay 는 deterministic only. LLM 호출 금지 (replay 마다 LLM
   부르면 비용/latency 폭발).
2. **Idempotent**: 같은 messages 로 두 번 호출해도 같은 결과.
3. **프로덕션 무영향**: `prevState != null` 이면 건너뜀. UI 는 항상 session 을
   보내므로 production path 는 바뀌지 않음.
4. **회귀 검사**: 기존 5,729 vitest 통과, golden multi-turn 25 케이스 recovery.
5. **Opt-in env flag**: `INTAKE_RECONSTRUCTION=1` 로 wrap — 문제 발생 시 즉시
   off.

### 제거되는 우회로

성공 시 다음 코드 제거 가능:
- `serve-engine-runtime.ts` L2107 prior-user-turn join (내가 방금 넣은 것)
- `single-call-router.ts` L528 stateless-replay join

## 테스트 전략

### Unit (vitest)
`lib/recommendation/domain/__tests__/intake-reconstruction.test.ts`:
- `["스테인리스 엔드밀", "ai:날 수?", "4날", "ai:직경?", "10mm"]` →
  `[workPieceName=Stainless, fluteCount=4, diameterMm=10]`
- `["스테인리스 4날 스퀘어", "ai:어떤 형상?", "아니 볼로 바꿔"]` →
  `[workPieceName=Stainless, fluteCount=4, toolSubtype=Ball]`
- Revision chain: `["10mm", "ai:...", "아니 12mm"]` → `[diameterMm=12]`
- Skip/상관없음: `["스테인리스", "ai:코팅?", "상관없어"]` →
  `[workPieceName, coating=skip]`
- Empty/AI-only history → no-op

### Integration
- 기존 `scripts/eval-judge.mjs` M01/M02 재돌려 점수 20+ 확인
- golden multi-turn runner 25 케이스 돌려 회귀 0

## 롤아웃

1. PR 1 — `intake-reconstruction.ts` + unit tests (isolated, flag off)
2. PR 2 — runtime wire-up behind `INTAKE_RECONSTRUCTION=1`, eval 돌려 +점수 확인
3. PR 3 — flag default on, 우회로 제거, 문서 갱신

## 위험 / Open Questions

- **Q**: det parser 가 M02 같은 revision turn 을 별도로 처리해야 하는가?
  **A**: `hasEditSignal` gate 가 편입되므로 revision turn 은 parseEditIntent
  경로로 내려가 conflict 없이 replace 만 수행. det parser 는 non-revision
  turn 에서만 호출.

- **Q**: multi-value / op-override 필터 (e.g. `diameter >= 10`) 복원 가능?
  **A**: det parser 가 이미 op 를 내뿜으므로 `buildAppliedFilterFromValue`
  에 그대로 넘기면 동일.

- **Q**: narrowingHistory 의 candidateCountBefore/After 는?
  **A**: replay 시 실제 DB 쿼리를 돌리면 비용 폭증 → 0 으로 두고 runtime 의
  최종 retrieval 이 한 번만 돌도록 둔다. 기존 UI 는 이 숫자를 표시에만 씀.

- **Q**: intent detection ("질문" vs "추천") 은?
  **A**: replay 의 의무 밖. 마지막 user turn 의 intent 는 기존 runtime
  classifier 가 last-message 기반으로 판단. replay 는 "필터 상태" 만 복원.
