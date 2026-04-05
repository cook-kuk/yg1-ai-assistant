# 경쟁사 공구 스펙 자동 추출 기능 구현

## 배경 및 목적

YG-1 ARIA 시스템에 "대체품 추천" 기능을 추가한다.
사용자가 경쟁사 공구 모델명(예: "GUHRING 3736")을 입력하면:
1. 웹 검색으로 해당 공구의 스펙(직경, 날수, 소재 적합성 등)을 자동 추출
2. 추출된 스펙으로 `intakeForm`을 자동으로 채움
3. `/api/recommend`를 호출해 YG-1 대체 공구를 추천

DB(competitor-repo) 없이 실시간 웹 검색으로만 동작한다.

---

## 현재 코드 구조 (변경하지 말 것)

```
lib/
├── types/intake.ts                    ← FIELD_CONFIGS, InquiryPurpose 타입
├── frontend/recommendation/
│   ├── intake-flow.tsx                ← IntakeGate UI 컴포넌트
│   ├── intake-types.ts                ← re-export only
│   ├── use-product-recommendation-page.ts  ← 메인 훅
│   └── recommendation-client.ts      ← API 요청 빌더
app/
└── products/page.tsx                  ← 페이지 진입점
```

### 핵심 타입 (변경 금지)

```ts
// lib/types/intake.ts
export type InquiryPurpose =
  | "new"
  | "substitute"          // ← 대체품 모드 (이미 존재)
  | "inventory_substitute"
  | "cutting_condition"
  | "product_lookup"

export interface ProductIntakeForm {
  inquiryPurpose: AnswerState<InquiryPurpose>
  material: AnswerState<string>           // ISO: "P" | "M" | "K" | "N" | "S" | "H"
  operationType: AnswerState<string>      // "Side_Milling" 등
  machiningIntent: AnswerState<MachiningIntent>
  toolTypeOrCurrentProduct: AnswerState<string>  // ← 경쟁사 모델명 들어갈 곳
  diameterInfo: AnswerState<string>       // "10mm" 형식
  country?: AnswerState<string>
}
```

### API 구조 (변경 금지)

```
POST /api/recommend
body: { intakeForm: ProductIntakeForm, messages: [], session: null }

POST /api/chat
body: { messages: [{role: "user", text: "..."}] }
→ 응답: { text: "...", ... }
```

**중요**: `/api/chat`은 이미 web_search 도구를 내부적으로 사용하므로
별도 웹 검색 구현 필요 없음. 적절한 프롬프트만 전달하면 됨.

---

## 구현할 것

### 1. 새 파일: `lib/frontend/recommendation/competitor-spec-resolver.ts`

경쟁사 모델명 → 스펙 추출 전담 모듈.

```ts
export interface CompetitorSpec {
  model: string
  diameterMm: number | null
  flutes: number | null
  isoMaterial: string[]        // ["P", "M", "K"] 등
  toolSubtype: "Square" | "Radius" | "Ball" | null
  coating: string | null
  operationType: "Milling" | "Holemaking" | "Threading" | "Turning" | null
  confidence: "high" | "medium" | "low"
  source: string               // 출처 URL or 설명
}

export interface SpecResolveResult {
  success: boolean
  spec: CompetitorSpec | null
  error?: string
}
```

`resolveCompetitorSpec(modelName: string): Promise<SpecResolveResult>` 함수 구현:

- `/api/chat`에 POST 요청
- 시스템 프롬프트: 절삭공구 스펙 추출 전문가 역할
- 사용자 메시지: `"${modelName}" 절삭공구 스펙을 웹 검색으로 찾아 JSON만 반환`
- 응답에서 JSON 파싱 (```json ... ``` 블록 처리 포함)
- 파싱 실패 시 `success: false` 반환
- timeout: 15초

**프롬프트 예시** (실제 구현 시 이 구조 사용):

```
당신은 절삭공구 스펙 추출 전문가입니다.
주어진 경쟁사 공구 모델명을 웹 검색으로 찾아 스펙을 추출하세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:
{
  "model": "모델명",
  "diameterMm": 숫자 또는 null,
  "flutes": 숫자 또는 null,
  "isoMaterial": ["P","M","K","N","S","H"] 중 해당하는 것들의 배열,
  "toolSubtype": "Square" | "Radius" | "Ball" | null,
  "coating": "코팅명" 또는 null,
  "operationType": "Milling" | "Holemaking" | "Threading" | "Turning" | null,
  "confidence": "high" | "medium" | "low",
  "source": "출처 URL"
}

confidence 기준:
- high: 공식 카탈로그/제조사 사이트에서 확인
- medium: 대리점/유통사 자료에서 확인
- low: 추정 또는 불확실
```

