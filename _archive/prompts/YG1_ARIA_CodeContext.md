# Claude Code 사전 컨텍스트: 현재 코드 핵심 포인트

이 문서는 Phase 1 프롬프트와 함께 Claude Code에 넣어주세요.
Claude Code가 코드를 읽기 전에 핵심 병목을 미리 알면 훨씬 덜 헤맵니다.

---

## 현재 확인된 핵심 버그 (코드 레벨)

### 1. raw fallback으로 filter 오염
**파일:** `serve-engine-runtime.ts` — `buildPendingWorkPieceSelectionFilter()`
```
const selectedValue = optionMatch?.value ?? chipMatch ?? raw.trim()
```
이 한 줄 때문에 "익산 공장 정보줘" → `workPieceName = "익산 공장 정보줘"` 됨.

### 2. prevState chips fallback으로 stale chips
**파일:** `serve-engine-general-chat.ts` — `buildValidatedReplyResponse()`
```
const chips = prevState.displayedChips?.length ? prevState.displayedChips : reply.chips
const displayedOptions = prevState.displayedOptions ?? []
```
이 로직 때문에 질문은 coating인데 chips는 flute.

### 3. pendingAction write path 없음
**파일:** `lib/types/exploration.ts:154-164` — 타입 정의 있음
**파일:** `serve-engine-runtime.ts:471-518` — read/intercept 있음
**파일:** `session-manager.ts:69,105,146-147` — carry-forward만 함
→ 실제로 set하는 코드가 없음. Dead feature.

### 4. queryTarget/tool-plan이 런타임 주 경로에 연결 안 됨
**파일:** `query-target-classifier.ts` — 좋은 구조 있음
**파일:** `tool-plan-builder.ts` — `buildToolPlan()` 잘 정의됨
→ 하지만 `buildToolPlan()`은 **테스트에서만** 사용됨. 런타임은 안 탐.
→ 실제 런타임 분기는 `earlyAction + SKIP_RETRIEVAL_ACTIONS` 중심.

### 5. TurnContext가 여러 번 빌드됨
빌드 위치:
- `serve-engine-runtime.ts:341`
- `serve-engine-runtime.ts:521`
- `serve-engine-option-first.ts:109,296`
- `serve-engine-general-chat.ts:572`
→ "같은 턴의 단일 immutable snapshot"이 아님.

### 6. referencedProducts에 displayedProducts가 합쳐짐
**파일:** `turn-context-builder.ts:172-176`
→ "지금 화면에 보이는 것"과 "실제로 참조한 것"이 섞임.

### 7. memory write가 분산됨
- `option-bridge.ts:173-191` — `buildMemoryFromSession()` + `updateMemory()`
- `serve-engine-general-chat.ts:523-570` — 별도 `persistedMemory`
- `serve-engine-response.ts:192-210, 483-500` — `buildSessionState()`에서 `conversationMemory` 거의 안 넣음
→ write policy가 한 군데서 닫히지 않음.

---

## 재사용 가능한 좋은 구조

| 파일 | 재사용 가치 | 새 역할 |
|------|------------|---------|
| `session-manager.ts` | 높음 | state persistence/restore 껍데기 |
| `turn-context-builder.ts` | 중간 | TurnSnapshot builder 일부 (판단 로직 분리 필요) |
| `query-target-classifier.ts` | 중간 | LLM decision 보조 signal |
| `tool-plan-builder.ts` | 중간 | search planner 일부 |
| `option-validator.ts` | 높음 | response-validator 일부 |
| `recent-interaction-frame.ts` | 중간 | reference summary 보조 |
| `hybrid-retrieval.ts` | 높음 | 검색 엔진 core (그대로) |
| `match-engine.ts` | 높음 | 110점 스코어링 (그대로) |
| `fact-checker.ts` | 높음 | validator 강화 소스 |
| `question-engine.ts` | 중간 | 질문 선택 보조 signal |

---

## 레포 구조 핵심 경로

```
lib/recommendation/
├── application/           # use-case/service 조립
├── domain/                # 순수 규칙
│   ├── context/           # turn-context-builder, query-target-classifier, recent-interaction-frame
│   ├── memory/            # conversation memory
│   ├── options/           # option-bridge, option-validator
│   └── tools/             # tool-plan-builder
├── infrastructure/        # LLM, engine, presenter, repository
│   └── engines/           # serve-engine-runtime, option-first, general-chat, assist, response
└── shared/                # 공용 유틸
```

API entry point: `app/api/recommend/route.ts`
→ `serve-engine-runtime.ts`의 메인 함수 호출

---

## 기존 타입 핵심 위치

- `lib/types/exploration.ts` — ExplorationSessionState, DisplayedOption, pendingAction 타입 등
- 기존 session state는 `ExplorationSessionState`로 관리됨
- `appliedFilters`, `lastAskedField`, `currentMode`, `displayedOptions`, `displayedChips` 등이 여기 있음

---

## 현재 flow 요약

```
사용자 입력
→ serve-engine-runtime.ts (turn orchestration + 모든 분기)
  ├── earlyAction 체크 (undo, reset, etc.)
  ├── pending field 처리 (← raw fallback 버그 여기)
  ├── question assist 체크
  ├── side question / general chat 분기
  │   └── serve-engine-general-chat.ts (← stale chips fallback 여기)
  │       └── serve-engine-assist.ts (direct factual handlers)
  ├── option-first path
  │   └── serve-engine-option-first.ts (option generation + question)
  └── response assembly
      └── serve-engine-response.ts (recommendation/question response DTO)
```

핵심 문제: 이 분기들이 각각 독립적으로 surface를 조립함.
→ 하나의 파이프라인으로 강제되지 않음.
