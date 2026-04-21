# Harvey Machining Advisor Pro (MAP) 완벽 사용 가이드

> [web] **접속**: `map.harveyperformance.com` · 무료 · 계정 필요 없음 (브라우저 즉시)
> **개발사**: Harvey Performance Company (USA, Massachusetts)
> 산하 브랜드: **Harvey Tool, Helical Solutions, Titan USA, Micro 100, Valorkut, Internal Tool**
> **목적**: 공구·재료·머신 조건 입력 → 최적 절삭 조건 자동 추천

## 목차
1. MAP은 무엇인가 (배경·철학)
2. 전체 화면 구조
3. 카드별 초상세 설명 (6개 카드)
4. 필드 하나하나 — 무엇을 입력?
5. Material · Hardness 완벽 선택 가이드
6. Workholding Security 완전 해부 (시그니처 기능)
7. Speed/Feed ±20% 튜너 활용법
8. ADOC/RDOC Adjuster 사용법
9. 단계별 워크플로우 (초심자→숙련자)
10. 실전 시나리오 5가지 + 숫자
11. Corner Adjustment 이해
12. PDF 출력·저장
13. 한계 / 못 하는 것
14. 자주 묻는 질문 (FAQ)
15. 체크리스트 & 용어 사전

## 1. MAP은 무엇인가

### 1.1 역사 · 배경
- Harvey Performance Company는 미국에서 **초정밀 엔드밀**로 유명한 회사 (1990년 설립)
- Harvey Tool (미세·정밀 엔드밀), Helical Solutions (범용 고성능 엔드밀) 등 **자사 브랜드 ~수만 종** 보유
- **MAP**은 이 공구들의 **추천 절삭 조건을 자동 산출**해주는 무료 웹 애플리케이션
- 2015년경 출시, 현재 최신 UI는 2022년 리뉴얼

### 1.2 철학
Harvey가 말하는 MAP의 3대 원칙:
1. **"No Guesswork"** — 추정 금지, 공구·재료·머신 전부 DB 기반
2. **"Real Workholding Matters"** — 현장 고정구 강성을 조건에 반영
3. **"Tune to Your Priority"** — 생산성 vs 공구수명을 유저가 선택

### 1.3 경쟁 툴과의 차이
| 경쟁사 | 비교 |
|---|---|
| **Sandvik CoroGuide** | 범용 · 제조사 중립 · 더 많은 재질 |
| **Kennametal NOVO** | 자사공구 · MAP과 가장 유사 철학 |
| **MachiningCloud** | 여러 제조사 통합 · 무료 가입 |
| **FSWizard (모바일 앱)** | 개인 개발 · 간편하지만 정교함 ↓ |
| **YG-1 SpeedLab** | 공구 필터 검색 중심 · 계산 기능은 약함 |

Harvey MAP이 **완성도 면에서 최고 평가**를 받는 이유는 Workholding slider + Speed/Feed ±% 슬라이더 조합.

## 2. 전체 화면 구조

### 2.1 URL 진입 후 첫 화면

```
┌──────────────────────────────────────────────────────────────┐
│ [MACHINING ADVISOR PRO 로고]           [[Account]] [[?]] [↻] [←]    │ ← 헤더 바
├──────────────┬──────────────┬──────────────┬────────────────┤
│   TOOL       │  MATERIAL    │  OPERATION   │   MACHINE      │
│   (비어있음) │  (비어있음)  │  (비어있음)  │  (비어있음)    │
│              │              │              │                │
└──────────────┴──────────────┴──────────────┴────────────────┘
┌──────────────────────────────┬──────────────────────────────┐
│        PARAMETERS            │       RECOMMENDATIONS        │
│  (비활성 — 입력 전)          │  (비활성 — 입력 전)          │
└──────────────────────────────┴──────────────────────────────┘
```

### 2.2 헤더 바 아이콘 설명

| 아이콘 | 이름 | 기능 |
|---|---|---|
| [Account] | Account | 로그인 (선택 — 세션 저장용) |
| [?] | Help | 튜토리얼 · FAQ 링크 |
| ↻ | Reset All | 전체 초기화 |
| ← | Logout | 계정 사용 시 로그아웃 |

### 2.3 상단 4카드 + 하단 2카드

**상단 (입력 4카드)**: 왼쪽에서 오른쪽으로 **순서대로 채워야** 함 (의존성 있음)

**하단 (계산 2카드)**:
- **PARAMETERS**: 상단이 다 채워지면 활성화 — 세부 파라미터 조정
- **RECOMMENDATIONS**: 최종 결과 · ±% 튜닝 · PDF 출력

## 3. 카드별 초상세 설명

### 3.1 TOOL 카드

```
┌────────────────────────────┐
│   TOOL                  [?] │
│                            │
│   Tool #                   │
│   ┌──────────────────┐     │
│   │ (입력)           │  ▼  │
│   └──────────────────┘     │
│                            │
│   ┌──────────────────┐     │
│   │  Tool details    │     │
│   │                  │     │
│   │  (공구 스펙 자동)│     │
│   │                  │     │
│   └──────────────────┘     │
└────────────────────────────┘
```

**"Tool #" 필드** — Harvey 공구 번호 입력
- Harvey Tool / Helical Solutions 카탈로그 번호 (예: `EMB100S3`, `H45ALC-C-030`)
- 입력하면 드롭다운 자동완성
- Tool details 박스에 즉시 다음 정보 자동 로드:
  - **Cutter Diameter (D)** — 절삭직경
  - **Length of Cut (LOC)** — 절삭날 길이
  - **Overall Length (OAL)** — 전장
  - **Shank Diameter** — 섕크 직경
  - **Number of Flutes (Z)** — 날수
  - **Helix Angle** — 나선각 (예: 35°, 45° variable)
  - **Coating** — 코팅 (AlTiN Nano, TiB2, Uncoated 등)
  - **Tool Material** — 카바이드 grade (HTC 10% Co 등)

**중요**: 공구 번호를 모르면 진행 불가. Harvey 홈페이지에서 찾거나, 다른 제조사 공구면 MAP 사용 불가.

### 3.2 MATERIAL 카드 (가장 정교)

