# V3 Simulator — Bundle & Performance Audit

Generated: 2026-04-22
Target route: `/simulator_v2` (YG-1 Simulator v3)
Build tool: Next.js 15 · Turbopack · App Router · `output: "standalone"`

> Scope: 번들 분석 + 개선 권장안. 코드는 `next.config.mjs` 최소 수정만 반영. `cutting-simulator-v2.tsx`는 건드리지 않음.

---

## 1. 빌드 결과 (측정값)

- `npm run build` 정상 성공 (Turbopack · Compiled successfully in ~17s · 41 static pages generated)
- `/simulator_v2` 는 `○ (Static)` 로 프리렌더됨
- 이 Next 버전은 터미널이 TTY가 아닐 때 route size 컬럼을 생략하므로, `.next/server/app/simulator_v2/page_client-reference-manifest.js` 의 청크 목록 + 실측 파일 크기로 계산함.

### 1.1 `/simulator_v2` First Load JS (measured)

`page_client-reference-manifest.js` 가 참조하는 14개 chunk 의 합계:

| 항목 | Raw (bytes) | Gzip (est.) |
|---|---:|---:|
| simulator_v2 First Load JS 합계 | **3,114,363 (≈3.0 MB)** | **~895 KB** |

즉, 초기 접속 시 사용자는 약 **895 KB gzip / 3.0 MB 원본 JS** 를 다운로드함. (Next 권장 상한 ~170 KB gzip 대비 **약 5배**)

### 1.2 상위 청크 (heavy chunks, raw 기준)

| Chunk | Raw | 주요 라이브러리 (grep 실증) | 즉시-lazy 가능? |
|---|---:|---|---|
| `3597067ddbce9d86.js` | **1,988,437 B (1.9 MB)** | `three`, `@react-three/fiber`, `@react-three/drei` (THREE., BufferGeometry, MeshStandardMaterial, WebGLRenderer, OrbitControls) | **예 (가장 큰 승부처)** |
| `1c7df59708bdfb1a.js` | 418,523 B | `jspdf` + `pdfjs` | 예 (PDF 생성 on-demand) |
| `cd0ea1a91c483be0.js` | 384,841 B | `recharts` | 예 (차트 탭/섹션 가시 시에만) |
| `8f8fdd25b12c5904.js` | 384,841 B | `recharts` (중복 참조/두 번째 번들 경로) | 예 |
| `25ef16b69a31e3e7.js` | 214,874 B | 공통 React/runtime | 유지 |
| `2988bfaf82a45b76.js` | 198,173 B | 공통 라이브러리 | 유지 |
| `3e27d2cd89a45285.js` | 162,715 B | — | 검토 |
| `31ebcb1bb99a9a1e.js` | 158,145 B | — | 검토 |
| `33f454524dc853a3.js` | 143,371 B | — | 검토 |
| `e65b63c5b59d1a02.js` | 125,356 B | — | 검토 |

> 관찰: recharts가 **두 개의 동일 크기 청크 (384,841 B × 2)** 로 나타남 → Turbopack 이 동일 모듈 그래프를 2개 entry (simulator + admin)로 분리 emit 한 결과로 추정. `optimizePackageImports`로 트리쉐이크하면 양쪽 모두 축소 기대.

---

## 2. 가장 무거운 노드 모듈 Top 5 (실측)

```
du -sh node_modules/{three,@react-three,framer-motion,recharts,@anthropic-ai}
```

| # | Package | 디스크 크기 | /simulator_v2 번들 영향 |
|---|---|---:|---|
| 1 | `three` | **39 MB** | 번들 내 1.9 MB (main three + drei 의존) |
| 2 | `framer-motion` | 5.8 MB | 번들 내 상당 비중 (21개 simulator 파일에서 import) |
| 3 | `@react-three` (fiber+drei) | 5.4 MB | three 번들에 포함 |
| 4 | `recharts` | 5.4 MB | 번들 내 ~385 KB × 2 |
| 5 | `@anthropic-ai/sdk` | 5.1 MB | **서버 전용** (번들에 미포함) ✓ 안전 |

