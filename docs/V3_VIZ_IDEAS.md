# V3 Visualization Ideas — ROI 기반 10선 + Wow Factor 개선안

> **목적**: Simulator v3는 이미 50+ 컴포넌트를 보유. 본 문서는 **ROI 높은 신규 시각화 아이디어 10선**과 기존 기능의 **wow factor 개선 6선**을 정리한다.
> **작성일**: 2026-04-22
> **작성자**: Cook-forge viz research
> **경로 prefix**: 모든 구현은 `lib/frontend/simulator/v2/` 하위로 흡수하되, `cutting-simulator-v2.tsx` 본체는 **수정 금지** (컴포넌트 사이드카로만 추가).

---

## 0. 요약 (TL;DR)

| # | 아이디어 | 복잡도 | 예상 시간 | ROI | 한마디 |
|---|---|---|---:|---:|---|
| 1 | Stability Lobe Diagram (채터 안정 영역) | 중 | 10h | **10/10** | 전문가 즉시 사로잡음. 경쟁사 없음 |
| 2 | Chip Morphology 3D (칩 형상) | 중 | 12h | **9/10** | "이 칩 모양이면 실패" 한눈에 |
| 3 | Surface Topography (3D 표면 height-map) | 중 | 10h | **9/10** | Ra/Rz 숫자 → 시각적 감 |
| 4 | Wear Progression Animation (progressive) | 저 | 6h | **8/10** | 공구 수명 스토리텔링 |
| 5 | Acoustic Emission 시뮬 (소리 파형) | 저 | 5h | **7/10** | 오디오 체험. 데모 킬러 |
| 6 | Real-time CAM path (G-code → 3D) | 중 | 14h | **9/10** | 실제 현장 파일 즉시 재생 |
| 7 | Cost Waterfall | 저 | 4h | **8/10** | 경영진 설득 카드 |
| 8 | Energy Sankey (전력→절삭→열 분배) | 저 | 5h | **7/10** | 친환경·원가 스토리 |
| 9 | CAD STEP 파일 프리뷰 + AI feature 인식 | 고 | 30h | **10/10** | B2B 영업 파괴력 |
| 10 | Time-lapse 가공 영상 시뮬 (30초 영상) | 저 | 6h | **8/10** | 공유 가능한 마케팅 자산 |

**총 구현 시간**: ~102h (약 2.5 스프린트) · **총 ROI 평균**: 8.5/10

---

## 1. Stability Lobe Diagram (채터 안정 영역)

### 무엇?
스핀들 RPM × 절입 깊이(ap) 2D 평면 위에 **채터(chatter) 안정 영역**을 초록/불안정 영역을 빨강으로 시각화. X축: 스핀들 속도, Y축: 축방향 절입. 현재 조건을 점으로 찍어 "지금 내 조건이 안정 구간인지" 즉시 보여줌.

### 왜 ROI 10?
- **산업계 최상위 전문가 언어**. 공작기계 엔지니어가 보는 순간 "이 회사 진짜네" 인식
- Sandvik·Iscar·Walter 모두 **웹 시뮬레이터에는 미구현** (논문·학술 툴에만 존재)
- YG-1이 먼저 구현하면 **기술적 leadership 포지셔닝** 즉시 확보

### 필요 라이브러리
- **recharts (설치됨)** — ScatterChart + Area 조합
- 또는 d3-contour (미설치, ~50KB) — 더 정밀한 lobe 곡선
- FFT는 `dsp.js` 또는 브라우저 `AnalyserNode` 사용 (추가 dependency 불요)

### 구현 복잡도: 중
수학 모델이 까다롭다. Altintas-Budak 방정식의 **단순화 버전** 사용 권장:
```
ap_lim(n) = -1 / (2 · K_s · Re[Φ(ωc)])
```
- K_s: 재료 specific cutting force (canonical-values.ts에서 재료별 조회)
- Φ: 공구의 frequency response function (간이 모델: 2-DOF mass-spring)