```
┌────────────────────────────┐
│   MATERIAL             [?]  │
│                            │
│   Material                 │
│   ┌──────────────────┐▼    │
│   │ Aluminum Alloy,  │     │
│   │       Cast       │     │
│   └──────────────────┘     │
│                            │
│   Subgroup                 │
│   ┌──────────────────┐▼    │
│   │ 380 — Silicon-   │     │
│   │ copper series    │     │
│   └──────────────────┘     │
│                            │
│   Condition                │
│   ┌──────────────────┐▼    │
│   │ F                │     │
│   └──────────────────┘     │
│                            │
│   ┌────┬────┬────┬────┐    │
│   │HBW │HBS │HRB │HRC │    │
│   │ 0  │ 80 │ 40 │ 0  │    │
│   └────┴────┴────┴────┘    │
│                            │
│                 [RESET]    │
└────────────────────────────┘
```

#### Material 드롭다운 — 주요 카테고리 (Harvey 기준)
1. **Aluminum Alloy, Cast** — 주조 알루미늄
2. **Aluminum Alloy, Wrought** — 가공용 알루미늄 (압연·단조)
3. **Brass & Bronze**
4. **Cast Iron**
5. **Copper & Copper Alloys**
6. **Graphite**
7. **Hard Steel (42-65 HRC)**
8. **High Temperature Alloy** (Inconel, Hastelloy)
9. **Medium Carbon Steel**
10. **Plastic**
11. **Stainless Steel (300/400 Series)**
12. **Steel (Pre-Hardened)**
13. **Titanium Alloy**
14. **Tool Steel**

각 카테고리마다 **Subgroup** (세부 재질 5~30종)과 **Condition** (열처리 상태 2~6종)이 달라짐.

#### Subgroup 예시 (Aluminum Alloy, Cast)

| Subgroup | 주요 합금 | 용도 |
|---|---|---|
| 319 — Silicon-copper | Si 6%, Cu 3.5% | 자동차 실린더 헤드 |
| **380 — Silicon-copper series** | Si 8-9%, Cu 3-4% | **다이캐스팅 표준** |
| 356 — Silicon-magnesium | Si 7%, Mg 0.3% | 항공, 사이클 휠 |
| 413 — Silicon eutectic | Si 12% | 고정밀 다이캐스팅 |

#### Condition 옵션 (Aluminum Cast)

| Condition | 의미 | 경도 변화 |
|---|---|---|
| **F** | As-Fabricated (주조 상태) | HBW 60-80 |
| **T5** | 시효경화 부분 | HBW 90-110 |
| **T6** | 완전 시효경화 | HBW 100-130 |
| **O** | Annealed 연화 | HBW 30-50 |

#### 경도 4스케일 (HBW / HBS / HRB / HRC)

Harvey는 **4개 스케일을 동시 표시**하고, 하나를 수정하면 나머지 자동 변환.

```
┌────┬────┬────┬────┐
│HBW │HBS │HRB │HRC │
│150 │150 │80  │(0) │  ← 탄소강 200 HBW 입력 시
└────┴────┴────┴────┘
```

**어떤 스케일을 쓸지**:
- **HBW** (Brinell, Wolfram 압자): 연질 금속 (Al, 황동, 주철 등) 표준
- **HBS** (Brinell, Steel ball): HBW와 거의 동일 (구분 희박)
- **HRB** (Rockwell B, 강구): 중경도 (50-100 HRB) — 연강, 황동, 동
- **HRC** (Rockwell C, 다이아몬드 원뿔): 고경도 (20-68 HRC) — 열처리강, 공구강

**자동 변환 (Harvey 내부 공식, 탄소강 기준)**:
- HBW 200 ≈ HRC 11
- HBW 300 ≈ HRC 30
- HBW 400 ≈ HRC 42
- HRC 60 ≈ HBW 650

### 3.3 OPERATION 카드

```
┌────────────────────────────┐
│   OPERATION             [?] │
│                            │
│   Type                     │
│   ┌──────────────────┐▼    │
│   │ (선택)           │     │
│   └──────────────────┘     │
│                            │
│   Tool Path                │
│   ┌──────────────────┐▼    │
│   │ (선택)           │     │
│   └──────────────────┘     │
│                            │
│   ┌──────────┐ ┌────────┐  │
│   │  공구    │ │ Tool   │  │
│   │  그림    │ │ Path   │  │
│   │          │ │ Info   │  │
│   └──────────┘ └────────┘  │
└────────────────────────────┘
```

#### Type 드롭다운 옵션
- **Milling** — 엔드밀 가공 (대부분 선택)
- **Drilling** — 드릴링 (Harvey 일부 드릴 지원)
- **Threading** — 탭/나사가공
- **Reaming** — 리밍

> ※ 엔드밀 시뮬레이션은 **Milling** 선택.

#### Tool Path 드롭다운 옵션 (Type=Milling 기준)

| Tool Path | 의미 | 언제 씀 |
|---|---|---|
| **Slotting** | 전폭 가공 (ae = D) | 홈 파기, 포켓 초기 |
| **Side Milling** | 측면 가공 (ae < D) | 벽면 다듬기, 일반 |
| **Profiling** | 윤곽 가공 (얕은 ae) | 외형 다듬기 |
| **Pocketing** | 포켓 내부 가공 | 사각/원형 포켓 |
| **Adaptive (Dynamic)** | 적응형 가공 | MasterCam 스타일 |
| **HEM (High Efficiency)** | 고효율 가공 | 얕은 ae + 깊은 ap |
| **Trochoidal** | 트로코이달 | 하드재 슬롯, 공구수명 최우선 |
| **Plunge** | 플런징 (수직 관통) | 포켓 초기 진입 |
| **Peel** | 필링 (나선형) | 깊은 벽 가공 |
| **Ramping** | 경사 진입 | 3~15° 각도 하강 |

**Tool Path Info 박스**: 선택한 경로의 **시각 그림**과 설명 텍스트를 보여줌.

### 3.4 MACHINE 카드

```
┌────────────────────────────┐
│   MACHINE               [?] │
│                            │
│   Spindle                  │
│   ┌──────────────────┐▼    │
│   │                  │     │
│   └──────────────────┘     │
│                            │
│   Holder                   │
│   ┌──────────────────┐▼    │
│   │                  │     │
│   └──────────────────┘     │
│                            │
│   MAX RPM    MAX IPM       │
│   [______]   [______]      │
│                            │
│   ┌─ WORKHOLDING ────────┐ │
│   │     SECURITY         │ │
│   │                      │ │
│   │  LOOSE ===●=== RIGID │ │
│   │                      │ │
│   │       [RESET]        │ │
│   └──────────────────────┘ │
└────────────────────────────┘
```

