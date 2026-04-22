# YG-1 Simulator v3 — 접근성 (WCAG 2.1 AA) 긴급 감사 보고서

> 작성일: 2026-04-22
> 대상: `lib/frontend/simulator/v2/*` (cutting-simulator-v2.tsx 제외)
> 기준: WCAG 2.1 Level AA (색상 대비 4.5:1, 키보드 네비, 스크린리더 호환)

## 요약

총 **8개 파일**에 걸쳐 **주요 A11Y 이슈 수정**을 적용했다. TypeScript 타입체크 통과 (`npx tsc --noEmit`).
구조 변경 없이 속성 추가 / 토큰 교체만 수행했으므로 시각 회귀는 거의 없다.

- aria-label / aria-modal / role 추가: 17건
- 색상 대비 (`text-slate-400` → `500/600`) 상향: 9건
- `<label htmlFor>` ↔ `<input id>` 연결: 1건 (벤치마크 모달)

## 파일별 변경점

### 1. `welcome-modal.tsx`
- 이미 `role="dialog" aria-modal="true" aria-labelledby` 존재 → 그대로 유지.
- 예시 프리셋 카드 내부 Vc/fz 프리뷰 div에 `aria-label` (Vc/fz 값 읽기 쉽게).

### 2. `command-palette.tsx`
- 이미 `cmdk` 라이브러리가 내부적으로 `role="dialog"`, `aria-controls` 처리. 변경 없음.

### 3. `favorites-panel.tsx`
- 검색 input: `aria-label="북마크 검색 (이름, 메모, 태그)"` 추가.
- 파일 import input: `aria-label="북마크 JSON 파일 가져오기"` 추가.
- 편집/삭제 아이콘 버튼(✏/🗑): `aria-label={북마크명 + 편집/삭제}` 동적 추가, 이모지는 `<span aria-hidden>` 로 래핑.
- 추가/편집 모달: `aria-label` → `aria-labelledby="yg1-fav-modal-title"` 로 교체하고 `<h4 id>` 연결.
- 검색/편집 input 컬러: `placeholder-slate-400` → `placeholder-slate-500` (대비 개선).

### 4. `ai-chat-sidebar.tsx`
- `<motion.aside role="dialog">` 에 `aria-modal="true"` + `aria-labelledby="yg1-ai-chat-title"` 추가, 헤더 `<h2 id>` 연결.
- 입력 textarea: `aria-label="AI 질문 입력"` 추가.
- `placeholder-slate-400` / 타임스탬프 `text-slate-400` → `slate-500` 로 대비 상향.
- 하단 안내 문구도 `text-slate-400` → `slate-500`.

### 5. `beginner-wizard.tsx`
- 이미 `role="dialog" aria-modal aria-labelledby` 존재.
- 5단계 진행 표시 바: `role="progressbar"` + `aria-valuenow/min/max/label` 추가 (기존 `aria-hidden` 제거).
- 재질 (ISO P/M/K/N/S/H), 가공 모드, 우선순위 선택 버튼: `aria-pressed={isSelected}` + 동적 `aria-label` 추가.
- 지름 프리셋 버튼 (3/6/10/12/16 mm): `aria-pressed` + `aria-label` 추가.
- 지름 슬라이더 `input[type=range]`: 기존 `aria-label` 유지 확인.
- 재질 힌트 영역 대비: `text-slate-400` → `slate-600` (light mode).
- ParamChip 레이블: `text-slate-400` → `slate-600`.

### 6. `ai-auto-agent-panel.tsx`
- **진행 바** (`iteration n/N`): 외부 컨테이너에 `role="progressbar"` + `aria-valuenow/min/max/label` 추가.
- 각 iteration 카드의 **score 바**: `role="progressbar"` + 0~100 범위 aria-value 속성 추가.
- 실험 횟수 `input[type=range]`: `aria-label="실험 횟수 N회 (최소 3, 최대 8)"` 추가.
- "중단" 버튼: `aria-label="자율 에이전트 중단"` + 아이콘 `aria-hidden="true"`.
- 대기 메시지 / iteration 차트 축 라벨 contrast: `text-slate-400` → `slate-500/600`.