### 예상 시간: **10h**
- 수식 구현: 3h
- 시각화 컴포넌트: 4h
- 현재 조건 오버레이 + 애니메이션: 3h

### 구현 스케치
```tsx
// lib/frontend/simulator/v2/stability-lobe-diagram.tsx
import { ScatterChart, Area, XAxis, YAxis } from 'recharts'

export function StabilityLobeDiagram({ spindleRpm, ap, material, toolDiameter }) {
  const lobeData = useMemo(() => computeStabilityLobes({
    rpmRange: [1000, 20000],
    material, toolDiameter, teethCount: 4,
  }), [material, toolDiameter])

  const currentPoint = { rpm: spindleRpm, ap }
  const isStable = pointInStableRegion(currentPoint, lobeData)

  return (
    <HolographicFrame title="Stability Lobe · 채터 안정 영역">
      <ScatterChart>
        <Area dataKey="ap_lim" stroke="#10b981" fill="rgba(16,185,129,0.2)" />
        <Scatter data={[currentPoint]} fill={isStable ? '#10b981' : '#ef4444'} />
      </ScatterChart>
    </HolographicFrame>
  )
}
```

---

## 2. Chip Morphology 3D (칩 형상)

### 무엇?
현재 feed/speed 조건에서 생성되는 칩의 **3D 형상을 실시간 미리보기**. 4가지 형태:
- 연속형 (continuous) — 길고 꼬임
- 톱니형 (serrated) — 분절 + 주기적 파동
- 분절형 (segmented) — 짧고 끊김
- 비정형 (built-up edge) — 불규칙

### 왜 ROI 9?
- 현장 작업자의 **"칩 색·모양 보고 조건 조정"** 경험을 디지털화
- 기존 3D 씬에 chip particle은 있지만 **"형상 자체"**를 다루진 않음
- 교육용으로 특히 강력 (Beginner Wizard 연계)

### 필요 라이브러리
- `@react-three/fiber` + `@react-three/drei` (설치됨)
- Three.js `TubeGeometry` + `CatmullRomCurve3`로 나선형 칩 메시 생성
- 추가 dependency 불요

### 구현 복잡도: 중
핵심은 **칩 형상을 feed·speed·material에서 예측하는 룰**. Merchant's circle 기반 간이 모델:
- `ChipThicknessRatio = cos(φ - α) / sin(φ)` (φ: shear angle, α: rake angle)
- 재료별 온도 → 형태 매핑 테이블 (patterns.ts 확장)

### 예상 시간: **12h**
- 형상 분류 룰: 2h
- 4종 3D 메시 생성: 6h
- 트랜지션 애니메이션: 2h
- Beginner 모드 annotation: 2h

### 구현 스케치
```tsx
// lib/frontend/simulator/v2/chip-morphology-3d.tsx
function ChipMesh({ type, length, pitch, color }) {
  const curve = useMemo(() => {
    if (type === 'continuous') return makeHelix(length, pitch, 360*3)
    if (type === 'segmented') return makeBrokenHelix(length, pitch, 3)
    // ...
  }, [type, length, pitch])
  return <mesh><tubeGeometry args={[curve, 64, 0.3, 8]} /><meshStandardMaterial color={color} /></mesh>
}
```

---

## 3. Surface Topography (3D 표면 height-map)

### 무엇?
가공된 표면의 **3D height map**을 렌더. Ra/Rz 값을 숫자가 아닌 실제 굴곡으로 보여줌. tool marks (feed mark pattern)를 visual cusp height로 재현.

### 왜 ROI 9?
- 표면조도는 YG-1 제품의 핵심 차별점인데 **현재 숫자로만 표시**됨
- "Ra 0.8 vs Ra 1.6" 같은 수치보다 **3D 굴곡 비교가 압도적으로 설득력**
- 도면 갤러리와 자연스러운 연계