#### Spindle 드롭다운 (주요)

| Option | 실제 의미 |
|---|---|
| **BT30** | 일본 소형 머신 (15~20K RPM) |
| **BT40** | 일본 표준 VMC (8~12K RPM) |
| **BT50** | 대형 머신 (6~8K RPM) |
| **CAT40** | 미국 표준 (8~12K RPM) |
| **CAT50** | 미국 대형 |
| **HSK63A** | 독일 HSM (20~40K RPM) |
| **HSK50E** | 고속 (30~50K RPM) |
| **HSK40E** | 미세가공 (60K+ RPM) |

#### Holder 드롭다운 (강성 순)

| Holder | Rigidity | 설명 |
|---|---|---|
| **ER Collet** | 중간 (55%) | 가장 범용 · 저렴 · 조립쉬움 |
| **Weldon Side-Lock** | 중상 (70%) | 핀셋으로 꽉 조임 · 큰 토크 |
| **End Mill Holder** | 중상 (65%) | 측면 나사 고정 |
| **Hydraulic Chuck** | 상 (80%) | 유압으로 균일 조임 |
| **Shrink Fit** | 매우 상 (85%) | 열박음 · 최고정밀 |
| **Milling Chuck / Power Chuck** | 최상 (90%) | 중가공 특화 |

> ※ **Holder가 중요한 이유**: 같은 공구·조건이라도 홀더 강성에 따라 공구 편향 20~40% 차이. Harvey는 이를 보정.

#### MAX RPM / MAX IPM

- **MAX RPM**: 스핀들이 낼 수 있는 최대 회전수 (분당)
- **MAX IPM**: X·Y·Z축이 낼 수 있는 최대 이송속도 (inch per minute)

**예시 값**:
- 범용 VMC: 12,000 RPM / 400 IPM
- 고속 VMC: 20,000 / 787
- HSM: 30,000 / 1180
- 흑연전용: 40,000 / 1575

입력한 값을 **실제 추천 조건이 초과하면 자동 하향** (머신 한계 보호).

### 3.5 WORKHOLDING SECURITY 슬라이더 ★ Harvey 시그니처

**이것이 Harvey MAP을 경쟁사와 차별화하는 유일한 한 가지**. 현장 엔지니어의 실전 지식을 UI에 반영.

```
  LOOSE ===============●======= RIGID
    0%     25%    50%    75%    100%
```

#### 슬라이더 값의 의미 (현장 체감 기준)

| Slider | 현장 상황 | 허용되는 조건 |
|---|---|---|
| **0% (매우 Loose)** | • 공구 짧게 물림 (15mm+)<br>• 일감을 손으로 잡는 상황 | 가장 보수적 — Vc 60%, ap 30% 수준 |
| **25%** | • 범용 바이스에 헐거움<br>• 일감에 지그 없음 | 보수적 |
| **50% (중간)** | • 표준 바이스 · 토크 정상<br>• 얕은 턱 받침 | 표준 |
| **75%** | • 전용 고정구<br>• 4면 바이스 · 측면 고정 | 적극적 |
| **100% (Rigid)** | • 일체형 클램프<br>• 스톱 플레이트로 움직임 제한<br>• 두꺼운 주조재 바닥 | 가장 적극적 — 최대 조건 |

#### 슬라이더가 영향 주는 것

1. **추천 ap 상한** — Loose일수록 얕게
2. **추천 ae 상한** — Loose일수록 좁게
3. **Vf 상한** — 이송속도 제한
4. **편향 허용치** — Rigid일수록 편향 더 허용
5. **HEM/Trochoidal 권장** — Rigid에서만 HEM 권장

#### 실무 팁
- **초심자는 50% 부터 시작**
- **프로토타입 처음이면 25% 로 보수적**
- **양산 안정화됐으면 75% 까지 올리기**
- **100%는 특수 고정구 없으면 비현실적**

### 3.6 PARAMETERS 카드

```
┌──────────────────────────────────────┐
│   PARAMETERS                      [?] │
│                                      │
│   Stick Outs        [__15__] (100%)  │  ← mm + % of LOC
│                                      │
│   [lock] Radial Depth   [__0.4_] (40%_)  │  ← mm + % of D
│                                      │
│   [lock] Axial Depth    [__10_] (100%)   │  ← mm + % of D
│                                      │
│   Engagement Angle    53°            │  ← 자동 계산
│                                      │
│   ┌─────────┐   ┌──────────────┐     │
│   │ SELECTED│   │ ADOC/RDOC    │     │
│   │  TOOL   │   │  ADJUSTER    │     │
│   │         │   │              │     │
│   │  ──┬──  │   │  0%──────╥   │     │
│   │    │    │   │          ║   │     │
│   │    │    │   │  (수직   ║   │     │
│   │    │    │   │  슬라이더)║   │     │
│   │    │    │   │         100%  │     │
│   └─────────┘   └──────────────┘     │
│                                      │
│   ┌ TOOL ENGAGEMENT ANGLE ┐          │
│   │        ●---            │          │
│   │       (원형 그래픽)    │          │
│   └─────────────────────────┘          │
└──────────────────────────────────────┘
```

#### Stick Outs (공구 돌출)
- 홀더 밖으로 나온 공구 길이 (mm / inch)
- **% 는 LOC 대비** (100% = LOC 전체가 돌출)
- 보통 `LOC + 2~5mm` 수준이 최소

#### Radial Depth (ae)
- 공구 옆으로 깎는 폭
- **% 는 D 대비** (100% = 슬로팅)
- **[lock] LOCK 토글**: ap 바꿀 때 ae를 고정시켜 연동 방지

#### Axial Depth (ap)
- 공구 축방향 파고드는 깊이
- **% 는 D 대비** (100% = 1×D)
- **[lock] LOCK 토글**

#### Engagement Angle
`θ = arccos(1 − 2·ae/D)` 자동 계산.
- ae=0.4D → θ=53°
- ae=1.0D (slot) → θ=180°