---

### 2. 새 파일: `lib/frontend/recommendation/use-competitor-spec.ts`

React 훅. 경쟁사 모델명 입력 → 스펙 자동 추출 → intakeForm 자동 채움.

```ts
export function useCompetitorSpec(
  onChange: (key: keyof ProductIntakeForm, val: AnswerState<string>) => void
) {
  const [isResolving, setIsResolving] = useState(false)
  const [resolvedSpec, setResolvedSpec] = useState<CompetitorSpec | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)

  const resolveSpec = async (modelName: string) => { ... }
  const clearSpec = () => { ... }

  return { isResolving, resolvedSpec, resolveError, resolveSpec, clearSpec }
}
```

`resolveSpec` 동작:
1. `setIsResolving(true)`
2. `resolveCompetitorSpec(modelName)` 호출
3. 성공 시 스펙으로 intakeForm 자동 채움:
   - `diameterMm` 있으면 → `onChange("diameterInfo", { status: "known", value: `${spec.diameterMm}mm` })`
   - `isoMaterial` 있으면 → `onChange("material", { status: "known", value: spec.isoMaterial.join(",") })`
   - `operationType` 있으면 → `onChange("operationType", { status: "known", value: getDefaultOperation(spec.operationType) })`
     - Milling → "Side_Milling" (기본값)
     - Holemaking → "Drilling"
4. `setResolvedSpec(spec)`

---

### 3. `lib/types/intake.ts` 수정

**변경 1**: `substitute` 버튼 `disabled: true` 제거

```ts
// 변경 전
{ value: "substitute", label: "YG-1 대체품 찾기", disabled: true },

// 변경 후
{ value: "substitute", label: "YG-1 대체품 찾기" },
```

**변경 2**: `toolTypeOrCurrentProduct` 필드에 customInput 추가

```ts
{
  key: "toolTypeOrCurrentProduct",
  label: "가공 방식",
  emoji: "🛠️",
  description: "찾고 싶은 공구 계열을 선택하세요.",
  options: [
    { value: "Holemaking", label: "Holemaking" },
    { value: "Threading", label: "Threading" },
    { value: "Milling", label: "Milling" },
    { value: "Turning", label: "Turning" },
    { value: "Tooling System", label: "Tooling System" },
  ],
  unknownLabel: "모름",
  hasCustomInput: true,                                          // ← 추가
  customInputLabel: "경쟁사 모델명 직접 입력",                    // ← 추가
  customInputPlaceholder: "예: GUHRING 3736, SANDVIK R216",     // ← 추가
},
```

---

### 4. `lib/frontend/recommendation/intake-flow.tsx` 수정

`IntakeFieldSection` 컴포넌트에서 `toolTypeOrCurrentProduct` 렌더링 변경.

**추가할 import**:
```ts
import { useCompetitorSpec } from "./use-competitor-spec"
```

**`IntakeFieldSection` props에 `onChange` 전체 접근 필요** — 이미 있음.

**`referenceStyleSelection` 선언 직전에 추가**:
```ts
const isSubstituteMode =
  config.key === "toolTypeOrCurrentProduct" &&
  form?.inquiryPurpose?.status === "known" &&
  (form.inquiryPurpose as { status: "known"; value: string }).value === "substitute"
```

**`toolTypeOrCurrentProduct` 분기 교체**:

```tsx
config.key === "toolTypeOrCurrentProduct" ? (
  isSubstituteMode ? (
    <SubstituteModeInput
      currentValue={currentValue}
      onChange={onChange}
      formOnChange={/* IntakeGate의 onChange */}
    />
  ) : (
    /* 기존 ToolCategoryCard 그리드 — 변경 없음 */
    <div className="rounded-2xl border border-gray-200 ...">
      ...기존 코드 그대로...
    </div>
  )
) : ...
```

**새 컴포넌트 `SubstituteModeInput`** (같은 파일 안에 선언):

