# AI Research Lab — 아키텍처 문서

본 문서는 ARIA Simulator v2 내부의 **AI Research Lab Demo Shell** 의
파일 구조·데이터 흐름·확장 포인트를 정리한다.

- 작성일: 2026-04-20
- 버전: v0.1
- 대상 독자: 프론트엔드 엔지니어, ML 팀, 신규 온보딩 개발자

---

## 📐 전체 구조

### 파일 트리 (ASCII)

```
lib/frontend/simulator/v2/
├── ai-research-lab/
│   ├── ai-research-lab.tsx            # 메인 컨테이너 (섹션 라우팅 + 배너)
│   ├── sticky-demo-banner.tsx         # 스크롤 따라오는 DEMO 배너
│   ├── section-shell.tsx              # 공통 섹션 래퍼 (타이틀·설명·뱃지)
│   ├── section-nav.tsx                # 사이드바 네비게이션 (IntersectionObserver)
│   ├── sections/
│   │   ├── ml-prediction-gauge.tsx    # XGBoost 수명 예측 게이지
│   │   ├── uncertainty-analysis.tsx   # Bayesian 5/95 분위수 밴드
│   │   ├── sensor-anomaly-panel.tsx   # 센서 2Hz 스트림 + 이상탐지
│   │   ├── personalization-panel.tsx  # 공장별 residual 개인화
│   │   ├── causal-xai-panel.tsx       # DoWhy + Claude 설명 SSE
│   │   ├── doe-designer.tsx           # DOE 실험설계 UI
│   │   ├── survival-curve-panel.tsx   # Kaplan-Meier 곡선
│   │   └── ai-roadmap.tsx             # Phase 1~5 로드맵 시각화
│   └── data/
│       ├── ml-interfaces.ts           # 모든 엔드포인트 계약 (TS interface)
│       ├── mock-data-engine.ts        # seedable PRNG + mock* 함수들
│       └── feature-explanations.ts    # InfoToggle 콘텐츠 SSOT
├── copilot/
│   ├── cutting-copilot.tsx            # 플로팅 챗 창 (우하단)
│   ├── copilot-context-capture.tsx    # 현재 공구·소재·파라미터 스냅샷
│   ├── copilot-messages.tsx           # 말풍선·코드블록·표 렌더러
│   ├── copilot-quick-actions.tsx      # "이 조건 최적화해줘" 등 숏컷
│   ├── copilot-system-prompts.ts      # 시스템 프롬프트 SSOT
│   └── use-copilot-stream.ts          # fetch POST + ReadableStream SSE hook
├── tour/
│   ├── tour-provider.tsx              # React context (step, progress, next/prev)
│   ├── tour-spotlight.tsx             # 어두운 오버레이 + 하이라이트 cutout
│   ├── tour-tooltip.tsx               # 말풍선 위치 자동 계산 (Popper-lite)
│   ├── tour-scenarios.ts              # 시나리오 SSOT (step 배열)
│   ├── first-visit-prompt.tsx         # "투어를 시작할까요?" 모달
│   └── tour-overlay.tsx               # 최상위 포탈 wrapper
└── shared/
    ├── info-toggle.tsx                # ⓘ 버튼 + Popover + "AI에게 물어보기"
    └── demo-badge.tsx                 # "DEMO DATA" amber 뱃지

app/api/
├── copilot/route.ts                   # SSE 스트리밍 Claude 챗봇
└── xai/causal/route.ts                # SSE 인과추론 설명
```

---

## 🔄 데이터 흐름

### Mock Data 경로

1. 각 섹션 컴포넌트가 `data/mock-data-engine.ts` 의 `mock*` 함수 호출
   - 예: `mockPredictToolLife({ toolSku, materialId, feed, speed, doc })`
2. 결정론적 PRNG (mulberry32) 로 seed 기반 데이터 생성 → 재현성 보장
   - seed 는 입력 파라미터의 SHA-32 해시로 생성 (동일 입력 → 동일 출력)
3. 반환 객체에 `isDemoData: true` flag 포함 (UI 표시 의무)
4. UI 는 이 값을 렌더링하면서 `<DemoBadge />` 로 출처 명시
5. 각 mock 함수 상단에 `TODO: PRODUCTION` 주석 블록으로 실제 엔드포인트 계약 명시