#### SELECTED TOOL (공구 실루엣)
- TOOL 카드에서 선택한 공구의 실제 프로필 그림
- D, LOC, OAL 비율 반영
- Ball/Square/R/Chamfer 팁 구분

#### ADOC/RDOC ADJUSTER ★ Harvey 시그니처
수직 슬라이더로 % 기반 동시 조절:
- **Top = 0%** (얕은 가공)
- **Bottom = 100%** (깊은 가공)
- 드래그하면 ap·ae 조합이 사전정의 맵에 따라 움직임
- HEM 모드, Trochoidal 모드별로 맵이 다름

#### TOOL ENGAGEMENT ANGLE (원형 차트)
- 원주 = 공구 단면
- 파란 호 = 엔게이지먼트 각도
- 시각적으로 "공구가 얼마나 박혀있는지" 확인

### 3.7 RECOMMENDATIONS 카드

```
┌────────────────────────────────────────────────┐
│   RECOMMENDATIONS               [PDF] PDF     [?]  │
│                                                │
│   Surface Speed  ─────  350   m/min (1148 SFM)│
│   Speed          ─────  11,140 RPM             │
│                                                │
│   Feed per tooth ─────  0.0030 in (0.076 mm)   │
│   Feed per minute ────  200  IPM               │
│   MRR            ─────  32  in³/min            │
│                                                │
│   Chip Thickness ─────  0.0024 in (0.061 mm)   │
│                                                │
│   ┌─────────┐   ┌─────────┐                    │
│   │  SPEED  │   │  FEED   │                    │
│   │  100%   │   │  100%   │                    │
│   │   ●     │   │   ●     │                    │
│   │         │   │         │                    │
│   │ +20%    │   │ +20%    │                    │
│   │ +15%    │   │ +15%    │                    │
│   │ +10%    │   │ +10%    │                    │
│   │ +5%     │   │ +5%     │                    │
│   │ 0% ●    │   │ 0% ●    │                    │
│   │ -5%     │   │ -5%     │                    │
│   │ -10%    │   │ -10%    │                    │
│   │ -15%    │   │ -15%    │                    │
│   │ -20%    │   │ -20%    │                    │
│   │         │   │         │                    │
│   │Increased│   │Less     │                    │
│   │Tool Life│   │Deflection                    │
│   └─────────┘   └─────────┘                    │
│                                                │
│   [RESET]              [RESET]                 │
│                                                │
│   ┌ CORNER ADJUSTMENT ────────────────────┐    │
│   │                                       │    │
│   │  Corner adjustment applies to         │    │
│   │  High Efficiency Milling and          │    │
│   │  Finishing.  (Reference Only)         │    │
│   │                                       │    │
│   └───────────────────────────────────────┘    │
└────────────────────────────────────────────────┘
```

#### 출력 필드들

| 필드 | 단위 | 의미 |
|---|---|---|
| **Surface Speed** | m/min 또는 SFM | = Vc · `n·π·D·10⁻³` |
| **Speed** | RPM | 스핀들 회전수 |
| **Feed per tooth** | in (mm) | = fz |
| **Feed per minute** | IPM (mm/min) | = Vf |
| **MRR** | in³/min (cm³/min) | 금속제거율 |
| **Chip Thickness** | in (mm) | 실 chip 두께 (RCTF 반영) |

#### SPEED 슬라이더 (세로, 100% 중심)
- 100% = 카탈로그 추천
- **+%** → Increased Production (생산성↑, 수명↓)
- **-%** → Increased Tool Life (수명↑, 생산성↓)

#### FEED 슬라이더 (세로, 100% 중심)
- **+%** → Increased Production (생산성↑, 편향↑)
- **-%** → Less Tool Deflection (편향↓, 마감품질↑)

두 슬라이더는 독립. **Speed +10% + Feed -5%** 같은 조합 가능.

## 4. 필드 하나하나 — 무엇을 입력?

### 4.1 입력 순서 (순차적으로 채워야 됨)

```
TOOL → MATERIAL → OPERATION → MACHINE → PARAMETERS 자동활성
```

**왜 순서?** TOOL이 안 정해지면 Harvey가 어떤 공구 스펙을 쓸지 모름. MATERIAL이 없으면 Vc 추천 못 함.

### 4.2 각 필드별 "뭘 넣어야?" 컨닝페이퍼

| 카드 | 필드 | 값 고르는 법 |
|---|---|---|
| TOOL | Tool # | Harvey 카탈로그에서 공구 번호 찾아 입력. 모르면 여기서 멈춤. |
| MATERIAL | Material | 재질 대분류 (Al / Steel / Stainless / Cast Iron / ...) |
| MATERIAL | Subgroup | 세부 합금 (예: 6061-T6, SUS304) |
| MATERIAL | Condition | 열처리 상태 (F/T6/Annealed/Hardened) |
| MATERIAL | Hardness (HBW/HRC) | 재료시험 값. 모르면 **재질별 표준값** 자동 |
| OPERATION | Type | 거의 대부분 "Milling" |
| OPERATION | Tool Path | 가공 방식 (Slotting / Side / Pocket / HEM 등) |
| MACHINE | Spindle | 머신 스핀들 타입 (BT40/HSK63 등) |
| MACHINE | Holder | 홀더 종류 |
| MACHINE | MAX RPM | 머신 스펙시트의 최대 회전수 |
| MACHINE | MAX IPM | 머신 스펙시트의 최대 이송 |
| MACHINE | Workholding | 현장 판단 — Loose ↔ Rigid |
| PARAMETERS | Stick Out | 공구 돌출 (홀더 바깥쪽 길이) |
| PARAMETERS | Radial Depth | ae (옆으로 깎는 폭) |
| PARAMETERS | Axial Depth | ap (축방향 깊이) |

### 4.3 "모르는 값"은 이렇게

| 모르는 값 | 대안 |
|---|---|
| 재료 Hardness | Subgroup+Condition 고르면 Harvey 기본값 자동 |
| Spindle type | 커스텀 MAX RPM만 수동 입력 |
| Workholding | **50% (중간)**으로 시작 |
| Stick Out | LOC + 5mm (최소) 권장 |
| ae/ap | Harvey 기본값 사용 (Side: 40%/100%, Slot: 100%/25%) |

## 5. Material · Hardness 완벽 선택 가이드