### 필요 라이브러리
- `@react-three/fiber` (설치됨) + `PlaneGeometry` vertex displacement
- Simplex noise 또는 `three/examples/jsm/math/ImprovedNoise` (three에 포함)

### 구현 복잡도: 중
Cusp height 공식: `h = f² / (8·r)` (f=feed, r=corner radius)
- Feed 방향 주기 무늬 + 랜덤 noise 중첩
- Color map: cool(저) → warm(고) gradient

### 예상 시간: **10h**
- Height-map 생성 로직: 3h
- 3D Plane + lighting: 4h
- Ra/Rz 실시간 계산 라벨: 2h
- Before/After 비교 모드: 1h

### 구현 스케치
```tsx
function TopographyMesh({ ra, feedPerTooth, cornerRadius }) {
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(20, 20, 128, 128)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i)
      const cusp = (feedPerTooth ** 2) / (8 * cornerRadius)
      const periodic = cusp * Math.sin(x * Math.PI / feedPerTooth)
      const noise = ra * 0.3 * noise3D(x*0.5, y*0.5, 0)
      pos.setZ(i, periodic + noise)
    }
    geo.computeVertexNormals()
    return geo
  }, [ra, feedPerTooth, cornerRadius])
  return <mesh geometry={geometry}><meshStandardMaterial color="#8b9dc3" metalness={0.7} /></mesh>
}
```

---

## 4. Wear Progression Animation

### 무엇?
공구 tip이 가공 시간에 따라 **점진적으로 마모되는 애니메이션**. T=0 날카로움 → T=30min VB=0.1mm → T=90min VB=0.3mm (수명 한계). 3D 엔드밀 모델의 flank 영역을 dynamic하게 깎아 들어감.

### 왜 ROI 8?
- 공구 수명 = YG-1 핵심 마케팅 메시지
- 기존 `wear-gauge-panel.tsx`는 숫자 게이지만 보여줌 → **visual 스토리 부재**
- 데모 중 자동 재생으로 "90분 후 이런 모습입니다" 체험

### 필요 라이브러리
- `@react-three/fiber` + `framer-motion-3d` (framer-motion은 설치됨, `-3d`는 별도 패키지)
- **대안**: 순수 three.js morphTargets로도 충분

### 구현 복잡도: 저
Taylor 수명 곡선 (이미 구현됨) + morph target 블렌딩만 하면 됨.
- 기존 `endmill-3d-preview.tsx` 확장

### 예상 시간: **6h**
- 2종 wear state 메시 (sharp, worn) 제작: 2h
- Morph blend 로직: 2h
- Timeline scrubber UI: 2h

### 구현 스케치
```tsx
function WearProgressionScene({ tMinutes, taylorC, taylorN }) {
  const vbMm = Math.pow(taylorC / tMinutes, 1/taylorN) * 0.001
  const wearRatio = Math.min(vbMm / 0.3, 1) // 0.3mm = life limit
  return <ToolMesh morphTargetInfluences={[1-wearRatio, wearRatio]} />
}
```

---

## 5. Acoustic Emission 시뮬 (소리 파형)

### 무엇?
현재 절삭 조건의 예상 **가공 소리를 합성 + 파형 시각화**. "휘이이잉" (정상) vs "까드득까드득" (채터) vs "딱딱" (중단). Web Audio API 기반 실시간 합성.

### 왜 ROI 7?
- 소리는 **현장 작업자의 가장 중요한 진단 감각**
- 데모 중 "한번 들어보세요" → 즉각적 몰입
- 채터 warning과 자연스러운 연계 (Stability Lobe와 시너지)

### 필요 라이브러리
- **브라우저 내장 Web Audio API** (추가 dependency 불요)
- 파형 시각화는 기존 `vibration-oscilloscope.tsx` 재활용

### 구현 복잡도: 저
- 기본: sine wave (공구 회전 주파수) + harmonics
- Chatter: AM modulation at tooth passing frequency
- BUE: pulse train