```tsx
function SubstituteModeInput({
  currentValue,
  onChange,
  onFormChange,
}: {
  currentValue: string | null
  onChange: (s: AnswerState<string>) => void
  onFormChange: (key: keyof ProductIntakeForm, val: AnswerState<string>) => void
}) {
  const [inputVal, setInputVal] = useState(currentValue ?? "")
  const { isResolving, resolvedSpec, resolveError, resolveSpec, clearSpec } =
    useCompetitorSpec(onFormChange)

  const handleSearch = () => {
    if (!inputVal.trim()) return
    onChange({ status: "known", value: inputVal.trim() })
    resolveSpec(inputVal.trim())
  }

  return (
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-3">
      {/* 헤더 */}
      <div className="flex items-center gap-2">
        <span className="text-lg">🔄</span>
        <div>
          <p className="text-sm font-semibold text-blue-800">
            현재 사용 중인 경쟁사 공구 모델명
          </p>
          <p className="text-[10px] text-blue-500 mt-0.5">
            입력하면 스펙을 자동으로 찾아 아래 항목을 채워줍니다
          </p>
        </div>
      </div>

      {/* 입력창 + 검색 버튼 */}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-xl border-2 border-blue-300 bg-white px-3 py-2.5 text-sm
                     placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
          placeholder="예: GUHRING 3736, SANDVIK R216, SGS 47698..."
          value={inputVal}
          onChange={e => {
            setInputVal(e.target.value)
            onChange(
              e.target.value.trim()
                ? { status: "known", value: e.target.value.trim() }
                : { status: "unanswered" }
            )
          }}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={!inputVal.trim() || isResolving}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white
                     hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                     flex items-center gap-1.5 whitespace-nowrap"
        >
          {isResolving ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2
                              border-white border-t-transparent" />
              검색 중...
            </>
          ) : (
            <>🔍 스펙 검색</>
          )}
        </button>
      </div>

      {/* 결과: 성공 */}
      {resolvedSpec && !isResolving && (
        <div className="rounded-xl border border-green-200 bg-white p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-green-700 flex items-center gap-1">
              ✓ 스펙 자동 완성됨
              <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                resolvedSpec.confidence === "high"
                  ? "bg-green-100 text-green-700"
                  : resolvedSpec.confidence === "medium"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-gray-100 text-gray-500"
              }`}>
                {resolvedSpec.confidence === "high" ? "신뢰도 높음"
                  : resolvedSpec.confidence === "medium" ? "신뢰도 중간"
                  : "신뢰도 낮음 — 확인 권장"}
              </span>
            </p>
            <button
              type="button"
              onClick={() => { clearSpec(); setInputVal(""); onChange({ status: "unanswered" }) }}
              className="text-[10px] text-gray-400 hover:text-gray-600"
            >
              초기화
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-[11px]">
            {resolvedSpec.diameterMm && (
              <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                <div className="text-gray-400">직경</div>
                <div className="font-semibold text-gray-800">φ{resolvedSpec.diameterMm}mm ✓</div>
              </div>
            )}
            {resolvedSpec.flutes && (
              <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                <div className="text-gray-400">날수</div>
                <div className="font-semibold text-gray-800">{resolvedSpec.flutes}날 ✓</div>
              </div>
            )}
            {resolvedSpec.isoMaterial.length > 0 && (
              <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                <div className="text-gray-400">소재</div>
                <div className="font-semibold text-gray-800">{resolvedSpec.isoMaterial.join("/")} ✓</div>
              </div>
            )}
            {resolvedSpec.toolSubtype && (
              <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                <div className="text-gray-400">형상</div>
                <div className="font-semibold text-gray-800">{resolvedSpec.toolSubtype} ✓</div>
              </div>
            )}
            {resolvedSpec.coating && (
              <div className="rounded-lg bg-gray-50 px-2 py-1.5">
                <div className="text-gray-400">코팅</div>
                <div className="font-semibold text-gray-800">{resolvedSpec.coating}</div>
              </div>
            )}
          </div>
          {resolvedSpec.confidence === "low" && (
            <p className="text-[10px] text-amber-600 flex items-center gap-1">
              ⚠ 아래 항목들을 직접 확인하고 수정하세요
            </p>
          )}
          {resolvedSpec.source && (
            <p className="text-[10px] text-gray-400 truncate">출처: {resolvedSpec.source}</p>
          )}
        </div>
      )}

      {/* 결과: 실패 */}
      {resolveError && !isResolving && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-xs text-amber-700">
            ⚠ 스펙을 자동으로 찾지 못했습니다. 아래 항목을 직접 입력해주세요.
          </p>
        </div>
      )}
    </div>
  )
}
```

**중요**: `SubstituteModeInput`에서 `onFormChange`가 필요하므로,
`IntakeFieldSection`의 props에 `onFormChange`를 추가하고
`IntakeGate`에서 전달해야 한다.

---

### 5. `allRequiredAnswered` 동작 확인

`lib/types/intake.ts`의 `allRequiredAnswered` 함수:

```ts
export function allRequiredAnswered(form: ProductIntakeForm): boolean {
  return (
    isAnswered(form.inquiryPurpose) &&
    isAnswered(form.material) &&
    isAnswered(form.operationType) &&
    isAnswered(form.toolTypeOrCurrentProduct) &&
    isAnswered(form.diameterInfo)
  )
}
```

`substitute` 모드에서는 `toolTypeOrCurrentProduct`에 경쟁사 모델명이 들어가므로
`allRequiredAnswered`가 `true`가 되어 "조건 요약 확인" 버튼이 활성화된다. **변경 불필요**.

---

## 전체 플로우 확인

```
사용자: "YG-1 대체품 찾기" 선택
              ↓