### 5.1 Material 선택 플로우차트

```
어떤 재료? 
├─ 알루미늄? 
│   ├─ 주물 ──→ Aluminum Alloy, Cast
│   │   └─ 380 Silicon-copper (일반 다이캐스팅)
│   │   └─ 356 Silicon-magnesium (항공)
│   └─ 가공용 ──→ Aluminum Alloy, Wrought
│       ├─ 6061 (범용)
│       ├─ 7075 (고강도)
│       ├─ 2024 (항공)
│       └─ 5083 (해양)
│
├─ 강철?
│   ├─ 탄소강 (0.3~0.6%) ──→ Medium Carbon Steel
│   │   └─ 1045, S45C, 4140
│   ├─ 공구강 ──→ Tool Steel
│   │   └─ D2, SKD11, O1, A2
│   ├─ 프리하든 ──→ Steel, Pre-Hardened
│   │   └─ P20, 1.2738 (30~40 HRC)
│   └─ 경화 ──→ Hard Steel (42-65 HRC)
│       └─ 54~60 HRC 공구강, 베어링강
│
├─ 스테인리스?
│   └─ Stainless Steel
│       ├─ 300 Series (304/316 — 오스테나이트)
│       ├─ 400 Series (420/440 — 마르텐사이트)
│       └─ Duplex (2205/2507)
│
├─ 주철? ──→ Cast Iron
│   ├─ Gray (GC200/FC250)
│   ├─ Ductile (FCD450)
│   └─ Malleable
│
├─ 티타늄? ──→ Titanium Alloy
│   ├─ Ti-6Al-4V (표준)
│   └─ Ti-6242S (고온)
│
├─ 내열합금? ──→ High Temperature Alloy
│   ├─ Inconel 718 (가장 흔함)
│   ├─ Inconel 625
│   ├─ Hastelloy
│   └─ Waspaloy
│
└─ 플라스틱/흑연? ──→ Plastic 또는 Graphite
```

### 5.2 Hardness 입력 기준

**재질 선택하면 기본값이 자동 채워짐**. 재료시험 값 있으면 수동 수정.

| 재료 | 기본 Hardness |
|---|---|
| Al 6061-T6 | **HBW 95** |
| S45C Normalized | HBW 180 |
| SUS304 | HBW 185 |
| FC250 | HBW 210 |
| P20 (prehard) | **HRC 32** |
| D2 Annealed | HBW 220 |
| D2 Hardened | **HRC 58** |
| Inconel 718 | **HRC 36** |
| Ti-6Al-4V | **HRC 32** |

### 5.3 Condition 선택 요령

| Condition | 언제 |
|---|---|
| **F** (As-Fabricated) | 주조·단조 직후 상태 |
| **Annealed** | 풀림 (가장 연함) |
| **Normalized** | 불림 (표준) |
| **T6** (Al) | 완전 시효경화 |
| **T4** (Al) | 자연시효 |
| **Q&T** (강) | 담금질 후 뜨임 |
| **Hardened** | 담금질 후 |

## 6. Workholding Security 완전 해부

### 6.1 슬라이더 표시값

Harvey는 0~100% 연속값이지만, **현장 체크리스트로 보면**:

```
  0%   ──── Soft jaws, hand holding, tape
  10%  ──── Simple vise, light toothing
  25%  ──── Standard vise, medium torque
  40%  ──── Standard vise + stop, full toothing
  50%  ──── Full vise + parallel rails
  60%  ──── Vise + dedicated jaw
  75%  ──── Dedicated fixture, 3+ clamps
  90%  ──── Monolithic clamping, stops
  100% ──── Integrated fixture, zero movement
```

### 6.2 어떻게 평가?

**체크리스트 — 해당하는 항목 점수 합산**

| 체크 항목 | +점 |
|---|---|
| 일감이 바이스에 완전히 들어감? | +15 |
| 바이스에 토크 렌치로 제대로? | +15 |
| 일감 아래 쿠션(나무/고무) 없음? | +10 |
| 밀어올리는 힘 방향에 스톱 있음? | +10 |
| 일감 높이 ≤ 바이스 jaw 높이? | +10 |
| 전용 지그 사용? | +20 |
| 4면 or 다중 클램프? | +10 |
| 얇은 판재 (0.5×D 두께 미만)? | **-20** |
| 긴 돌출 일감 (> 2×바이스 폭)? | **-15** |

점수를 그대로 workholding % 로.

### 6.3 슬라이더가 실제로 영향 주는 값 (Harvey 내부 derate)

**50% → 75% 이동 시** 변화 (Al 6061, ⌀10mm 4날, Side milling 기준):

| 필드 | 50% (Medium) | 75% (Firm) | 차이 |
|---|---|---|---|
| ap (추천) | 10.0 mm | 15.0 mm | +50% |
| ae (추천) | 4.0 mm | 6.0 mm | +50% |
| Vf | 800 mm/min | 1100 mm/min | +37% |
| MRR | 32 cm³/min | 66 cm³/min | **+106%** |
| Tool Deflection | 15 μm | 15 μm | 0 (허용치 조정) |

**핵심**: Workholding 올리면 MRR 두배도 가능. 단 공구 편향은 동일하게 유지.

## 7. Speed/Feed ±20% 튜너 활용법

### 7.1 기본 사용 패턴

```
SPEED ±%    FEED ±%       상황
────────   ────────      ──────────────────────────
0          0             표준 (카탈로그 그대로)
+10        +5            양산 최적화 (수명 여유 있을 때)
-10        -10           프로토타입, 안정 우선
+20        0             시간 급함, 공구 여유분 있음
0          -15           표면품질 우선, 마감 가공
-15        +10           Trochoidal 전략 (얕게 빠르게)
```

### 7.2 Speed 튜너 상세 (공구수명 vs 생산성)

Taylor 방정식에 의해 **Vc 10% 올리면 수명 ~40% 감소**:

| SPEED % | Vc 변화 | 수명 변화 (상대) | 적정 상황 |
|---|---|---|---|
| +20% | +20% | **×0.4 (60% 단축)** | 급한 일, 공구 재고 많음 |
| +10% | +10% | ×0.62 | 양산 약간 압축 |
| 0% | 표준 | 1.0 | 정석 |
| -10% | -10% | ×1.62 | 수명 50% 추가 |
| -20% | -20% | **×2.63 (2.6배)** | 공구 재고 부족, 원가 절감 |