### 예상 시간: **5h**
- Audio synth 엔진: 2h
- 재생/정지 컨트롤 + mute default: 1h
- 파형 렌더 통합: 2h

### 구현 스케치
```tsx
function useCuttingSound({ rpm, teeth, isChatter }) {
  const audioCtxRef = useRef<AudioContext>()
  useEffect(() => {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    osc.frequency.value = (rpm / 60) * teeth // tooth passing freq Hz
    if (isChatter) {
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 15 // chatter modulation
      // AM modulation setup
    }
    // ...
  }, [rpm, teeth, isChatter])
}
```

**주의**: 기본 mute, 사용자 명시적 opt-in. `localStorage`에 음량 저장.

---

## 6. Real-time CAM path from CNC G-code

### 무엇?
사용자가 실제 **.nc / .tap / .gcode 파일을 업로드**하면 파싱 후 3D 공간에 공구 경로 재생. 현재 조건을 파일에 overlay해 "이 파트를 이 조건으로 가공하면 X분 소요" 산출.

### 왜 ROI 9?
- **현장 엔지니어의 실제 워크플로우** — 지금 손에 들고 있는 파일로 즉시 검증
- 영업 상황에서 "저희 파일 넣어봐도 되나요?" → 즉시 데모
- 기존 `interactive-gcode-viewer.tsx` 확장

### 필요 라이브러리
- 순수 JS G-code parser (직접 작성, ~200줄, 추가 dependency 불요)
- 또는 `gcode-parser` npm (미설치, ~30KB)
- Three.js `Line` + `BufferGeometry` (설치됨)

### 구현 복잡도: 중
G-code 명령어 서브셋만 지원 (G0/G1/G2/G3/M03/M05/F/S). 복잡한 macro·sub-routine은 무시.

### 예상 시간: **14h**
- 파서 구현: 4h
- 경로 Line 렌더 + 재생: 4h
- 시간 스크러버 + 현재 위치 highlighter: 3h
- 조건 overlay (sim predicted vs 실제 F/S): 3h

### 구현 스케치
```tsx
function parseGcode(source: string): Segment[] {
  const lines = source.split('\n')
  const segments: Segment[] = []
  let pos = { x: 0, y: 0, z: 0 }, feed = 0
  for (const line of lines) {
    const m = line.match(/G0?([01])\s+(?:X(-?[\d.]+))?\s*(?:Y(-?[\d.]+))?\s*(?:Z(-?[\d.]+))?\s*(?:F([\d.]+))?/)
    if (!m) continue
    const next = { x: +(m[2] ?? pos.x), y: +(m[3] ?? pos.y), z: +(m[4] ?? pos.z) }
    segments.push({ from: pos, to: next, rapid: m[1] === '0', feed: m[5] ? +m[5] : feed })
    pos = next
  }
  return segments
}
```

---

## 7. Cost Waterfall Chart

### 무엇?
부품 1개당 가공 원가를 **waterfall chart**로 분해:
- 시작: 공작물 소재비 $X
- +공구비 분담 (tool cost / life count)
- +머신 시간비 (machine hour rate × cycle time)
- +인건비
- +overhead
- = 총 원가

### 왜 ROI 8?
- **경영진·구매팀 설득용 슬라이드 즉시 생성**
- Break-Even Chart는 있지만 **분해가 없음**
- PDF export와 자연스러운 연계

### 필요 라이브러리
- **recharts (설치됨)** — ComposedChart + custom Bar
- 추가 dependency 불요

### 구현 복잡도: 저
단순 계산 + recharts configuration만 하면 됨. 이미 `break-even-chart.tsx` 패턴 재활용.

### 예상 시간: **4h**
- 원가 분해 계산: 1h
- Waterfall 시각화: 2h
- Tooltip + 하이라이트: 1h

