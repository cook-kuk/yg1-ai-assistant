# YG-1 Simulator v3 · 기능 매트릭스 (Feature Matrix)

> Cook-forge `simulator_v2` 경로에 구현된 **v3 Director-ready 릴리스** 기준
> 작성일: 2026-04-22 · 경로 prefix: `lib/frontend/simulator/v2/`
> 본 매트릭스는 "벤더 영감 vs YG-1 Original" 분류·단축키·LLM 모델·localStorage 키를 한 페이지에서 조감하기 위한 SSOT 문서.

---

## 1. 전체 기능 카운트 (Executive Summary)

| 카테고리 | 기능 수 | 비고 |
|---|---:|---|
| AI API (서버 엔드포인트) | **6** | `coach`, `nl-query`, `optimize`, `auto-agent`, `chat`, `explain-warning` |
| 비주얼 컴포넌트 | **15+** | 3D 씬 2종 + 도면 + 게이지 + HUD + 히트맵 + 오실로스코프 + 벡터 다이어그램 외 |
| 교육 도구 | **7** | Beginner Wizard, Lesson Cards, Interactive Tutorial, Glossary Browser, Cheat Sheet, Learning Mode, Feature Explainer |
| 출력 / 공유 | **5** | PDF 생성, G-code, Shopfloor Card, Session Export, Manual Download |
| 분석 / 계산 | **8** | Cutting Calculator, Advanced Metrics, Taylor Curve, Break-even, Heatmap Panel, Diagnostic, Formula Panel, SFM-IPT Table |
| UX 유틸 | **10** | Command Palette, Undo/Redo, Shortcuts, Presets, Favorites, Benchmark, Micro-interactions, Parallax Tilt, Cinematic Backdrop, Welcome Modal |
| **합계** | **51+** | — |

---

## 2. 기능 상세 매트릭스

> 범례 — **Novel?** ✨ = YG-1 Original (타사 레퍼런스 없이 Cook-forge가 신규 설계) · — = 벤더 영감 기반
> 파일 경로는 모두 `lib/frontend/simulator/v2/` 하위 상대경로.

### 2-1. AI 기능 (6개)

| 기능 | 카테고리 | 구현 파일 | 벤더 출처 | Novel? | 단축키 |
|---|---|---|---|---|---|
| AI 코치 패널 | AI | `ai-coach-panel.tsx` | YG-1 Original | ✨ | — |
| 자연어 검색 바 | AI | `ai-query-bar.tsx` | YG-1 Original | ✨ | — |
| 1-click 최적화 | AI | `ai-optimize-button.tsx` | Walter-inspired | — | — |
| 자율 에이전트 (Auto-Agent) | AI | `ai-auto-agent-panel.tsx` | YG-1 Original | ✨ | — |
| AI 채팅 사이드바 | AI | `ai-chat-sidebar.tsx` | YG-1 Original | ✨ | — |
| 경고 해설 (Explain Warning) | AI | `ai-warning-explain.tsx` | YG-1 Original | ✨ | — |

### 2-2. 비주얼 컴포넌트 (17개)

