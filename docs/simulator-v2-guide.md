# 가공조건 시뮬레이터 v2 — 완전 가이드

> Harvey MAP · YG-1 SpeedLab · 우리 v2 전부 이해하기 위한 문서
> 도메인 기초부터 기능 하나하나까지.

## 목차
0. [왜 가공조건 시뮬레이터가 필요한가](#0-왜-가공조건-시뮬레이터가-필요한가)
1. [5분 도메인 지식](#1-5분-도메인-지식)
2. [Harvey MAP 해부](#2-harvey-map-machining-advisor-pro-해부)
3. [YG-1 SpeedLab 해부](#3-yg-1-speedlab-해부)
4. [우리 v2 해부](#4-우리-v2-해부)
5. [세 도구 한눈에 비교](#5-세-도구-한눈에-비교)
6. [실사용 시나리오 3가지](#6-실사용-시나리오)
7. [용어 사전](#7-용어-사전)

## 0. 왜 가공조건 시뮬레이터가 필요한가

### 문제
CNC 머신으로 금속을 깎을 때 **"얼마나 빨리 돌리고, 얼마나 깊게 파고, 얼마나 빨리 움직이냐"** 를 정해야 합니다. 이 숫자들이 조금만 틀어져도:
- 너무 빠름 → **공구 5분 만에 깨짐**
- 너무 느림 → **생산성 1/3로 추락, 공구가 재료에 문지르기만 함**
- 깊이/폭 잘못 → **채터링(진동), 표면 거칠음, 스핀들 과부하**

### 기존 해법
현장 엔지니어는 보통 이렇게 합니다:
1. 공구 카탈로그 PDF에서 "추천 절삭조건" 찾기 (수천 페이지)
2. 과거 노트/경험으로 어림잡기
3. 처음엔 보수적으로 시작해서 조금씩 올리기 (시행착오 시간 = 돈)

### 시뮬레이터의 역할
**"이 공구로 이 재료 이렇게 깎을 건데, 조건이 안전한가? 최적인가?"** 에 즉시 답.
- 공구 파손 위험 경고
- 머신 한계 초과 감지
- 공구 수명·원가·표면거칠기 예측
- 카탈로그 데이터 자동 매칭

## 1. 5분 도메인 지식

### 1.1 가공 4대 독립 파라미터

CNC에서 유저가 **직접 설정**하는 숫자 4개. 이것만 알면 반은 끝남.

| 기호 | 한글 | 영어 | 단위 | 의미 |
|---|---|---|---|---|
| **Vc** | 절삭속도 | Cutting Speed / SFM | m/min | 공구 날 끝이 재료를 스치는 선속도 |
| **fz** | 날당 이송 | Feed per tooth / IPT | mm/tooth | 한 날이 재료를 한 번 지나갈 때 먹는 두께 |
| **ap** | 축방향 절입 | Axial DOC / ADOC | mm | 공구 축 방향으로 파고드는 깊이 |
| **ae** | 경방향 절입 | Radial DOC / RDOC | mm | 공구 옆방향으로 깎는 폭 |

**직관적 비유 (연필로 종이 지우기)**
- Vc = 연필을 얼마나 빨리 쓱쓱 움직이냐
- fz = 한 번 지날 때 얼마나 힘주냐
- ap = 연필심이 종이에 얼마나 깊게 박히냐
- ae = 지우개가 얼마나 넓게 닿냐

### 1.2 파생 3대 결과 (계산으로 나옴)

| 기호 | 한글 | 공식 | 의미 |
|---|---|---|---|
| **n** | 회전수 (RPM) | `n = 1000·Vc / (π·D)` | 스핀들이 분당 몇 회전 |
| **Vf** | 테이블 이송 | `Vf = fz · Z · n` | XY축이 분당 몇 mm 이동 |
| **MRR** | 금속제거율 | `MRR = ap·ae·Vf / 1000` | 분당 몇 cm³ 파내는가 (생산성 지표) |

> ★ Vc·fz는 **"공구의 언어"** (공구 카탈로그는 Vc/fz로 스펙)
> n·Vf는 **"머신의 언어"** (CNC 프로그램에 찍히는 숫자)

### 1.3 결과 영향 지표

| 기호 | 한글 | 의미 |
|---|---|---|
| **Pc** | 소요 동력 | 이 가공을 하려면 스핀들이 몇 kW 필요한가 |
| **Fc** | 절삭력 | 공구가 받는 힘 (N) |
| **T** | 토크 | 공구 축에 걸리는 회전 모멘트 (N·m) |
| **δ** | 공구 편향 | 측면력으로 공구가 휘는 양 (μm) — 가공 오차의 주범 |
| **Ra** | 표면 거칠기 | 마감 품질 (μm) — 낮을수록 매끄러움 |

### 1.4 공구 형상 4종 (엔드밀 기준)

```
Square       Ball         Corner-R      Chamfer
──┬──        ──┬──         ──┬──          ──┬──
  │            │             │              ╲
  │            │             │               ╲
  │         ╱  │  ╲          │  ╲             ╲
──┴──     ──   └   ──      ──┴───┘            ──
평평       반구형        모서리 R         45° 각
```

| 형상 | 용도 | 대표 예시 |
|---|---|---|
| Square (스퀘어) | 측면/슬롯 가공, 일반용 | EHD84, GA931 |
| Ball (볼) | 3D 곡면, 금형 | GNX98, SEM846 |
| Corner-R (코너 R) | 모서리 강도 보강 | SEME61, GMG87 |
| Chamfer (챔퍼) | 모따기, 디버링 | GME83 |

### 1.5 소재 ISO 분류

국제 공구업계 표준 6분류. **공구·조건 선택의 1순위 기준**.

| ISO | 소재 | 특징 | 대표 재질 | Vc 대략 |
|---|---|---|---|---|
| **P** | 탄소·합금강 | 표준 기준 | S45C, 4140 | 150~200 m/min |
| **M** | 스테인리스 | 가공경화, 점착 | SUS304, 316 | 100~140 |
| **K** | 주철 | 부스러지는 칩 | FC250, FCD | 180~240 |
| **N** | 비철 | 무르고 빠름 | Al6061, 황동 | 400~800 |
| **S** | 초내열합금 | 열·인성 고 | Inconel, Ti | 40~80 |
| **H** | 경화강 | 단단 (>45HRC) | SKD11, 공구강 | 60~120 |

### 1.6 형상 비율 (ae/D, ap/D)

**ae/D = 경방향 engagement**
- 0.5 미만 → **chip thinning 발생** (날이 얇게 먹음 → 실제 chip load 감소 → fz 상향 가능)
- 0.5 초과 → 정상 (fz 그대로)
- 1.0 = 슬로팅 (전폭 가공)

**ap/D = 축방향 engagement**
- 0.2 이하 → 얕은 마감
- 1.0 근방 → 표준 측면
- 2.0 초과 → 깊은 HEM (공구 파손 경계)

> [목표] **HEM (High Efficiency Milling) 전략**: `ae/D ≈ 0.08` + `ap/D ≈ 2`
> 얇게 + 깊게 → 공구 수명↑ + 생산성↑ (현대 가공의 핵심)

### 1.7 보정 인자들

**Chip Thinning (RCTF)**
- ae/D < 0.5일 때: 실제 chip = fz × √(1-(1-2·ae/D)²)
- 예: ae/D=0.1 → RCTF≈0.6 → 실 chip은 fz의 60%만
- 같은 chip 유지하려면 fz를 1/RCTF만큼 상향 (Harvey가 자동 보정해주는 게 킬러 기능)

**Ball-nose 유효직경 (D_eff)**
- 볼 엔드밀에서 ap이 얕으면 실 절삭 지름 작아짐
- `D_eff = 2·√(ap·(D-ap))`
- 예: D=6 ap=0.3 → D_eff=2.6mm → 실 Vc는 설정값의 43%

**Taylor 공구수명 방정식**
- `V · T^n = C` → T = (C/V)^(1/n)
- 카바이드 n≈0.25, HSS n≈0.125
- Vc 10% 올리면 수명 ~40% 감소 (비선형)

## 2. Harvey MAP (Machining Advisor Pro) 해부

> [web] https://map.harveyperformance.com
> **철학**: "조언자(Advisor) 모델" — 공구·재료·머신·공법 알려주면 최적 조건 추천

### 2.1 화면 구조 (상단 4 + 하단 2 카드)

```
┌──────────┬──────────┬──────────┬──────────┐
│   TOOL   │ MATERIAL │OPERATION │ MACHINE  │
│  (공구)  │ (재료)   │ (가공법) │ (머신)   │
└──────────┴──────────┴──────────┴──────────┘
┌─────────────────────┬────────────────────┐
│    PARAMETERS       │  RECOMMENDATIONS   │
│    (파라미터)       │  (추천조건 + ±%)   │
└─────────────────────┴────────────────────┘
```

### 2.2 각 카드 상세

#### 1. TOOL 카드
- **Tool #** — Harvey 자사 공구 번호 입력
- **Tool details** — 입력 시 D, LOC, OAL, 재질·코팅 자동 로드
- 공구를 모르면 진행 불가 (공구 데이터베이스 기반)

#### 2. MATERIAL 카드 (가장 정교)
- **Material** 드롭다운 — "Aluminum Alloy, Cast" 등 대분류
- **Subgroup** — "380 — Silicon-copper series" 등 세부
- **Condition** — F(주조상태), T6(시효경화), Annealed 등 **열처리 상태**
- **HBW / HBS / HRB / HRC** — 4개 경도 스케일 동시 표시 (전환 자동)

> ※ 왜 경도가 4개? 재료마다 측정 스케일이 다름. Al은 HBW, 강은 HRC, 동은 HRB. Harvey가 자동 변환.

#### 3. OPERATION 카드
- **Type** — Side Milling / Slotting / Profiling / Plunge 등
- **Tool Path** — 가공 경로 전략 (HEM, Trochoidal, Adaptive)
- **Tool Path Info** — 경로 시각 썸네일 (슬롯/측면 그림)

#### 4. MACHINE 카드
- **Spindle** 드롭다운 — 스핀들 타입 (BT40/HSK63 등)
- **Holder** 드롭다운 — 콜릿/샹크홀더/Shrink Fit 등
- **MAX RPM / MAX IPM** — 머신 한계
- **WORKHOLDING SECURITY** 슬라이더 — ★ Harvey 시그니처
  - Loose ← → Rigid: "얼마나 단단히 물렸나?"
  - 슬라이더가 왼쪽이면 Harvey가 조건을 보수적으로 내림
  - 바이스에 헐렁하게 물린 것 vs 전용 고정구로 꽉 잡은 것 차이

#### 5. PARAMETERS 카드
- **Stick Out** — 공구 돌출 길이 (절대값 + %)
- **Radial Depth (ae)** — 절대값 + % + [lock] LOCK
- **Axial Depth (ap)** — 절대값 + % + [lock] LOCK
- **Engagement Angle** — ae/D로부터 자동 계산된 엔게이지먼트 각
- **SELECTED TOOL** — 공구 실루엣 그림 (shape 반영)
- **ADOC/RDOC ADJUSTER** — ★ Harvey 시그니처
  - 수직 슬라이더 0%(top)~100%(bottom)
  - ap/ae를 **% 단위로 동시 조작**

#### 6. RECOMMENDATIONS 카드
- Surface Speed (Vc), RPM, Feed per tooth, Feed per minute, MRR, Chip Thickness
- **SPEED ±20% 슬라이더** ★ Harvey 시그니처
  - 기준값 100% 중심으로 -20% ~ +20% 미세조정
  - 라벨: "Increased Production ↔ Increased Tool Life"
- **FEED ±20% 슬라이더**
  - "Increased Production ↔ Less Tool Deflection"
- **CORNER ADJUSTMENT** 패널 (reference only, 실 적용은 NC 프로그램)
- **PDF** 출력 버튼

### 2.3 Harvey UX 철학

1. **"Advisor" 모델** — 유저는 조건을 직접 짜지 않음. 슬라이더로 미세조정만.
2. **Workholding 슬라이더가 신의 한 수** — 현장 실정을 유일하게 UI에 반영
3. **±%로 최적화 방향 직관화** — "더 생산 ↔ 더 수명" 이분법
4. **자사 공구 DB 기반** — Harvey 공구만 추천 가능 (약점이자 상업 전략)

### 2.4 Harvey 강점 / 약점

| 강점 | 약점 |
|---|---|
| 공구 DB와 완전 연동 | Harvey 공구만 지원 |
| Workholding 입력이 직관적 | 공구 치수 수정 불가 |
| RCTF·Ball D_eff 자동 보정 | 코팅·쿨런트 선택 없음 |
| 경도 4스케일 변환 | Tool Life 예측 없음 |
| Speed/Feed ±% UX | 다크모드·URL 공유 없음 |

## 3. YG-1 SpeedLab 해부

> [web] https://yg1speedlab.com
> **철학**: "공구 찾기 검색엔진 + 간이 Speeds/Feeds"

### 3.1 화면 구조 (좌 Filter + 우 Results)

```
┌─────────────────┬──────────────────────────┐
│  Tool Selector  │       Results            │
│                 │                          │
│  - Units        │  Find by EDP             │
│  - EDP search   │  Browse by Dimensions    │
│  - ISO buttons  │  Browse by Material      │
│  - Dia/LOC/...  │                          │
│  - Flutes       │  Loaded: 20955           │
│  - Tool Mat'l   │  Matches: 20955          │
│  - Advanced     │  Showing: 0 (max 100)    │
└─────────────────┴──────────────────────────┘
```

### 3.2 핵심 요소

- **Units 토글**: Any / Inch / Metric (전역 단위 전환)
- **EDP Search**: 정확한 공구번호로 즉시 찾기 (예: `SEM845001003`)
- **Work Material**: P/M/K/N/S/H 6버튼 (색상 구분)
- **Tool Dimensions**: Dia / LOC / Shank / OAL / CR — **인치+미터 동시 컬럼**
- **Number of Flutes**: 날수
- **Tool Material**: 카바이드/HSS 등
- **Show Advanced Filters**: 접힌 패널에 보조 필터들
- **Results 카운트**: 20955개 로드됨, N개 매칭, M개 표시

### 3.3 SpeedLab UX 철학

1. **"Browse-first"** — 조건 계산보다 **공구 찾기가 먼저**
2. **필터 조합 = 매칭 수 실시간 표시** → 검색 직관성
3. **인치+미터 듀얼 컬럼** → 글로벌 엔지니어 친화
4. **자사 카탈로그 2만건 홍보** (데이터 양이 자산)

### 3.4 SpeedLab 강점 / 약점

| 강점 | 약점 |
|---|---|
| 공구 필터링 탁월 | 조건 시뮬레이션 기능 빈약 |
| 이중 단위 표시 | 경고/시각화 없음 |
| YG-1 공구 2만+ 카탈로그 | Workholding/Spindle 고려 없음 |
| 20955건 Matches 카운트 | Tool Life·MRR·Pc 계산 없음 |

## 4. 우리 v2 해부

> **철학**: "Harvey의 조언력 + SpeedLab의 데이터력 + 우리만의 α"
> 엔드밀 전용, 6개 ISO 전부, 30개 실 YG-1 예시

### 4.1 전체 레이아웃

```
------------------------------------------
[*] 상단 바 — Tool Group · Filter카운트 · Units · Jump · Share · A · B · PDF · [link]Link · [dark]
------------------------------------------
[link] LIVE 상관관계 스트립 (multiplier 투명 공개)
------------------------------------------
엔드밀 형상 [전체 | Sq | Ball | R | Chamfer]
------------------------------------------
[fast] Starter / 예시 30개
------------------------------------------
[*] [독립인자]
  ┌────┬────────┬──────────┬────────┐
  │TOOL│MATERIAL│OPERATION │MACHINE │
  └────┴────────┴──────────┴────────┘
  [gear] 머신·공구 셋업 (Stickout·RPM·IPM·kW·Workholding·Coolant·Coating)
  [*] 슬라이더 (Vc·fz·ap·ae·Stick) + 2D ADOC/RDOC + 엔게이지먼트 원
------------------------------------------
[chart] Recommended vs Your (카탈로그 ↔ 현재)
← Corner Adjustment (코너 감속 %)
[*] SPEED ±% / FEED ±% (Harvey UX)
------------------------------------------
[gear] [종속인자] — RPM·Vf·Surface Speed·Chip·Engagement·Vc_eff
------------------------------------------
[목표] [결과인자] — MRR·Pc·Torque·Fc·Deflection
                Tool Life·Ra·Chatter·Cost/Part
------------------------------------------
[gear] Advanced (접기) — 원가입력·Chatter 게이지·
                   [↓chart] Taylor곡선·[목표] Reverse Solver·
                   [box] Pass Planner·[save] 프리셋·[note] GCode
------------------------------------------
⚖ A/B 조건 비교
------------------------------------------
[!] 검증 경고 리스트
------------------------------------------
[표] 카탈로그 절삭조건 (Matches / Showing)
```

### 4.2 독립인자 섹션 — TOOL 카드

| 요소 | 역할 | Harvey/SpeedLab 대응 |
|---|---|---|
| 시리즈/EDP 검색 | 공구 코드로 DB 매칭 | SpeedLab EDP Search |
| Dia/LOC/Shank/OAL/CR | 공구 치수 (듀얼 단위) | SpeedLab Tool Dimensions |
| Flutes 드롭다운 | 날수 | SpeedLab |
| 재질 드롭다운 | 카바이드/HSS/PCD 등 | SpeedLab |
| 형상 버튼 4종 | Sq/Ball/R/Chamfer | — |
| 공구 실루엣 SVG | 치수 시각화 | Harvey SELECTED TOOL |
| 카탈로그 데이터 뱃지 | "O 카탈로그 기반" / "[!] 보간" | — (우리 독자) |

### 4.3 독립인자 섹션 — MATERIAL 카드

| 요소 | 역할 |
|---|---|
| ISO 6버튼 (P/M/K/N/S/H) | 대분류 |
| **Subgroup** 드롭다운 (25개 프리셋) | Alloy steel / SUS304 / Inconel 등 |
| **Condition** 드롭다운 | Annealed / Q&T / Hardened / T6 등 |
| **경도 4스케일** (HRC/HBW/HRB/HBS) | 버튼 클릭시 자동 변환 |
| 세부소재 드롭다운 (API 기반) | 카탈로그에서 찾은 실 workpiece 목록 |
| kc 표시 | 비절삭저항 N/mm² |

### 4.4 독립인자 섹션 — OPERATION 카드

| 요소 | 역할 |
|---|---|
| Type 드롭다운 | Side/Slot/Profile/Facing/Pocket |
| Tool Path 드롭다운 | Conventional/HEM/Trochoidal/Adaptive/Dynamic/Plunge/Ramping/Helical |
| **Tool Path 다이어그램 SVG** | 8종 경로 시각 그림 ★ |
| 절삭 방향 [Climb / Conventional] | Climb: Ra×0.8, Fc×0.9, Life×1.15 |
| 최적화 모드 [생산/균형/수명] | Vc·fz 기본값 프리셋 |

### 4.5 독립인자 섹션 — MACHINE 카드

| 요소 | 역할 |
|---|---|
| Spindle 프리셋 (6종) | VMC 12k / 20k / HSM 30k / 흑연 40k / 미세 60k / 커스텀 |
| Holder 프리셋 (6종) | ER 콜릿 / 엔드밀홀더 / Shrink Fit / Hydraulic / 밀링척 / Side Lock |
| MAX RPM / MAX IPM / MAX kW | 머신 한계 (초과시 경고) |
| **Workholding 강성 슬라이더** | Loose ↔ Rigid (편향 허용치·공격성 자동조정) |
| **Coolant 드롭다운** (6종) | Flood/Through/MQL/Mist/Air/Dry — Vc 보정 |
| **Coating 드롭다운** (10종) | Uncoated/TiN/AlTiN/AlCrN/Diamond 등 — Vc 보정 |

### 4.6 독립인자 섹션 — 파라미터 슬라이더

각 슬라이더는 **절대값 + %** 동시 표시 + **LOCK 토글** + **Both 단위**:
- **Stick Out L** (mm + ×D + inch)
- **Vc** (m/min + SFM)
- **fz** (mm/t + in/t)
- **ap** (mm + ×D + inch) [lock]
- **ae** (mm + ×D + inch) [lock]

**우측 비주얼**:
- **ADOC/RDOC 2D 어드저스터** ★ (Harvey 시그니처) — 박스 드래그로 ap%·ae% 동시조절
- **Engagement Circle** — 원형 차트로 엔게이지먼트 각 표시

### 4.7 Recommended vs Your ★ 우리 킬러 기능

Harvey·SpeedLab 둘 다 **없는** 기능. 카탈로그 추천값과 현재값을 4컬럼으로 나란히:

```
┌──────────┬──────────┬──────────┬──────────┐
│    Vc    │    fz    │   ap/D   │   ae/D   │
│ 추천 현재│          │          │          │
│ 180  190 │ 0.05 0.04│ 0.8  1.0 │ 0.3  0.2 │
│  +5.6%   │  -20%    │  +25%    │  -33%    │
│ [*] 근사  │ [*] 이탈  │ [*] 근사  │ [*] 이탈  │
└──────────┴──────────┴──────────┴──────────┘
```

색상:
- [*] ±5% 이내 — 추천 근사
- [*] ±15% 초과 — 위험 이탈

### 4.8 Corner Adjustment

Harvey에도 있지만 우리는 **실제 계산 반영**:
- 0~70% 슬라이더
- "코너 진입시 Vf → X mm/min (-Y%)" 실시간 표시
- (실제 NC 프로그램 반영은 별도 필요)

### 4.9 SPEED / FEED ±% (Harvey 시그니처 수입)

- **SPEED ±20%**: Vc 미세조정. 라벨 "Increased Production ↔ Increased Tool Life"
- **FEED ±20%**: fz 미세조정. 라벨 "Increased Production ↔ Less Tool Deflection"
- 0% 리셋 버튼
- 실시간 effective 값 표시: `Vc 180 m/min · 6,000 rpm`

### 4.10 종속인자 (6 메트릭 카드)

계산 중간값 — 독립→결과 사이 다리:

| 카드 | 계산식 | 의미 |
|---|---|---|
| **RPM (n)** | `1000·Vc/(π·D_eff)` | 스핀들 회전수 |
| **Vf / IPM** | `fz·Z·n` | XY 이송 |
| **Surface Speed** | Vc (SFM 병기) | 날끝 선속도 |
| **Chip Thickness (hex)** | `fz · RCTF` | 실 chip 두께 (RCTF 보정) |
| **Engagement Angle** | `acos(1-2·ae/D)` | 날이 재료에 박히는 호 각 |
| **Vc (effective)** | Ball의 경우 D_eff 반영 | 실 절삭속도 |

### 4.11 결과인자 (5+4 카드)

**가공 성능 (5)**:
- MRR (cm³/min + in³/min)
- Pc (kW + HP)
- Torque (N·m + in·lb)
- Cutting Force Fc (N)
- Tool Deflection δ (μm)

**예측 지표 (4)** — 우리 독자 ★:
- **Tool Life** (min, Taylor's equation)
- **Ra 표면거칠기** (μm, 이론값 + 등급라벨: 미러급/마감/중간/거친가공)
- **Chatter Risk** (% + LOW/MED/HIGH + 사유)
- **Cost/Part** (원, 공구비 + 머신시간비)

### 4.12 Advanced 패널 (접기)

[gear] 버튼으로 펼치면:

1. **[₩] 단가 분석 입력** — 공구단가/머신시간단가/사이클타임 입력 → 파트당 원가 산출
2. **[↑chart] Chatter 상세 게이지** — 위험도 바 + 상세 사유
3. **[↓chart] Taylor 수명곡선** ★ — Vc-Life 로그곡선 + 현재 마커 + 최저원가 Vc
4. **[목표] Reverse Solver** ★ — 목표 MRR 입력 → Vc/fz/ap/ae 역산 원클릭 적용
5. **[box] 스톡 → 패스 계획** ★ — 스톡 크기 입력 → 러프/마감 패스수 + 총시간
6. **[save] 프리셋 저장/불러오기** ★ — localStorage 20개까지
7. **[note] GCode 스니펫** ★ — Fanuc/Heidenhain/Siemens 3종 + 클립보드 복사

### 4.13 A/B 조건 비교 ★ 우리 독자

상단 `[save] A` / `[save] B` 버튼으로 스냅샷 저장 → 10개 지표 나란히 diff:

```
지표    │    A         │    B         │ Δ (B vs A)
Vc      │ 180 m/min    │ 200 m/min    │ +20 (+11.1%)
fz      │ 0.0500 mm/t  │ 0.0600 mm/t  │ +0.01 (+20%)
MRR     │ 28.8 cm³/min │ 38.4 cm³/min │ +9.6 (+33.3%)
Pc      │ 2.4 kW       │ 3.5 kW       │ +1.1 (+45.8%)
...
```

### 4.14 상관관계 자동연동 [link] ★ 우리 시그니처

**`[link] Link ON/OFF` 토글**로 6대 상관관계 자동적용 on/off:

| 변화 | 자동 연동 |
|---|---|
| 경도 HRC ↑ | Vc 자동 하향 (30HRC×0.95 → 60HRC×0.45) |
| Stickout L/D ↑ | Vc·fz 자동 derate (L/D>4 → ×0.85, >6 → ×0.75) |
| Workholding ↓ | ap·ae 상한 축소 + 현재값 초과시 자동 clamp |
| Tool Path 변경 | HEM/Trochoidal → ae=0.08D ap=1.5D 자동, Adaptive → ae=0.15D |
| Operation 변경 | Side/Slot/Profile별 ap·ae 디폴트 재설정 |
| Spindle 변경 | max RPM/IPM/kW 함께 변경 |

**상단 LIVE 스트립**이 현재 적용된 multiplier를 투명하게 공개:
```
[link] LIVE: Coolant ×1.0 · Coating ×1.35 · Hardness ×0.72 · Stickout Vc×1 fz×1
         · Workholding ap≤20 ae≤7 · Climb Ra×0.8 F×0.9 Life×1.15
Vc_eff = 200 × 0.97 = 194 m/min
```

### 4.15 경고 시스템 [!]

실시간 규칙 기반 경고 (error/warn/info):

- **ap > 2·D** → 공구 파손 위험 (error)
- **ae > D** → 물리적 불가 (error)
- **ap > LOC** → 절삭날 길이 초과 (error)
- **RPM > 스핀들 최대** → 스핀들 초과 (error)
- **Pc > 스핀들 kW** → 파워 초과 (error)
- **Vf IPM > 최대 IPM** → 이송 초과 (error)
- **δ > 50μm** / Workholding 허용치 초과 → 정밀도 손상 (error)
- **L/D > 5** → 편향 위험 (warn)
- **hex < 최소 chip (ISO별)** → rubbing → 수명 급감 (warn) ★
- **Chatter level = high** → 위험도 N% (error) ★
- **Chamfer CR vs ap** 등 형상별 주의 (info)

### 4.16 부가 기능

- **[dark] 다크 테마** — slate-900 배경 전환
- **[link] URL 공유** — 전체 상태가 query string으로 자동 동기화 → Share 버튼 클립보드
- **[PDF] PDF 출력** — jsPDF + html2canvas, 고해상도 A4 다페이지
- **Jump to Results** — 카탈로그 섹션 앵커 점프
- **Units Metric/Inch/Both** — 3개 모드
- **Starter Cards** — 빈 상태 가이드 (EDP/치수/소재 3경로)

## 5. 세 도구 한눈에 비교

### 5.1 기능 매트릭스

| 기능 | Harvey MAP | YG-1 SpeedLab | 우리 v2 |
|---|---|---|---|
| **공구 DB 검색** | [OK] 자사 | [OK] 20955 | [OK] 카탈로그 |
| **EDP 직접 검색** | [OK] | [OK] | [OK] |
| **LOC/Shank/OAL/CR 필드** | [OK] | [OK] | [OK] |
| **Material Subgroup + Condition** | [OK] | [!] 간이 | [OK] |
| **4 경도 스케일 변환** | [OK] | [X] | [OK] |
| **Tool Path 선택** | [OK] 시각 | [X] | [OK] 시각 |
| **Workholding Security** | [OK] | [X] | [OK] |
| **Spindle/Holder 프리셋** | [OK] | [X] | [OK] |
| **Coolant 선택** | [OK] | [X] | [OK] 6종 |
| **Coating 선택** | [!] 공구 | [!] 필터 | [OK] 10종 |
| **Units Metric/Inch/Both** | [!] 토글만 | [OK] | [OK] |
| **Stick Out %/LOCK** | [OK] | [X] | [OK] |
| **ap/ae %/LOCK** | [OK] | [X] | [OK] |
| **2D ADOC/RDOC 어드저스터** | [OK] 수직 | [X] | [OK] 2D |
| **Engagement Circle** | [OK] | [X] | [OK] |
| **Speed/Feed ±% 슬라이더** | [OK] | [X] | [OK] |
| **Corner Adjustment** | [OK] ref only | [X] | [OK] 실 계산 |
| **Chip Thinning (RCTF)** | [OK] 자동 | [X] | [OK] 자동 |
| **Ball-nose D_eff** | [OK] | [X] | [OK] |
| **RPM/Vf/MRR/Pc 계산** | [OK] | [!] 일부 | [OK] |
| **Torque/Fc/편향** | [X] | [X] | [OK] ★ |
| **Tool Life (Taylor)** | [X] | [X] | [OK] ★ |
| **Ra 표면거칠기 예측** | [X] | [X] | [OK] ★ |
| **Chatter Risk 예측** | [X] | [X] | [OK] ★ |
| **Cost/Part 원가 분석** | [X] | [X] | [OK] ★ |
| **Taylor 수명곡선 차트** | [X] | [X] | [OK] ★ |
| **Reverse MRR Solver** | [X] | [X] | [OK] ★ |
| **Multi-pass 스톡 계산기** | [X] | [X] | [OK] ★ |
| **Recommended vs Your** | [X] | [X] | [OK] ★ |
| **GCode 스니펫** | [X] | [X] | [OK] 3 dialect ★ |
| **경고 시스템** | [!] 일부 | [X] | [OK] 15+ 규칙 ★ |
| **상관관계 자동연동** | [!] 부분 | [X] | [OK] 6개 + [link] 토글 ★ |
| **A/B 비교** | [X] | [X] | [OK] ★ |
| **URL 공유** | [X] | [X] | [OK] ★ |
| **프리셋 저장 (localStorage)** | [X] | [X] | [OK] ★ |
| **다크 테마** | [X] | [!] only | [OK] 토글 |
| **PDF 출력** | [OK] | [X] | [OK] jsPDF |
| **Starter 카드** | [X] | [OK] | [OK] |

### 5.2 철학 비교

| 철학 | Harvey | SpeedLab | v2 |
|---|---|---|---|
| 출발점 | 공구 번호 | 필터 | 예시 or EDP or 필터 |
| 주 유저 | Harvey 고객 | YG-1 고객 | YG-1 고객 + 연구 |
| 강점 | 조언·보정 | 데이터 양 | 계산 + 분석 + 연동 |
| 주 UX | ±% 슬라이더 | 필터→카탈로그 | 3섹션 + [link] 연동 |

## 6. 실사용 시나리오

### 시나리오 A — "SUS304 일감이 들어왔는데 처음 쓰는 공구"

1. **Starter 카드 → "ISO로 시작"** 클릭
2. **MATERIAL**: ISO = M 선택 → Subgroup "오스테나이트 SS (304, 316)" → Condition "Annealed"
3. **TOOL**: 시리즈에 `EHD84` 검색 → 카탈로그 조건 자동 로드 + EDP 자동 채움
4. **OPERATION**: Side Milling + Conventional Path 유지
5. **MACHINE**: 우리 VMC 스핀들 "VMC 표준 (BT40, 12k)" 선택
6. [link] Link ON 상태 → 경도·stickout 자동 derate 적용됨
7. **결과 확인**:
   - Pc 2.1 kW → 머신 15kW 한참 여유
   - Tool Life 42 min, Cost/Part 850원
   - 경고: "hex 0.013 < 최소 0.015" → fz 살짝 상향 권장
8. **Speed/Feed ±%** 슬라이더로 Feed +10% → 생산성↑
9. [save] A 저장 → 대조군 B 만들어서 비교
10. [link] Share 로 매니저에게 링크 전송

### 시나리오 B — "기존 조건 최적화 — 30초 가공시간 단축"

1. 기존 조건 불러오기 ([save] 프리셋에서)
2. **Advanced 펼치기** → **Taylor 수명곡선** 확인
   - 현재 Vc가 "최저원가 Vc" 대비 너무 오른쪽 (수명 희생중)
3. **[목표] Reverse Solver**: 목표 MRR 40 cm³/min 입력 → "적용"
4. 자동 제안 조건 적용됨 → 결과 확인
5. [box] 스톡 L100×W60×H30mm 입력 → "총 가공시간 7.3 min"
6. ⚖ A/B 비교로 원본 vs 신안 시각화

### 시나리오 C — "긴 공구로 깊은 포켓 → 편향 걱정"

1. TOOL: ⌀6mm, Stickout **45mm** 입력 (L/D=7.5)
2. [link] LIVE 스트립: **Vc×0.6 fz×0.55 자동 derate** (L/D>6이라)
3. **Workholding** 슬라이더 낮춤 → ap/ae 상한 자동 clamp
4. **결과**: 편향 35μm (허용 10μm 초과)
5. [!] 경고: "편향 35μm > Workholding 허용 10μm"
6. **Advanced → Chatter** 게이지: HIGH (75%) 사유 "L/D 과도"
7. 조치: Stickout 줄이거나, ap 낮춰서 Fc↓

## 7. 용어 사전

| 용어 | 풀네임 | 의미 |
|---|---|---|
| **ADOC** | Axial Depth of Cut | = ap, 축방향 절입 |
| **RDOC** | Radial Depth of Cut | = ae, 경방향 절입 |
| **SFM** | Surface Feet per Minute | = Vc의 imperial (ft/min) |
| **IPT** | Inches Per Tooth | = fz의 imperial (in/tooth) |
| **IPM** | Inches Per Minute | = Vf의 imperial (in/min) |
| **LOC** | Length of Cut | 절삭날 유효 길이 |
| **OAL** | Overall Length | 공구 전장 |
| **CR** | Corner Radius | 코너 R |
| **HEM** | High Efficiency Milling | 얇게+깊게 고효율 전략 |
| **MRR** | Material Removal Rate | 분당 제거 체적 |
| **RCTF** | Radial Chip Thinning Factor | 경방향 chip 보정계수 |
| **EDP** | Each Dollar Part number | YG-1 공구 고유코드 |
| **hex** | — | 실 chip 두께 (= fz × RCTF) |
| **kc** | — | 비절삭저항 (N/mm²) 재질별 |
| **Taylor's eq.** | — | V·T^n = C, 공구수명 방정식 |
| **Chatter** | — | 진동·채터링 (공구-기계 연성진동) |
| **Climb milling** | Down milling | 다운컷, 날이 두꺼운 chip부터 얇게 |
| **Conventional milling** | Up milling | 업컷, 날이 얇게 시작해 두꺼워짐 |
| **Workholding** | — | 일감을 고정하는 방법·강성 |
| **Stickout** | — | 공구가 홀더 밖으로 나온 길이 |

## 부록: 숫자로 보는 v2 규모

| 항목 | 수 |
|---|---|
| 엔드밀 예시 | 30개 (ISO 6×Shape 4 분포) |
| ISO 분류 | 6종 (P/M/K/N/S/H) |
| 엔드밀 형상 | 4종 (Sq/Ball/R/Chamfer) |
| Material Subgroup | 25개 프리셋 |
| Spindle 프리셋 | 6종 |
| Holder 프리셋 | 6종 |
| 공구 재질 | 8종 |
| 코팅 | 10종 |
| 쿨런트 | 6종 |
| Tool Path | 8종 (SVG 다이어그램) |
| GCode dialect | 3종 (Fanuc/Heidenhain/Siemens) |
| 경고 규칙 | 15+ |
| 상관관계 자동연동 | 6개 |
| 결과 메트릭 | 14개 |
| 시각화 SVG | 4종 (공구/엔게이지/Taylor/Path) |
| 코드 라인 (v2 주요) | ~1500줄 |

*이 문서는 /simulator_v2 구현 기준 작성 (2026-04-21).*

## 부록 B: 계산 검증 결과 (2026-04-21 실행)

검증 스크립트: `scripts/verify-simulator-calc.mjs` · `node scripts/verify-simulator-calc.mjs`

| 카테고리 | 케이스 | 결과 |
|---|---|---|
| 기본 공식 (n/Vf/MRR/Pc) | SUS304 · S45C · Al6061 · Inconel718 · 경화강 60HRC | 5케이스 × 4지표 **20/20 통과** |
| RCTF (chip thinning) | ae/D 0.5 / 0.2 / 0.1 / 0.05 | **4/4 통과** |
| Ball-nose D_eff | 4 조합 | **4/4 통과** |
| Taylor 수명 | 추천 Vc · 20% 초과 · AlTiN 보너스 | **3/3 통과** |
| Ra 표면거칠기 | 볼 마감 · 스퀘어 · 코너R | **4/4 통과** |

**최종 35/35 통과**. 오차 기준:
- n/Vf: 0.5% 이내
- MRR: 1.5% 이내 (반올림 허용)
- Pc: 2.0% 이내 (Sandvik 공식 대비)
- RCTF/D_eff: 1.0% 이내
- Taylor/Ra: 예상 범위 내

### 발견·수정된 버그
**Pc 계산 1000배 오류** — `cutting-calculator.ts`에서 `Pc = MRR × kc / (60 × 10⁶ × η)`로 되어있어 1000배 작게 나왔음. Sandvik 공식은 MRR이 cm³/min 기준이면 `/(60 × 10³ × η)`가 맞음. 수정 후 SUS304 ⌀10 표준 케이스 Pc = 0.70 kW로 교과서와 일치.

> [*] 이 버그는 Harvey MAP과 수치 비교를 안 했으면 발견 못 했을 수준. Workholding이나 경고 시스템이 Pc 기반인데 늘 "여유있음"으로만 나왔을 것. **검증 테스트 필요성 증명**.

## 부록 C: 주요 계산식 전부

> v2가 사용하는 모든 공식을 한 곳에. UI "[수식] 계산식 보기" 패널과 동일.

### 1. 회전수·이송 (머신 언어 변환)

**n (RPM)** = `1000·Vc / (π·D)`
예: Vc=120, D=10 → n = 1000·120 / (π·10) = **3820 rpm**

**Vf (테이블이송)** = `fz · Z · n`
예: fz=0.05, Z=4, n=3820 → Vf = 0.05·4·3820 = **764 mm/min**

### 2. 제거율·파워 (Sandvik 공식)

**MRR (금속제거율)** = `ap · ae · Vf / 1000` [cm³/min]
예: 10·2·764 / 1000 = **15.28 cm³/min**

**Pc (소요동력)** = `MRR · kc / (60·10³·η)` [kW]
- kc = 재질 비절삭저항 (N/mm²): P=2000, M=2200, K=1200, N=800, S=2500, H=3500
- η = 기계효율 (기본 0.8)
예: 15.28·2200 / 48000 = **0.70 kW**

### 3. 절삭력·편향

**ω (각속도)** = `2π·n / 60` [rad/s]

**T (토크)** = `Pc·1000 / ω` [N·m]

**Fc (절삭력)** = `2·T·1000 / D` [N]

**δ (공구 편향, 캔틸레버 모델)** = `Fc · L³ / (3·E·I)` [mm]
- I = `π·D⁴ / 64` (원형 단면 관성 모멘트, mm⁴)
- E = 탄성계수 (카바이드 600 GPa, HSS 210 GPa)
- L = 공구 돌출 (stickout)

### 4. Chip Thinning 보정 (Harvey식)

**RCTF (경방향 chip 보정계수)** = `√(1 − (1 − 2·ae/D)²)`
- ae/D ≥ 0.5 이면 1 (보정 불필요)
- 이하에서 실 chip 두께는 fz의 RCTF 배

**실 chip 두께 (hex)** = `fz · RCTF` [mm]

**볼 엔드밀 유효직경 D_eff** = `2·√(ap·(D − ap))` [mm]
- 얕은 ap에서 실 절삭 지름 축소

### 5. 엔게이지먼트 각도

**θ (engagement angle)** = `arccos(1 − 2·ae/D) · 180/π` [°]

### 6. 공구 수명 (Taylor 방정식)

**Taylor 기본식**: `V · Tⁿ = C`
- V = 절삭속도, T = 수명, n·C = 실험상수
- 카바이드 n ≈ 0.25, HSS n ≈ 0.125

**수명 추정**:
`T_life = T_ref · (V_ref · coating / V)^(1/n)` [min]
- T_ref = 기준 수명 (카바이드 45분, HSS 60분, H·S계 20분)
- coating = 코팅 보너스 (AlTiN ×1.35, AlCrN ×1.4 등)
- climb 보정 ×1.15

### 7. 표면거칠기 Ra (이론값)

`Ra ≈ fz² / (8·R) · 1000` [μm]
- R = 날끝 반경
  - Square: 약 0.04 mm (edge hone)
  - Ball: D/2
  - Radius: CR
- ae/D < 0.5 시 chip thinning 효과로 ×0.8
- Climb 시 추가 ×0.8

### 8. 단위 변환

| 변환 | 공식 |
|---|---|
| Vc ↔ SFM | `SFM = Vc · 3.28084` |
| Vf ↔ IPM | `IPM = Vf / 25.4` |
| kW ↔ HP | `HP = kW · 1.34102` |
| N·m ↔ in·lb | `in·lb = N·m · 8.85075` |
| mm ↔ inch | `inch = mm / 25.4` |

### 9. Chatter Risk 휴리스틱 (rule-based)

누적 위험도 (0~100):
- L/D > 6 → +40, > 4 → +20
- Pc > 85% 스핀들 → +20
- Workholding < 50 → +25, < 70 → +10
- 편향 > 30 μm → +20

**레벨**: ≥55 HIGH, ≥30 MED, < 30 LOW

### 10. 상관관계 자동 derate

**경도 → Vc derate**:
| HRC | ×Vc |
|---|---|
| ≤ 30 | 1.00 |
| 30~40 | 0.95 |
| 40~50 | 0.85 |
| 50~55 | 0.72 |
| 55~60 | 0.58 |
| 60~65 | 0.45 |
| > 65 | 0.35 |

**Stickout (L/D) → Vc·fz derate**:
| L/D | ×Vc | ×fz |
|---|---|---|
| ≤ 3 | 1.00 | 1.00 |
| ≤ 4 | 0.95 | 0.90 |
| ≤ 5 | 0.85 | 0.80 |
| ≤ 6 | 0.75 | 0.70 |
| ≤ 8 | 0.60 | 0.55 |
| > 8 | 0.45 | 0.40 |

**Workholding (s=0~1) → ap/ae 상한**:
- `ap_max = D·(0.5 + s·1.5)`
- `ae_max = D·(0.3 + s·0.7)`

**Climb milling 효과**: Ra ×0.8 · Fc ×0.9 · Life ×1.15

### 11. Economic Cutting Speed (Taylor-Ackoff)

**최저 원가 Vc**:
`V_econ = V_ref · (C_machine_per_min / ((1/n − 1) · C_tool))^n`
- C_machine = 머신 시간당 원가 / 60 [원/분]
- C_tool = 공구 단가 [원]
- n = Taylor 지수
- 수명↔속도 trade-off에서 총원가 최저점

### 12. 단가 분석

`파트당 공구비 = C_tool / (T_life / cycle_time)`
`파트당 머신비 = (C_machine / 60) · cycle_time`
`총 파트당 원가 = 공구비 + 머신비`
