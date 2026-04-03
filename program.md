# ARIA AutoAgent — 자율 개선 프로그램

> 이 파일은 meta-agent(Claude Code)가 읽는 지시서.
> `Read program.md and let's kick off a new experiment!` 로 시작.

## 목표

YG-1 AI 절삭공구 추천 시스템(ARIA)의 **테스트 통과율을 최대화**한다.
현재 점수를 측정하고, 코드를 수정하고, 점수가 오르면 유지, 내리면 되돌린다.

## 점수 측정 방법

```bash
npx vitest run lib/recommendation/ --reporter=json --outputFile=results.json 2>/dev/null
node -e "const r=require('./results.json'); console.log(JSON.stringify({
  total: r.numTotalTests,
  passed: r.numPassedTests, 
  failed: r.numFailedTests,
  skipped: r.numPendingTests,
  score: (r.numPassedTests / (r.numTotalTests - r.numPendingTests) * 100).toFixed(1)
}))"
```

**현재 기준선**: 1977 passed / 1986 total (9 skipped) = **100.0% score** (failed 제외)
**목표**: skipped 9개를 0으로 줄이면서 기존 passed를 깨지 않기.

## 피드백 → 테스트 자동 생성

```bash
# dry-run (API 호출만, LLM 안 씀)
node scripts/feedback-to-tests.js --dry-run

# 풀 실행 (Haiku 정제 포함, ~$0.01)
node scripts/feedback-to-tests.js

# 생성된 테스트 실행
npx vitest run lib/recommendation/infrastructure/engines/__tests__/feedback-derived.test.ts
```

## 편집 가능한 파일 (Task Agent Harness)

이 파일들만 수정한다:

| 파일 | 역할 | 위험도 |
|------|------|--------|
| `lib/recommendation/infrastructure/engines/serve-engine-runtime.ts` | 메인 라우팅/오케스트레이션 | 🔴 높음 |
| `lib/recommendation/shared/filter-field-registry.ts` | 필터 필드 정의 | 🟡 중간 |
| `lib/recommendation/domain/question-engine.ts` | 질문 생성 로직 | 🟡 중간 |
| `lib/recommendation/infrastructure/engines/serve-engine-option-first.ts` | 칩 생성 | 🟡 중간 |
| `lib/recommendation/infrastructure/engines/serve-engine-response.ts` | 응답 생성 | 🟢 낮음 |
| `lib/recommendation/shared/constraint-text-parser.ts` | 자연어 파싱 | 🟢 낮음 |
| `lib/recommendation/core/semantic-turn-extractor.ts` | LLM 의도 해석 | 🟡 중간 |
| `lib/recommendation/domain/hybrid-retrieval.ts` | DB 검색 + 후처리 | 🔴 높음 |
| `lib/chat/application/chat-service.ts` | /chat 경로 | 🟡 중간 |

## 편집 금지 파일

- `lib/recommendation/infrastructure/presenters/` — API 응답 포맷
- `lib/recommendation/infrastructure/http/` — HTTP 라우팅
- `lib/contracts/` — DTO 인터페이스
- `app/api/` — Next.js route handlers
- 테스트 파일 자체 (`__tests__/*.test.ts`) — 점수 조작 방지

## 실험 루프

### 1. 현재 점수 측정
```bash
npx vitest run lib/recommendation/ --reporter=json --outputFile=results.json 2>/dev/null
```

### 2. 실패/스킵 테스트 분석
```bash
# 실패 테스트 목록
node -e "const r=require('./results.json'); r.testResults.forEach(f => f.assertionResults.filter(a => a.status==='failed').forEach(a => console.log(a.ancestorTitles.join(' > ') + ' > ' + a.title)))"

# 실패 메시지
node -e "const r=require('./results.json'); r.testResults.forEach(f => f.assertionResults.filter(a => a.status==='failed').forEach(a => console.log(a.title + ': ' + (a.failureMessages?.[0]?.slice(0,200) ?? 'no message'))))"
```

### 3. 실패 원인 진단
실패 테스트의 기대값과 실제값을 비교.
테스트가 호출하는 함수의 소스 코드를 읽고 로직 흐름 추적.

### 4. 수정
가장 영향 적은 최소 변경으로 수정.
하나의 실패 그룹을 한 번에 고침 (관련 실패 묶어서).

### 5. 재측정
```bash
npx vitest run lib/recommendation/ --reporter=json --outputFile=results.json 2>/dev/null
```

### 6. 판정
- **score 상승 또는 유지** → `git add . && git commit -m "autoagent: {설명}"` → 다음 실패 그룹
- **score 하락** → `git checkout -- .` → 다른 접근 시도
- **같은 실패 3번 연속** → 해당 테스트를 `.skip`으로 표시하고 다음으로

