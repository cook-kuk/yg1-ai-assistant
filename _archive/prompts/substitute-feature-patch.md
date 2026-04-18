# 대체품 추천 기능 활성화 패치
> DB 없이 즉시 적용 가능 | 수정 파일 2개 | 예상 작업시간 1~2시간

---

## 파일 1: `lib/types/intake.ts`

### 변경 1-A: `substitute` 버튼 disabled 제거

```ts
// ❌ 변경 전
{ value: "substitute", label: "YG-1 대체품 찾기", disabled: true },

// ✅ 변경 후
{ value: "substitute", label: "YG-1 대체품 찾기" },
```

### 변경 1-B: `toolTypeOrCurrentProduct` 필드에 customInput 추가

```ts
// ❌ 변경 전
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
},

// ✅ 변경 후
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
  hasCustomInput: true,
  customInputLabel: "경쟁사 모델명 직접 입력",
  customInputPlaceholder: "예: GUHRING 3736, SANDVIK R216, SGS 47698",
},
```

---

## 파일 2: `lib/frontend/recommendation/intake-flow.tsx`

### 변경 위치: `IntakeFieldSection` 함수 안 `referenceStyleSelection` 선언부

현재 코드에서 이 부분을 찾으세요:

```tsx
const referenceStyleSelection = config.key === "toolTypeOrCurrentProduct" ? (
```

그 바로 위에 이걸 추가하세요:

```tsx
// ── 대체품 모드 감지 ──────────────────────────────────────────
const isSubstituteMode =
  config.key === "toolTypeOrCurrentProduct" &&
  form?.inquiryPurpose?.status === "known" &&
  (form.inquiryPurpose as { status: "known"; value: string }).value === "substitute"
// ─────────────────────────────────────────────────────────────
```

그다음 `toolTypeOrCurrentProduct` 렌더링 블록 전체를 교체하세요:

```tsx
// ❌ 변경 전 (이 블록 전체를)
const referenceStyleSelection = config.key === "toolTypeOrCurrentProduct" ? (
  <div className="rounded-2xl border border-gray-200 bg-[radial-gradient(circle_at_top_left,#ffffff_0%,#f4f4f5_72%)] p-3">
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(clamp(120px, 22vw, 240px), 1fr))", gap: "0.5rem" }}>
      {config.options.map(option => (
        <ToolCategoryCard
          key={option.value}
          option={option}
          disabled={option.disabled}
          selected={state.status === "known" && currentValue === option.value}
          onClick={() => onChange({ status: "known", value: option.value })}
        />
      ))}
    </div>
  </div>
) : config.key === "inquiryPurpose" ? (

// ✅ 변경 후 (이걸로 교체)
const referenceStyleSelection = config.key === "toolTypeOrCurrentProduct" ? (
  isSubstituteMode ? (
    /* ── 대체품 모드: 경쟁사 모델명 텍스트 입력 ── */
    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">🔄</span>
        <div>
          <p className="text-sm font-semibold text-blue-800">
            현재 사용 중인 경쟁사 공구 모델명을 입력하세요
          </p>
          <p className="text-[10px] text-blue-500 mt-0.5">
            모델명만 입력해도 됩니다. 소재·직경은 아래에서 따로 선택하세요.
          </p>
        </div>
      </div>
      <input
        className="w-full rounded-xl border-2 border-blue-300 bg-white px-3 py-2.5 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
        placeholder="예: GUHRING 3736, SANDVIK R216, SGS 47698, Kennametal B2C..."
        value={customVal}
        onChange={e => handleCustomChange(e.target.value)}
      />
      {currentValue && state.status === "known" && (
        <div className="flex items-center gap-1.5 text-[11px] text-blue-600">
          <span className="text-blue-500">✓</span>
          <span><strong>{currentValue}</strong> 입력됨</span>
        </div>
      )}
    </div>
  ) : (
    /* ── 기존 가공 방식 카드 UI (신규 추천 모드) ── */
    <div className="rounded-2xl border border-gray-200 bg-[radial-gradient(circle_at_top_left,#ffffff_0%,#f4f4f5_72%)] p-3">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(clamp(120px, 22vw, 240px), 1fr))", gap: "0.5rem" }}>
        {config.options.map(option => (
          <ToolCategoryCard
            key={option.value}
            option={option}
            disabled={option.disabled}
            selected={state.status === "known" && currentValue === option.value}
            onClick={() => onChange({ status: "known", value: option.value })}
          />
        ))}
      </div>
    </div>
  )
) : config.key === "inquiryPurpose" ? (
```

---

## 추가 변경 (선택사항이지만 권장): 대체품 모드에서 라벨 변경

`IntakeFieldSection` 에서 필드 라벨 부분에 아래 로직 추가하면 UX가 더 자연스러워집니다:

```tsx
// getIntakeFieldLabel 호출하는 줄 찾아서 아래처럼 교체
<span className="text-xs font-semibold text-gray-900">
  {config.key === "toolTypeOrCurrentProduct" && isSubstituteMode
    ? "경쟁사 공구 모델명"
    : getIntakeFieldLabel(config.key as keyof ProductIntakeForm, language)}
</span>
```

그리고 description도:
```tsx
<p className="text-[10px] text-gray-500">
  {config.key === "toolTypeOrCurrentProduct" && isSubstituteMode
    ? "대체를 원하는 경쟁사 공구 모델명을 입력하세요."
    : localizeIntakeText(config.description, language)}
</p>
```

---

## 변경 없이 그대로 두는 것들

| 항목 | 이유 |
|------|------|
| `recommendation-client.ts` | form 그대로 전달하므로 수정 불필요 |
| `use-product-recommendation-page.ts` | 변경 없음 |
| `app/products/page.tsx` | 변경 없음 |
| `/api/recommend` 서버 코드 | `substitute` 이미 처리됨 확인 완료 |
| DB / `competitor-repo.ts` | 나중에 추가하면 됨 |

---

## 동작 확인 시나리오

변경 후 이 플로우가 작동해야 합니다:

```
1. /products 접속
2. 🧭 문의 목적 → "YG-1 대체품 찾기" 클릭 (이제 활성화됨)
3. 🧱 가공 소재 → "P 탄소강" 클릭
4. 🛠️ 경쟁사 공구 모델명 → "GUHRING 3736" 입력 (텍스트 입력창 표시됨)
5. 📐 가공 형상 → "Side Milling" 클릭  ← 이건 계속 표시됨
6. 📏 공구 직경 → "10mm" 클릭
7. "조건 요약 확인" → "이 조건으로 추천 시작"
8. AI 응답: "GUHRING 3736 대체 공구를 찾아드리겠습니다. 현재 954개 후보..."
9. 대화로 좁혀가다 최종 추천
```

---

## 주의사항

- `substitute` 모드에서 `toolTypeOrCurrentProduct`에 경쟁사 모델명이 입력되면
  `allRequiredAnswered()` 함수가 `true`를 반환합니다 (기존 로직 그대로).
- `material`, `operationType`, `diameterInfo`는 여전히 필수입니다.
  사용자가 소재·직경을 직접 선택하게 되는 구조입니다.
- DB가 생기면 나중에 `competitor-repo.ts`에 모델명→스펙 테이블을 채우면
  `evidence` 10점이 자동으로 올라갑니다. 코드 추가 변경 없음.