toolTypeOrCurrentProduct 필드: 카드 UI → 텍스트 입력창으로 전환
              ↓
"GUHRING 3736" 입력 + 🔍 스펙 검색 클릭
              ↓
/api/chat POST → 웹 검색 → JSON 파싱 (약 3~5초)
              ↓
스펙 추출 성공:
  - material: "P,M,K" 자동 채움
  - diameterInfo: "10mm" 자동 채움  (직경 null이면 사용자 직접 입력)
  - toolTypeOrCurrentProduct: "GUHRING 3736" 저장
              ↓
사용자가 나머지 빈 항목 직접 입력/확인
              ↓
"조건 요약 확인" → "이 조건으로 추천 시작"
              ↓
/api/recommend POST → AI 응답:
"GUHRING 3736 대체 공구를 찾아드리겠습니다.
 현재 탄소강 φ10mm 조건으로 954개 후보 중..."
              ↓
대화로 좁혀가다 → 최종 추천
```

---

## 구현 시 주의사항

1. **기존 "신규 제품 추천" 플로우 절대 건드리지 말 것**
   - `inquiryPurpose === "new"` 일 때는 기존 카드 UI 그대로 유지

2. **`/api/chat` 타임아웃 15초 설정**
   - 웹 검색이 느릴 수 있으므로 AbortController 사용

3. **JSON 파싱 방어 코드 필수**
   ```ts
   // ```json ... ``` 블록 처리
   const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) 
                  ?? text.match(/\{[\s\S]*\}/)
   ```

4. **스펙 추출 실패해도 폴백 동작**
   - 에러 메시지 표시 후 사용자 직접 입력으로 진행 가능
   - 추천 자체는 스펙 없어도 가능 (덜 정확하지만)

5. **TypeScript strict mode 준수**
   - 기존 코드가 strict mode이므로 타입 에러 없어야 함

6. **`machiningIntent`는 건드리지 말 것**
   - `substitute` 모드에서도 `{ status: "unanswered" }` 유지

---

## 완성 후 검증 시나리오

다음 시나리오가 모두 작동해야 함:

### 시나리오 1: 스펙 추출 성공
```
1. "YG-1 대체품 찾기" 클릭
2. "GUHRING 3736" 입력 → "🔍 스펙 검색" 클릭
3. 로딩 스피너 표시 (3~5초)
4. 스펙 카드 표시: "4날 ✓ / P/M/K ✓" 등
5. material, diameterInfo 자동 채워짐
6. operationType만 직접 선택
7. "조건 요약 확인" 활성화 → 추천 시작
8. AI: "GUHRING 3736 대체품 찾아드리겠습니다..."
```

### 시나리오 2: 스펙 추출 실패
```
1. "YG-1 대체품 찾기" 클릭
2. 존재하지 않는 모델명 입력 → 검색
3. "⚠ 스펙을 자동으로 찾지 못했습니다" 표시
4. 사용자가 material, diameterInfo 직접 입력
5. 추천 정상 진행
```

### 시나리오 3: 신규 추천 모드 (기존 동작 유지)
```
1. "신규 제품 추천" 클릭
2. toolTypeOrCurrentProduct: 기존 카드 UI 표시 (Milling, Holemaking 등)
3. 기존 플로우 그대로
```

---

## 파일 목록 요약

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `lib/types/intake.ts` | 수정 | substitute 활성화, customInput 추가 |
| `lib/frontend/recommendation/competitor-spec-resolver.ts` | 신규 생성 | 웹 검색 스펙 추출 로직 |
| `lib/frontend/recommendation/use-competitor-spec.ts` | 신규 생성 | React 훅 |
| `lib/frontend/recommendation/intake-flow.tsx` | 수정 | SubstituteModeInput 컴포넌트 추가 |

총 4개 파일. 서버 코드, API route, DB 변경 없음.