### 구현 스케치
```tsx
const stages = [
  { label: 'Material', value: 2.50, cumulative: 2.50 },
  { label: 'Tool wear', value: 0.35, cumulative: 2.85 },
  { label: 'Machine time', value: 1.20, cumulative: 4.05 },
  { label: 'Labor', value: 0.80, cumulative: 4.85 },
  { label: 'Overhead', value: 0.60, cumulative: 5.45 },
  { label: 'Total', value: 5.45, cumulative: 5.45, total: true },
]
```

---

## 8. Energy Sankey (전력→절삭→열 분배)

### 무엇?
스핀들 입력 전력 kW → 기계 손실 → 순수 절삭 power → **열 분배 (칩 70% / 공구 15% / 공작물 15%)** 흐름을 Sankey diagram으로.

### 왜 ROI 7?
- **친환경·에너지효율 내러티브** (ESG 대응)
- 기존 Blok heatmap과 **수치적 일관성** 제공
- 학술적 신뢰감 부여

### 필요 라이브러리
- **recharts에 Sankey 내장** (설치됨, `import { Sankey } from 'recharts'`)
- 추가 dependency 불요

### 구현 복잡도: 저
열분배 비율은 이미 Blok 모델에 있음. flux 값만 node/link 구조로 변환.

### 예상 시간: **5h**
- Sankey 데이터 구조 변환: 1h
- Recharts Sankey 렌더 + styling: 2h
- 홀로그래픽 프레임 통합: 2h

---

## 9. CAD STEP 파일 프리뷰 + AI feature 인식

### 무엇?
고객이 **.step / .stp 파일 업로드** → 3D 렌더 → AI가 자동으로 분석:
- "이 부분은 6mm 깊이 포켓, Ø10 엔드밀 추천"
- "이 hole은 M6 탭, tap 공정 필요"
- "surface finish Ra 1.6 요구, ball end 추천"

### 왜 ROI 10?
- **B2B 영업의 게임 체인저**. 현장에서 "파일 주세요" → 5초 안에 견적·추천 완성
- `occt-import-js` (OpenCascade wasm) **이미 설치됨** — infra 준비 완료
- LLM 파이프라인도 이미 있음 (`ai-auto-agent-panel.tsx` 패턴)

### 필요 라이브러리
- **occt-import-js (설치됨)** — STEP → mesh 변환
- `@react-three/fiber` (설치됨)
- LLM feature 인식: 기존 `llm-executor.ts` 래퍼

### 구현 복잡도: 고
- STEP 파싱은 occt wasm이 처리해줌 (무거움 — web worker 필수)
- Feature recognition은 **geometry heuristic + LLM hybrid**
  - heuristic: 평면·원기둥·구멍 topology 추출
  - LLM: "이 피처 조합이면 어떤 공정?"을 prompt로 질의

### 예상 시간: **30h**
- occt worker 래퍼: 6h
- 3D viewer + 재질 표시: 4h
- Feature extraction heuristic: 10h
- LLM prompt 엔지니어링: 6h
- 추천 결과 UI: 4h

### 구현 스케치
```tsx
// lib/frontend/simulator/v2/cad-preview.tsx
const worker = new Worker('/workers/occt-worker.js')
worker.postMessage({ file: stepFile })
worker.onmessage = (e) => {
  const { mesh, features } = e.data
  setScene(mesh)
  analyzeWithLLM(features).then(setRecommendations)
}
```

**주의**: STEP 파일은 영업기밀 가능 → 업로드는 **client-side only, 서버 전송 금지**. LLM 질의도 feature 메타데이터만 전송.

---

## 10. Time-lapse 가공 영상 시뮬 (30초 영상)

### 무엇?
전체 가공 사이클 (예: 90분)을 **30초 time-lapse mp4/webm으로 렌더링**. 공유 가능한 영상 파일로 export. 마케팅·SNS·교육 자료로 직접 사용.

### 왜 ROI 8?
- **바이럴 가능성**. 링크드인·유튜브 쇼츠에 바로 업로드
- 기존 3D 씬 재활용 → 추가 asset 불요
- Session Export와 자연스러운 연계