| 기능 | 카테고리 | 구현 파일 | 벤더 출처 | Novel? | 단축키 |
|---|---|---|---|---|---|
| 3D WebGL 절삭 씬 | 비주얼 | `cutting-3d-scene.tsx` | YG-1 Original + three.js | ✨ | 🎮 |
| 3D 엔드밀 프리뷰 | 비주얼 | `endmill-3d-preview.tsx` | YG-1 Original | ✨ | 🔄 |
| YG-1 도면 (Blueprint) | 비주얼 | `tool-blueprint.tsx` | YG-1 Original | ✨ | 📐 |
| 도면 갤러리 6종 | 비주얼 | `blueprint-gallery.tsx` | YG-1 Original | ✨ | 🖼 |
| 실시간 절삭 씬 | 비주얼 | `live-cutting-scene.tsx` | YG-1 Original | ✨ | 🎬 |
| 가공 경로 씬 | 비주얼 | `tool-path-scene.tsx` | ISCAR-inspired | — | 🗺 |
| 가공 경로 다이어그램 | 비주얼 | `tool-path-diagrams.tsx` | ISCAR-inspired | — | — |
| 진동 오실로스코프 | 비주얼 | `vibration-oscilloscope.tsx` | ISCAR + Sandvik | — | 📡 |
| 온도 히트맵 | 비주얼 | `temperature-heatmap.tsx` | Sandvik (Blok 모델) | — | 🌡 |
| 힘 벡터 다이어그램 | 비주얼 | `force-vector-diagram.tsx` | Sandvik | — | ➡ |
| 아날로그 게이지 | 비주얼 | `analog-gauges.tsx` | YG-1 Original | ✨ | 🎛 |
| 영웅 KPI 디스플레이 | 비주얼 | `dashboard-hero-display.tsx` | YG-1 Original | ✨ | ✨ |
| Cyberpunk HUD | 비주얼 | `cyberpunk-hud.tsx` | YG-1 Original | ✨ | — |
| 홀로그래픽 프레임 | 비주얼 | `holographic-frame.tsx` | YG-1 Original | ✨ | — |
| Cinematic Backdrop | 비주얼 | `cinematic-backdrop.tsx` | YG-1 Original | ✨ | — |
| Machining Animation | 비주얼 | `machining-animation.tsx` | Harvey-inspired | — | — |
| Wear Gauge | 비주얼 | `wear-gauge-panel.tsx` | Kennametal-inspired | — | — |

### 2-3. 교육 도구 (7개)

| 기능 | 카테고리 | 구현 파일 | 벤더 출처 | Novel? | 단축키 |
|---|---|---|---|---|---|
| Beginner Wizard | 교육 | `beginner-wizard.tsx` | YG-1 Original | ✨ | — |
| Beginner Lesson Cards | 교육 | `beginner-lesson-cards.tsx` | YG-1 Original | ✨ | — |
| Interactive Tutorial | 교육 | `interactive-tutorial.tsx` | Harvey-inspired | — | — |
| Glossary Browser | 교육 | `glossary-browser.tsx` | Sandvik-inspired | — | — |
| Cheat Sheet Panel | 교육 | `cheat-sheet-panel.tsx` | Harvey-inspired | — | — |
| Learning Mode | 교육 | `learning-mode.tsx` | YG-1 Original | ✨ | — |
| Feature Explainer | 교육 | `feature-explainer.tsx` | YG-1 Original | ✨ | — |

### 2-4. 출력 / 공유 (5개)

| 기능 | 카테고리 | 구현 파일 | 벤더 출처 | Novel? | 단축키 |
|---|---|---|---|---|---|
| PDF 생성 | 출력 | `pdf-generator.tsx` | Sandvik-inspired | — | Ctrl+P |
| G-code 다운로드 | 출력 | `gcode-download-button.tsx`, `gcode-gen.ts` | ISCAR-inspired | — | — |
| Shopfloor Card (A6) | 출력 | `shopfloor-card.ts` | YG-1 Original | ✨ | Ctrl+P |
| Session Export | 공유 | `session-export.tsx` | YG-1 Original | ✨ | — |
| Manual Download | 공유 | `manual-download-button.tsx` | YG-1 Original | ✨ | — |

### 2-5. 분석 / 계산 (8개)

| 기능 | 카테고리 | 구현 파일 | 벤더 출처 | Novel? | 단축키 |
|---|---|---|---|---|---|
| Cutting Calculator | 분석 | `../cutting-calculator.ts` | Harvey-inspired | — | — |
| Advanced Metrics Panel | 분석 | `advanced-metrics-panel.tsx` | Sandvik-inspired | — | — |
| Taylor Tool-life Curve | 분석 | `taylor-curve.tsx` | YG-1 Original | ✨ | — |
| Break-even Chart | 분석 | `break-even-chart.tsx` | Walter-inspired | — | — |
| Heatmap Panel (메트릭) | 분석 | `heatmap-panel.tsx` | YG-1 Original | ✨ | — |
| Diagnostic Panels | 분석 | `diagnostic-panels.tsx` | YG-1 Original | ✨ | — |
| Formula Panel | 분석 | `formula-panel.tsx` | Harvey-inspired | — | — |
| SFM-IPT Table | 분석 | `sfm-ipt-table.tsx` | Walter-inspired | — | — |

