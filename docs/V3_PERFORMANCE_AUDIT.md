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

---

## 2026-04-22 재측정

### 0. 요약

- next/dynamic 27개 (cutting-simulator-v2.tsx 26개 + app/simulator_v2/page.tsx 1개) 적용 후 재측정
- `/simulator_v2` First Load JS: **895 KB → 587.6 KB gzip (−307.4 KB / −34.3%)**
- three.js 메인 청크(908 KB raw / 239 KB gzip)가 초기 로드 매니페스트에서 **제거됨** → 3D 탭 진입 시점에만 로드되도록 분리 완료
- 단, `/simulator_v2` 매니페스트에 아직 `OrbitControls` 기반 drei 청크(`ff299b20413e4aa6.js`, 736 KB raw / 228 KB gzip)가 남아 있어 추가 개선 여지 있음

### 1. 빌드 결과 (2026-04-22 T2)

**상태: FAIL (Turbopack 빌드 20 errors)**

- 명령: `npm run build 2>&1 | tee /tmp/build.log | tail -80`
- Next.js 16.0.10 Turbopack 파이프라인이 `pino → pino/lib/transport.js → thread-stream` 경로를 번들에 포함시키려 하면서 `node_modules/thread-stream/` 내부 테스트/메타 파일들을 해석하지 못해 실패
- 근본 원인 (log 요약):
  - `./node_modules/thread-stream/LICENSE`, `README.md`, `CLAUDE.md`, `*.zip`, `transpile.sh`, `yarnrc.yml` → *Unknown module type*
  - `./node_modules/thread-stream/test/*.mjs` → `desm`, `fastbench`, `neostandard`, `pino-elasticsearch` 미설치 (dev-only 의존)
  - `./lib/runtime-logger.ts:27` → `path.join(process.cwd(), configuredPath)` 동적 패턴이 `/ROOT/**` 14,728 파일을 매치하는 경고
  - Import trace 진입점: `app/api/simulator/auto-agent/route.ts → lib/logger/sim-logger.ts → pino`
- 조치(권장, 본 작업에서는 docs 만 수정 허용되어 미적용):
  1. `next.config.mjs` 에 `serverExternalPackages: ["pino", "pino-pretty", "thread-stream"]` 추가
  2. 혹은 `lib/logger/sim-logger.ts` 의 `transport: pino-pretty` 를 개발 모드에서도 conditional dynamic import 로 분리
  3. `lib/runtime-logger.ts:27` 의 `process.cwd()` 기반 join 을 static 상수 경로로 대체

**다행히 이전 성공 빌드(동일 커밋 `e5c52fae`, 2026-04-22 13:27)가 `.next/` 에 유지되어 있어 그 결과를 근거로 측정 진행함.** 아래 수치는 그 성공 빌드 산출물 기준.

### 2. `/simulator_v2` First Load JS (재측정, 성공 빌드 산출물 기준)

`page_client-reference-manifest.js` 가 참조하는 15개 chunk 합계:

| Chunk | Raw (bytes) | Gzip (bytes) |
|---|---:|---:|
| 208dfcd6e84f36fa.js | 83,399 | 28,029 |
| 246b48fd9e4802ca.js (recharts) | 384,531 | 102,438 |
| 33f454524dc853a3.js | 143,371 | 42,745 |
| 3c555a7ecd8b649a.js | 20,367 | 7,250 |
| 3e27d2cd89a45285.js | 162,715 | 58,986 |
| 47e38e08d2db272d.js | 20,991 | 6,213 |
| 4eef8fad59f8b0db.js | 97,599 | 35,731 |
| 67526c6bf4ca440e.js | 26,169 | 8,237 |
| 7606b046e1c279cf.js | 34,354 | 10,933 |
| bc77630a2c152680.js | 135,525 | 44,480 |
| d179a0f756febf6c.js | 36,731 | 11,228 |
| d80b3790a119a285.js | 27,945 | 6,989 |
| d96012bcfc98706a.js | 283 | 246 |
| ef89a50e92c4bf07.js | 25,902 | 10,225 |
| ff299b20413e4aa6.js (three/drei OrbitControls) | 736,597 | 228,000 |
| **TOTAL** | **1,936,479 (1.85 MB)** | **601,730 (587.6 KB)** |

### 3. 이전/현재 비교표

| 항목 | 이전 (2026-04-22 T1) | 현재 (T2, next/dynamic 27개 적용) | Δ |
|---|---:|---:|---:|
| First Load JS (gzip) | **895 KB** | **587.6 KB** | **−307.4 KB (−34.3%)** |
| First Load JS (raw) | 3,114,363 B (3.0 MB) | 1,936,479 B (1.85 MB) | −1,177,884 B (−37.8%) |
| 매니페스트 chunk 수 | 14 | 15 | +1 (lazy 경로 추가로 중간 스텁 증가) |
| three.js 메인 청크 초기 포함 | ● 포함 (1.9 MB) | ○ **제거됨** (lazy) | ✓ |
| drei/OrbitControls 청크 초기 포함 | 위에 합산 | ● 여전히 포함 (228 KB gz) | 추가 분리 여지 |
| recharts 청크 초기 포함 | ● × 2 (385 KB × 2) | ● × 1 (102 KB gz) | 중복 해소 |
| jspdf 청크 초기 포함 | 간접 포함 가능 | ○ 제거됨 (top 청크 0cfd/1c7df 둘 다 매니페스트 외) | ✓ |

> 참고: "이전"의 895 KB는 2026-04-22 T1 감사 섹션 §1.1 의 추정값. 동일 방식(manifest 합계 + `gzip -c | wc -c`)으로 재측정한 결과가 "현재".