### 7. 반복
모든 실패가 해결되거나 3라운드 연속 점수 변화 없으면 종료.

## 수정 우선순위

1. **filter-field-registry**: 필터 매핑/파싱 오류 (한국어 alias 누락, canonicalize 실패)
2. **serve-engine-runtime**: 라우팅 오류 (pending selection, revision, navigation guard)
3. **constraint-text-parser**: 자연어 파싱 실패 (regex 패턴 부족)
4. **question-engine**: 질문 생성 오류 (잘못된 필드에 질문, 불필요한 질문)
5. **serve-engine-option-first**: 칩 생성 오류 (0건 결과 칩, 카테고리 혼재)

## 수정 원칙

- **최소 변경**: 한 번에 10줄 이하 수정 선호
- **회귀 방지**: 수정 후 기존 통과 테스트가 깨지면 무조건 revert
- **overfitting 방지**: 특정 테스트 하드코딩 금지. "이 테스트가 없어도 좋은 개선인가?" 자문
- **로그 남기기**: 매 실험 결과를 results.tsv에 기록

```bash
echo "$(date +%H:%M)\t$(node -e "const r=require('./results.json');console.log(r.numPassedTests+'/'+r.numTotalTests)")\t{변경 설명}" >> results.tsv
```

## 알려진 취약 영역

### 칩 클릭 → 필터 적용
- `resolvePendingQuestionReply` → 칩 텍스트에서 필터 추출
- canonicalField(diameterRefine→diameterMm) 변환 누락 가능
- "(N개)" 접미사 파싱 실패 가능

### 직경 필터 교체
- intake form의 diameterMm이 appliedFilters에 없음 → revision 실패
- diameterRefine + diameterMm 이중 WHERE 위험
- ±2mm 범위 검색에 다른 카테고리(드릴, 탭) 혼입

### 한국어 자연어 파싱
- 형상 alias: 볼엔드밀→Ball, 평엔드밀→Square, 러핑→Roughing
- skip 토큰: 상관없음, 아무거나, 패스, 스킵, 넘어가
- 조건 변경: "직경 8mm로 바꿔서 추천해줘" — field + value + action 동시 파싱

### 속도 병목
- 라우팅에 LLM 4개 순차 호출 (병렬화 가능)
- pre-search + main search 이중 검색 (/chat 경로)

## 성공 기준

| 지표 | 현재 | 목표 |
|------|------|------|
| 테스트 통과율 | 1977/1986 | 1986/1986 |
| skipped | 9 | 0 |
| 빌드 성공 | ✅ | ✅ |
| 기존 통과 테스트 유지 | 1977 | ≥1977 |

## 시작

```
1. results.json이 없으면 먼저 점수 측정
2. 실패/스킵 테스트 목록 확인
3. 가장 쉬운 실패부터 시작
4. 루프 실행
```

## 피드백 기반 자율 개선 (Phase 2)

실제 사용자 피드백이 http://20.119.98.136:3001/feedback 에 쌓이고 있다.
MongoDB에 저장된 feedback_events 컬렉션에서 👎/😐 평가를 추출하여 테스트로 변환.

### 피드백 데이터 구조

```typescript
// 각 피드백 엔트리에 포함된 정보
{
  userMessage: string      // 사용자 입력
  aiResponse: string       // AI 응답
  responseFeedback: "👍" | "😐" | "👎"  // 응답 평가
  chipFeedback: "👍" | "😐" | "👎"      // 칩 평가
  appliedFilters: string[] // 적용된 필터
  conditions: string       // intake 조건
  narrowingPath: string    // 축소 경로
  candidateCount: number   // 후보 수
  topProducts: string      // 추천 제품
  conversationSnapshot: [  // 전체 대화 이력
    { role: "user", text: "...", chips: [...], feedback: "👎" },
    { role: "ai", text: "...", chips: [...] },
  ]
}
```

### 피드백 → 테스트 변환 프로세스

```bash
# 1. 피드백 API에서 👎 평가 추출
curl -s http://20.119.98.136:3001/api/feedback | \
  node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const bad = data.feedbackEntries.filter(e => 
      e.responseFeedback === '👎' || e.chipFeedback === '👎'
    );
    bad.forEach(e => console.log(JSON.stringify({
      user: e.userMessage,
      response: e.aiResponse?.slice(0,100),
      feedback: e.responseFeedback,
      chipFeedback: e.chipFeedback,
      filters: e.appliedFilters,
      candidates: e.candidateCount,
      conditions: e.conditions,
    })));
  "
```