### 필요 라이브러리
- **브라우저 내장 MediaRecorder API** (canvas.captureStream)
- 추가 dependency 불요
- 옵션: `webm-writer-js` (미설치) — 더 정밀한 프레임 제어

### 구현 복잡도: 저
three.js canvas → MediaRecorder → Blob → 다운로드. 표준 패턴.

### 예상 시간: **6h**
- 레코딩 훅: 2h
- 타임라인 가속 파라미터: 1h
- 다운로드 UI + 워터마크 (YG-1 로고): 3h

### 구현 스케치
```tsx
function useSceneRecorder(canvasRef, durationSec = 30) {
  const start = async () => {
    const stream = canvasRef.current.captureStream(30)
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => chunks.push(e.data)
    recorder.start()
    setTimeout(() => recorder.stop(), durationSec * 1000)
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      downloadBlob(blob, `yg1-simulator-${Date.now()}.webm`)
    }
  }
  return { start }
}
```

---

## 11. 기존 기능 Wow Factor 개선 (6선)

### 11-1. 🔊 음성 경고 (Web Speech API)
- **현 상태**: 경고는 텍스트 toast만
- **개선**: TTS로 "채터 감지, RPM 8000으로 낮추세요" 음성 출력
- **구현**: `speechSynthesis.speak(new SpeechSynthesisUtterance(msg))` — 브라우저 내장
- **예상 시간**: 2h · **ROI**: 7

### 11-2. 🎨 컬러 커스터마이저 (팀별 브랜딩)
- **현 상태**: 단일 YG-1 blue 테마
- **개선**: 고객사 팀 색상으로 HUD 전체 리브랜드 (데모용)
- **구현**: CSS variable + localStorage 프리셋 (Toyota red, Samsung blue, etc)
- **예상 시간**: 4h · **ROI**: 6

### 11-3. 📹 세션 녹화 + 재생 (시나리오 공유)
- **현 상태**: session-export.tsx는 JSON만 저장
- **개선**: 사용자 조작 이벤트 스트림 저장 → 재생하면 **데모가 자동으로 진행**
- **구현**: 이벤트 버스 + JSON 시퀀스. `rrweb` 패턴 (미설치, 대신 자체 이벤트 로거)
- **예상 시간**: 8h · **ROI**: 8

### 11-4. 🗣 AI 영상 설명 (TTS narration)
- **현 상태**: Time-lapse 영상에 음성 없음
- **개선**: 구간별 자동 해설. "지금 Ø10 엔드밀이 알루미늄을 절삭합니다. 이 조건에서는..."
- **구현**: LLM → 텍스트 스크립트 생성 → TTS → 영상과 합성
- **예상 시간**: 10h · **ROI**: 8

### 11-5. 🎮 게임화 요소 (achievement badges)
- **현 상태**: Benchmark leaderboard만
- **개선**: "첫 optimize 사용", "10종 재료 경험", "MRR 100cc/min 달성" 등 배지
- **구현**: localStorage 카운터 + 토스트 애니메이션 (framer-motion)
- **예상 시간**: 6h · **ROI**: 6 (엔드유저 engagement, 영업엔 낮음)

### 11-6. 🌐 멀티유저 실시간 협업 (WebSocket)
- **현 상태**: 1인 세션만
- **개선**: 고객-영업담당이 **같은 시뮬레이션을 공동 조작**. cursor sharing, 조건 동기화
- **구현**: `yjs` + WebSocket server (미설치). 또는 Liveblocks SaaS (미설치)
- **예상 시간**: 24h (+ backend 인프라) · **ROI**: 9 (영업 원격 미팅 킬러 기능)

---

## 12. 우선순위 추천

### 즉시 (1주 이내, high ROI + low complexity)
- **#4 Wear Progression** (6h)
- **#7 Cost Waterfall** (4h)
- **#10 Time-lapse 영상** (6h)
- **#11-1 음성 경고** (2h)
- **합계**: 18h — **임팩트 대비 구현 속도 최상**