### 2-6. UX 유틸 (10개)

| 기능 | 카테고리 | 구현 파일 | 벤더 출처 | Novel? | 단축키 |
|---|---|---|---|---|---|
| Command Palette | UX | `command-palette.tsx` | YG-1 Original | ✨ | Ctrl+K |
| Undo / Redo | UX | `use-undo-redo.ts` | YG-1 Original | ✨ | Ctrl+Z / Ctrl+Y |
| Shortcuts Hook | UX | `use-simulator-shortcuts.ts` | YG-1 Original | ✨ | — |
| Presets 저장/불러오기 | UX | `presets.ts`, `apply-preset-safe.ts` | YG-1 Original | ✨ | Ctrl+S |
| Favorites Panel | UX | `favorites-panel.tsx` | YG-1 Original | ✨ | — |
| Benchmark Leaderboard | UX | `benchmark-leaderboard.tsx` | YG-1 Original | ✨ | — |
| Micro-interactions | UX | `micro-interactions.tsx` | YG-1 Original | ✨ | — |
| Parallax Tilt | UX | `parallax-tilt.tsx` | YG-1 Original | ✨ | — |
| Welcome Modal | UX | `welcome-modal.tsx` | YG-1 Original | ✨ | — |
| Power-arc Effect | UX | `power-arc-effect.tsx` | YG-1 Original | ✨ | — |

---

## 3. 벤더 영감 vs YG-1 Original 통계

| 출처 구분 | 건수 | 비율 | 대표 기능 |
|---|---:|---:|---|
| Harvey-inspired | 4 | 7.8% | Cutting Calculator, Formula Panel, Machining Animation, Interactive Tutorial |
| Sandvik-inspired | 5 | 9.8% | Temperature Heatmap, Force Vector, Advanced Metrics, PDF Generator, Glossary Browser |
| Walter-inspired | 3 | 5.9% | 1-click Optimize, Break-even Chart, SFM-IPT Table |
| ISCAR-inspired | 3 | 5.9% | Tool-path Scene, Tool-path Diagrams, G-code Download |
| Kennametal-inspired | 1 | 2.0% | Wear Gauge Panel |
| Vibration Oscilloscope (ISCAR + Sandvik 복합) | 1 | 2.0% | Vibration Oscilloscope |
| **YG-1 Original** ✨ | **34** | **66.6%** | 3D Scene, Blueprint Gallery, Coach, Auto-Agent, Cyberpunk HUD 외 다수 |
| **합계** | **51** | **100%** | — |

> 주: 요청 사양서의 "YG-1 Original 17" 기준은 비주얼 하위 카테고리에 한정한 수치. 본 문서 전체 51 항목 기준으로는 34건(약 66.6%)이 YG-1 Original로 집계됨.

---

## 4. 단축키 모음표

> 구현 파일: `lib/frontend/simulator/v2/use-simulator-shortcuts.ts` (`SHORTCUT_HINTS` 배열)

| 조합 | 동작 | 카테고리 | 아이콘 |
|---|---|---|---|
| `Ctrl + S` | 스냅샷 A 저장 (현재 조건 → A슬롯) | 스냅샷 | 💾 |
| `Ctrl + Shift + S` | 스냅샷 B 저장 (현재 조건 → B슬롯) | 스냅샷 | 💾 |
| `Ctrl + Z` | 실행 취소 (이전 조건으로) | 스냅샷 | ↶ |
| `Ctrl + Y` / `Ctrl + Shift + Z` | 다시 실행 (Redo) | 스냅샷 | ↷ |
| `Ctrl + P` | 작업장 카드 PDF (A6 1장, QR 포함) | 출력·공유 | 📋 |
| `Ctrl + K` | 명령 팔레트 (공구·재질·페이지 통합 검색) | 네비게이션 | 🔍 |
| `?` | 단축키 도움말 오버레이 | 도움말 | ⌨ |
| `Esc` | 열린 팝업/모달 닫기 | 도움말 | ✕ |

**IME 안전 가드**: `isComposing()` + `keyCode === 229` 체크로 한글/일본어 조합 중 단축키 오발화 방지.
**입력 필드 가드**: `<input>`, `<textarea>`, `<select>`, `contentEditable` 타겟에서는 `Esc` 외 단축키 비활성화.