### 7.3 Feed 튜너 상세 (편향 vs 생산성)

fz 올리면 공구에 걸리는 힘↑ → 편향↑ → 정밀도↓:

| FEED % | fz 변화 | 편향 변화 | 적정 상황 |
|---|---|---|---|
| +20% | +20% | +24% | 거친 가공, 형상공차 큰 |
| +10% | +10% | +11% | 양산 가속 |
| 0% | 표준 | 0 | 정석 |
| -10% | -10% | -9% | 마감, 정밀 가공 |
| -20% | -20% | -17% | 초정밀 (±5μm) |

### 7.4 실전 조합 예시 (⌀10 4날 Al6061 Side milling)

| SPEED | FEED | 결과 Vc | 결과 fz | MRR | 예상 수명 | 편향 |
|---|---|---|---|---|---|---|
| 0 | 0 | 350 m/min | 0.076 mm | 32 cm³/min | 45 min | 15 μm |
| +10 | 0 | 385 | 0.076 | 35 | 28 min | 15 |
| +10 | +10 | 385 | 0.084 | 39 | 28 min | 17 |
| +20 | +20 | 420 | 0.091 | 46 | 18 min | 19 |
| -10 | -10 | 315 | 0.068 | 26 | 73 min | 13 |

## 8. ADOC/RDOC Adjuster 사용법

### 8.1 수직 슬라이더 원리

```
0%  ──────── Top (얕은 가공)
   │
   │  ← 여기로 올리면 ae↑ap↑ 동시에 증가
   │
   ●  ← 현재 위치 (예: 50%)
   │
   │
100% ──────── Bottom (깊은 HEM)
```

### 8.2 % 위치별 ap/ae 자동 매핑 (Harvey 내부)

Side milling / ⌀10mm 공구 기준:

| 슬라이더 % | ap (mm) | ae (mm) | ap/D | ae/D | 전략 |
|---|---|---|---|---|---|
| 0% | 2.0 | 2.0 | 0.2 | 0.2 | 얕은 마감 |
| 25% | 5.0 | 3.0 | 0.5 | 0.3 | 표준 Side |
| 50% | 10.0 | 4.0 | 1.0 | 0.4 | 표준 |
| 75% | 15.0 | 3.0 | 1.5 | 0.3 | HEM 진입 |
| 100% | 20.0 | 0.8 | **2.0** | **0.08** | **풀 HEM** |

바닥으로 갈수록 **ae 줄고 ap 늘어나는** 게 HEM의 핵심.

### 8.3 HEM vs 전통 Side milling (같은 공구·소재)

**Al6061, ⌀10mm 4날, Helical H45ALC-C-030**:

| 항목 | 전통 Side (50%) | HEM (100%) | HEM 이득 |
|---|---|---|---|
| ap | 10mm | 20mm | **2×** |
| ae | 4mm | 0.8mm | 1/5 |
| Vf | 800 mm/min | **3,200 mm/min** | **4×** |
| MRR | 32 | **51** | **+60%** |
| 예상 수명 | 45 min | **120 min** | **2.7×** |
| 표면 | 중 | 중상 | ↑ |

**"HEM은 빠르면서 공구도 오래 씀"** — Harvey가 강력히 밀어주는 전략.

## 9. 단계별 워크플로우

### 9.1 초심자 워크플로우 (처음 써보는 경우)

```
STEP 1. 공구 번호 찾기 (Harvey 카탈로그 or 상자)
         ↓
STEP 2. TOOL 카드에 번호 입력 → Tool details 자동채워짐 확인
         ↓
STEP 3. MATERIAL 카드 → 재료 대분류부터 → Subgroup → Condition
         ↓
STEP 4. OPERATION → "Milling" 선택 → Tool Path는 "Side Milling" 기본
         ↓
STEP 5. MACHINE → 머신 스펙시트 보고 채우기
         ↓
STEP 6. Workholding → **50% (중간)로 시작**
         ↓
STEP 7. PARAMETERS → Stick Out만 입력 (나머지는 Harvey 기본값)
         ↓
STEP 8. RECOMMENDATIONS 확인 → 그대로 프로그램에 투입
         ↓
STEP 9. 실가공 → 괜찮으면 다음 번엔 Workholding 60%로 시도
```

### 9.2 숙련자 워크플로우

```
STEP 1. 공구 넣고 재료 넣고 빠르게 정의
STEP 2. Tool Path를 "HEM" 또는 "Adaptive"로 공격적 선택
STEP 3. ADOC/RDOC Adjuster를 75~85%로 깊이 가공
STEP 4. SPEED +5 / FEED 0 로 생산성 약간 올리기
STEP 5. 결과 확인 → 수명 60분 이상이면 OK
STEP 6. PDF 출력해서 양산 표준으로 등록
```

### 9.3 "왜 Harvey가 조건을 덜 공격적으로 뽑을까?" 해결

Harvey는 **보수적 추천**. 더 공격적으로 가려면:
1. **Workholding 슬라이더 올리기** (가장 큰 효과)
2. **Tool Path를 HEM 또는 Adaptive로 변경**
3. **ADOC/RDOC Adjuster 80%+ 로 설정**
4. **SPEED +10 / FEED +10**

이 조합이면 **Harvey 기본값 대비 MRR 3~4배** 가능.

## 10. 실전 시나리오 5가지 + 숫자

### 시나리오 A: Al6061-T6 고속측면 (항공·반도체 부품)

**입력**:
- TOOL: Helical `HEV-C-3-0375`  (⌀9.525mm, 3날, LOC 28.6mm)
- MATERIAL: Aluminum Alloy, Wrought → 6061-T6 → **HBW 95**
- OPERATION: Milling → **Side Milling**
- MACHINE: BT40, Shrink Fit Holder, 12000 RPM / 400 IPM
- Workholding: **75%** (전용 지그)
- Stick Out: 25mm (LOC+minor)
- ap: 9.525mm (100%), ae: 3.8mm (40%)