기타 참고 (`du -sh node_modules/* | sort -rh | head` 결과): `lucide-react 33 MB`, `pdfjs-dist 37 MB`, `jspdf 29 MB`, `exceljs 23 MB`, `hls.js 25 MB` 가 디스크 상위지만, 이 중 클라이언트 번들 영향은 lucide (아이콘 개별 import 검증 필요), jspdf/pdfjs (현재 418 KB 청크).

---

## 3. 현재 상태 점검

### 3.1 `next/dynamic` 사용 여부

```
grep -r "next/dynamic" lib/frontend/simulator app/simulator_v2
```

결과: **0건**. simulator v2 의 모든 무거운 컴포넌트가 정적 import.

현재 정적으로 eager-import 중인 주요 파일:
- `cutting-simulator-v2.tsx` 51~109 줄: `BreakEvenChart`, `Endmill3DPreview`, `TemperatureHeatmap`, `ForceVectorDiagram`, `InteractiveTutorial`, `BenchmarkLeaderboard`, `AiChatSidebar`, `Cutting3DScene`, `AnalogGauges`, `DashboardHeroDisplay`, `HeatmapPanel`, `MachiningAnimation`
- `app/simulator_v2/page.tsx` 13~15 줄: `CinematicBackdrop`, `CyberpunkHud`, `SimErrorBoundary`
- 단 하나의 on-demand import: `const { generateReportPDF } = await import("./pdf-generator")` (line 904) — PDF 생성은 이미 lazy ✓

### 3.2 `next.config.mjs` 점검

- `output: "standalone"` ✓
- `images.unoptimized: true` — 정적 배포 환경에서는 적절. 그러나 next/image remotePatterns 설정이 없어 외부 이미지 최적화를 활용 못함.
- `typescript.ignoreBuildErrors: true` — CI 타입체크를 별도로 돌리는 전제 OK (본 작업에서 `tsc --noEmit` 통과 확인 후 build).
- **누락 항목**:
  - `experimental.optimizePackageImports` (lucide-react · recharts · framer-motion · @radix-ui 등에 매우 효과적)
  - `compiler.removeConsole` (production console.log 제거 — Turbopack 지원)
  - `modularizeImports` (recharts·lucide의 barrel import 최소화 대안)
- Turbopack minify 는 build 에서 기본 on (SWC 내장). 추가 플래그 불필요.

---

## 4. 최적화 권장안

### 4.1 Phase 1 — 즉시 적용 가능 (코드 변경 小, 가장 큰 효과)

#### [A] three.js / @react-three 라인을 `next/dynamic` 으로 분리  (가장 큰 승부수)
- **대상**: `Cutting3DScene` (1.9 MB 청크의 본체), `Endmill3DPreview`
- **방법** (cutting-simulator-v2.tsx 를 수정하지 말라는 제약에 따른 간접 패턴):
  - `lib/frontend/simulator/v2/` 에 wrapper 파일 2개 추가 (`cutting-3d-scene.lazy.tsx`, `endmill-3d-preview.lazy.tsx`) 후 `next/dynamic({ ssr:false })` 로 감싼 default export 제공.
  - 본 문서는 구현을 명시 지시 시점까지 보류 (권장안만).
- **예상 효과**: First Load JS **≈ 895 KB gzip → ≈ 380 KB gzip (−58%)**. three 청크가 실제 3D 탭이 가시화될 때만 로드됨.

#### [B] recharts 컴포넌트 lazy split
- **대상**: `BreakEvenChart`, `MultiToolCompare`
- 청크가 같은 크기(384 KB)로 2번 emit 되고 있음 → dynamic 화 + `optimizePackageImports: ["recharts"]` 병행.
- **예상 효과**: 약 **130~180 KB gzip** 감소 (차트 초기 가시가 아닌 경우).

#### [C] jspdf + pdfjs lazy (부분적으로 이미 적용됨)
- `pdf-generator.tsx` 는 이미 `await import` 로 lazy ✓.
- 그러나 `work-instruction-pdf.ts` 가 top-level import 로 들어가 418 KB 청크를 초기 로드에 포함시킬 가능성 있음 → 확인 후 사용 지점에서 `await import("./work-instruction-pdf")` 패턴으로 전환 권장.

### 4.2 Phase 2 — next.config.mjs 개선

