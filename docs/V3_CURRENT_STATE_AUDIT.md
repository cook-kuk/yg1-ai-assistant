# V3 Current State Audit

> Simulator v2 코드 전수 감사 — v3 작업 기준점
> 생성: 2026-04-22 · 브랜치: `feat/simulator-v3-director-ready`
> 감사 대상 9개 파일 전량 정독 완료 (2 subagent 병렬 수행)

## 목차
1. [SimulatorState 인터페이스 카탈로그](#섹션-1-simulatorstate-인터페이스-카탈로그)
2. [MAP UI → v2 구현 매핑표](#섹션-2-map-ui--v2-구현-매핑표)
3. [API 엔드포인트 매트릭스](#섹션-3-api-엔드포인트-매트릭스)
4. [Preset 데이터 인벤토리](#섹션-4-preset-데이터-인벤토리)
5. [State 직렬화 + GCode](#섹션-5-state-직렬화--gcode)
6. [cutting-calculator.ts 함수 카탈로그](#섹션-6-cutting-calculator-함수-카탈로그)
7. [종합 Gap 요약 (Cross-cutting)](#섹션-7-종합-gap-요약)

---

## 섹션 1: SimulatorState 인터페이스 카탈로그

> `cutting-simulator-v2.tsx`의 `CuttingSimulatorV2` 함수 내 `useState` 40개 전량

### Tool 관련 (10)

| 필드 | 타입 | 기본값 | 설명 | 라인 |
|---|---|---|---|---|
| `productCode` | string | "" | 공구 시리즈/EDP 코드 | 151 |
| `realEdp` | string \| null | null | 카탈로그 검색으로 획득한 실제 EDP | 152 |
| `diameter` | number | 10 | 공구 직경 mm | 153 |
| `fluteCount` | number | 4 | 절삭날 개수 | 154 |
| `activeShape` | "square"\|"ball"\|"radius"\|"chamfer" | "square" | 엔드밀 형상 | 155 |
| `LOC` | number | 25 | 절삭날 길이 mm | 156 |
| `OAL` | number | 75 | 전체 길이 mm | 157 |
| `shankDia` | number | 10 | 섕크 직경 mm | 158 |
| `cornerR` | number | 0.5 | 코너 반경 mm (radius 형상만) | 159 |
| `toolMaterial` | string | "carbide" | 공구 재질 키 | 160 |

### Material 관련 (8)

| 필드 | 타입 | 기본값 | 설명 | 라인 |
|---|---|---|---|---|
| `isoGroup` | string | "P" | ISO 소재 분류 | 163 |
| `subgroupKey` | string | "" | 세부 소재 서브그룹 | 164 |
| `condition` | string | "" | 열처리 조건 | 165 |
| `hardnessScale` | "HRC"\|"HBW"\|"HRB"\|"HBS" | "HRC" | 경도 척도 | 166 |
| `hardnessValue` | number | 30 | 경도값 | 167 |
| `workpiece` | string | "" | 워크피스 필터 | 168 |
| `cuttingType` | string | "" | 절삭유형 필터 | 169 |
| `toolShape` | string | "" | 공구형상 필터 | 170 |

### Operation 관련 (3)

| 필드 | 타입 | 기본값 | 라인 |
|---|---|---|---|
| `operation` | string | "Side_Milling" | 173 |
| `toolPath` | string | "conventional" | 174 |
| `strategy` | string | "" | 238 |

### Machine 관련 (9)

| 필드 | 타입 | 기본값 | 라인 |
|---|---|---|---|
| `spindleKey` | string | "vmc-std" | 177 |
| `holderKey` | string | "er-collet" | 178 |
| `maxRpm` | number | 12000 | 179 |
| `maxKw` | number | 15 | 180 |
| `maxIpm` | number | 394 | 181 |
| `workholding` | number | 65 | 182 |
| `coolant` | string | "flood" | 216 |
| `coating` | string | "altin" | 217 |
| `toolGroup` | string | "milling" | 215 |

### Parameters 관련 (8)

| 필드 | 타입 | 기본값 | 라인 |
|---|---|---|---|
| `stickoutMm` | number | 30 | 185 |
| `stickoutManual` | boolean | false | 186 |
| `Vc` | number | 200 | 187 |
| `fz` | number | 0.05 | 188 |
| `ap` | number | 10 | 189 |
| `ae` | number | 5 | 190 |
| `apLocked` | boolean | false | 191 |
| `aeLocked` | boolean | false | 192 |

### Dial 관련 (3)

| 필드 | 타입 | 기본값 | 라인 |
|---|---|---|---|
| `speedPct` | number | 0 | 195 |
| `feedPct` | number | 0 | 196 |
| `mode` | "productivity"\|"balanced"\|"toollife" | "balanced" | 199 |

### UI 관련 (12)

| 필드 | 타입 | 기본값 | 라인 |
|---|---|---|---|
| `displayUnit` | "metric"\|"inch"\|"both" | "metric" | 144 |
| `darkMode` | boolean | false | 208 |
| `snapshotA` | SnapshotSummary\|null | null | 209 |
| `snapshotB` | SnapshotSummary\|null | null | 210 |
| `shareToast` | string\|null | null | 211 |
| `urlHydrated` | boolean | false | 212 |
| `formulaOpen` | boolean | false | 236 |
| `diagnosticOpen` | boolean | false | 237 |
| `autoCorrelate` | boolean | true | 228 |
| `advancedOpen` | boolean | false | 218 |
| `climb` | boolean | true | 227 |
| `gcodeOpen` | boolean | false | 224 |

### Catalog 관련 (4)

| 필드 | 타입 | 기본값 | 라인 |
|---|---|---|---|
| `catalogData` | SimulatorApiResponse\|null | null | 202 |
| `isLoading` | boolean | false | 203 |
| `dataSource` | "catalog"\|"interpolated"\|"default" | "default" | 204 |
| `everInteracted` | boolean | false | 205 |

### Cost & Advanced 관련 (5)

| 필드 | 타입 | 기본값 | 라인 |
|---|---|---|---|
| `toolCostKrw` | number | 45000 | 220 |
| `machineCostPerHourKrw` | number | 50000 | 221 |
| `cycleTimeMin` | number | 5 | 222 |
| `cornerReductionPct` | number | 30 | 219 |
| `gcodeDialect` | "fanuc"\|"heidenhain"\|"siemens" | "fanuc" | 223 |

### Stock 관련 (5)

| 필드 | 타입 | 기본값 | 라인 |
|---|---|---|---|
| `stockL` | number | 100 | 229 |
| `stockW` | number | 60 | 230 |
| `stockH` | number | 30 | 231 |
| `finishAp` | number | 0.2 | 232 |
| `targetMRR` | number | 30 | 233 |

### Preset 관련 (2)

| 필드 | 타입 | 기본값 | 라인 |
|---|---|---|---|
| `savedPresets` | Array<{name, state}> | [] | 234 |
| `presetName` | string | "" | 235 |

**총 40 개 필드** (URL 직렬화 29, ephemeral 11)

---

## 섹션 2: MAP UI → v2 구현 매핑표

| MAP UI 요소 | v2 구현 위치 | 상태 | Gap 설명 |
|---|---|---|---|
| **Tool # 입력 (EDP/시리즈)** | cutting-simulator-v2.tsx:933-940 input + 검색 btn | ✅ 완전 | 실시간 카탈로그 검색 구현 |
| **Tool 상세 자동로드** | cutting-simulator-v2.tsx:505-535 `fetchCatalog()` | ⚠ 부분 | MAP은 PDF 기반 SFM/IPT 자동추천, v2는 하드코딩 예시+API 보간 |
| **Material 드롭다운 (ISO)** | cutting-simulator-v2.tsx:1030-1050 | ✅ 완전 | 6 ISO 그룹 |
| **Subgroup 드롭다운** | cutting-simulator-v2.tsx (MATERIAL 카드) | ✅ 완전 | MATERIAL_SUBGROUPS 28종 |
| **Condition 필터** | cutting-simulator-v2.tsx | ⚠ 부분 | 카탈로그 필터링만, UI 기본값 없음 |
| **HBW/HBS/HRB/HRC 토글** | cutting-simulator-v2.tsx:1090-1100 radio | ✅ 완전 | 4척도 + hardnessVcDerate 변환 |
| **Material Reset** | cutting-simulator-v2.tsx:673-676 `resetMaterial()` | ✅ 완전 | |
| **Operation Type 드롭다운** | cutting-simulator-v2.tsx OPERATION 카드 | ✅ 완전 | Side/Slotting/Profiling/Facing/Pocketing |
| **Tool Path 드롭다운** | cutting-simulator-v2.tsx:1060-1080 | ✅ 완전 | 8 Path |
| **Tool Path Info 모달** ⭐ | tool-path-diagrams.tsx (SVG만) | ❌ **누락** | **Info 버튼/모달 미구현** — tool-path-diagrams.tsx에 SVG 함수 있으나 Dialog 트리거 없음 |
| **Spindle 드롭다운** | cutting-simulator-v2.tsx MACHINE 카드 | ✅ 완전 | 10 프리셋 |
| **Holder 드롭다운** | cutting-simulator-v2.tsx MACHINE 카드 | ✅ 완전 | 6 프리셋 |
| **MAX RPM / MAX IPM / MAX kW** | cutting-simulator-v2.tsx MACHINE 카드 input | ✅ 완전 | |
| **Workholding Security 슬라이더** | cutting-simulator-v2.tsx:182, 300-306 | ⚠ 부분 | 0-100 구현, **시각적 그라데이션(Loose→Rigid 색상) 없음** |
| **Machine Reset** | cutting-simulator-v2.tsx:677-679 `resetMachine()` | ✅ 완전 | |
| **Stick Out (%)** | cutting-simulator-v2.tsx:185-186 | ⚠ 부분 | mm 절대값만, **L/D 비율 자동 % 표시 필요 보강** |
| **Radial Depth (ae) + Reset** | cutting-simulator-v2.tsx:190, 680-685 | ✅ 완전 | 슬라이더 + 잠금 + 자동보정 |
| **Axial Depth (ap) + Reset** | cutting-simulator-v2.tsx:189, 680-685 | ✅ 완전 | |
| **Engagement Angle (°) 표시** | engagement-circle.tsx + cutting-simulator-v2.tsx | ✅ 완전 | ae/D 기반 원형 |
| **Selected Tool 영역** | tool-silhouette.tsx + cutting-simulator-v2.tsx:971-973 | ✅ 완전 | |
| **Tool Engagement Angle (원형)** | engagement-circle.tsx | ✅ 완전 | |
| **ADOC/RDOC Adjuster 2D** | adoc-rdoc-adjuster.tsx | ✅ 완전 | |
| **Recommendations PDF 버튼** | cutting-simulator-v2.tsx:813-816 `printPdf()` | ⚠ 부분 | html2canvas+jsPDF, **QR코드/요약박스/GCode 페이지 없음** |
| **Surface Speed (SFM/Vc)** | Recommendations 출력 | ✅ 완전 | UNITS.mPerMinToSFM |
| **Speed (RPM)** | result.n | ✅ 완전 | |
| **Feed per tooth (fz/IPT)** | fzEff | ✅ 완전 | |
| **Feed per minute (Vf/IPM)** | result.Vf, vfIpm | ✅ 완전 | |
| **Chip Thickness (hex)** | derived.hex | ✅ 완전 | MIN_CHIP_THICKNESS 경고 |
| **MRR** | result.MRR | ✅ 완전 | |
| **Corner Adjustment 패널** | corner-panel.tsx | ⚠ 부분 | **"Reference Only" 배너 없음, HEM/Finishing 활성화 표시 없음** |
| **Speed dial ±% + Reset** | speedPct slider | ⚠ 부분 | MAP은 ±20% 세밀, v2는 ±50% 범위 (과도) |
| **Feed dial ±% + Reset** | feedPct slider | ⚠ 부분 | 동상 |
| **[Copy] 버튼** | Share 버튼 | ✅ 완전 | URL 클립보드 |
| **[Know More] 버튼** | formulaOpen 토글 | ⚠ 부분 | Formula Panel 있으나 교육용 설명 부족 |

**⚠ MAP 대비 주요 격차 요약**
1. **Tool Path Info 모달 미구현** — SVG 함수는 있으나 Dialog 래퍼 없음
2. **PDF 출력 단조로움** — QR코드/요약박스/공식유도/GCode 3~4페이지 구성 필요
3. **Workholding 시각화 약함** — LOOSE→RIGID 그라데이션·pulse 경고 없음
4. **Corner Adjustment 패널 불완전** — Reference Only 배너·활성 조건·공식 시각화 누락
5. **Tool # 자동 SFM/IPT 로드 없음** — MAP의 핵심 기능

---

## 섹션 3: API 엔드포인트 매트릭스

### 3.1 GET /api/simulator

**Query** (`route.ts:4-11`):
```typescript
{ series: string, diameter?: string, material?: string, workpiece?: string,
  hardness?: string, cuttingType?: string, toolShape?: string }
```

**Response** (`route.ts:70-89`):
```typescript
{
  found: boolean; count: number; series: string
  diameter: number|null; material: string|null; workpiece: string|null
  hardness: string|null; cuttingType: string|null; toolShape: string|null
  conditions: Array<{ seriesName, isoGroup, cuttingType, toolShape,
    workpiece, hardnessHrc, diameterMm, Vc, fz, ap, ae, n, vf, confidence }>
  facets: { isoGroups[], workpieces[], hardnesses[], cuttingTypes[], toolShapes[] }
  ranges: { VcMin, VcMax, fzMin, fzMax } | null
  interpolated: boolean
}
```

**Data Source**: `EvidenceRepo.findBySeriesName()` → JSON evidence 청크

**⚠ MAP 격차**: MAP은 toolId 1개로 SFM 곡선 자동, v2는 series 문자열 필터 top 20만.

### 3.2 GET /api/simulator/edp

**Query**: `{ series: string }`
**Response**: `{ edp: string|null, series, reason?, error? }`
**Data Source**: PostgreSQL `raw_catalog.prod_edp`
**⚠ MAP 격차**: MAP은 EDP→마케팅명·카탈로그·재고 전체 조회, v2는 EDP 번호만.

### 3.3 GET /api/simulator/recommend (🚫 수정 금지)

**Query**: `{ iso: string, diameter?, shape?, hardness?, limit? }`
**Response**: `{ iso, diameter, shape, hardness, total, recommendations: [...] }`
**점수 공식**: ISO+40, 직경근접+30, 형상+20, 경도+10, 신뢰도+10, 커버리지+5
**Data Source**: `EvidenceRepo.filterByConditions()`
**⚠ MAP 격차**: MAP은 시리즈별 SFM 곡선+공구수명, v2는 휴리스틱 점수만.

---

## 섹션 4: Preset 데이터 인벤토리

### 4.1 SPINDLE_PRESETS (`presets.ts:9-20`) — **10**개
VMC 표준/고속 · CV30/40/50 · HSM · 흑연 · 미세 · NMTB · Custom. 각 엔트리: `{key, label, maxRpm, maxKw, maxIpm}`.
**⚠ MAP 격차**: MAP 20종 (Mazak Smooth/Okuma OSP 등 누락).

### 4.2 HOLDER_PRESETS (`presets.ts:28-35`) — **6**개
ER 콜릿 · Weldon · End Mill Holder · Hydraulic · Shrink Fit · Milling Chuck. rigidity 55~90.

### 4.3 TOOL_MATERIALS (`presets.ts:37-46`) — **8**개
Solid Carbide · Carbide+TiN/AlTiN/DLC · Cermet · HSS M42 · PCD · CBN. E_GPa 210~1050.

### 4.4 TOOL_PATHS (`presets.ts:54-63`) — **8**개
Conventional · HEM · Trochoidal · Adaptive · Dynamic · Plunge · Ramping · Helical.

### 4.5 STRATEGY_OPTIONS (`presets.ts:66-101`) — **8 × 2-3 ≈ 20** 개 서브전략

### 4.6 MATERIAL_SUBGROUPS (`presets.ts:112-150`) — **28**개 (P/M/K/N/S/H + FRP 5 + Graphite)
**⚠ MAP 격차**: flat 배열, MAP은 3단계 계층 (Steel→Low Carbon→Cold Rolled).

### 4.7 COOLANTS (`presets.ts:159-166`) — **6**개
flood(×1.0) · throughspindle(×1.15) · mql(×0.92) · mist(×0.88) · air(×0.82) · dry(×0.7).

### 4.8 COATINGS (`presets.ts:175-186`) — **10**개
Uncoated · TiN · TiCN · AlTiN · AlCrN · nACo · DLC · ZrN · CrN · Diamond. ×1.0~1.6, Tmax 400~1200°C.

### 4.9 TOOL_GROUPS (`presets.ts:194-201`) — **6**개 (milling 1개만 enabled)

### 4.10 OPERATION_DEFAULTS (`presets.ts:211-217`) — **5**개
Side_Milling · Slotting · Profiling · Facing · Pocketing. apRatio/aeRatio/fzMult/vcMult/hint.

---

## 섹션 5: State 직렬화 + GCode

### 5.1 SerializableState (`state-serde.ts:3-33`)

**29개 필드** URL 보존 (Tool 10 + Material 5 + Operation 2 + Machine 4 + Parameters 4 + Dial 3 + UI 1)

**Ephemeral (미보존 11개)**: darkMode, snapshotA/B, shareToast, urlHydrated, formulaOpen, diagnosticOpen, autoCorrelate, climb, cornerReductionPct, strategy, apLocked, aeLocked, stickoutManual, savedPresets 등

**⚠ MAP 격차**: MAP은 세션별 DB 저장, v2는 URL 쿼리스트링만.

### 5.2 GCode 3 Dialects (`gcode-gen.ts:21-69`)

**Fanuc/Haas** (기본): O0001 블록번호, G43 공구길이보정, G21/G17/G40/G49/G80/G90 셋업
**Heidenhain iTNC/TNC**: TOOL CALL + S, L Z+50 FMAX, R0 반경보정
**Siemens 840D**: T## D#, S## M3 분리, G0/G1 간결

**쿨런트 매핑**: flood=M08 · mist=M07 · mql=M07(주석) · air=M26(Siemens 전용) · dry=M09 · throughspindle=M08(주석)

**⚠ 미지원 제어기**: Mazak Smooth · Okuma OSP · DMG Mori DURATURN · Doosan/Hyundai-WIA (국산).

---

## 섹션 6: cutting-calculator.ts 함수 카탈로그

### 21개 Exported 함수

#### 기본 계산
- **`calculateCutting(params)`** (43-54) — Sandvik `n=1000Vc/πD`, `Vf=fzZn`, `MRR=ap·ae·Vf/1000`, `Pc=MRR·kc/(60·10³·η)` η=0.8
- **`getDefaultRange(D)`** (65-74) — `{VcMin:50, VcMax:400, fzMin:0.01, fzMax:0.3, apMax:2D, aeMax:D}`
- **`applyOptimizationMode(range, mode)`** (78-93) — 범위의 20%/50%/85% 선택

#### 보정 인자
- **`radialChipThinningFactor(ae, D)`** (97-103) — `√[1-(1-2ae/D)²]`, ae/D<0.5 영역
- **`ballNoseEffectiveDiameter(D, ap)`** (107-112) — `2√[ap(D-ap)]`
- **`engagementAngleRad(ae, D)`** (115-119) — `acos(1-2ae/D)`
- **`deriveFactors(params)`** (136-159) — RCTF·hex·fzCompensated·Deff·VcActual·nActual·engagementDeg

#### 고급 분석
- **`computeAdvanced(params)`** (168-188) — 토크`T=Pc·1000/ω` · 절삭력`Fc=2T/D` · 편향`δ=FL³/(3EI)` 캔틸레버
- **`estimateToolLifeMin(params)`** (208-224) — Taylor `T=Tref·(Vref·coating/V)^(1/n)` n=0.25(카바이드)/0.125(HSS), 20-600분 클램프
- **`estimateRaUm(params)`** (229-246) — `Ra=fz²/(8R)·1000` μm
- **`estimateChatterRisk(params)`** (250-271) — L/D+파워+WH+편향 가중치 합산, LOW/MED/HIGH
- **`estimateCostPerPart(params)`** — 파트당 공구비+머신비
- **`hardnessVcDerate(scale, value)`** (285-300) — HRC 환산 후 구간별 계수 (1.0~0.35)
- **`stickoutDerate(L, D)`** (303-312) — L/D 구간별 {vc, fz} 계수
- **`workholdingCap(security, D)`** (315-322) — `apMax=D(0.5+1.5s)`, `aeMax=D(0.3+0.7s)`
- **`workholdingAllowance(security)`** (482-489) — `deflectionLimit`, `aggressivenessMultiplier`
- **`climbAdjust(climb)`** (325-330) — `{raMult:0.8, fcMult:0.9, lifeMult:1.15}` climb일 때

#### 전략/역산
- **`computePassPlan(params)`** (340-372) — 러프/피니시 패스 수·시간·MRR
- **`economicVc(params)`** (376-388) — Taylor-Ackoff `Vc_econ = Vc_ref·[(C_machine)/((1/n-1)·C_tool)]^n`
- **`solveForTargetMRR(params)`** (391-417) — 목표 MRR 역산

#### 코너/형상
- **`internalCornerFeed(F, OD, TD)`** (420-424) — `F(OD-TD)/OD`
- **`externalCornerFeed(F, ID, TD)`** (425-427) — `F(ID+TD)/ID`
- **`chamferEffD(Dtip, depth, θ)`** (432-435) — `Dtip+2depth·tan(θ)`

#### 경고
- **`buildWarnings(params)`** (496-528) — 10+개 조건 검사 후 SimWarning[]

### 상수
- **`KC_TABLE`** (6-13) — P:2000, M:2200, K:1200, N:800, S:2500, H:3500 (N/mm²)
- **`ISO_LABELS`** (15-22) — ISO 그룹 한글
- **`UNITS`** (191-201) — 11개 변환 함수 (mm↔in, m/min↔SFM, kW↔HP, N·m↔in·lb)
- **`MIN_CHIP_THICKNESS`** (274-281) — P:0.010, M:0.015, K:0.008, N:0.005, S:0.020, H:0.015 (mm)
- **`SFM_IPT_TABLE`** (446-460) — 13 재질 출발값

**⚠ MAP 대비 격차 요약**
1. Harvey "Tool Life Cost Balance" 완전 모델 없음 (economicVc는 Taylor-Ackoff만)
2. KC_TABLE 6 ISO만 — MAP은 50+ 마이크로 소재
3. 스핀들 임계속도 모델 없음 (채터 점수는 L/D 가중치만)
4. 복잡 인서트/면취 엔드밀 동적 유효경 없음
5. 실시간 칩 흐름 시뮬 없음 (정적 MIN_CHIP_THICKNESS 상수만)
6. 다중 제약 파레토 최적해 없음 (solveForTargetMRR은 MRR 1개 제약만)
7. 쿨런트/코팅 화학 상호작용 없음 (선형 Vc 승수만)
8. 동적 work hardening factor 없음 (스테인리스 MIN_CHIP_THICKNESS=0.015mm 경고만)

---

## 섹션 7: 종합 Gap 요약 (Cross-cutting)

> 두 subagent 결과를 합쳐본 v2 전체의 **취약 포인트 × 연구소장 대면 우려 지점**

### 7.1 연구소장 대면에서 가장 먼저 나올 질문들 & 현 답변 수준

| Q | 현 v2 대응 | 답변 품질 |
|---|---|---|
| "이 숫자 어디서 나왔나요?" | Recommendations 값 | ❌ **provenance 추적 UI 없음** (어느 데이터·공식으로 왔는지) |
| "Harvey MAP과 뭐가 다른가요?" | 문서 있음 | ⚠ 화면에서 즉석 비교 기능 없음 (STEP 6-7에서 보강) |
| "이 용어가 뭔가요? (fz, ae, Pc 등)" | 없음 | ❌ **교육 모드 없음** (STEP 3 핵심) |
| "SUS304로 바꾸면 뭐가 달라지나요?" | Material 선택 가능 | ⚠ 변경이 Vc/fz에 즉시 반영되지만 "왜 그렇게 되는지" 설명 부재 |
| "데이터는 누구 거예요?" | 문서 | ⚠ UI 배지 없음 — confidence/source 가시화 필요 (STEP 4) |

### 7.2 STEP 2에서 분류할 Gap 프리뷰 (구조만)

**A. MAP 有 / v2 無** (벤치마크 복제 P0)
- Tool Path Info 모달
- Workholding Security 그라데이션 색상
- Tool # → SFM/IPT 자동 로드 (PDF 인덱스)

**B. v2 有 / MAP 대비 약함** (보강 P1)
- PDF 출력 (QR+요약박스 없음)
- Corner Adjustment (Reference Only 배너 없음, 공식 시각화 없음)
- Speed/Feed dial (±50%는 과도, ±20%로 조정)
- Stick Out (mm만, L/D % 강조 필요)

**C. MAP 無 / v2 有** (유지·강화 C)
- 다크모드, A/B 스냅샷, URL 공유, GCode 3 dialect
- 경제 Vc, Reverse MRR solver, Taylor curve, pass plan
- 8종 Tool Path SVG, 칩 색깔 진단, 증상 매트릭스, 실수 TOP 10
- FRP/Graphite 재질, CV40/NMTB 스핀들

### 7.3 STEP 3~6 작업 볼륨 예상

| STEP | 예상 파일 변경 | 신규 컴포넌트 | 라인 변경 추정 |
|---|---|---|---|
| STEP 3 (교육 모드) | 대 | ~7 (EduLabel·Banner·Overlay·Callout·Theater·Context·Content) | +2500 (education-content.ts 약 2000) |
| STEP 4 (Speeds&Feeds) | 중 | ~2 (speeds-feeds-types·provenance-panel) + API 1 | +1200 |
| STEP 5 (MAP 보강) | 중 | ~2 (ToolPathInfoModal·WorkholdingVis) | +600 |
| STEP 6 (초월 7기능) | 대 | 7 (AI·Heatmap·Animation·ToolLife·MultiCompare·LearningMode·LiveCompare) + API 1 | +3500 |

**총 예상**: 신규 컴포넌트 ~18, 신규 API ~2, 라인 ~7800 추가

### 7.4 위험 요소 (Risk Register)

| 위험 | 완화 |
|---|---|
| `cutting-simulator-v2.tsx` 이미 1854줄, 계속 키우면 유지보수 불가 | STEP 3~6에서 **컴포넌트 쪼개기** — 카드별 분리 고려 (선택) |
| 교육 콘텐츠 80~100 entry, 오타·오류 시 연구소장 앞에서 망신 | eval 테스트 `edu_content.test.ts` 강제 검증 + peer review |
| AI 코치 (STEP 6-1) API 키 노출 위험 | 서버 사이드 엔드포인트만 사용 (`/api/simulator/coach`) |
| PDF 출력에 QR 코드 라이브러리 (qrcode.js 등) 추가 필요 | npm 종속성 사전 체크 |
| Harvey PDF를 직접 복사 금지 — estimated 플래그 강제 | types에 `source: 'pdf_verified'\|'estimated'` 필수 필드 |

---

**작성 주체**: 메인 에이전트 (섹션 7) + Explore Subagent A (섹션 3·4·5) + Explore Subagent B (섹션 1·2·6) 병렬 수행 후 종합.