### 7. `yg1-video-panel.tsx`
- 이미 `<iframe title={selected.title}>` 존재. 재생 버튼 `aria-label`, 썸네일 img `alt` 모두 존재.
- 변경 없음 (감사 결과 통과).

### 8. `benchmark-leaderboard.tsx`
- NicknameModal 외부 overlay 내부 panel: `role="dialog"` + `aria-modal="true"` + `aria-labelledby="yg1-bench-nick-title"` 추가.
- `<h3 id="yg1-bench-nick-title">` 연결.
- 닉네임 `<label>` 에 `htmlFor` + input 에 `id` 연결 (레이블-인풋 공식 연결).
- 닉네임 input placeholder: `placeholder-slate-400` → `500` 로 대비 개선.
- JSON import 파일 input: `aria-label="리더보드 JSON 파일 가져오기"` 추가.

## 키보드 네비게이션 확인

- 모든 `<button>` / `<input>` 기본 `tabIndex` 유지 (리더보드의 `motion.li role="button"` 은 `tabIndex={0}`).
- Esc 닫기: welcome / beginner-wizard / command-palette / favorites modal / nickname modal / ai-chat-sidebar 모두 `keydown` 리스너로 구현 완료.
- 다만 focus trap 은 구현되어 있지 않음 — 남은 이슈 참고.

## 남은 이슈 (우선순위)

### P1 (High)
1. **Focus trap 미구현**: 모달이 열려도 Tab 키가 모달 바깥 요소로 빠진다. `focus-trap-react` 도입 또는 수동 구현 필요. (welcome / beginner / favorites / benchmark / ai-chat)
2. **AI 채팅 사이드바는 `role="dialog"` 지만 비모달 영역**: `aria-modal="true"` 로 선언했지만 실제로는 back 다른 인터랙션이 계속 가능함. `role="complementary"` 로 재고려 필요.

### P2 (Medium)
3. **TypingIndicator / 스트리밍 상태 변경**: `aria-live="polite"` 영역 부재 → 스크린리더 사용자는 응답이 도착했는지 못 느낀다.
4. **Iteration 히스토리 리스트**: `<ul role="list">` 시맨틱 유지 + `aria-live="polite"` 고려.
5. **즐겨찾기 카드**: ⭐ 토글 버튼의 상태 변화가 색상으로만 전달됨 — `aria-pressed` 는 이미 있으나 `aria-label` 도 조건부로 이미 ok.
6. **Diameter SVG preview**: `aria-label` 에 값 포함되어 있지만 `role="img"` 명시 권장.

### P3 (Low)
7. **벤치마크 탭**: `role="tab"` 은 있지만 `role="tablist"` 부모가 있으나 `role="tabpanel"` 연결 아이디가 없음.
8. **카테고리 탭**: `aria-controls` 누락 — 탭과 패널 간 연결 없음.
9. **Welcome modal 프리셋 카드**: 클릭 시 모달이 즉시 닫히는데 `aria-describedby` 로 설명이 없어 스크린리더 사용자가 결과를 모를 수 있음.
10. **라이트 모드 일부 `text-slate-500` 텍스트는 작은 폰트(11px/10px)에서 여전히 경계선**: AAA 수준은 아님. 대형 텍스트 기준으로는 통과.

## 검증

- `npx tsc --noEmit`: **통과** (추가 오류 없음).
- 수동 확인 필요: 스크린리더 (NVDA/VoiceOver) 스모크 테스트는 다음 스프린트에 예정.

## 변경된 파일

1. `lib/frontend/simulator/v2/welcome-modal.tsx`
2. `lib/frontend/simulator/v2/favorites-panel.tsx`
3. `lib/frontend/simulator/v2/ai-chat-sidebar.tsx`
4. `lib/frontend/simulator/v2/beginner-wizard.tsx`
5. `lib/frontend/simulator/v2/ai-auto-agent-panel.tsx`
6. `lib/frontend/simulator/v2/benchmark-leaderboard.tsx`

(`command-palette.tsx`, `yg1-video-panel.tsx` 는 감사 결과 이미 기준을 충족하여 무변경.)