### 실제 LLM 경로 (Copilot, Causal xAI)

1. 클라이언트 컴포넌트가 `fetch('/api/copilot', { method: 'POST', body: JSON.stringify({ messages, context }) })`
2. Next.js API Route (`runtime = 'nodejs'`) 가 `@anthropic-ai/sdk` 로 Anthropic API 호출
3. SSE 형식 (`text/event-stream`) 으로 토큰 단위 스트리밍
4. 클라이언트가 `response.body.getReader()` → TextDecoder → 이벤트 파싱
5. UI 는 토큰 누적하여 말풍선 실시간 갱신

### InfoToggle ↔ Copilot 연결 (Global Event)

1. 어떤 InfoToggle 이든 "AI에게 물어보기" 버튼 클릭 시
2. `window.dispatchEvent(new CustomEvent('copilot:ask', { detail: { question } }))`
3. CuttingCopilot 이 mount 시점에 이 이벤트 listen
4. 이벤트 수신 시:
   - Copilot 창 자동 오픈
   - input 필드에 question 자동 채움
   - 300ms 후 자동 전송 (UX: 사용자가 한번 보게 지연)

### 투어 상태 흐름

1. `tour-provider` 가 localStorage (`aria-tour-seen`) 확인
2. 최초 방문이면 `first-visit-prompt` 표시
3. 시작 시 `tour-scenarios.ts` 의 step 배열을 순회
4. 각 step 마다 target selector 의 DOM rect 계산 → spotlight cutout + tooltip 배치
5. 종료 시 localStorage 에 기록

---

## 🎨 스타일 시스템

Tailwind CSS 4 + Radix UI Popover 기반. 다크모드 지원 (`prefers-color-scheme`).

| 용도 | 컬러 |
|------|------|
| 주 accent (AI / ML) | `teal-500` |
| 경고 (DEMO) | `amber-500` |
| 데모 배지 배경 | `amber-100` + border `amber-300` |
| 프로덕션 요건 박스 | `amber-50` + border `amber-200` |
| 성공 (센서 정상) | `emerald-500` |
| 위험 (센서 이상) | `rose-500` |
| 중립 (차트 축) | `slate-400` |

타이포그래피: `Pretendard Variable` (한글) + `Inter` (영문).
애니메이션: `framer-motion` 은 의도적으로 **미사용** — CSS transition + Tailwind `animate-*` 만 사용하여 번들 크기 최소화.

---

## 🔐 환경 변수

| 변수 | 용도 | 필수 여부 |
|------|------|-----------|
| `ANTHROPIC_API_KEY` | Claude API 인증 (Copilot, xAI) | **필수** |
| `OPENAI_API_KEY` | 기존 cook-forge 플로우 — AI Lab 과 무관 | AI Lab 에서는 선택 |
| `NEXT_PUBLIC_AI_LAB_DEMO_BANNER` | `'true'` 시 sticky 배너 강제 표시 | 선택 |

런타임에서 누락 감지 시: Copilot 은 서버에서 501 응답 → 클라이언트가 "키 미설정" 토스트 표시.

---

## 🧪 테스트 전략

- **Mock 데이터**: seedable 이므로 deterministic unit test 가능
  - `expect(mockPredictToolLife({...})).toMatchSnapshot()`
- **Copilot / Causal xAI**: 실제 API 호출이므로 **integration test** 만
  - 키가 있는 CI job 에서만 실행, PR 기본 CI 에서는 skip
- **투어 / InfoToggle**: Playwright E2E 로 검증 (기존 playwright 하네스 활용)
  - `tour:next` 이벤트 발생 시 다음 step DOM target 가시성 검증
- **접근성**: 각 섹션 axe-core 자동 검사, violation 0 목표

---

## 🚀 확장 포인트

각 mock 함수 상단의 `TODO: PRODUCTION` 주석 블록이 **엔드포인트 계약** 이다.
실제 ML 팀이 이 시그니처를 맞춰 엔드포인트를 개발하면,
클라이언트 코드는 `mock*` 호출을 `await fetch(...)` 로만 교체하면 완성된다.

예)

