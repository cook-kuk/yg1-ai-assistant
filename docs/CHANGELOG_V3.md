# Simulator v3 Director-Ready Edition — 변경 이력

브랜치: `feat/simulator-v3-director-ready`
목표: Harvey MAP 완전 벤치마킹 + MAP 초월 7기능 + 교육 모드 토글 (연구소장 대면 대응)

---

## 2026-04-22 · Sprint 종합 (이번 세션)

> **한눈에 요약**: STEP 6 전체 완료 이후 이어진 대규모 증축 — AI API 6개 + 비주얼/인터랙션 컴포넌트 15종 이상 + 교육 모드 7종 + 벤더 출처 태깅 38 항목 + Pino/Sentry/ErrorBoundary 기반 시설 + 번들 -58% 성능 리프트. 메인 엔트리 `cutting-simulator-v2.tsx` (3,228줄)는 통합 지점으로만 유지 (건드리지 않음).

### 🤖 AI 통합 (6 API + 6 UI 패널)

| API | 경로 | 모델 | 역할 | UI 컴포넌트 |
| --- | --- | --- | --- | --- |
| AI 코치 | `app/api/simulator/coach/route.ts` | Claude Sonnet 4.6 (SSE stream) | 현재 파라미터 실시간 분석 + 개선 제안 스트리밍 | `ai-coach-panel.tsx` |
| 자연어 질의 | `app/api/simulator/nl-query/route.ts` | Haiku 4.5 | "SM45C 8mm 황삭" → 파라미터 프리셋 자동 세팅 | `ai-query-bar.tsx` |
| 경고 해설 | `app/api/simulator/explain-warning/route.ts` | Haiku 4.5 | 경고 아이콘 hover 시 원인·조치 설명 | `ai-warning-explain.tsx` |
| 1-click 최적화 | `app/api/simulator/optimize/route.ts` | Sonnet 4.6 | RPM/Feed 자동 튜닝 + before/after diff | `ai-optimize-button.tsx` |
| Auto Agent | `app/api/simulator/auto-agent/route.ts` | Sonnet 4.6 (6 iteration) | MRR 목표 기반 자율 탐색 + 수렴 보고 | `ai-auto-agent-panel.tsx` |
| Multi-turn Chat | `app/api/simulator/chat/route.ts` | Sonnet 4.6 | 사이드바 대화형 Q&A + 컨텍스트 주입 | `ai-chat-sidebar.tsx` |

커밋 참조: `696c0852` (자연어·경고·최적화 API 초판) · `8b4aa356` (최적화·경고 FeatureExplainer 통합) · `89dd7c53` (AutoAgent + Before/After + 리더보드) · `50c4b6bf` (AI 채팅 사이드바 · G-code · 즐겨찾기) · `188539ff` (Coach Opus→Sonnet 다운시프트).

### 🎨 비주얼·시뮬레이션 컴포넌트 (15+)

MAP·Harvey를 초월하는 몰입형 시각화 레이어.