**Harvey 출력**:
| 항목 | 값 |
|---|---|
| Surface Speed | **475 m/min** (1558 SFM) |
| RPM | **15,873** → 한계로 clamp **12,000** |
| Vc (실효) | 359 m/min |
| fz | 0.098 mm |
| Vf (IPM) | 138 IPM (3,513 mm/min) |
| MRR | **127 cm³/min** |
| Chip Thickness | 0.062 mm |

**판단**: MRR 127은 매우 높음 → 실무 적용 가능.

### 시나리오 B: SUS316L 깊은 슬롯

**입력**:
- TOOL: Harvey `EMB40C-C-0750`  (⌀19mm, 5날, LOC 38mm)
- MATERIAL: Stainless Steel → 316L → Annealed → **HBW 170**
- OPERATION: Milling → **Slotting**
- MACHINE: BT40, ER Collet, 10000 / 315
- Workholding: **40%** (표준 바이스)
- ap: 9.5mm (50%), ae: 19mm (100%)

**Harvey 출력**:
| 항목 | 값 |
|---|---|
| Surface Speed | 120 m/min (394 SFM) |
| RPM | 2,010 |
| fz | 0.036 mm |
| Vf | 36 IPM (914 mm/min) |
| MRR | **165 cm³/min** |
| Chip Thickness | 0.036 mm |
| Tool Deflection | 예상 20μm |

**경고**: Stainless에 0.5D ap + 전폭은 부담 → Trochoidal 권장.

**Trochoidal로 재시도**:
| 항목 | 값 |
|---|---|
| Tool Path | **Trochoidal** |
| ap | 28.6mm (**1.5D**) ↑↑ |
| ae | 1.9mm (10%) ↓↓ |
| Vc | 150 m/min |
| MRR | 유사 **158 cm³/min** |
| **수명** | **3× 연장** |

### 시나리오 C: 60HRC 경화강 볼엔드밀 금형마감

**입력**:
- TOOL: Harvey `EMB55B-C-020` (⌀5mm 볼, 2날)
- MATERIAL: Hard Steel (42-65 HRC) → Die Steel → **HRC 60**
- OPERATION: Milling → **Profiling**
- MACHINE: HSK63 HSM, Shrink Fit, 30000 / 787
- Workholding: **85%** (전용 지그, 강체)
- Stick Out: 18mm (3.6×D)
- ap: 0.1mm, ae: 0.05mm (미세 3D)

**Harvey 출력**:
| 항목 | 값 |
|---|---|
| Surface Speed | 80 m/min (262 SFM) |
| RPM | **5,093** |
| D_eff (볼) | 1.98mm (ap=0.1) → 실 Vc 31 m/min |
| fz | 0.012 mm |
| Vf | 4.8 IPM (122 mm/min) |
| MRR | 0.0006 cm³/min (매우 작음) |
| Chip Thickness | 0.002 mm |

**판단**: 극미세 조건 → Harvey가 매우 신중히 출력. 이 조건으로는 정밀·표면 우선.

### 시나리오 D: Inconel 718 에어로 포켓

**입력**:
- TOOL: Helical `HET-20-0500` (⌀12.7mm, 4날, variable helix)
- MATERIAL: High Temp Alloy → **Inconel 718 Aged** → HRC 36
- OPERATION: Milling → **Pocketing (Adaptive)**
- MACHINE: BT40, Shrink Fit, 8000 RPM
- Workholding: 70%
- ap: 12.7mm (1×D), ae: 1.3mm (10% — Adaptive 표준)

**Harvey 출력**:
| 항목 | 값 |
|---|---|
| Surface Speed | **50 m/min** (164 SFM) |
| RPM | 1,253 |
| fz | 0.075 mm |
| Vf | 15 IPM (375 mm/min) |
| MRR | 6.2 cm³/min |
| 예상 수명 | **3 hr** |

**판단**: Inconel은 저속·소량. 하지만 Adaptive로 ap 최대 가져감 → 시간 경쟁력 확보.

### 시나리오 E: Ti-6Al-4V 복합 윤곽

**입력**:
- TOOL: Harvey `EMB90-C-0375` (⌀9.53mm, 3날)
- MATERIAL: Titanium Alloy → Ti-6Al-4V → **HRC 32**
- OPERATION: Milling → **HEM**
- MACHINE: HSK63, Hydraulic Chuck, 15000 / 600
- Workholding: **80%**
- ap: 19.05mm (2×D — HEM), ae: 0.95mm (10% — HEM)

**Harvey 출력**:
| 항목 | 값 |
|---|---|
| Surface Speed | 120 m/min (394 SFM) |
| RPM | **4,011** |
| fz | 0.112 mm (HEM은 chip thinning 보정됨) |
| Vf | 53 IPM (1,347 mm/min) |
| MRR | **24.4 cm³/min** (Ti로는 매우 좋음) |
| Chip Thickness | 0.020 mm (RCTF 적용 후) |

**HEM 없이 Slotting으로 했다면** → MRR 8 cm³/min 수준 (1/3).

## 11. Corner Adjustment 이해

### 11.1 왜 필요?
- 공구가 내각 코너에 진입하면 순간 engagement 증가
- ae/D가 0.3 → 0.6 로 급등 가능
- chip load 급증 → 공구 파손·채터링 위험

### 11.2 Harvey의 방식
**"Reference Only"** — Harvey는 수치만 보여줌. 실제 적용은 **CAM**이 담당.

### 11.3 실용적 사용
Harvey MAP에서 **"Corner Adjustment: -30%"** 같은 값을 보면:
- CAM 소프트웨어(MasterCam/Fusion360)에서 **"Corner feed reduction"** 옵션에 30% 입력
- 또는 NC 프로그램 직접 편집해서 코너 진입 구간 F값을 70%로

## 12. PDF 출력 · 저장

### 12.1 PDF 내용
상단 우측 [PDF] PDF 버튼 클릭 시:
- 입력값 전체 (TOOL/MATERIAL/OPERATION/MACHINE/PARAMETERS)
- 출력값 전체 (RPM/IPM/MRR/Chip 등)
- 생성 시각·유저명 (로그인 시)

### 12.2 저장
- 계정 로그인 시 "Save Job" 가능
- 로그인 없어도 URL 복사해서 재진입 가능 (쿼리스트링에 상태 저장)

## 13. 한계 / 못 하는 것

Harvey MAP이 **하지 않는** 기능:

