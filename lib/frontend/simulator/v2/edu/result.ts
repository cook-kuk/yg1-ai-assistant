// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 교육 콘텐츠: 결과 지표 (result)
// 시뮬레이터가 계산·출력하는 수치 결과(동력, 절삭력, 토크, 편향 등)에 대한 3단계 설명.

import type { EducationDb } from "../education-content"

export const RESULT_ENTRIES: EducationDb = {
  "pc-power": {
    id: "pc-power",
    korean: "Pc — 소요 동력 (kW)",
    english: "Cutting Power (Pc)",
    category: "result",
    definition: {
      beginner:
        "가공하면서 기계가 실제로 써야 하는 힘(전기). 두껍게 깊게 빠르게 깎을수록 커진다. 기계 스펙을 넘으면 스핀들이 주저앉는다.",
      intermediate:
        "Pc = (ap · ae · fz · z · n · kc) / (60 · 10^6) [kW]. kc는 비절삭저항(N/mm²)이며 재료·칩두께 의존. 실제는 스핀들 효율 η(0.7~0.85)로 나눠 Pm = Pc/η 로 여유를 본다.",
      expert:
        "Pc [kW] = MRR [cm³/min] · kc [N/mm²] / (60 · 10³ · η). kc = kc1.1 · hm^(-mc) (Kienzle 식). 예: SM45C kc1.1 ≈ 2100 N/mm², mc ≈ 0.26. MRR = ap · ae · vf / 1000. 스핀들 연속정격의 80% 이내에서 운용, 100% 초과 시 토크 리미트·열변형·스핀들 수명 급감. Sandvik Tool Life Curves Handbook §4.",
    },
    formula: "Pc [kW] = MRR [cm³/min] × kc [N/mm²] / (60 × 10³ × η)",
    whyItMatters:
      "기계의 물리적 한계를 결정. Pc가 스핀들 연속정격을 넘으면 RPM이 떨어지고 Fz가 감소해 표면이 뭉개진다.",
    realWorldExample:
      "BT40 11kW 스핀들로 SM45C를 ap=10 ae=20 fz=0.12 D=20 z=4 vc=150 으로 치면 Pc ≈ 7.2 kW. η=0.8 가정 시 Pm ≈ 9 kW → 정격 82%로 한계선.",
    commonPitfall:
      "스핀들 피크 정격(S6-10%)과 연속 정격(S1)을 헷갈리는 것. 장시간 가공은 S1 기준으로 보수적으로 잡아야 한다.",
    relatedConcepts: ["fc-cutting-force", "torque", "mrr", "vc", "kc"],
    sourceAuthority: "Sandvik Tool Life Curves Handbook §4, Kienzle (1952)",
  },

  "fc-cutting-force": {
    id: "fc-cutting-force",
    korean: "Fc — 주절삭력 (N)",
    english: "Main Cutting Force (Fc)",
    category: "result",
    definition: {
      beginner:
        "공구가 재료를 밀어낼 때 드는 힘. 두꺼운 칩·딱딱한 재료일수록 커진다. 너무 크면 공구가 휘고 부러진다.",
      intermediate:
        "Fc = ap · hm · kc [N]. hm은 평균 칩두께(= fz · sin κr · √(ae/D) for 측면가공). 공구 편향·채터·파손의 1차 원인.",
      expert:
        "Fc = b · h · kc1.1 · h^(-mc), b=ap/sin κr, h=hm. 정상 범위: 엔드밀 Ø10 기준 100~400N, Ø20 기준 300~1200N. 경고: 공구 허용 횡력(제조사 데이터, 예 Ø10 초경 ≈ 800N) 초과 시 파손. ISO 3685 Annex F 참조.",
    },
    formula: "Fc [N] = ap × hm × kc, hm = fz × sin(κr) × √(ae/D)",
    whyItMatters:
      "공구 편향(δ = FL³/3EI), 채터, 파손을 직접 결정. Fc를 모르면 공구수명·정밀도 예측 불가.",
    realWorldExample:
      "Ø10 4날 초경 엔드밀로 SM45C ap=10 ae=3 fz=0.08: hm≈0.035, kc≈3200 → Fc ≈ 1100N. 허용 횡력 초과 → ap/2로 낮춰야 함.",
    commonPitfall:
      "Fc만 보고 Ff(이송력)·Fp(배분력)를 무시. 드릴·보링은 Ff가 결정적, 엔드밀은 Fc가 결정적.",
    relatedConcepts: ["pc-power", "torque", "deflection", "hex-chip-thickness", "kc"],
    sourceAuthority: "ISO 3685 Annex F, MJ Jackson (2006) Ch.3",
  },

  torque: {
    id: "torque",
    korean: "토크 (N·m)",
    english: "Spindle Torque",
    category: "result",
    definition: {
      beginner:
        "스핀들이 공구를 돌리는 '회전 힘'. 저속에서 크고, 고속에서 작다. 대구경 공구·깊은 절삭일수록 많이 든다.",
      intermediate:
        "M = Fc · D / 2000 [N·m] (D=공구경 mm). 또는 M = 9550 · Pc / n [N·m]. 저속 가공에서 스핀들 토크 곡선 한계가 RPM 하한을 결정.",
      expert:
        "M [N·m] = 9.55 · 10³ · Pc[kW] / n[rpm]. BT40 급 스핀들 연속 토크 100~150 N·m (저속 기어), 고속 영역에서는 50% 이하로 감쇠. 정상: 정격의 60~80%, 경고: 100% 초과 시 스핀들 모터 과열·가속 실패. Sandvik Handbook §4.2.",
    },
    formula: "M [N·m] = 9550 × Pc [kW] / n [rpm] = Fc × D / 2000",
    whyItMatters:
      "저속 대구경 가공(face mill Ø80+)에서 kW보다 토크가 먼저 한계에 걸린다. RPM 하한선을 결정.",
    realWorldExample:
      "Ø80 페이스밀 n=400 vc=100 Pc=7kW → M = 9550·7/400 ≈ 167 N·m. BT40 연속토크 150 N·m → 초과, 저속기어 전환 또는 vc 상향 필요.",
    commonPitfall:
      "스핀들 파워곡선의 저속 토크 상한(constant torque zone)을 무시하고 kW만 보는 것. 1000rpm 이하는 별도 확인.",
    relatedConcepts: ["pc-power", "fc-cutting-force", "rpm", "spindle-preset"],
    sourceAuthority: "Sandvik Tool Life Curves Handbook §4.2, ASME B5.54",
  },

  deflection: {
    id: "deflection",
    korean: "δ — 공구 편향 (μm)",
    english: "Tool Deflection",
    category: "result",
    definition: {
      beginner:
        "공구가 옆에서 받는 힘 때문에 휘어지는 양. 얇고 길면 많이 휜다. 편향이 크면 벽이 비뚤어지고 치수가 틀어진다.",
      intermediate:
        "δ = F · L³ / (3 · E · I) [mm]. 캔틸레버 모델. L=돌출, E=탄성계수(초경 ≈ 600GPa), I=단면 2차모멘트. 50μm 초과 시 정밀도 심각 손상.",
      expert:
        "δ [mm] = Fc · L³ / (3 · E · Ieff). 엔드밀 Ieff ≈ π·Deff⁴/64, Deff ≈ 0.8·D (홈 고려). 정상 ≤ 20μm, 경고 ≥ 50μm, 파괴 ≥ 100μm. L/D = 3 기준 → L/D = 4일 때 편향 2.37배. Sandvik 권고: L/D > 4는 네크 다운 공구 또는 진동방지 홀더.",
    },
    formula: "δ [mm] = Fc × L³ / (3 × E × Ieff), Ieff ≈ π × (0.8D)⁴ / 64",
    whyItMatters:
      "정밀도(IT 등급)·표면품질·채터 발생의 핵심 변수. L³에 비례하므로 돌출 2배면 편향 8배.",
    realWorldExample:
      "Ø10 초경 엔드밀 L=40 (L/D=4), Fc=400N → δ ≈ 42μm. IT7 공차(±18μm) 초과 → L=30으로 줄이면 δ ≈ 18μm로 급감.",
    commonPitfall:
      "캔틸레버 모델은 공구만 고려. 실제로는 홀더·스핀들 강성도 직렬로 더해져 실측 편향은 계산값의 1.3~1.8배.",
    relatedConcepts: ["fc-cutting-force", "stick-out", "chatter-risk", "l-over-d-ratio"],
    sourceAuthority: "MJ Jackson (2006) Ch.5, Sandvik Handbook §5.3",
  },

  "ra-roughness": {
    id: "ra-roughness",
    korean: "Ra — 표면거칠기 (μm)",
    english: "Surface Roughness (Ra)",
    category: "result",
    definition: {
      beginner:
        "가공면의 울퉁불퉁한 정도. 값이 작을수록 매끈함. 거울면 Ra 0.1, 일반 기계가공 Ra 1.6~3.2.",
      intermediate:
        "Ra = fz² / (8·rε) [mm] (이론값, 볼·코너R 절삭). 실제는 채터·마모·떨림으로 2~3배 커짐. ISO 4287 중심선 평균.",
      expert:
        "Ra_theoretical = f² / (31.25 · rε) [μm] (f=mm/rev, rε=mm). 정상: 황삭 Ra 3.2~6.3, 중삭 Ra 1.6~3.2, 정삭 Ra 0.4~1.6, 경면 Ra ≤ 0.2. 경고: 이론값 대비 3배 초과 시 채터·마모 진행 중. ISO 4287 / JIS B 0601.",
    },
    formula: "Ra [μm] ≈ fz² × 1000 / (31.25 × rε)  (fz·rε in mm)",
    whyItMatters:
      "도면 공차(예 Ra 1.6 ▽▽▽)를 충족해야 출하 가능. 이송·코너R·공구마모가 1차 인자.",
    realWorldExample:
      "볼엔드밀 R4로 fz=0.08: Ra ≈ 0.08²·1000/(31.25·4) ≈ 0.051μm 이론. 실측 Ra 0.3μm → 마모·떨림 포함 현실.",
    commonPitfall:
      "이론 Ra만 보고 만족하는 것. 실제는 공구 마모(VB > 0.2mm)·진동·빌트업 에지로 이론의 3~10배. 실측 필수.",
    relatedConcepts: ["fz", "corner-radius", "tool-wear", "chatter-risk"],
    sourceAuthority: "ISO 4287, JIS B 0601, Sandvik Handbook §7",
  },

  "chatter-risk": {
    id: "chatter-risk",
    korean: "채터 위험도 (%)",
    english: "Chatter Risk Index",
    category: "result",
    definition: {
      beginner:
        "가공 중 '끼익' 떨리는 현상이 일어날 가능성. 100%에 가까울수록 위험. 얇고 길고 빠른 가공이 위험하다.",
      intermediate:
        "SLD(Stability Lobe Diagram)에서 현재 (n, ap)가 안정 영역에서 얼마나 가까운지 % 지표화. ap_lim · fn · κ로 산출.",
      expert:
        "Risk% = ap_actual / ap_lim × 100. ap_lim = -1 / (2·Kc·Re[G(ω)]) (Altintas SLD). 정상 ≤ 50%, 주의 50~80%, 경고 ≥ 80% → 주파수 이동 필수. Tobias (1961), Altintas (2000) Manufacturing Automation Ch.3.",
    },
    formula: "Risk% = ap_actual / ap_lim × 100, ap_lim ∝ 1/(2·Kc·|G(ω)|)",
    whyItMatters:
      "채터는 공구 즉사·표면 파괴·스핀들 베어링 손상을 일으킴. 정량 위험도로 조건 재설계 트리거.",
    realWorldExample:
      "Ø10 L/D=4 엔드밀 ap=15 fz=0.1 n=3000 → Risk 85%. n을 3400 또는 2600으로 ±13% 시프트하면 로브 간 안정점 진입, Risk 40%로 하강.",
    commonPitfall:
      "RPM 소폭 조정으로 해결된다고 믿기. 사실 L/D·홀더 강성이 근본. 10% 시프트로 안 되면 구조적 문제.",
    relatedConcepts: ["chatter", "deflection", "stick-out", "rpm"],
    sourceAuthority: "Altintas (2000) Manufacturing Automation Ch.3, Tobias (1961)",
  },

  "tool-life": {
    id: "tool-life",
    korean: "공구 수명 (min)",
    english: "Tool Life (T)",
    category: "result",
    definition: {
      beginner:
        "공구가 '못 쓸 정도'로 닳기까지 걸리는 시간(분). 빠르게·뜨겁게 돌릴수록 수명이 짧아진다.",
      intermediate:
        "Taylor: V · T^n = C. 마모 한계 VB = 0.3mm (ISO 3685) 도달까지. n=0.25(초경), C는 재료/코팅/냉각으로 결정.",
      expert:
        "T [min] = (C/V)^(1/n). 정상: 황삭 30~60 min, 정삭 60~240 min. 경고: < 15 min → Vc/fz 재검토. ISO 3685: VB_avg = 0.3mm 또는 VB_max = 0.6mm 또는 crater depth KT = 0.06 + 0.3f 도달 시점. V 10% ↑ → T 약 40% ↓ (n=0.25).",
    },
    formula: "T [min] = (C/Vc)^(1/n), n=0.25 (초경), VB_limit = 0.3 mm (ISO 3685)",
    whyItMatters:
      "공구비가 전체 가공비의 3~15%. 수명 예측 없이 스케줄·원가 계산 불가.",
    realWorldExample:
      "Ø10 TiAlN 초경으로 SM45C Vc=150 → T ≈ 60 min. Vc=180(+20%)로 올리면 T ≈ 30 min(-50%). 교체 주기 2배 빨라짐.",
    commonPitfall:
      "Taylor식의 C값을 아무거나 쓰는 것. C는 재료·코팅·냉각·공구 형상마다 다름. 제조사 카탈로그 또는 실측으로 교정.",
    relatedConcepts: ["taylor-equation", "tool-wear", "economic-vc", "vc"],
    sourceAuthority: "ISO 3685 Tool Life Testing, F.W. Taylor (1907)",
  },

  rctf: {
    id: "rctf",
    korean: "RCTF — 반경방향 칩 박막화 계수",
    english: "Radial Chip Thinning Factor",
    category: "result",
    definition: {
      beginner:
        "측면가공에서 ae(옆으로 먹는 깊이)가 작으면 실제 칩이 설정값보다 얇아진다. 그 얇아진 비율을 보정해주는 값.",
      intermediate:
        "RCTF = 1 / sin(θ), θ = acos(1 − 2·ae/D). ae < D/2일 때 hex = fz · sin θ < fz. 박막화 → 마찰·경화·공구수명 악화.",
      expert:
        "RCTF = 1/sin(acos(1−2·ae/D)) = 1/√(1−(1−2·ae/D)²). 보정 이송: fz_corrected = fz_target · RCTF. 정상: ae ≥ D/2 → RCTF ≈ 1. 경고: ae = 0.1·D → RCTF ≈ 1.67, ae = 0.05·D → RCTF ≈ 2.29. HSM(트로코이달) 필수 보정. Sandvik Handbook §3.6.",
    },
    formula: "RCTF = 1 / sin(acos(1 − 2·ae/D)), fz_corrected = fz_target × RCTF",
    whyItMatters:
      "ae를 줄여 공구 편향을 낮추려다 오히려 rubbing·조기마모 유발. RCTF 보정 없이는 HSM 불가능.",
    realWorldExample:
      "Ø10 엔드밀 ae=1 (0.1D), fz_target=0.08 → RCTF 1.67 → fz=0.134 mm/tooth로 올려야 실제 칩두께 0.08 유지.",
    commonPitfall:
      "RCTF 보정 후 fz를 올렸는데 Fc·편향도 함께 오른다는 걸 잊는 것. 보정 후 재점검 필수.",
    relatedConcepts: ["hex-chip-thickness", "fz", "rdoc", "trochoidal"],
    sourceAuthority: "Sandvik Handbook §3.6, Iscar HSM Guide",
  },

  "hex-chip-thickness": {
    id: "hex-chip-thickness",
    korean: "hex — 실제 최대 칩두께",
    english: "Maximum Chip Thickness (hex)",
    category: "result",
    definition: {
      beginner:
        "공구가 한 번 지나갈 때 실제로 벗겨내는 가장 두꺼운 칩. 너무 얇으면 문지르고, 너무 두꺼우면 부러진다.",
      intermediate:
        "hex = fz · sin(κr) · sin(θ_exit), θ_exit = acos(1−2·ae/D). 평균 hm ≈ hex · 2/π (대략). 공구 카탈로그의 fz는 hex 기준.",
      expert:
        "hex [mm] = fz · sin(κr) · √(1 − (1 − 2·ae/D)²) (측면 ae < D/2). 정상: 0.05~0.15 mm (초경 엔드밀). 경고: < 0.02 → rubbing/work hardening, > 0.2 → 칩 체적 과다·파손. Sandvik 권장 hex_min ≈ 0.5 · rε · (1−cos κr) 로 rubbing 회피.",
    },
    formula: "hex [mm] = fz × sin(κr) × √(1 − (1 − 2·ae/D)²)",
    whyItMatters:
      "칩 두께는 공구 수명·표면거칠기·가공경화의 모든 것. 설정 fz가 아닌 실제 hex를 관리해야 함.",
    realWorldExample:
      "Ø12 엔드밀 κr=90° ae=2 (0.17D) fz=0.1 → hex ≈ 0.075. ae=6 (0.5D)로 올리면 hex=fz=0.1. 같은 fz라도 ae에 따라 완전히 다른 절삭.",
    commonPitfall:
      "fz = 칩두께 라고 오해. 실제 hex는 ae·κr로 최대 50% 작아짐. 얇은 ae에서 공구 카탈로그 fz를 그대로 쓰면 rubbing.",
    relatedConcepts: ["rctf", "fz", "rubbing"],
    sourceAuthority: "Sandvik Handbook §3.5, ISO 3002-1",
  },

  "taylor-equation": {
    id: "taylor-equation",
    korean: "Taylor 공구수명 방정식",
    english: "Taylor Tool Life Equation",
    category: "result",
    definition: {
      beginner:
        "속도를 올리면 공구가 훨씬 빨리 닳는다는 걸 수학으로 정리한 공식. 100년 넘게 쓰는 가공의 기본 법칙.",
      intermediate:
        "V · T^n = C. V 10%↑ → T 약 40%↓ (n=0.25). 확장형: V · T^n · f^a · d^b = C 로 이송·절입 반영.",
      expert:
        "V·T^n = C. n: 공구재 지수 — HSS 0.125, 초경 0.20~0.30, 세라믹 0.40~0.60, CBN/PCD 0.50~0.70. C: 재료·냉각 의존 상수(SM45C 초경 ≈ 200~300). 확장: V·T^n·f^a·d^b = C, 통상 a ≈ 0.5n, b ≈ 0.2n. Vc 10% 상승 시 수명 ~40% 감소. Frederick W. Taylor (1907) 'On the Art of Cutting Metals' §§14~19. 확장형은 Colding (1959).",
    },
    formula: "V × T^n = C  (확장: V × T^n × f^a × d^b = C)",
    whyItMatters:
      "모든 공구수명 예측·경제속도 계산의 출발점. 이 식 없이 원가 최적화 불가.",
    realWorldExample:
      "SM45C 초경 n=0.25, C=250 → Vc=150 m/min → T ≈ (250/150)^4 ≈ 7.7 min. Vc=120 → T ≈ (250/120)^4 ≈ 18.8 min. 속도 20% 낮추면 수명 2.4배.",
    commonPitfall:
      "단순 V·T^n=C만 믿고 f·ap를 무시. 고이송/심절입 시 확장형 필수. 또한 VB 한계값(0.3mm)이 응용에 따라 달라짐(정삭은 0.15).",
    relatedConcepts: ["tool-life", "economic-vc", "taylor-curve", "tool-wear"],
    sourceAuthority: "F.W. Taylor (1907) On the Art of Cutting Metals §14-19, Colding (1959)",
  },
}