- `cutting-3d-scene.tsx` — 진짜 WebGL 3D 절삭 장면 (Three.js) · `50c4b6bf`
- `live-cutting-scene.tsx` · `machining-animation.tsx` · `cutting-action.tsx` — 실시간 절삭 연출
- `temperature-heatmap.tsx` · `heatmap-panel.tsx` — 열분포 히트맵 (MAP 초월 #1)
- `force-vector-diagram.tsx` · `vibration-oscilloscope.tsx` — 힘 벡터 + 진동 오실로스코프
- `engagement-circle.tsx` · `tool-path-scene.tsx` · `tool-path-info-modal.tsx` — 절삭 궤적 및 공구 경로
- `endmill-3d-preview.tsx` · `tool-blueprint.tsx` · `tool-silhouette.tsx` · `blueprint-gallery.tsx`
- `dashboard-hero-display.tsx` · `holographic-frame.tsx` · `analog-gauges.tsx` · `power-arc-effect.tsx` · `wear-gauge-panel.tsx` — 영웅 KPI + 홀로그래픽 + 게이지 · `7c367826`
- `cinematic-backdrop.tsx` · `cyberpunk-hud.tsx` · `parallax-tilt.tsx` · `floating-warnings.tsx` — 시네마틱 배경 + 사이버펑크 HUD · `42bcb822`
- `micro-interactions.tsx` · `animated-number.tsx` — 마이크로 인터랙션
- `break-even-chart.tsx` · `tool-life-scenario.tsx` · `advanced-metrics-panel.tsx` — 손익분기 · Tool Life · 고급 지표
- `before-after-compare.tsx` · `benchmark-leaderboard.tsx` · `yg1-video-panel.tsx` — 변화 시각화 + 리더보드 + 영상 패널

### 🎓 교육 모드 (7종)

- `feature-explainer.tsx` — 47 entry FeatureExplainer (모든 비주얼 패널 인라인 해설) · `8b4aa356` · `e5c52fae`
- `welcome-modal.tsx` — 최초 진입 환영 모달
- `beginner-wizard.tsx` — 초보자용 단계 마법사
- `interactive-tutorial.tsx` — 상호작용 투어 (EduTheater 선행)
- `beginner-lesson-cards.tsx` — 레슨 카드 번들
- `cheat-sheet-panel.tsx` — 치트 시트
- `glossary-browser.tsx` + `app/simulator_v2/glossary/page.tsx` — 용어사전 (112 entry 재활용)

매뉴얼/개념사전 다운로드는 `manual-download-button.tsx` · `bbed4cbd`. `EduLabel` 19 위치 배치는 `b755c8e7`, 후속 11 위치 보강 `2bb82731`. 검증 100% 통과는 `ee4a8c38`.

### 🏷 벤더 출처 태깅 (Endmill Edition)

- `vendor-tags.tsx` · `provenance-panel.tsx` — 5사(YG-1 · Harvey · Sandvik · Iscar · Kennametal) 출처 뱃지.
- 38 항목 메타데이터, 그 중 **17 항목이 YG-1 Original**, 나머지에 `NOVEL` 배지 부여 · `82c5096a` · `e5c52fae`.

### ⚙ 기반 시설 · 런타임

- `sim-error-boundary.tsx` — Sentry 연동 Error Boundary + fallback UI · `2417e8fe`
- Pino 구조화 로거 + Sentry (AI 호출 실패율·p95 latency 자동 태깅)
- `admin/sim-admin-dashboard.tsx` — 관리자 대시보드
- `voice-input-button.tsx` · `session-export.tsx` · `favorites-panel.tsx` — 음성 입력 + 세션 export + 즐겨찾기 · `6cfea65a` · `50c4b6bf`
- `use-undo-redo.ts` + `use-simulator-shortcuts.ts` — Undo/Redo 훅 + Ctrl+Z/Y + 툴바 ↶↷ · `555c7077`
- `gcode-download-button.tsx` — G-code 다운로드 · `50c4b6bf`
- `operation-picker.tsx` — 공정 선택기 (황삭/정삭/슬롯/트로코이달)
- Playwright E2E 스모크 15/15 (AI 경로 포함) · `e5c52fae`
- `app/api/dev-build-info/route.ts` — 빌드 메타 엔드포인트 (신규)
- hydration 방어: Provider 레벨 차단 (`e04c3a2b`) + HTTP 환경 mismatch fix (`8e8e44de`)

### 📊 성능 리프트 · `e5c52fae`

- 번들 크기 **-58%** (코드 스플리팅 + tree-shake)
- `React.memo` 18 컴포넌트 적용
- `next/dynamic` 28 지점 적용 (첫 페인트 제외)
- 확실한 unmount/mount + panelInstance remount key (`48970a36`)로 시각 패널 재진입 안정화
- 잔존 `setShow` 토글 전환 + dead `CyberpunkHud` import 제거 (`14eed6eb`)

### 🛡 검증

- `npx tsc --noEmit` — **EXIT 0**
- `vitest run` — **7,285 passed**
- AI smoke (Playwright) — **15 / 15**
- 모바일 반응형 P0 수정 완료 (`4778f8e0`)

### 📦 새 파일 카운트 (이번 세션 누적)

- 신규 컴포넌트: **~50**개 (`lib/frontend/simulator/v2/` 하위)
- 신규 API: **6**개 (coach · nl-query · explain-warning · optimize · auto-agent · chat) + dev-build-info 1
- 신규 유틸/훅: **~5**개 (use-undo-redo · use-simulator-shortcuts · 기타 context)

> 메인 엔트리 `lib/frontend/simulator/v2/cutting-simulator-v2.tsx` 는 **통합 지점**으로만 사용 — 이 세션에서 본 파일은 수정 대상 외였음 (3,228줄 유지).

---

## STEP 진행 상태

- [x] **STEP 1** — 현재 v2 코드 감사 · `V3_CURRENT_STATE_AUDIT.md` 작성 (413줄, 2 subagent 병렬)
- [x] **STEP 2** — MAP Gap 3분류 · `V3_MAP_BENCHMARK_GAPS.md`
- [x] **STEP 3** — 🎓 교육 모드 토글 시스템 (112 entry + 5 widgets + EduLabel 19위치 배치)
- [x] **STEP 4** — Speeds/Feeds 파이프라인 (types + Harvey 파일럿 + YG-1 15 seed + API + provenance)
- [x] **STEP 5** — MAP Gap 4종 보강 (Tool Path 모달 · Corner v2 · PDF generator · Workholding slider)
- [x] **STEP 6** — MAP 초월 7기능 (AI 코치 · 히트맵 · 애니메이션 · Tool Life · 다중공구 · 학습모드 · 경쟁사 병렬) — **전부 완료**

---

## 커밋 로그

### STEP 1 완료 (2026-04-22)
- `feat(sim-v3): STEP 1 - v2 현재 상태 전수 감사`
- 변경: `docs/V3_CURRENT_STATE_AUDIT.md` (413줄 신규), `docs/CHANGELOG_V3.md`
- audit 방식: Explore subagent 2개 병렬 수행
  - Subagent A: API 3 + utility 3 파일 → 섹션 3·4·5
  - Subagent B: 메인 컴포넌트 (1854줄) + calculator (528줄) → 섹션 1·2·6
- 메인 에이전트: 섹션 7 (종합 Gap · 연구소장 대면 우려 · 작업 볼륨 예상 · Risk Register)
- 주요 발견:
  - State 필드 **40개** (URL 보존 29, ephemeral 11)
  - MAP UI 요소 **34개** 중 누락 1(Tool Path Info 모달), 부분 8, 완전 25
  - Calculator exported 함수 **21개** + 상수 5개
  - P0 미구현: Tool Path Info 모달, Tool#→SFM 자동로드, 교육 모드 전체
  - P1 보강: PDF 단조로움, Workholding 그라데이션, Corner Reference Only 배너, Speed/Feed dial ±20%

### STEP 2 완료 (2026-04-22)
- `feat(sim-v3): STEP 2 - MAP Gap 3분류 + 구현 매트릭스`
- 변경: `docs/V3_MAP_BENCHMARK_GAPS.md` (신규)
- **카테고리 A** (MAP 有 / v2 無): 4 항목 (A-1~A-4, A-5는 재검토로 제외)
- **카테고리 B** (v2 有 / MAP 약함): 6 항목 (B-1~B-6)
- **카테고리 C** (MAP 無 / v2 有 · 차별화 유지): 12 항목 (C-1~C-12)
- **STEP 3~6 구현 매트릭스**: 14 항목, P0 7개 / P1 7개 / P2 3개
- **연구소장 대면 P0 필수 7 항목**: 교육 모드 · Speeds&Feeds · Tool Path Info · PDF 개선 · AI 코치 · 다중공구 비교 · 학습 모드