1. [X] **Harvey 외 공구 지원** — YG-1, Sandvik, Kennametal 공구는 못 씀
2. [X] **공구 치수 수정** — 카탈로그 값 고정
3. [X] **Tool Life 분(分) 예측** — 상대적 %만 (슬라이더 -20%~+20%)
4. [X] **Ra 표면거칠기 예측**
5. [X] **Chatter Risk 경고**
6. [X] **GCode 생성**
7. [X] **원가(₩/$) 계산**
8. [X] **조건 A/B 비교**
9. [X] **커스텀 머신 프로파일 저장 라이브러리**
10. [X] **한국어 UI** (영문 전용)
11. [X] **비대칭 지지·비정상 클램프 고려** — Workholding 슬라이더는 단일 값
12. [X] **코팅 선택** (공구 번호에 내장)
13. [X] **쿨런트 선택** (공구 번호에 내장)

## 14. FAQ

**Q1. 공구 번호 모르면 못 쓰나요?**
A. Harvey 사이트에서 "Tool Finder"로 찾거나, 공구 상자에 적힌 EDP 사용. 타사 공구면 MAP 대신 YG-1 SpeedLab · FSWizard 등 사용.

**Q2. Workholding 슬라이더 값 어디서 참고?**
A. 본 가이드 6.2 섹션의 체크리스트 점수 합계로.

**Q3. Harvey가 추천하는 조건이 너무 느려요.**
A. Workholding 올리고 Tool Path를 HEM으로, ADOC/RDOC Adjuster 80%+로. 그래도 느리면 SPEED/FEED +10%.

**Q4. PDF가 잘 안 뽑혀요.**
A. 브라우저 팝업 차단 끄기. Chrome 최신 버전 권장.

**Q5. Harvey MAP과 실제 가공 결과가 다른데요?**
A. 머신 상태·공구 마모·재료 변동 때문. Harvey 값은 "신품 공구 + 이상적 조건" 기준. 현장은 **±15%** 오차 예상.

**Q6. 모바일에서 써도 되나요?**
A. 됨. 하지만 슬라이더·2D 어드저스터는 데스크톱이 편함.

**Q7. Trochoidal과 HEM 차이?**
A. HEM은 일반 가공 (얕은 ae + 깊은 ap). Trochoidal은 슬롯 전용 (원형 궤적으로 전폭 가공).

**Q8. SPEED +10은 어떤 효과?**
A. Vc 10% 증가 → 예상 수명 38% 감소 (Taylor 방정식). 생산성은 IPM만큼 선형 증가.

## 15. 체크리스트 & 용어 사전

### 15.1 사용 전 체크리스트

- [ ] Harvey 공구 번호 확보 (공구 상자/카탈로그)
- [ ] 재료 종류와 Condition 확인 (시편 태그)
- [ ] 머신 스펙시트 (MAX RPM / IPM) 확인
- [ ] 홀더 종류 확인
- [ ] 공구 돌출 길이 측정 (홀더 바닥면~공구끝)
- [ ] 고정구 상태 점검 → Workholding 점수 계산
- [ ] 공구 마모 확인 (신품/중고)

### 15.2 용어 사전

| 용어 | 풀네임 | 의미 |
|---|---|---|
| **MAP** | Machining Advisor Pro | Harvey 시뮬레이터 이름 |
| **ADOC** | Axial Depth of Cut | 축방향 절입 (= ap) |
| **RDOC** | Radial Depth of Cut | 경방향 절입 (= ae) |
| **SFM** | Surface Feet per Minute | 절삭속도 영단위 |
| **IPT** | Inches Per Tooth | 날당 이송 영단위 (= fz) |
| **IPM** | Inches Per Minute | 테이블 이송 영단위 (= Vf) |
| **LOC** | Length of Cut | 절삭날 길이 |
| **OAL** | Overall Length | 공구 전장 |
| **HEM** | High Efficiency Milling | 얕은 ae + 깊은 ap 전략 |
| **Trochoidal** | — | 원형 궤적 슬롯 가공 |
| **Shrink Fit** | — | 열박음 홀더 |
| **Workholding** | — | 일감 고정 방식·강성 |
| **Taylor eq.** | V·T^n = C | 공구수명 방정식 |
| **Chip Thinning** | RCTF | 얕은 ae에서 실 chip 감소 |
| **D_eff** | Effective Diameter | 볼 엔드밀 유효직경 |
| **HBW/HBS/HRB/HRC** | — | 4개 경도 스케일 |

### 15.3 긴급 상황별 대처

| 현장 상황 | Harvey MAP 조치 |
|---|---|
| 공구 깨짐 발생 | Workholding -20% 내리고 재시도 |
| Chatter (진동) | Stick Out 줄이고 ae를 0.1D 이하로 |
| 표면 거침 | FEED -15%, Tool Path를 Profiling으로 |
| 생산성 부족 | Tool Path를 HEM으로, SPEED +15% |
| 공구 마모 빠름 | SPEED -10%, 새 코팅 공구 고려 |
| 스핀들 부하↑ | ap 10% 줄이고 ae 늘려 전체 MRR 유지 |

## 부록: Harvey MAP 빠른 참조 카드

```
┌──────────────────────────────────────────┐
│          HARVEY MAP CHEAT SHEET          │
├──────────────────────────────────────────┤
│                                          │
│  START:                                  │
│    1. TOOL #  →  2. MATERIAL              │
│    3. OPERATION  →  4. MACHINE            │
│                                          │
│  ADJUST:                                 │
│    [lock] ap/ae LOCK                         │
│    ADOC/RDOC slider (수직)               │
│    Workholding = 50% (시작)              │
│                                          │
│  OPTIMIZE:                               │
│    SPEED +/− 20% (수명↔생산)             │
│    FEED  +/− 20% (편향↔생산)             │
│    HEM 전략: 슬라이더 80%+                │
│                                          │
│  OUTPUT:                                 │
│    [PDF] PDF / [save] Save Job                  │
│                                          │
│  LIMIT:                                  │
│    Harvey 공구만, 수명 분단위 X,         │
│    GCode X, 원가 X                       │
│                                          │
└──────────────────────────────────────────┘
```

*작성 · 2026-04-21 · Harvey MAP v2022-renewal UI 기준*
*Harvey Performance Company 공식 자료 + 업계 표준 Sandvik/Kennametal 핸드북 참조*