### 피드백 품질 정제 (LLM-as-Judge)

사용자 emoji 평가는 노이즈가 많다. 대충 누르거나 반대로 누르는 경우 존재.
**대화 맥락을 보고 LLM이 평가를 재판정**하여 신뢰도 높은 피드백만 사용.

```typescript
// Haiku로 빠르게 판정 (비용 최소화)
const refinementPrompt = `
당신은 AI 절삭공구 추천 시스템의 품질 평가자입니다.
아래 대화와 사용자의 emoji 평가를 보고, 평가가 합리적인지 판단하세요.

대화:
{conversationSnapshot}

사용자 평가: {emoji} (👍/😐/👎)
후보 수: {candidateCount}개
적용된 필터: {appliedFilters}

판정 기준:
- 0건 결과인데 👍 → 대충 누름 → override: 👎
- Milling 검색인데 TAP/드릴 추천 + 👍 → 대충 누름 → override: 👎  
- 정상 추천(적합한 제품 + 충분한 후보) + 👎 → 대충 누름 → override: 👍
- 질문에 답 안 하고 반복 + 😐 → 합리적 → keep: 😐
- 조건 변경 안 됨 + 👎 → 합리적 → keep: 👎

JSON으로 응답:
{
  "original": "👎",
  "refined": "👎",       // 정제된 평가
  "confidence": 0.9,     // 판정 신뢰도 (0~1)
  "reason": "0건 결과이므로 부정 평가 합리적",
  "actionable": true,    // 코드 수정으로 개선 가능한지
  "failure_type": "zero_result" // zero_result | bad_recommendation | revision_failed | category_mixing | slow_response | ui_issue | none
}
`
```

#### 정제 규칙

| 상황 | 원래 평가 | 정제 결과 | 이유 |
|------|----------|----------|------|
| 0건 결과 | 👍 | → 👎 | 결과 없는데 긍정은 대충 누른 것 |
| 0건 결과 | 😐 | → 👎 | 0건은 명백한 실패 |
| 정상 추천 (Top-3 매칭 80%+) | 👎 | → 😐 | 제품 자체는 합리적 |
| Milling인데 TAP 추천 | 👍 | → 👎 | 카테고리 불일치 |
| 조건 변경 요청 → "구체적으로 말씀해주세요" | 😐 | → 👎 | 기능 미작동 |
| 정상 응답 + 적절한 칩 | 👎 | → 😐 (신뢰도 0.5) | 불확실 — 무시 |

#### 신뢰도 기반 필터링

```
confidence >= 0.8 AND actionable == true  → 테스트 생성 대상
confidence >= 0.6 AND refined == "👎"     → 수동 검토 대상  
confidence < 0.6                          → 무시 (노이즈)
```

#### 객관적 실패 자동 감지 (emoji 무관)

emoji 정제와 별도로, **대화 내용만으로 객관적 실패를 탐지**:

```
자동 👎 판정 (emoji 무시):
- candidateCount === 0                    → zero_result
- AI 응답에 "구체적으로 말씀" 포함        → revision_failed  
- Milling 조건인데 TAP/드릴 시리즈 추천   → category_mixing
- 같은 질문 2회 이상 반복                 → loop_detected
- 응답 시간 > 15초                        → slow_response
```

이렇게 하면 emoji 평가에 의존하지 않고도 실패를 잡을 수 있음.

### 피드백 기반 실험 루프

```
1. 피드백 API에서 최근 👎/😐 수집
2. 각 피드백의 conversationSnapshot 분석
3. 실패 패턴 분류 (0건/잘못된 추천/변경 실패/칩 오류)
4. 해당 패턴의 코드 경로 추적
5. 수정 → 기존 테스트 통과 확인 → 커밋
6. 반복
```

### 자동 테스트 생성

👎 피드백에서 regression test 자동 생성:

```typescript
// 예: 사용자가 "직경 8mm로 바꿔줘" 했는데 안 된 경우
it("feedback-derived: 직경 변경 요청이 revision으로 처리됨", async () => {
  const state = makeState({
    appliedFilters: [], // 피드백의 appliedFilters에서 복원
    resolvedInput: makeBaseInput({ diameterMm: 10 }), // conditions에서 복원
  })
  const result = await resolveExplicitRevisionRequest(state, "직경 8mm로 바꿔줘")
  expect(result).not.toBeNull()
  expect(result?.kind).toBe("resolved")
})
```

이런 테스트를 `__tests__/feedback-derived.test.ts`에 누적.
새 피드백이 올 때마다 테스트가 늘어남 → 같은 버그 재발 방지.