이미 본 작업에서 다음을 반영함 (아래 섹션 6):
- `experimental.optimizePackageImports`: lucide-react, recharts, framer-motion, @radix-ui/* 트리쉐이킹 강화
- `compiler.removeConsole`: production에서 console.log 자동 제거 (error/warn 유지)

추가 권장 (본 작업에서는 미적용):
- `experimental.turbopackPersistentCaching`: 로컬/CI 빌드 가속 (실험적 옵션, Next 버전 확인 필요)
- `modularizeImports`로 recharts barrel → 개별 모듈 매핑 (optimizePackageImports 가 충분치 않을 때)
- `bundlePagesRouterDependencies` — app router 에는 불필요

### 4.3 Phase 3 — 이미지·폰트·런타임

#### 이미지
- `/public` 에 PNG/JPG 이 있다면 WebP/AVIF 로 사전 변환. `images.unoptimized: true` 를 유지할 경우 런타임 최적화가 없으므로 원본 포맷이 중요.
- hero/3D 프리뷰 이미지에 `loading="lazy"` + `decoding="async"`.

#### 폰트
- 현재 `next/font/google` 혹은 `next/font/local` 사용 여부 재확인. 사용 중이면 `display:'swap'` 명시, subset 지정으로 FOUT 최소화.

#### 런타임 (React)
- `cutting-simulator-v2.tsx` 의 무거운 파생 계산 (조건 recompute) 에 `useMemo` 적용 후보:
  - 입력 → 절삭조건 계산 함수 결과
  - 차트 데이터 매핑 (AreaChart · BarChart · PieChart series 변환)
  - filter/options 리스트 (`useMemo([filter, rawList])`)
- 순수 표시 컴포넌트 `React.memo` 후보:
  - `AnalogGauges`, `DashboardHeroDisplay`, `MachiningAnimation`, `HeatmapPanel` (props 가 primitive/안정 참조일 때)
- 고비용 업데이트 스트림 (3D 씬 프레임 루프) 은 이미 `useFrame` 사용 중 → `Cutting3DScene` 내부 메모이제이션은 현행 유지.

---

## 5. 예상 개선 효과 요약

| 단계 | First Load JS (gzip est.) | 감소율 | 비고 |
|---|---:|---:|---|
| 현재 | ~895 KB | — | 3D + recharts + jspdf 전부 eager |
| Phase 1 (three lazy) | ~380 KB | **−58%** | 3D 씬이 화면에 보일 때만 로드 |
| Phase 1 + 2 (recharts + optimizePackageImports) | ~230 KB | **−74%** | 일반 Next target 구간 진입 |
| Phase 1+2+3 (useMemo/memo + lazy pdf) | ~200 KB | **−78%** | LCP/TBT 개선 체감 큼 |

> 위 수치는 chunk 단위 실측 비율에서 도출한 보수적 추정. 실제 값은 구현 후 재측정 필요.

---

## 6. 본 감사에서 실제 적용한 변경

1. `next.config.mjs`:
   - `experimental.optimizePackageImports` 추가 (lucide-react, recharts, framer-motion, @radix-ui/react-icons)
   - `compiler.removeConsole`: production 에서 `log`/`debug` 제거, `error`/`warn` 유지
2. 본 문서 (`docs/V3_PERFORMANCE_AUDIT.md`) 생성.

그 외 코드 수정 없음 (특히 `cutting-simulator-v2.tsx` 는 요청에 따라 무수정 유지).

---

## 7. 부록 — 측정 명령어 레퍼런스

```bash
# 빌드
npm run build 2>&1 | tail -80

# simulator_v2 가 참조하는 chunk 목록
grep -oE 'static/chunks/[a-f0-9]+\.js' \
  .next/server/app/simulator_v2/page_client-reference-manifest.js | sort -u

# 상위 청크
find .next/static/chunks -type f -name "*.js" -printf '%s %p\n' | sort -rn | head -25

# 청크 내용 힌트 (라이브러리 식별)
grep -ohE 'THREE\.|BufferGeometry|MeshStandardMaterial|recharts|jspdf|pdfjs|framer-motion|@react-three' \
  .next/static/chunks/<hash>.js | sort -u
```