---

## 5. LLM 모델 사용 매트릭스

> provider.ts tier 네이밍 유지 (CLAUDE.md 지침) · 실제 모델은 OpenAI GPT-5.4 기반 실행.

| Tier | AI 기능 | 용도 | 건수 |
|---|---|---|---:|
| **Sonnet 4.6** (고성능) | AI 코치 (`coach`) | 코칭/멀티턴 reasoning | 1 |
| | 1-click 최적화 (`optimize`) | 파라미터 탐색·근거 설명 | 1 |
| | 자율 에이전트 (`auto-agent`) | 다단계 plan-and-execute | 1 |
| | AI 채팅 (`chat`) | 문맥 유지 대화 | 1 |
| | **소계** | | **4** |
| **Haiku 4.5** (저지연) | 자연어 검색 (`nl-query`) | intent 파싱·필터 변환 | 1 |
| | 경고 해설 (`explain-warning`) | 짧은 설명 · 빠른 응답 | 1 |
| | **소계** | | **2** |
| **합계** | | | **6** |

> Cook-forge 규약: 새 코드는 `llm-executor.ts` 래퍼를 통해 tier만 지정하고, 실제 모델 매핑은 `provider.ts`에서 단일 지점으로 관리.

---

## 6. localStorage 키 목록

| 키 | 용도 | 주 사용 파일 |
|---|---|---|
| `yg1-sim-presets` | 사용자 저장 프리셋 (이름+조건 스냅샷) | `presets.ts`, `favorites-panel.tsx` |
| `yg1-sim-v3-education` | 교육 모드 on/off · 레벨 선호도 | `education-context.tsx` |
| `yg1-sim-v3-mode` | 모드 토글 (beginner / expert / director) | `mode-context.tsx`, `mode-toggle.tsx` |
| `yg1-sim-v3-first-visit` | 최초 방문 플래그 (Welcome Modal 1회성) | `welcome-modal.tsx` |
| `yg1-sim-v3-tutorial-completed` | 인터랙티브 튜토리얼 완료 여부 | `interactive-tutorial.tsx` |
| `yg1-sim-v3-chat-history` | AI 채팅 히스토리 (리빌드 시 복원) | `ai-chat-sidebar.tsx` |
| `yg1-sim-v3-favorites` | 즐겨찾기 공구·프리셋 목록 | `favorites-panel.tsx` |
| `yg1-sim-v3-benchmark` | 벤치마크 리더보드 로컬 점수 | `benchmark-leaderboard.tsx` |
| `yg1-sim-v3-glossary-favs` | 용어집 즐겨찾기 | `glossary-browser.tsx` |
| `yg1-sim-v3-glossary-level` | 용어집 난이도 선호 (basic / advanced) | `glossary-browser.tsx` |
| `yg1-sim-v3-lesson-index` | Beginner Lesson Cards 진행 인덱스 | `beginner-lesson-cards.tsx` |
| `yg1-sim-v3-mode` (중복) | `mode-context.tsx` SSOT 키 (상동) | — |

> 접두사 규칙: v3 구간은 `yg1-sim-v3-*` prefix 의무. 레거시 `yg1-sim-presets`는 v2 시절 명명 유지(마이그레이션 비용 회피).

---

## 7. 관련 참고 문서

- `docs/V3_CURRENT_STATE_AUDIT.md` — 현행 상태 감사 리포트
- `docs/V3_INVESTIGATION_MATRIX.md` — 조사/검증 매트릭스
- `docs/V3_MAP_BENCHMARK_GAPS.md` — MAP 벤치마크 갭 분석
- `docs/V3_PERFORMANCE_AUDIT.md` — 성능 감사
- `docs/CHANGELOG_V3.md` — v3 변경 이력
- `public/docs/simulator-v3-manual.md` — 사용자 매뉴얼 (최종 사용자용)
- `public/docs/simulator-v3-concepts.md` — 개념 가이드

---

_Last updated: 2026-04-22 · SSOT: 본 문서 (다른 문서와 불일치 시 본 문서 우선)_