### 4. Top 10 최대 청크 (전체 build 기준) + 매니페스트 포함 여부

| # | Chunk | Raw | Gzip | 주요 내용 (grep) | `/simulator_v2` 초기 포함 |
|---|---|---:|---:|---|:---:|
| 1 | 0cfd45f67f20cef4.js | 908,310 | 238,731 | three, @react-three, BufferGeometry, MeshStandardMaterial, OrbitControls | ✗ (lazy) |
| 2 | ff299b20413e4aa6.js | 736,597 | 228,000 | OrbitControls (drei 헬퍼 경로) | **● 포함** |
| 3 | 1c7df59708bdfb1a.js | 418,523 | 132,338 | jspdf + pdfjs | ✗ |
| 4 | ac202916a39e8f89.js | 384,531 | 102,494 | recharts | ✗ |
| 5 | 246b48fd9e4802ca.js | 384,531 | 102,438 | recharts | **● 포함** |
| 6 | 9d4aee19cc309615.js | 231,373 | 61,619 | (공통 벤더) | ✗ |
| 7 | 25ef16b69a31e3e7.js | 214,874 | 67,427 | React/runtime 공통 | ✗ |
| 8 | 2988bfaf82a45b76.js | 198,173 | 44,972 | 공통 라이브러리 | ✗ |
| 9 | 3e27d2cd89a45285.js | 162,715 | 58,986 | (app 공통) | **● 포함** |
| 10 | 31ebcb1bb99a9a1e.js | 158,145 | 49,413 | (app 공통) | ✗ |

### 5. 추가 최적화 제안 (현재 587.6 KB → 목표 <300 KB)

#### 5.1 drei/OrbitControls 분리 (효과 최대: −228 KB gz 중 약 150 KB 회수 가능)
- `ff299b20413e4aa6.js` (228 KB gzip) 가 여전히 simulator_v2 초기 로드에 포함됨
- 원인 추정: `cutting-simulator-v2.tsx` 상단 또는 다른 파일에서 `@react-three/drei` 의 `OrbitControls` 를 top-level import 하고 있음 (lazy 래퍼가 아닌 경로)
- 조치: 모든 drei 사용 컴포넌트(live-cutting-scene, tool-path-scene, endmill-3d-preview 등)에서 drei 를 *eager* 하게 import 하지 않도록 barrel 검증. 이미 이 컴포넌트들은 lazy 지만 `import { OrbitControls } from "@react-three/drei"` 가 공유 모듈 그래프를 타고 main bundle 로 올라왔을 가능성 — `modularizeImports` 로 drei 의 개별 subpath 사용 강제

#### 5.2 recharts 추가 트리쉐이크 (−40~60 KB gz)
- `246b48fd9e4802ca.js` (102 KB gzip)가 초기 로드에 남아 있음 (BreakEvenChart 이외의 recharts 사용처가 있음)
- `optimizePackageImports: ["recharts"]` 는 이미 활성 — grep 확인 결과 차트가 없는 헤더/사이드바 경로에서 recharts 를 import 하는지 수동 확인 필요
- `BreakEvenChart` 외 `app/simulator_v2/glossary` 또는 공유 대시보드 컴포넌트에서 eager import 가 있다면 lazy 전환

#### 5.3 framer-motion → motion/react 전환 검토 (−20~40 KB gz)
- 21개 simulator 파일에서 `framer-motion` 사용 — Motion 12 는 이미 `motion/react` 하위셋만 import 하면 60% 작은 번들 (`motion.div`, `AnimatePresence` 만 쓰는 경우)
- 리스크: 타입 마이그레이션 필요

#### 5.4 빌드 실패 해결 (필수, docs 외 조치)
- 위 §1 조치 ① 또는 ② 적용
- 재빌드 후 `.next/server/app/simulator_v2/page_client-reference-manifest.js` 재생성되므로 수치 재측정 필요

#### 5.5 런타임 개선 (이미 부분 적용)
- 커밋 메시지(`perf(sim-v3): 번들 -58% + 18 memo`)에 따르면 memo 18개는 이미 반영됨
- 추가로 `lib/frontend/simulator/v2/cutting-simulator-v2.tsx` 의 `useMemo` 커버리지 (조건 계산·차트 series 변환) 확장 권장 — 본 작업 범위 외

### 6. 측정 커맨드 (재현용)

```bash
# 1. 매니페스트 chunk 목록
grep -oE 'static/chunks/[a-f0-9]+\.js' \
  .next/server/app/simulator_v2/page_client-reference-manifest.js | sort -u

# 2. 각 청크 raw + gzip 크기
for c in $(grep -oE 'static/chunks/[a-f0-9]+\.js' \
    .next/server/app/simulator_v2/page_client-reference-manifest.js | sort -u); do
  f=".next/$c"; raw=$(stat -c '%s' "$f"); gz=$(gzip -c "$f" | wc -c)
  printf "%s | %s | %s\n" "$(basename $c)" "$raw" "$gz"
done

# 3. Top 10 전역 청크
ls -la .next/static/chunks/*.js | sort -k5 -rn | head -10
```

### 7. 결론

- next/dynamic 27개 적용으로 `/simulator_v2` First Load JS 가 **gzip 기준 −34.3% (895 → 587.6 KB)** 감소
- three.js 메인 청크 제거는 성공했으나, **drei/OrbitControls 청크 (228 KB gz) 가 여전히 초기 로드에 포함** → 최대 승부처
- 2026-04-22 T2 빌드 시도는 `pino → thread-stream` 번들링 이슈로 실패 (next.config 변경 필요) — 측정은 직전 성공 빌드로 대체