### 단기 (2-3주, high ROI + medium complexity)
- **#1 Stability Lobe** (10h)
- **#3 Surface Topography** (10h)
- **#2 Chip Morphology 3D** (12h)
- **#6 G-code CAM path** (14h)
- **합계**: 46h

### 중장기 (스프린트 전체 투자 필요)
- **#9 STEP + AI feature 인식** (30h) — **전략적 최대 무기**
- **#11-6 실시간 협업** (24h+) — **인프라 필요**

---

## 13. 구현 시 공통 가이드라인

1. **SSOT 준수**: 키워드는 `patterns.ts`, 재료 상수는 `canonical-values.ts`에서만 조회
2. **하드코딩 금지**: 매직넘버는 `config + envNum()` 패턴
3. **LLM**: 신규 기능 LLM 호출은 `llm-executor.ts` 래퍼 경유
4. **DB**: PostgreSQL은 `getSharedPool()` 사용
5. **타입체크**: Phase 종료시 `npx tsc --noEmit`
6. **빌드**: 최종 `npm run build`
7. **본체 불변**: `cutting-simulator-v2.tsx`는 import만 추가, 로직 수정 금지
8. **토글 가능**: 모든 신규 viz는 Command Palette에 등록해 on/off 가능하게
9. **Accessibility**: V3_A11Y_AUDIT.md 체크리스트 준수 (ARIA label, 키보드 focus)
10. **성능**: V3_PERFORMANCE_AUDIT.md 60fps 가이드 — 무거운 3D는 lazy import + `Suspense`

---

## 14. 라이브러리 설치 현황 (참고)

| 라이브러리 | 버전 | 상태 | 본 문서 활용 |
|---|---|---|---|
| three | 0.184.0 | 설치됨 | #1, #2, #3, #4, #6, #9, #10 |
| @react-three/fiber | 9.6.0 | 설치됨 | #1, #2, #3, #4, #6, #9 |
| @react-three/drei | 10.7.7 | 설치됨 | #2, #3, #9 |
| @react-three/postprocessing | 3.0.4 | 설치됨 | bloom (기존) |
| framer-motion | 12.38.0 | 설치됨 | #4, #11-5 |
| recharts | 2.15.4 | 설치됨 | #1, #7, #8 |
| occt-import-js | 0.0.23 | **설치됨** | #9 STEP 파싱 |
| Web Audio API | 브라우저 | 내장 | #5, #11-1 |
| Web Speech API | 브라우저 | 내장 | #11-1 |
| MediaRecorder API | 브라우저 | 내장 | #10, #11-3 |
| d3-contour | — | 미설치 (옵션) | #1 정밀 lobe |
| gcode-parser | — | 미설치 (옵션) | #6 (자체 구현 가능) |
| yjs / liveblocks | — | 미설치 | #11-6 |

**핵심 발견**: `occt-import-js` 이미 설치됨 → #9 CAD STEP 프리뷰는 infra가 이미 준비된 **hidden asset**. 영업 무기화 1순위 추천.

---

## 15. 참고 문서

- `/home/seungho/cook-forge/docs/V3_FEATURE_MATRIX.md` — 기존 기능 매트릭스
- `/home/seungho/cook-forge/docs/V3_CURRENT_STATE_AUDIT.md` — 현재 상태
- `/home/seungho/cook-forge/docs/V3_MAP_BENCHMARK_GAPS.md` — 경쟁사 gap 분석
- `/home/seungho/cook-forge/docs/V3_PERFORMANCE_AUDIT.md` — 성능 가이드
- `/home/seungho/cook-forge/docs/V3_A11Y_AUDIT.md` — 접근성 체크리스트

---

**끝**. 본 문서는 리서치 전용. 실제 구현은 별도 티켓으로 생성 후 Phase별 진행 권장.
