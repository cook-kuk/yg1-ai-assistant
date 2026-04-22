// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 교육 콘텐츠: 가공 현상 (phenomenon)
// 채터·rubbing·응착·마모 등 현장에서 실제로 벌어지는 현상과 대응법.

import type { EducationDb } from "../education-content"

export const PHENOMENON_ENTRIES: EducationDb = {
  chatter: {
    id: "chatter",
    korean: "채터 — 공진 진동",
    english: "Chatter (Regenerative Vibration)",
    category: "phenomenon",
    definition: {
      beginner:
        "공구와 가공물이 공진해 '끼익' 소리 나면서 떨림. 표면이 파도 치듯 울퉁불퉁해진다. 공구가 순식간에 깨질 수 있다.",
      intermediate:
        "재생형 진동(regenerative chatter). 이전 날이 남긴 파상면을 다음 날이 물려 절삭력 변동이 누적. 원인: L/D 큼·ap 과다·RPM이 SLD 불안정 로브. 증상: 특정 주파수 비명, 줄무늬 표면, Ra 5~10배 악화. 대응: RPM ±10~15%, ap 절반, stick-out 단축.",
      expert:
        "원인: 절삭력 변동 ΔF가 구조 FRF G(ω)와 양성 피드백 ap_lim = -1/(2·Kc·Re[G(ω)]). 증상: 가속도계 PSD에서 구조 고유진동수 근처 피크, Ra > 이론값 5배, 공구 VB 비정상 증가. 대응: ① Altintas SLD 안정점으로 n 이동(통상 ±10~20%) ② ap 50% 감소(로브 회피) ③ stick-out 0.7x 단축 → 강성 k∝1/L³로 3배 향상 ④ 변동피치 공구 사용. 출처: Tobias (1961), Altintas (2000) Manufacturing Automation Ch.3.",
    },
    whyItMatters:
      "채터는 단순 떨림이 아니라 공구 즉사·스핀들 베어링 손상·치수불량으로 직결. 자율 가공의 최대 적.",
    realWorldExample:
      "Ø10 L/D=4.5 엔드밀 ap=15 n=3200 → 980Hz 비명 + Ra 3.2→25. 대응: n을 3600(+12%) 이동 + ap 8로 감소 → Ra 2.1 복원.",
    commonPitfall:
      "볼륨 키우지 말고 먼저 stick-out을 확인. L 20%↓ = k 80%↑로 가장 효과적. RPM만 만지면 근본 미해결.",
    relatedConcepts: ["chatter-risk", "tool-deflection", "deflection", "stick-out", "speed-dial"],
    sourceAuthority: "Tobias (1961), Altintas (2000) Manufacturing Automation Ch.3",
  },

  rubbing: {
    id: "rubbing",
    korean: "Rubbing — 긁힘",
    english: "Rubbing (Insufficient Chip Load)",
    category: "phenomenon",
    definition: {
      beginner:
        "칩이 너무 얇아서 공구가 재료를 '깎지' 않고 '문지르는' 현상. 열만 잔뜩 나고 공구가 쑥쑥 닳는다.",
      intermediate:
        "원인: hex < 최소 칩두께(통상 rε의 5~10%). fz 너무 작거나 ae 너무 작아 RCTF 미보정 시 발생. 증상: 반짝이는 번쩍한 표면, 공구 발갛게 달아오름, VB 급증. 대응: fz 1.5~2배 증가, 또는 ae 증가, 트로코이달 전환.",
      expert:
        "원인: 날 에지 반경 rε보다 칩두께 h가 작으면 전단(shearing) 대신 소성변형/마찰 지배. 임계: h_min ≈ 0.3~0.5 · rε_edge (초경 ≈ 5~15μm). 증상: 플랭크면 광택, 온도 ΔT +200~400°C, 가공경화 표면층, Ra 역설적 상승. 대응: fz를 hex_min = 0.5·rε·(1−cos κr) 이상으로. 통상 fz 0.05→0.1 (+100%). Sandvik: '얇게 많이' 대신 '두껍게 적게'. 출처: Shaw (2005) Metal Cutting Principles §20.",
    },
    whyItMatters:
      "'천천히 살살' 가공이 공구수명을 늘린다는 오해 1위. 실제로는 rubbing으로 수명 1/3 이하.",
    realWorldExample:
      "Ø8 엔드밀로 STS304 ae=0.8 fz=0.03 → 공구 5분 만에 VB 0.4. fz=0.08 + ae 4로 올리니 T = 45 min 복원.",
    commonPitfall:
      "'안전하게' fz 낮추는 것. 초경은 fz를 과감히 올려야 살아남는다. 특히 스테인리스·내열합금.",
    relatedConcepts: ["hex-chip-thickness", "work-hardening", "tool-wear", "fz", "rctf"],
    sourceAuthority: "Shaw (2005) Metal Cutting Principles §20, Sandvik Handbook §3.6",
  },

  "chip-welding": {
    id: "chip-welding",
    korean: "Chip Welding — 칩 응착 (BUE)",
    english: "Chip Welding / Built-Up Edge (BUE)",
    category: "phenomenon",
    definition: {
      beginner:
        "칩이 공구 날에 녹아붙는 현상. 날이 더러워져서 표면이 지저분해지고 칩이 잘 안 떨어진다. 알루미늄·스테인리스가 특히 잘 생긴다.",
      intermediate:
        "원인: 저속 고온 + 친화성 높은 재료(Al, 저탄소강, STS). 날-칩 계면에서 확산·용접. 증상: 날 앞면에 은백색 혹(BUE), 뜯긴 표면, Ra 악화, 칩 색 변화. 대응: Vc 증가(임계속도 돌파) 또는 날카로운 연마날 + 고압 쿨런트.",
      expert:
        "원인: 칩-레이크면 접촉부 온도 T_BUE (Al ≈ 200°C, 저탄소강 ≈ 500°C)에서 주기적 응착-탈락-재응착. 증상: BUE 층두께 10~100μm, 레이크면 거친 마찰흔, 표면 뜯김, 칩 색 황색→청색 경계. 대응: ① Vc를 BUE 임계 위로 (Al ≥ 300 m/min, 강 ≥ 80 m/min) ② 연마날 + 양각 경사 ③ DLC/TiCN 코팅(친화성 낮음) ④ MQL 또는 고압 쿨런트(>20bar). 출처: Trent & Wright (2000) Metal Cutting Ch.6.",
    },
    whyItMatters:
      "표면품질·치수정밀도·공구수명 모두 악화. 특히 정삭에서 치명적.",
    realWorldExample:
      "Al6061 Vc=80 m/min 비코팅 HSS → BUE 발생, Ra 3.2. Vc=400 m/min + DLC 코팅 + 연마날로 전환 → Ra 0.4, BUE 소실.",
    commonPitfall:
      "Vc를 오히려 낮추면 악화. BUE는 저속 현상 → 임계속도 위로 올려야 해결. 냉각 강화만으론 부족.",
    relatedConcepts: ["heat-build-up", "tool-wear", "vc", "altin-coating"],
    sourceAuthority: "Trent & Wright (2000) Metal Cutting Ch.6",
  },

  "heat-build-up": {
    id: "heat-build-up",
    korean: "Heat Build-up — 열 축적",
    english: "Heat Build-up",
    category: "phenomenon",
    definition: {
      beginner:
        "가공 중 생긴 열이 다 빠져나가지 못하고 쌓여서 공구·가공물이 뜨거워지는 현상. 공구가 물러지고 재료가 변형된다.",
      intermediate:
        "원인: 절삭열(Vc·fz·ap의 함수)이 냉각 용량 초과. 특히 드라이·MQL + 고속 + 저열전도 재료(Ti, Inconel). 증상: 칩 변색(청→보라), 공구 레이크면 열 크랙, 가공물 치수 팽창(ΔL = αLΔT). 대응: Vc -20%, 고압 쿨런트, 공기 블로우, 트로코이달로 공구 휴식.",
      expert:
        "원인: Q = Pc·(1−η_heat) ≈ Pc·0.85 (85%가 열로). 칩이 열의 75%를 가져가야 건강. 저열전도 재료(Ti λ≈7, Inconel λ≈11 W/mK)는 열이 공구로 역류. 증상: 칩 색 청색=550°C, 보라=600°C, 회색=700°C+. 공구 플랭크에 평행 열크랙(thermal fatigue). 대응: ① Vc 0.7~0.8x ② 쿨런트 압력 > 20bar 내부급유 ③ trochoidal로 공구 접촉시간 <30% ④ 공구 코팅 내열(AlTiN 900°C, AlCrN 1100°C). 출처: Astakhov (2006) Tribology of Metal Cutting Ch.4.",
    },
    whyItMatters:
      "열은 공구수명의 1차 결정 인자. 모든 마모 메커니즘이 T에 지수적으로 의존(Arrhenius).",
    realWorldExample:
      "Ti6Al4V Vc=120 드라이 → 칩 보라, 공구 10 min 만에 크레이터. Vc=80 + 고압 쿨런트 70bar로 T=75 min 복원.",
    commonPitfall:
      "쿨런트 플러드만 뿌려서 해결된다고 믿기. 실제론 고압 내부급유 아니면 칩 아래까지 못 닿음. 드라이+MQL이 더 나을 때도 있음.",
    relatedConcepts: ["tool-wear", "vc", "flood-coolant", "altin-coating"],
    sourceAuthority: "Astakhov (2006) Tribology of Metal Cutting Ch.4",
  },

  "work-hardening": {
    id: "work-hardening",
    korean: "Work Hardening — 가공경화",
    english: "Work Hardening",
    category: "phenomenon",
    definition: {
      beginner:
        "재료가 가공 중에 스스로 단단해지는 현상. 스테인리스·Inconel에서 심하다. 살살 깎으면 오히려 표면이 더 단단해져서 다음 날이 못 자른다.",
      intermediate:
        "원인: 소성변형 → 전위 밀도 증가 → 경도 상승. 오스테나이트계 STS·Ni기 초합금에서 현저. 트리거: rubbing, 여러 패스 겹침, 얇은 칩. 증상: 표면경도 HRC +10~20, 다음 공구 급속마모. 대응: '두껍게 한 번에' 원칙, fz↑, 패스 수↓, 날카로운 날.",
      expert:
        "원인: 전위 포화(dislocation saturation)로 σ_y 상승. STS304: 가공 후 표면층 HV200→HV450, 심도 50~200μm. Inconel718: HV350→HV550. 트리거: h < h_critical ≈ 2·rε → 소성역만 통과. 증상: 2차 가공 시 VB 3~5배 급증, 표면 백색층(white layer) SEM 관찰. 대응: ① fz를 경화층 두께의 2배 이상으로 (통상 fz ≥ 0.1mm) ② 양각 경사 +10~15° ③ 패스 수 최소화 ④ 경화층 완전 제거까지 1회 절삭. 출처: M'Saoubi et al. (2014) CIRP Ann. 63/2.",
    },
    whyItMatters:
      "스테인리스/슈퍼알로이 가공의 최대 난제. 가공경화를 모르면 공구비가 2~5배 뛴다.",
    realWorldExample:
      "STS304 ap=5 fz=0.05로 3패스 → 마지막 날이 표면 HV450 층을 긁다 10분 만에 사망. ap=15 fz=0.12 1패스로 바꾸니 T=90 min.",
    commonPitfall:
      "'정삭은 얇게' 공식을 그대로 적용. 오스테나이트계는 역설적으로 '정삭도 두껍게'. fz < 0.05는 금기.",
    relatedConcepts: ["rubbing", "hex-chip-thickness", "tool-wear", "pass-plan"],
    sourceAuthority: "M'Saoubi et al. (2014) CIRP Annals 63/2, ASM Handbook Vol.16",
  },

  "tool-deflection": {
    id: "tool-deflection",
    korean: "공구 변형 현상",
    english: "Tool Deflection (Physical Phenomenon)",
    category: "phenomenon",
    definition: {
      beginner:
        "공구가 힘을 받아 휘어지는 현상. 길고 얇은 공구일수록 많이 휜다. 눈에 보이지 않아도 수십 μm 휘어져 있다.",
      intermediate:
        "원인: 측면 절삭력 Fc·Ff가 공구에 캔틸레버 모멘트 부과. L/D > 3일 때 심각. 증상: 벽 테이퍼·바닥 언더컷·치수 산포. 대응: stick-out 0.5~0.7x, 네크다운 공구, ap·ae 분할, 강성 홀더(수축 끼움·유압).",
      expert:
        "원인: δ = F·L³/(3EI). L³ 의존성으로 L/D 3→4 시 편향 2.37배. E_초경 ≈ 600GPa, E_HSS ≈ 210GPa (초경이 3배 강성). 증상: 벽 상부-하부 치수차 10~80μm, 정삭면 떨림 마크. 대응: ① stick-out 최소화(k∝1/L³) ② L/D > 4 시 네크다운/스텁렝스 ③ ap 분할로 Fc 감소 ④ HSK/유압 홀더(반복정밀 <3μm) ⑤ 편향 역보정 오프셋. 출처: MJ Jackson (2006) Ch.5, ASME B5.54.",
    },
    whyItMatters:
      "채터의 전 단계. 편향이 누적되면 결국 진동으로 발산. 정밀도의 숨은 주범.",
    realWorldExample:
      "Ø8 L=40 초경 엔드밀로 25mm 벽 정삭 → 상부 정치수, 하부 +35μm 부풀음. L=25로 줄이니 편향 Δ=5μm로 공차 이내.",
    commonPitfall:
      "'공구는 안 휜다'고 믿는 초보 실수. 초경도 FEM 하면 수십 μm 휘어진다. 보정 또는 조건 축소 필수.",
    relatedConcepts: ["deflection", "chatter", "stick-out", "l-over-d-ratio"],
    sourceAuthority: "MJ Jackson (2006) Ch.5, ASME B5.54",
  },

  "tool-wear": {
    id: "tool-wear",
    korean: "공구 마모 — Flank/Crater Wear",
    english: "Tool Wear (Flank & Crater)",
    category: "phenomenon",
    definition: {
      beginner:
        "공구의 날이 시간이 지나며 닳는 현상. 옆면이 닳으면 flank 마모, 윗면에 구덩이가 파이면 crater 마모. 한계까지 가면 공구를 교체해야 한다.",
      intermediate:
        "원인: 기계적 마모(abrasion) + 화학적 확산(diffusion) + 응착(adhesion) + 산화. VB(flank wear land)·KT(crater depth) 측정. 한계: VB = 0.3mm (ISO 3685). 증상: 절삭력 증가, 치수 변화, 표면 악화, 소음.",
      expert:
        "원인: ① Abrasive wear (경질 개재물 알갱이 긁힘, 저속) ② Adhesive wear (BUE 반복, 중저속) ③ Diffusion wear (C·Co가 칩으로 확산, 고속 고온) ④ Oxidation wear (800°C+ 공기 산화). 기준: ISO 3685 VB_avg=0.3mm, VB_max=0.6mm, KT=0.06+0.3f, 노치마모 VN=1mm. 증상: Fc +20~50%, 표면 Ra 2~5배, 치수 드리프트, 청색 열발광. 대응: ① Vc -15% (마모 ∝ V^4) ② 내열 코팅 (AlTiN/AlCrN) ③ 쿨런트 강화 ④ 조기교체 예방보전. 출처: ISO 3685, Trent & Wright (2000) Ch.8.",
    },
    whyItMatters:
      "공구교체 시점을 놓치면 불량률·파손이 기하급수적. 예측·모니터링이 스마트 가공의 핵심.",
    realWorldExample:
      "Ø12 AlTiN 초경 SCM440 Vc=180 → VB 40분에 0.2, 55분에 0.3(교체), 65분에 0.6(파손). 50분 교체 규칙으로 파손 0건.",
    commonPitfall:
      "VB만 보고 KT를 무시. 고속 가공은 크레이터가 먼저 무너져 급파손. 양쪽 다 측정 또는 시간 기반 교체.",
    relatedConcepts: ["tool-life", "taylor-equation", "edge-chipping", "heat-build-up"],
    sourceAuthority: "ISO 3685 Tool Life Testing, Trent & Wright (2000) Ch.8",
  },

  "edge-chipping": {
    id: "edge-chipping",
    korean: "에지 치핑 — 날 결손",
    english: "Edge Chipping",
    category: "phenomenon",
    definition: {
      beginner:
        "공구 날이 조금씩 깨져 나가는 현상. 단속절삭·딱딱한 재료에서 잘 생긴다. 한 번 깨지면 가속적으로 망가진다.",
      intermediate:
        "원인: 충격 하중(단속절삭, 경계 진입/이탈), 과대 fz, 경질 개재물, 재료 경도 불균일. 증상: 날 연속 요철, 표면 뜯김, Fc 불규칙 피크. 대응: fz 감소, 경사 진입(ramp/roll-in), 강인성 높은 공구재(K20→K30) + 인성 코팅.",
      expert:
        "원인: ① 진입 충격 σ_peak > 공구 굴곡강도(TRS 초경 2500~4500 MPa) ② 경질 개재물(탄화물·산화물) 충돌 ③ 열충격(단속절삭 ΔT 400°C+ 반복) ④ 과대 fz로 칩 부하 급증. 증상: 날 에지에 0.05~0.5mm 결손, 불규칙 간격, 가속도계 임펄스 피크. 대응: ① roll-in/ramp 진입 (충격 5x 감소) ② fz를 25~50% 감소 (단속부) ③ 서브마이크론 초경 또는 세라믹/CBN 부적합 → 서멧 ④ 양각 10~15° 대신 0°/음각으로 에지 보강 ⑤ T-land (0.1mm × −15°) 에지 보강. 출처: Byrne et al. (2003) CIRP Ann. 52/2.",
    },
    whyItMatters:
      "플랭크 마모보다 훨씬 빠른 공구사망. 예측 어렵고, 한 번 시작되면 분 단위로 악화.",
    realWorldExample:
      "SCM440 단조면 (HB280) 경계 가공, 초경 Ø16 fz=0.15 진입 → 3분 만에 날 결손 0.3mm. roll-in 5°로 바꾸고 fz=0.1로 감소 → 날 40분 유지.",
    commonPitfall:
      "'더 강한 공구'를 찾는 것. 강인성과 경도는 트레이드오프. 단속절삭은 C2→C6급 서브마이크론 초경 + T-land가 정답.",
    relatedConcepts: ["tool-wear", "fz", "slotting", "altin-coating"],
    sourceAuthority: "Byrne, Dornfeld, Denkena (2003) CIRP Annals 52/2",
  },
}
