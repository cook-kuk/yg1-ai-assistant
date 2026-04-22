// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 교육 모드 콘텐츠 DB · Machine 카테고리
// 스핀들 테이퍼 / 척 / 워크홀딩 / 머신 한계 / L/D 비율 관련 10 entries

import type { EducationDb } from "../education-content"

export const MACHINE_ENTRIES: EducationDb = {
  "spindle-preset": {
    id: "spindle-preset",
    korean: "스핀들 프리셋 (머신 스핀들 규격)",
    english: "Spindle Preset",
    category: "machine",
    definition: {
      beginner:
        "공구를 잡는 머신 팔의 규격 모음. BT40·HSK63·CAT40 같은 '표준 사이즈'를 고르면 맞는 척/RPM 한계가 따라옴.",
      intermediate:
        "테이퍼 규격(BT/HSK/CAT), 최대 RPM, 최대 파워(kW), 토크 커브(Low/High-gear)를 한 세트로 묶은 프리셋. 시뮬레이터 계산 시 RPM/IPM 상한과 드로바 풀링력이 이 값에 제한된다.",
      expert:
        "스핀들 프리셋 = {taperType, maxRPM, peakPowerKW, continuousPowerKW, pullStudForceN, torqueCurve(n)}. 일반 머시닝센터 BT40 8-12k rpm / 15-22 kW, HSK63A 15-24k rpm / 25-40 kW, 고속 HSK63F 30-42k rpm / 15-20 kW. 선택 프리셋의 maxRPM이 n_target(=1000·Vc/πD)보다 낮으면 Vc 재계산 필요. 정밀도 IT5-IT7 범위. 출처: ISO 15488 (HSK), JIS B 6339 (BT).",
    },
    whyItMatters:
      "아무리 공구 스펙이 좋아도 머신 스핀들 한계를 넘으면 계산된 RPM/IPM이 물리적으로 나오지 않는다. 프리셋은 시뮬레이션을 실제 현장 능력에 묶는 앵커.",
    realWorldExample:
      "Φ6 엔드밀 Al7075 Vc=400 m/min → n=21,220 rpm. BT40 프리셋(12k rpm)에서는 불가 → HSK63F 프리셋(30k rpm)으로 전환해야 스펙대로 가공 가능.",
    commonPitfall:
      "카탈로그 SFM만 보고 RPM을 계산한 뒤 머신 상한을 잊는 실수. 특히 소경(<Φ3) 고속가공에서 BT40으로는 카탈로그 Vc의 30-50%밖에 못 낸다.",
    relatedConcepts: ["bt40", "hsk63", "cat40", "max-rpm-ipm", "workholding-security"],
    sourceAuthority: "ISO 15488 / JIS B 6339 / Sandvik Coromant Manufacturing Handbook Ch.12",
  },

  "bt40": {
    id: "bt40",
    korean: "BT40 (일본 표준 테이퍼)",
    english: "BT40 Taper (JIS B 6339)",
    category: "machine",
    definition: {
      beginner:
        "일본식 스핀들 규격. 게이지라인 지름 44.45mm. 전세계 범용 머시닝센터에서 가장 흔함. 저속-중속에 적합.",
      intermediate:
        "7/24 테이퍼(경사 3.5°), 드로바가 당겨서 고정. 최대 RPM 8-15k, 연속파워 11-22 kW. 플랜지-스핀들 접촉이 없어 고속에서 원심 팽창으로 공구 길이 오차 발생.",
      expert:
        "BT40: 게이지 Ø44.45mm, 7/24 taper, pull-stud force 12-18 kN, 정밀도 IT6-IT7 (AT3 등급), 스핀들 원심 팽창으로 20k rpm 이상에서 Z축 drift +20-50 µm. 대표 머신: Doosan DNM 시리즈, Mazak VCN, Makino V33, DMG Mori NVX. 최대 RPM 12,000 / peak 22 kW가 업계 표준 스펙. 출처: JIS B 6339-2 / Smid Machining Handbook §8.",
    },
    whyItMatters:
      "BT40은 공장 자산의 60% 이상을 차지하는 가장 흔한 규격. 이걸 기준으로 공구 스펙과 Vc를 잡아야 고객사 현장에서 재현 가능하다.",
    realWorldExample:
      "Doosan DNM 5700 (BT40, 12k rpm, 18.5 kW) + Φ10 4날 엔드밀 + SKD11 가공 시 Vc 100 m/min → n=3,183 rpm, IPT 0.05, Fz=637 mm/min. 머신 한계 내 여유 3.8배.",
    commonPitfall:
      "BT40에서 Φ3 이하 초소경 공구로 Al 고속가공 시도 → 12k rpm × π × 3 = 113 m/min밖에 안 되어 카탈로그 500 m/min의 22%. 이 경우 HSK63F 권장.",
    relatedConcepts: ["spindle-preset", "hsk63", "cat40", "max-rpm-ipm"],
    sourceAuthority: "JIS B 6339-2 / Smid Tool & Manufacturing Engineers Handbook §8",
  },

  "hsk63": {
    id: "hsk63",
    korean: "HSK63 (독일 고속 테이퍼)",
    english: "HSK63 Hollow Shank Taper (DIN 69893)",
    category: "machine",
    definition: {
      beginner:
        "독일식 고속 스핀들 규격. 속이 빈 짧은 테이퍼 + 플랜지 밀착 이중 접촉. 고속에서도 안 흔들림. 고정밀·고속가공 표준.",
      intermediate:
        "1/10 short taper + face contact (이중면 밀착). 원심 팽창에도 플랜지가 눌러줘서 Z 길이 안정. HSK63A 일반용, HSK63E 고속, HSK63F 초고속(42k rpm까지).",
      expert:
        "HSK63: 중공 구조 + face-and-taper dual contact, 드로바 내부 세그먼트 클램핑력 25-40 kN (BT40의 2배). 원심 확장 시 오히려 밀착력 증가 (self-energizing). 정밀도 IT5-IT6, A형 25k rpm · E형 30k rpm · F형 42k rpm. 대표 머신: Makino U6/V33i, DMG Mori HSC 시리즈, Mikron MILL S. 고파워 연속 25-40 kW. 출처: DIN 69893 / ISO 12164.",
    },
    whyItMatters:
      "20k rpm 이상에서 BT40은 원심 팽창으로 공구 길이가 변하고 흔들리지만, HSK는 face contact 덕에 Z 정확도 ±5 µm 유지. 금형/항공 정밀가공 필수.",
    realWorldExample:
      "Makino V33i (HSK63A, 30k rpm, 35 kW) + Φ2 볼엔드밀 + STAVAX 하드밀링 Vc 200 m/min → n=31,830 rpm. 머신 30k 상한 근접 → 실제 Vc=188 m/min 사용.",
    commonPitfall:
      "HSK63 척을 BT40 스핀들에 어댑터로 물리면 face contact가 사라져 HSK 이점이 소멸. 고속가공 효과 없음.",
    relatedConcepts: ["spindle-preset", "bt40", "cat40", "shrink-fit", "max-rpm-ipm"],
    sourceAuthority: "DIN 69893 / ISO 12164 / Sandvik Coromant Manufacturing Handbook Ch.12",
  },

  "cat40": {
    id: "cat40",
    korean: "CAT40 (미국 V-플랜지 표준)",
    english: "CAT40 / ANSI B5.50 V-Flange",
    category: "machine",
    definition: {
      beginner:
        "미국 Caterpillar가 정한 스핀들 규격. BT40과 치수는 거의 같은데 드로바 나사/플랜지 각이 다름. 북미 공장에서 주류.",
      intermediate:
        "7/24 taper, BT40과 플랜지 외경은 호환되지만 pull-stud 규격(5/8-11 또는 3/4-16)이 달라 상호 교체 불가. 최대 RPM 10-15k, 파워 15-22 kW.",
      expert:
        "CAT40: ANSI/ASME B5.50, 7/24 taper, Ø44.45mm gauge, pull-stud thread 5/8-11 UNC (retention knob 45°). 정밀도 IT6-IT7 (AT3). 대표 머신: Haas VF/UMC, Hurco VM, Fadal VMC. RPM 12k / peak 22 kW 일반. BT40와의 차이: (1) pull-stud geometry, (2) keyway 위치, (3) 드로바 clamping force 12-15 kN. 출처: ANSI B5.50-1985.",
    },
    whyItMatters:
      "북미 고객사(GE Aviation, Boeing 협력사, Tier-1 automotive)는 CAT40이 기본. 같은 BT40용 홀더 못 씀. 영업 시 견적 전 반드시 확인.",
    realWorldExample:
      "Haas VF-2SS (CAT40, 12k rpm, 22.4 kW) + Φ12 인덱서블 엔드밀 + 6061-T6 Al 페이싱 Vc 300 m/min → n=7,958 rpm, Fz 2,547 mm/min.",
    commonPitfall:
      "한국 공장 BT40 홀더 재고를 미국 CAT40 머신에 그대로 쓰려다 pull-stud 미호환으로 전량 재구매. 수출 프로젝트 견적 시 초기 확인 필수.",
    relatedConcepts: ["spindle-preset", "bt40", "hsk63", "max-rpm-ipm"],
    sourceAuthority: "ANSI/ASME B5.50-1985 / Smid Tool & Manufacturing Engineers Handbook §8",
  },

  "er-collet": {
    id: "er-collet",
    korean: "ER 콜릿 척",
    english: "ER Collet Chuck (DIN 6499)",
    category: "machine",
    definition: {
      beginner:
        "스프링 같은 얇은 통(콜릿)으로 공구 섕크를 조이는 범용 척. 싸고 종류 많아서 공방의 기본. 대신 흔들림(런아웃)이 좀 있음.",
      intermediate:
        "ER11/16/20/25/32/40 시리즈, 조임 범위 각 Ø0.5-1 mm 스텝. 런아웃 10-20 µm (카탈로그), 실측 20-40 µm. 토크 전달 섕크 마찰에 의존 → 깊은 절삭 시 공구 슬립 위험. 정밀도 IT8-IT9 수준.",
      expert:
        "ER collet: 8° taper slotted sleeve, 유효 클램핑 길이 1.0-1.5×D, 정밀도 IT8-IT9, TIR 10-25 µm (AA 등급 5-10 µm). 최대 RPM ~30k (Ø6 기준). 드라이브 토크는 μ(0.15)×F_clamp×D/2, 고토크 작업엔 부족. 대표 공급사: Rego-Fix ER, BIG Kaiser Mega-ER, YG-1 ER. 대표 머신 호환: Doosan/Mazak/Haas 범용 BT40/CAT40. 교체 빈도 높은 범용 라인에 최적. 출처: DIN 6499-1.",
    },
    whyItMatters:
      "가장 저렴하고 공구 Ø 변경 대응이 즉시 가능해 시제품·금형 수리에 압도적 점유. 단점(런아웃·슬립)을 알고 써야 공구수명 판단을 그르치지 않는다.",
    realWorldExample:
      "ER25 + Φ10 엔드밀로 SS400 슬로팅 시 런아웃 25 µm → IPT 편차 ±15% → 공구 1날에 부하 몰려 코너 치핑. 열박음으로 교체 시 수명 2.3배.",
    commonPitfall:
      "콜릿과 너트에 칩/오일 끼면 실제 TIR 50 µm까지 증가. 매 교체 시 세정·토크 렌치 사용 필수. 손힘 체결은 언더토크로 슬립 유발.",
    relatedConcepts: ["shrink-fit", "hydraulic-chuck", "spindle-preset", "l-over-d-ratio"],
    sourceAuthority: "DIN 6499-1 / Rego-Fix Technical Manual §3",
  },

  "shrink-fit": {
    id: "shrink-fit",
    korean: "열박음 척 (Shrink-Fit)",
    english: "Shrink-Fit Holder",
    category: "machine",
    definition: {
      beginner:
        "척을 불(유도가열)로 달궈서 구멍이 커지면 공구를 넣고 식히면 꽉 조여짐. 일체형처럼 붙어서 런아웃이 거의 없음.",
      intermediate:
        "induction heater로 홀더 ID를 300-400°C 가열, 공구 섕크 h6 공차와 I/D 0.02-0.05 mm 간섭. 런아웃 <3 µm, 강성 ER 대비 1.5-2배. 고속·고정밀용. 최대 RPM 40-50k, 정밀도 IT5.",
      expert:
        "Shrink-fit: interference fit 20-50 µm/Ø, clamping force 30-40 kN (ER의 1.5배), TIR ≤3 µm, 균형 G2.5@25k rpm. 최대 RPM 40-50k. Slim-line 타입 노즈 Ø≤공구Ø+2mm로 협소 가공 유리. 단점: 공구 길이 고정, 세팅 2-3분 소요, 초경 전용(HSS 불가, 열팽창 계수 차이). 대표: BIG Kaiser Mega EA, Nikken NC Shrink, Haimer Power Shrink. 대표 머신: Makino HSK63A / DMG Mori HSC. 출처: VDI 3376.",
    },
    whyItMatters:
      "흑연/CFRP/하드밀링처럼 공구 런아웃이 수명에 지배적인 공정에서 열박음은 ER 대비 수명 2-4배. HSK63+Shrink-fit은 고속가공 '정답'.",
    realWorldExample:
      "STAVAX 52HRC 금형 Ø6 볼엔드밀 하드밀링: ER TIR 20 µm → 수명 80분 / Shrink-fit TIR 2 µm → 수명 240분. 3배 연장으로 무인가공 1 shift 가능.",
    commonPitfall:
      "HSS 공구를 열박음에 끼우려다 홀더 냉각 중 섕크가 영구 변형. 초경(HSS보다 열팽창 ⅓) 전용임을 잊지 말 것.",
    relatedConcepts: ["er-collet", "hydraulic-chuck", "hsk63", "l-over-d-ratio"],
    sourceAuthority: "VDI 3376 / Haimer Technical Handbook / Sandvik Coromant Manufacturing Handbook Ch.12",
  },

  "hydraulic-chuck": {
    id: "hydraulic-chuck",
    korean: "유압 척",
    english: "Hydraulic Chuck",
    category: "machine",
    definition: {
      beginner:
        "척 안에 기름이 차 있어서 렌치로 돌리면 기름 압력이 얇은 벽을 안쪽으로 눌러 공구를 잡음. 교체 30초, 런아웃 낮음.",
      intermediate:
        "내부 피스톤이 membrane(얇은 슬리브)을 유압으로 균일 압박 → TIR 3-5 µm, 진동 감쇠 효과 있어 thin-wall 가공에 유리. 최대 RPM 25-30k, 정밀도 IT6.",
      expert:
        "Hydraulic chuck: 내부 pressure chamber → expansion sleeve (두께 0.3-0.5 mm) 균일 수축, clamping force 20-30 kN (열박음의 70-80%), TIR 3-6 µm, 진동 감쇠 ~2배 (vs shrink-fit, 내부 오일이 댐퍼 역할). 최대 RPM 25k @ balance G2.5. 세팅 torque 렌치만 있으면 30초, 열 필요 없음. 대표: Schunk Tendo, Kennametal HydroForce, BIG Kaiser Hydro. 대표 머신: Mazak VCN / DMG Mori DMU. 섕크 Weldon 플랫 허용 여부는 모델별 상이. 출처: Schunk Technical Catalogue §4.",
    },
    whyItMatters:
      "열박음만큼 정밀하면서 현장 교체 빠름 + 진동 감쇠로 thin-wall/잔류응력 부품 가공 시 재생(regeneration) 채터 억제에 유리.",
    realWorldExample:
      "Ti-6Al-4V thin-wall rib 가공: ER TIR 15 µm·채터 발생 / Hydraulic TIR 4 µm·진동 -6 dB → 표면조도 Ra 3.2 → 1.6 개선.",
    commonPitfall:
      "척 내부 오일 누설 시 clamping force 50% 이하로 급감 → 공구 슬립. 6개월마다 누유/압력 점검, 정기 교체.",
    relatedConcepts: ["er-collet", "shrink-fit", "workholding-security"],
    sourceAuthority: "Schunk Technical Catalogue §4 / Smid Machining Handbook §9",
  },

  "workholding-security": {
    id: "workholding-security",
    korean: "Workholding Security (고정 강성)",
    english: "Workholding Security / Rigidity",
    category: "machine",
    definition: {
      beginner:
        "공작물을 얼마나 단단하게 잡았는지. 흔들리면 깊게 못 깎는다. 바이스·클램프·지그로 꽉 잡아야 공구가 자기 실력 발휘.",
      intermediate:
        "공작물·지그·테이블 시스템 강성(N/µm). 낮으면 채터·치수 불량. 시뮬레이터는 Security Factor (0.5-1.2)로 MRR·ADOC 상한 조정.",
      expert:
        "Security factor k_ws: Poor=0.6 (single-point clamp, 긴 overhang), Fair=0.8 (vise, 표준), Good=1.0 (dedicated fixture + 3-point), Excellent=1.2 (rigid fixture + damping). 실효 Fz_max = Fz_catalog × k_ws, ADOC_max 비례. 정량 지표: 시스템 정적 강성 20-200 N/µm, dynamic stiffness at chatter freq > 50 N/µm 권장. 테이블 정밀도 IT7 이상, 대표 머신 base rigidity: Makino V33i 150 N/µm급 / Doosan DNM 80 N/µm급. 측정: 해머 임팩트 테스트 → FRF. 출처: Tobias 'Machine Tool Vibration' / Altintas 'Manufacturing Automation' §4.",
    },
    whyItMatters:
      "같은 공구·같은 머신이라도 공작물 고정이 부실하면 카탈로그 MRR의 50%도 못 낸다. Vc·IPT보다 먼저 확보할 기본 변수.",
    realWorldExample:
      "Al 블록 바이스 단일 고정(k_ws=0.7) → HEM 시도 시 채터 / 저면 3점 볼트 + side support(k_ws=1.0) → 동일 파라미터에서 채터 소멸, MRR 1.4배.",
    commonPitfall:
      "thin-wall/오버행 부품을 바이스만 믿고 고정 → 외력에 진동, 치수 ±50 µm 편차. Form-fit 지그 또는 low-melt 고정재 필요.",
    relatedConcepts: ["l-over-d-ratio", "spindle-preset", "hydraulic-chuck"],
    sourceAuthority: "Altintas 'Manufacturing Automation' §4 / Sandvik Coromant Manufacturing Handbook Ch.11",
  },

  "max-rpm-ipm": {
    id: "max-rpm-ipm",
    korean: "머신 최대 RPM/IPM 한계",
    english: "Machine Max RPM / Feedrate Limit",
    category: "machine",
    definition: {
      beginner:
        "머신이 낼 수 있는 최고 회전수와 최고 이송속도. 계산된 값이 이 한계를 넘으면 '현실에선 불가능'.",
      intermediate:
        "maxRPM(스핀들 상한)·maxIPM(축 이송 상한, 보통 X/Y 30-60 m/min, Z 20-40 m/min)·rapid_traverse 별도. 실제 허용은 accel 제한으로 짧은 구간에선 이론치의 50-70%. 위치결정 정밀도 IT5-IT6.",
      expert:
        "한계 요소: (1) 스핀들 maxRPM — 베어링·밸런스·드로바, (2) servo axis max feed (rapid) — ballscrew pitch × motor rpm, (3) linear accel 0.3-2 g (리니어축 5-20 m/s²), (4) look-ahead block buffer. 고속가공에선 programmed F가 나오려면 segment 길이 ≥ F²/(2·a). 예: F=10 m/min, a=5 m/s² → min segment 5.6 mm. 아래면 코너 감속. 대표 스펙: Makino iQ500 40k rpm / 60 m/min · 20 kW, Doosan DNM 5700 12k rpm / 36 m/min · 18.5 kW, DMG Mori DMU 65 18k rpm / 50 m/min, Mazak Variaxis 12k rpm / 42 m/min. 출처: Sandvik Manufacturing Handbook Ch.12 / Smid §8.",
    },
    whyItMatters:
      "카탈로그상 Vc=500, Fz=5,000 mm/min이라도 머신 30 m/min 상한에서 잘린다. 시뮬레이터가 'machine-limited' 경고를 띄우는 이유.",
    realWorldExample:
      "Al7075 Φ8 Z3 Vc 500 → n=19,894 rpm, Fz 0.08×3×19,894=4,775 mm/min. 머신 maxIPM 30,000 mm/min 여유. 하지만 maxRPM 15k인 머신에선 n=15k 제한, Vc 실효 377 m/min.",
    commonPitfall:
      "tool path에 G0 rapid 구간이 많으면 rapid traverse(보통 48-60 m/min)로 속도 나오지만, G1 cutting feed는 별도 한계. 혼동하면 사이클 타임 견적 오차 ±20%.",
    relatedConcepts: ["spindle-preset", "bt40", "hsk63", "workholding-security"],
    sourceAuthority: "Sandvik Coromant Manufacturing Handbook Ch.12 / Smid §8",
  },

  "l-over-d-ratio": {
    id: "l-over-d-ratio",
    korean: "L/D 비율 (공구 돌출 대 직경)",
    english: "L/D Ratio (Overhang-to-Diameter)",
    category: "machine",
    definition: {
      beginner:
        "공구가 척 밖으로 얼마나 길게 나왔나 / 공구 지름. 숫자 크면 휘청거려 깊게 못 깎음. 3 이하가 안전, 5 넘으면 위험.",
      intermediate:
        "L/D=3: rigid, 카탈로그 파라미터 100%. L/D=4: SFM/IPT 70-80%. L/D=5: 50-60%. L/D>6: 30% 이하 + chatter-tuned 절삭. 공구 편향 δ = F·L³/(3·E·I) → L³에 비례. 정밀도 IT 유지엔 L/D≤4 권장.",
      expert:
        "Cantilever deflection δ = F·L³/(3·E·I), I=π·D⁴/64 → δ ∝ (L/D)³. 초경 E=600 GPa. 표준 보정: L/D≤3 → 100%, 4 → 80%, 5 → 60%, 6 → 40%, 7+ → 25% (Vc·Fz 둘 다). 정적 강성 k_tool = 3·E·I/L³. 동적: 공구 1차 고유진동수 f₁ = (1.875²/2π)·√(E·I/(ρ·A·L⁴)) → 고L/D에서 낮아져 저RPM 채터 발생. 대응: 초경 H/W 섕크, 진동 감쇠 홀더(damped boring bar: Sandvik Silent Tools, Kennametal KM), 경량 절삭(light HEM). 대표 머신: Makino/Mazak 5-axis에서 L/D 6+ 딥캐비티 가공 시 damped holder 필수. 출처: Altintas 'Manufacturing Automation' §3 / Harvey Performance Deep Cavity Guide.",
    },
    whyItMatters:
      "L/D는 3제곱으로 편향을 증폭하는 가장 강력한 절삭력 변수. 딥캐비티/긴 리브 가공 시 Vc/IPT 수정보다 L/D 자체를 줄이는 게 우선.",
    realWorldExample:
      "Φ10 엔드밀, L/D=3 → δ=8 µm @ 300N, 정상 MRR. L=60 (L/D=6) → δ=64 µm, 채터 발생. 대응: 공구 스텝 피치 다운 + Fz 40%로 + trochoidal 전환.",
    commonPitfall:
      "깊은 포켓 가공 시 stick-out만 늘려 한번에 해결하려다 L/D=7 초과 → 공구 파손. 2-step(긴 roughing + 짧은 finishing) 분할이 정답.",
    relatedConcepts: ["workholding-security", "shrink-fit", "er-collet", "spindle-preset"],
    sourceAuthority: "Altintas 'Manufacturing Automation' §3 / Harvey Performance Deep Cavity Milling Guide",
  },
}