```ts
// 현재 (demo)
const result = mockPredictToolLife(input);

// 프로덕션 전환 시
const result = await fetch('/api/ml/tool-life', {
  method: 'POST',
  body: JSON.stringify(input),
}).then(r => r.json());
// 타입은 동일한 ml-interfaces.ts 의 `ToolLifePrediction` 재사용
```

SSOT 파일이 변경되면 Demo / Production 양쪽 동시에 정합성 유지.

---

## ⚙️ 성능 고려사항

- **센서 시뮬**: `setInterval(500ms)` — 2Hz. `visibilitychange` 감지하여 백그라운드 시 pause.
- **Mock 함수 호출**: 모든 섹션에서 `useMemo` 로 입력 변경 시만 재계산.
- **차트 렌더링**: SVG 직접 렌더 — 외부 차트 라이브러리 0 의존 (recharts/chart.js 불필요).
- **Copilot / xAI 스트림**: client-side SSE parsing, 큰 청크 없음 (토큰당 수십 바이트).
- **번들 크기**: AI Lab 전체 페이지 gzip 후 약 180KB (Copilot 라이브러리 포함).
- **첫 페인트**: LCP < 1.5s (Azure Static Web Apps + CDN).

---

## 🧩 컴포넌트 설계 원칙

1. **Presentational / Container 분리**: `sections/*` 는 순수 presentational, 데이터는 prop 으로 주입.
2. **SSOT**: patterns.ts / canonical-values.ts / feature-explanations.ts / tour-scenarios.ts — 하드코딩 금지.
3. **Prop drilling 최소화**: 전역 상태는 React Context (tour-provider) 또는 window event (copilot:ask).
4. **Storybook 미도입** (현재): Demo shell 자체가 시각적 프로토타입 역할을 겸함.
5. **Error boundary**: 각 섹션을 독립 boundary 로 감싸서 한 섹션 오류가 전체 페이지를 다운시키지 않도록.

---

## 🔄 상태 흐름 (간략 다이어그램)

```
┌─────────────────────────────────────────────┐
│ ai-research-lab.tsx (root)                  │
│  └── TourProvider                           │
│       └── Section grid                      │
│            ├── SectionShell                 │
│            │   ├── InfoToggle ──┐           │
│            │   └── Section body │           │
│            │        └ mockFoo() │           │
│            │                    ▼           │
│            └── (window event) copilot:ask   │
│                     │                       │
│                     ▼                       │
│ CuttingCopilot (portal, fixed bottom-right) │
│   └── useCopilotStream → /api/copilot SSE   │
└─────────────────────────────────────────────┘
```

---

## 📚 참고

- [`PRODUCTION_REQUIREMENTS.md`](./PRODUCTION_REQUIREMENTS.md) — 각 기능 실제 프로덕션화 요건
- `lib/frontend/simulator/v2/ai-research-lab/data/feature-explanations.ts` — 모든 InfoToggle 콘텐츠 SSOT
- `lib/frontend/simulator/v2/tour/tour-scenarios.ts` — 투어 시나리오 SSOT
- `lib/frontend/simulator/v2/ai-research-lab/data/ml-interfaces.ts` — 엔드포인트 계약 (Demo↔Production 경계)
- `CLAUDE.md` — 레포 전반 코딩 원칙 (하드코딩 금지, SSOT 원칙, LLM 래퍼 사용)

---

## 부록: 디렉터리 네이밍 규칙

- `sections/` 는 **독립 렌더링 가능한 패널**
- `shared/` 는 **2개 이상 섹션이 공유** 하는 컴포넌트
- `data/` 는 **타입 + 순수 함수** 만. React import 금지.
- `tour/`, `copilot/` 는 **cross-cutting concern** 이므로 별도 최상위 디렉터리.

## 부록: 향후 마이그레이션 TODO

1. `mock-data-engine.ts` 의 각 함수 → `/api/ml/*` 엔드포인트로 1:1 전환
2. `ml-interfaces.ts` 에 Zod 스키마 추가 → 런타임 검증 활성화
3. Copilot tool-use: `/api/copilot` 에 tool definition 추가 (ML 엔드포인트 호출)
4. 다국어화: 현재 한국어 하드코딩 → next-intl 도입 검토
5. Feature flag: LaunchDarkly 또는 자체 DB 기반 → 섹션별 on/off

---

문서 끝.
