# LLM-First 필터 추출 v2 — 이전 실패 반영 재구현
# Claude Code 실행 프롬프트

## 이전에 왜 revert 됐는가

커밋 a2eec55 → d28bd45 → revert d58b06c. 원인:
1. LLM extractor가 `extractFiltersWithLLM()`으로 만들어졌지만, 추출 결과의 `extractedFilters`가 배열(AppliedFilter[])로 나와서 첫 번째만 적용됨 → 여러 필터 동시 적용 안 됨
2. LLM을 primary로 바꿨을 때 칩 클릭(exact match)까지 LLM을 거치게 됨 → 불필요한 지연
3. 기존 deterministic NL 추출(`buildPendingSelectionFilter`)의 NL 패턴 매칭이 이미 잘 되는 케이스까지 LLM이 덮어씀

## 이번에 제대로 하는 방법

### 핵심 원칙: 단계별 처리

```
사용자 입력
→ Step 0: 칩 exact match (가장 빠름, 정확함)
→ Step 1: deterministic NL 패턴 매칭 (기존 로직, 빠름)
→ Step 2: LLM 분석 (Step 0,1이 둘 다 실패했을 때만)
→ Step 3: 추출된 필터 전부 appliedFilters에 반영
→ Step 4: 이미 적용된 필드는 다음 질문에서 스킵
```

**Step 0,1이 성공하면 LLM 안 부름 → 빠름.**
**Step 0,1이 실패했을 때만 LLM → 자연어 이해.**

이게 이전과 다른 점:
- 이전: LLM을 primary로 → 칩 클릭도 LLM 거침 → 느림
- 이번: 칩/패턴 먼저, LLM은 진짜 필요할 때만

---

## 구현

### 1. `llm-filter-extractor.ts` 재생성

이전 버전의 문제: `extractedFilters`가 `AppliedFilter[]` 배열이라 첫 번째만 적용됨.
이번: `Record<string, string | number>`로 여러 필드를 동시에 반환.

```typescript
// lib/recommendation/core/llm-filter-extractor.ts

export interface LlmFilterResult {
  extractedFilters: Record<string, string | number>  // { toolSubtype: "Radius", workPieceName: "알루미늄" }
  skipPendingField: boolean
  isSideQuestion: boolean
  confidence: number
}

export async function extractFiltersWithLLM(
  userMessage: string,
  lastAskedField: string | null,
  currentFilters: Record<string, string | number>,
  recentContext: string
): Promise<LlmFilterResult> {
  // Haiku 호출 — 빠르고 저렴
  // prompt에서 JSON만 반환하게 강제
  // 현재 적용된 필터를 알려줘서 중복 추출 방지
  // 여러 필드 동시 추출 가능
}
```

LLM prompt 핵심:
```
사용자 메시지에서 절삭공구 필터를 추출하라. 여러 개 가능.

현재 적용된 필터: ${JSON.stringify(currentFilters)}
현재 대기 질문: ${lastAskedField || "없음"}
사용자 메시지: "${userMessage}"

매핑 규칙:
- "Corner radius" / "코너R" / "래디우스" → toolSubtype: "Radius"
- "스퀘어" / "평날" → toolSubtype: "Square"
- "볼" / "볼노즈" → toolSubtype: "Ball"
- "황삭" / "러핑" → toolSubtype: "Roughing"
- "알루미늄" → workPieceName: "알루미늄" (정확한 DB값은 시스템이 매핑)
- "SUS" / "스테인리스" → workPieceName: "스테인리스강"
- "10mm" / "φ10" / "10파이" → diameter: 10
- "3날" / "3F" → fluteCount: 3
- "상관없음" / "몰라" / "아무거나" → skipPendingField: true
- "공장" / "회사" / "지점" / "본사" → isSideQuestion: true

이미 적용된 필터와 동일한 값은 추출하지 마라.
한 문장에 여러 필터가 있으면 전부 추출하라.

반드시 이 JSON만 반환:
{
  "extractedFilters": { "필드명": "값", ... },
  "skipPendingField": false,
  "isSideQuestion": false,
  "confidence": 0.9
}
```

### 2. `serve-engine-runtime.ts` 수정 — 핵심 통합 지점

현재 코드 흐름을 찾아라:
```bash
grep -n "buildPendingSelectionFilter\|pendingSelectionFilter\|pendingSelectionAction\|selectedValue.*optionMatch\|raw\.trim\|lastAskedField" \
  lib/recommendation/infrastructure/engines/serve-engine-runtime.ts | head -30
```

수정 방법:

```typescript
// ── 현재 코드 (AS-IS) ──
const pendingSelectionFilter = buildPendingSelectionFilter(prevState, lastUserMsg?.text ?? null)
const shouldResolvePendingSelectionEarly = !!pendingSelectionFilter && !isPostResultPhase(journeyPhase)

if (shouldResolvePendingSelectionEarly && pendingSelectionFilter) {
  pendingSelectionAction = pendingSelectionFilter.op === "skip"
    ? { type: "skip_field" }
    : { type: "continue_narrowing", filter: pendingSelectionFilter }
  pendingSelectionOrchestratorResult = buildPendingSelectionOrchestratorResult(pendingSelectionFilter)
}

// ── 새 코드 (TO-BE) ──
// Step 0+1: 기존 deterministic (칩 매칭 + NL 패턴)
const pendingSelectionFilter = buildPendingSelectionFilter(prevState, lastUserMsg?.text ?? null)
const shouldResolvePendingSelectionEarly = !!pendingSelectionFilter && !isPostResultPhase(journeyPhase)

if (shouldResolvePendingSelectionEarly && pendingSelectionFilter) {
  pendingSelectionAction = pendingSelectionFilter.op === "skip"
    ? { type: "skip_field" }
    : { type: "continue_narrowing", filter: pendingSelectionFilter }
  pendingSelectionOrchestratorResult = buildPendingSelectionOrchestratorResult(pendingSelectionFilter)
}

// Step 2: LLM fallback — deterministic이 못 잡았을 때만
if (!pendingSelectionAction && prevState?.lastAskedField && lastUserMsg && !isPostResultPhase(journeyPhase)) {
  const llmResult = await extractFiltersWithLLM(
    lastUserMsg.text,
    prevState.lastAskedField,
    prevState.appliedFilters ?? {},
    buildRecentContextForLLM(messages)  // 최근 2-3턴 요약
  )

  if (llmResult.skipPendingField) {
    // "상관없음" 처리
    const skipFilter = { field: prevState.lastAskedField, value: "__skip__", op: "skip" as const }
    pendingSelectionAction = { type: "skip_field" }
    pendingSelectionOrchestratorResult = buildPendingSelectionOrchestratorResult(skipFilter)
    console.log(`[llm-filter] skip "${prevState.lastAskedField}"`)

  } else if (llmResult.isSideQuestion) {
    // side question → 필터 적용 안 하고 일반 답변으로
    console.log(`[llm-filter] side question detected`)
    // pendingSelectionAction stays null → orchestrator handles as general chat

  } else if (Object.keys(llmResult.extractedFilters).length > 0) {
    // 필터 추출 성공 — 첫 번째를 pending field 답변으로 처리
    const entries = Object.entries(llmResult.extractedFilters)
    const [firstField, firstValue] = entries[0]
    
    const primaryFilter = {
      field: firstField,
      value: String(firstValue),
      op: "apply" as const
    }
    pendingSelectionAction = { type: "continue_narrowing", filter: primaryFilter }
    pendingSelectionOrchestratorResult = buildPendingSelectionOrchestratorResult(primaryFilter)
    console.log(`[llm-filter] primary: ${firstField}=${firstValue}`)

    // 나머지 필터도 appliedFilters에 추가 (여러 필터 동시 적용!)
    if (entries.length > 1) {
      const extraFilters = prevState.appliedFilters ? { ...prevState.appliedFilters } : {}
      for (let i = 1; i < entries.length; i++) {
        const [field, value] = entries[i]
        extraFilters[field] = String(value)
        console.log(`[llm-filter] extra: ${field}=${value}`)
      }
      // prevState의 appliedFilters를 업데이트 (다음 질문 선택 시 반영됨)
      if (prevState) {
        prevState.appliedFilters = extraFilters
      }
    }
  }
}
```

### 3. 다음 질문 선택 시 이미 적용된 필터 스킵

`serve-engine-response.ts` 또는 `question-engine.ts`에서 다음 질문을 고르는 부분을 찾아라:

```bash
grep -n "selectNextQuestion\|nextQuestion\|QUESTION_ORDER\|questionField\|lastAskedField" \
  lib/recommendation/infrastructure/engines/serve-engine-response.ts \
  lib/recommendation/domain/question-engine.ts | head -20
```

다음 질문을 선택하는 로직에 이미 적용된 필터 체크 추가:

```typescript
// AS-IS: 답변 history만 체크
const nextField = questionFields.find(f => !answered.includes(f))

// TO-BE: appliedFilters도 체크
const nextField = questionFields.find(f => 
  !answered.includes(f) && 
  !(appliedFilters && f in appliedFilters)
)
```

이렇게 해야 "Radius라고 했는데 또 형상 물어봄" 방지됨.

### 4. `?? raw.trim()` 제거 확인

`buildPendingSelectionFilter` 안에 `?? raw.trim()` 패턴이 있으면 제거:

```bash
grep -n "raw\.trim\|raw\.text\|?? raw" lib/recommendation/infrastructure/engines/serve-engine-runtime.ts
```

있으면 `?? null`로 교체. raw.trim()은 "익산 공장 정보줘" → workPieceName 버그의 원인.

### 5. buildRecentContextForLLM 헬퍼 추가

LLM에게 최근 대화 맥락을 주기 위한 간단한 헬퍼:

```typescript
function buildRecentContextForLLM(messages: Message[]): string {
  const recent = messages.slice(-4)  // 최근 4턴
  return recent.map(m => `${m.role}: ${m.text?.slice(0, 200)}`).join("\n")
}
```

---

## 수정 파일 정리

| 파일 | 수정 | 중요도 |
|------|------|--------|
| **신규** `lib/recommendation/core/llm-filter-extractor.ts` | LLM 필터 추출 함수 (Record 기반) | 🔴 |
| `serve-engine-runtime.ts` | Step 2 LLM fallback 추가 + `?? raw.trim()` 제거 | 🔴 |
| `serve-engine-response.ts` 또는 `question-engine.ts` | appliedFilters 체크로 중복 질문 방지 | 🔴 |

## 확인 (5개만, 빠르게)

1. 칩 클릭 "Square" → LLM 안 부르고 바로 적용? (Step 0에서 처리)
2. "Radius로 해주세요 소재는 알루미늄" → 두 필터 동시 적용? (Step 2 LLM)
3. Radius 선택 후 → 형상 또 물어보는지? (appliedFilters 체크)
4. "상관없음" → skip 동작?
5. `npx vitest run --exclude='e2e/**' --reporter=dot` regression 없는지

## 구현 지시

1. 먼저 `llm-filter-extractor.ts`를 만들어라 (이전 버전 참고하되 Record<string, string|number> 기반)
2. `serve-engine-runtime.ts`에서 기존 pendingSelectionFilter 처리 뒤에 LLM fallback 추가
3. 다음 질문 선택에서 appliedFilters 체크 추가
4. `?? raw.trim()` 있으면 제거
5. 기존 테스트 통과 확인
6. 커밋 + 푸시
7. 새 테스트 만들지 마라. 빠르게.
