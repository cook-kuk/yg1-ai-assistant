// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 교육 모드 콘텐츠 DB · Operation 카테고리
// 가공 전략·공정 12 entries (slotting/HEM/finishing/trochoidal 등)

import type { EducationDb } from "../education-content"

export const OPERATION_ENTRIES: EducationDb = {
  "slotting": {
    id: "slotting",
    korean: "슬로팅 (홈가공)",
    english: "Slotting",
    category: "operation",
    definition: {
      beginner:
        "공구 지름 그대로 홈을 파는 가공. 공구의 양쪽 날이 모두 재료와 닿아서 힘이 두 배. 가장 힘든 공정.",
      intermediate:
        "RDOC=100%D (full slot). 칩 배출 공간 부족으로 재칩핑(re-cutting) 발생 가능. 권장 ADOC 0.5-1.0×D, SFM -30% 보정, IPT -20% 보정. 탄소강/스테인리스/공구강 일반적.",
      expert:
        "Slotting: RDOC=100%D, ADOC≤1.0×D (일반강), ≤0.5×D (Inconel/Ti). Chip load 양쪽 대칭 → Fz 2배 부하. 파라미터 보정: Vc×0.7, IPT×0.8 (대비 side milling), power ≈ 2× side milling. 적합 재질: low-C steel, 304 SS, Al. 기피: hardened steel >50 HRC (trochoidal 대체), Inconel (HEM 권장). Chip evacuation 필수 → through-spindle coolant 또는 air blast. 출처: Sandvik Coromant Turning & Milling Handbook §5.",
    },
    whyItMatters:
      "슬로팅은 가장 가혹한 밀링 조건이라 공구 수명·파손 판단의 벤치마크가 된다. 슬롯을 가능하다면 trochoidal/HEM으로 회피하는 게 현대 전략.",
    realWorldExample:
      "SCM440 Ø10 Z4 엔드밀 슬로팅: Vc 80 m/min(사이드 120의 67%), IPT 0.04, ADOC 8 mm. Fz=510 mm/min, MRR 40.8 cm³/min.",
    commonPitfall:
      "슬로팅에서 IPT를 사이드밀링과 동일하게 잡으면 공구 치핑. 반드시 -20% 보정. 또한 ADOC를 1×D 넘기면 칩 배출 막혀 공구 파손.",
    relatedConcepts: ["side-milling", "trochoidal", "hem", "adaptive-clearing", "through-spindle"],
    sourceAuthority: "Sandvik Coromant Turning & Milling Handbook §5",
  },

  "side-milling": {
    id: "side-milling",
    korean: "사이드 밀링 (측면가공)",
    english: "Side / Peripheral Milling",
    category: "operation",
    definition: {
      beginner:
        "공구 옆면으로 재료 측면을 깎는 가공. 한쪽 날만 일하니까 슬로팅보다 훨씬 편함. 가장 일반적인 형태.",
      intermediate:
        "RDOC < 공구 Ø(보통 10-50%D). ADOC 크게 가능(1-3×D). climb/conventional 선택에 따라 표면 조도·공구수명 차이. 카탈로그 '기준' 조건이 side milling.",
      expert:
        "Side milling: RDOC 0.1-0.5×D (표준), ADOC 1-3×D. Climb (상향절삭) 권장: Fz 감소, 표면 Ra 개선, 공구수명 1.3배. Conventional (하향) 시 표면 경화층에 먼저 닿아 work-hardening 리스크. Chip thinning 보정: hex = IPT·√(1-(1-2RDOC/D)²), RDOC<D/2에서 실효 chip load↓. 보정 적용 시 IPT×1.3-1.8 상향. 적합 재질: 전 재질 범용. SFM 100% (기준). 출처: Sandvik Milling Handbook §6 / ISO 3685.",
    },
    whyItMatters:
      "카탈로그의 Vc/Fz는 'RDOC 50% 사이드밀' 전제. 다른 공정은 여기서 보정해서 쓴다. 시뮬레이터의 '기준점'.",
    realWorldExample:
      "6061-T6 Al Ø12 Z3 사이드밀 Vc 350 m/min, RDOC 3 mm (25%D), ADOC 20 mm, IPT 0.10 × chip-thinning ×1.5=0.15. Fz=4,178 mm/min.",
    commonPitfall:
      "RDOC를 5%D 이하로 좁히면 chip thinning으로 실효 chip load 극저 → 공구와 재료 '스치기' → rubbing/glazing 마모 가속. IPT 상향 필수.",
    relatedConcepts: ["slotting", "hem", "finishing", "trochoidal", "profiling"],
    sourceAuthority: "Sandvik Coromant Milling Handbook §6 / ISO 3685",
  },

  "hem": {
    id: "hem",
    korean: "HEM (High Efficiency Milling)",
    english: "HEM — High Efficiency Milling",
    category: "operation",
    definition: {
      beginner:
        "공구를 깊게 꽂고 얇게 옆으로 가는 기법. 공구 전체가 고르게 닳아서 오래 쓸 수 있음. 같은 시간에 더 많이 깎음.",
      intermediate:
        "ADOC 크게(2-3×D), RDOC 작게(5-15%D). Chip-thinning으로 IPT 상향. MRR 3-5배·공구수명 3-5배 동시 달성. 현대 CAM(HSM, Adaptive)의 기본 전략.",
      expert:
        "HEM: RDOC 5-15%D, ADOC 2-3×D. Chip thinning RCTF = √(1-(1-2·RDOC/D)²), 적용하여 IPT_program = IPT_cat / RCTF 상향 보정. 결과: MRR×3-5 + Tool Life×3-5 동시 달성 (열부하 분산 + 절삭 아크 짧음). SFM +20-30% 허용. 적합 재질: 전 재질 특히 SS/Inconel/Ti/hardened steel (≤55 HRC)에서 효과 극대. 머신: rigid high-feed, 룩어헤드 buffer 충분해야. 출처: Harvey Performance HEM Guidebook / Makino High Feed Milling Technical Bulletin.",
    },
    whyItMatters:
      "같은 공구·같은 머신으로 MRR 3배·공구수명 3배. 현대 가공 생산성의 게임체인저. 시뮬레이터의 'HEM 모드'는 항상 먼저 검토할 옵션.",
    realWorldExample:
      "Inconel 718 Ø10 Z5: 전통 슬로팅 Vc 30, IPT 0.04, ADOC 3, MRR 7.2 cm³/min / HEM Vc 40, IPT 0.08(×1.8 RCTF), ADOC 25, RDOC 1, MRR 25 cm³/min. 3.5배.",
    commonPitfall:
      "머신 강성 부족(soft BT40 + 긴 스틱아웃) + HEM → 채터로 오히려 공구 파손. 반드시 rigid 환경(HSK+짧은 L/D) 확인 후 적용.",
    relatedConcepts: ["trochoidal", "adaptive-clearing", "dynamic-milling", "slotting", "side-milling"],
    sourceAuthority: "Harvey Performance HEM Guidebook / Makino High Feed Milling Technical Bulletin",
  },

  "finishing": {
    id: "finishing",
    korean: "피니싱 (마감가공)",
    english: "Finishing",
    category: "operation",
    definition: {
      beginner:
        "마지막에 표면을 예쁘게 다듬는 가공. 얇게, 빠르게, 살살. 공구 새것 쓰고 치수 정확하게 맞춤.",
      intermediate:
        "얕은 ADOC(0.1-0.5 mm)·좁은 RDOC(<10%D)·높은 Vc(+20%)·낮은 IPT(0.02-0.05). 목표: Ra < 1.6 µm, 치수 IT6-7. 볼·코너 R 엔드밀 위주.",
      expert:
        "Finishing: ADOC 0.1-0.5 mm, RDOC 2-10%D (stepover), Vc ×1.2 (카탈로그 대비), IPT 0.02-0.05 mm/tooth. Surface roughness: Ra_theoretical = (stepover)²/(8·R_tip) for 볼엔드밀. 예: Ø6 볼, stepover 0.15 → Ra=0.47 µm. Cusp height h = R - √(R²-(s/2)²). 적합 재질: 전 재질, 특히 하드밀링(50-65 HRC)·금형강. 공구: 코팅 AlTiN/TiSiN, 볼·코너R, TIR <5 µm 필수 (shrink-fit). 출처: Smid §14 / Sandvik Surface Finish Handbook.",
    },
    whyItMatters:
      "최종 품질(치수/조도)이 결정되는 단계. 앞 공정 대비 0.1-0.5 mm만 남기는 stock 관리가 핵심. 너무 많이 남기면 편향, 너무 적으면 프리 쿨런트 마모.",
    realWorldExample:
      "STAVAX 54HRC Ø4 볼엔드밀 하드밀링 피니싱: Vc 150, RPM 11,937, IPT 0.03, stepover 0.08, MRR 1.1 cm³/min, Ra 0.4 µm (mirror-like).",
    commonPitfall:
      "피니싱에 rough 공구를 그대로 써서 마모된 날끝으로 진행 → 치수 편차 ±20 µm. 반드시 finishing 전용 공구(TIR <5 µm) 교체.",
    relatedConcepts: ["profiling", "side-milling", "shrink-fit", "coating"],
    sourceAuthority: "Smid §14 / Sandvik Surface Finish Handbook",
  },

  "profiling": {
    id: "profiling",
    korean: "프로파일링 (윤곽가공)",
    english: "Profiling / Contouring",
    category: "operation",
    definition: {
      beginner:
        "벽이나 외곽 곡선을 따라가며 깎는 가공. 부품 옆모습을 완성시키는 단계. 코너에서 속도가 순간적으로 느려짐.",
      intermediate:
        "2D/3D 윤곽을 따라 공구가 이동. RDOC 10-30%D, ADOC 0.5-1.5×D 일반. 코너 감속(deceleration) 발생 → 공구 부하 변동. climb 원칙.",
      expert:
        "Profiling: RDOC 0.1-0.3×D, ADOC 0.5-1.5×D. 코너 진입 시 '효과적 engagement' 순간 증가(내측 코너) → Fz 스파이크 1.5-2배. 대응: (1) arc-in/arc-out, (2) 코너 feed override 50-70%, (3) CAM trochoidal corner. SFM 기준의 ±10%, IPT는 climb 카탈로그값. 적합 재질: 전 재질. 공구: 4-6 날 엔드밀(표면), 2-3 날(러핑). 머신 look-ahead buffer 충분해야 코너 정밀 확보. 출처: Sandvik Milling Handbook §7 / Mastercam Profile Strategy Guide.",
    },
    whyItMatters:
      "부품 외관·치수를 결정하는 윤곽 공정. 코너 부하 스파이크를 이해 못하면 공구 치핑 반복. CAM 전략에서 arc-in/out이 기본.",
    realWorldExample:
      "6061 Ø8 Z4 프로파일링 외곽 800 mm: Vc 280 m/min, n 11,141 rpm, IPT 0.08, RDOC 2, ADOC 12, Fz 3,565 mm/min. 사이클 13.5 초.",
    commonPitfall:
      "내측 코너에서 feed override 미적용 → 공구 코너 치핑 → 치수 불량 ±30 µm. CAM에서 코너 smoothing 필수 설정.",
    relatedConcepts: ["side-milling", "finishing", "pocketing", "adaptive-clearing"],
    sourceAuthority: "Sandvik Milling Handbook §7 / Mastercam Profile Strategy Guide",
  },

  "pocketing": {
    id: "pocketing",
    korean: "포켓팅 (포켓가공)",
    english: "Pocketing",
    category: "operation",
    definition: {
      beginner:
        "블록 안에 박스 모양 구멍을 파는 가공. 안에 들어간 공구가 빠져나올 수 없어서 칩 빼내기가 어려움.",
      intermediate:
        "closed pocket을 가공. 진입은 ramping/helical/plunging, 내부는 zigzag/spiral/adaptive. 칩 배출·coolant 접근성이 제일 중요.",
      expert:
        "Pocketing: 표준 RDOC 40-60%D (zigzag), ADOC 0.5-1.5×D. 현대 방식: adaptive(RDOC 10-15%D·ADOC 2×D) + trochoidal 코너. 진입 전략: (1) ramping angle 2-5° (가장 범용), (2) helical bore 1×D 구멍 후 plunge, (3) pre-drill hole 후 plunge. 적합 재질: 전 재질. SFM ±0 (표준), IPT 표준. Chip evacuation 난이도↑ → through-spindle coolant 강력 권장. 출처: Sandvik Coromant Pocketing Guide / Mastercam HSM.",
    },
    whyItMatters:
      "금형/항공/자동차 부품의 40% 이상이 포켓 형상. 진입·칩 배출 전략이 사이클 타임과 공구 수명의 80%를 결정.",
    realWorldExample:
      "Al6061 100×60×25 포켓 Ø10 Z3: 전통 zigzag 45 sec + 공구수명 3 pc/life / Adaptive(RDOC 1.5, ADOC 20) 18 sec + 12 pc/life. 2.5배 단축·4배 수명.",
    commonPitfall:
      "closed 포켓에서 plunge 진입 시 non-center cutting 엔드밀 사용 → 날 중심부 충돌·파손. helical 진입 또는 center-cutting 스펙 확인 필수.",
    relatedConcepts: ["adaptive-clearing", "trochoidal", "ramping", "plunging", "through-spindle"],
    sourceAuthority: "Sandvik Coromant Pocketing Guide / Mastercam Dynamic Milling Documentation",
  },

  "facing": {
    id: "facing",
    korean: "페이싱 (면삭)",
    english: "Facing",
    category: "operation",
    definition: {
      beginner:
        "재료 윗면을 평평하게 깎아내는 가공. 소재 표면의 녹·스케일 제거하고 기준면 만들기. 큰 면삭 커터로 한 번에.",
      intermediate:
        "Ø 50-125 mm face mill, RDOC 60-80%D, ADOC 1-5 mm (1회), IPT 0.1-0.3. 중복율 70% 권장. 표면 마감도 겸비.",
      expert:
        "Facing: face mill Ø 50-160 mm (주로 인덱서블), RDOC 60-80%D of cutter, ADOC 0.5-5 mm, IPT 0.10-0.25. 진입·이탈 arc 적용으로 치핑 방지 (inserted cutter는 entry angle critical). SFM 카탈로그 기준 ±10%, entry angle 45° 페이스밀은 chip thinning 1.4배 → IPT 상향. 적합 재질: 전 재질. 목적: (1) 기준면, (2) 스케일 제거, (3) 마감. 대표 공구: Sandvik 345 face mill, Mitsubishi WNEU, Kennametal KSHP. Ra 1.6-3.2 달성. 출처: Sandvik Face Milling Handbook / ISO 6462.",
    },
    whyItMatters:
      "첫 공정 '기준면 만들기'는 이후 모든 치수의 origin. 비뚤거나 스케일이 남으면 후속 공정 누적오차로 이어져 치수 불량 다발.",
    realWorldExample:
      "SS400 300×200 블록 기준면: Ø80 인덱서블 Z6, Vc 250 m/min, n 995 rpm, IPT 0.20, Fz 1,194 mm/min, RDOC 56 (70%), ADOC 2. 1패스 30 sec.",
    commonPitfall:
      "인덱서블 페이스밀 날 중 1개만 마모·손상 → 표면에 일정 간격 scratch stripe. 매 교체 전 인서트 전수 검사 필수.",
    relatedConcepts: ["side-milling", "finishing", "profiling"],
    sourceAuthority: "Sandvik Face Milling Handbook / ISO 6462",
  },

  "trochoidal": {
    id: "trochoidal",
    korean: "Trochoidal (트로코이달)",
    english: "Trochoidal Milling",
    category: "operation",
    definition: {
      beginner:
        "공구가 원을 그리면서 슬슬 앞으로 나가는 기법. 공구와 재료가 잠깐만 닿아서 열이 덜 나고 오래 씀.",
      intermediate:
        "슬로팅에서 공구 직경보다 좁은 폭으로 원호 진입. RDOC 5-15% × LOC 전체 활용. Inconel/경화강 슬롯가공 표준.",
      expert:
        "Trochoidal: circular/epicycloidal 진동 경로, RDOC 5-15%D, ADOC 1-3×D (LOC 전체), step_forward = RDOC·k (k=0.5-1). SFM +30-50%, IPT_prog = IPT/RCTF 상향. 한 사이클 arc engagement ≤90° → heat sink 시간 충분. 적합 재질: Inconel 718, 300M steel, SKD11, Stavax 55-62HRC, Ti-6Al-4V (슬로팅 조건에서 특히 유리). 공구수명 전통 슬로팅 대비 3-10배. CAM: Mastercam Dynamic Mill, Fusion Adaptive, Siemens NX Adaptive. 출처: Volumill Technical Whitepaper / Sandvik HRSA Machining Guide.",
    },
    whyItMatters:
      "Inconel·경화강에서 전통 슬로팅은 공구 수명 5-10분. Trochoidal로 바꾸면 30-50분. 경제성의 본질적 격변.",
    realWorldExample:
      "Inconel 718 Ø10 Z5 슬롯 폭 12mm: 전통 슬롯 Vc 25, IPT 0.04, 5분에 공구 치핑 / Trochoidal Vc 40, IPT 0.06, ADOC 25, RDOC 1.5, 수명 42분.",
    commonPitfall:
      "CAM에서 trochoidal step-over를 RDOC의 100%로 잡으면 각 회전 간 재료 겹침 없음 → 가공 안 됨. step-over/RDOC = 0.3-0.7 유지 필수.",
    relatedConcepts: ["slotting", "hem", "adaptive-clearing", "dynamic-milling"],
    sourceAuthority: "Volumill Technical Whitepaper / Sandvik HRSA Machining Application Guide",
  },

  "adaptive-clearing": {
    id: "adaptive-clearing",
    korean: "Adaptive Clearing (적응 가공)",
    english: "Adaptive Clearing",
    category: "operation",
    definition: {
      beginner:
        "CAM이 공구 부하를 일정하게 유지하면서 길을 만들어주는 똑똑한 가공. 코너에서도 속도 안 떨어짐.",
      intermediate:
        "일정 engagement angle(보통 30°)을 유지하는 경로 생성. HEM의 CAM 구현. Fusion 360/HSMWorks의 'Adaptive' 전략.",
      expert:
        "Adaptive Clearing: CAM engine이 공구와 재료의 tool engagement angle(TEA)을 상수(일반 30-60°)로 유지하는 경로 계산. RDOC 5-15%D·ADOC 2-3×D로 HEM 조건을 자동 생성. Chip thinning 보정 자동 IPT 상향. 전통 pocket(RDOC 50%)대비 MRR 2-4배, 공구수명 3-5배. CAM 구현: Autodesk HSM/Fusion 'Adaptive', Mastercam Dynamic, Siemens NX HSC, PowerMill Vortex. 적합 재질: 전 재질, 특히 Inconel/Ti/hardened. SFM +20-30%. 출처: Autodesk HSM Documentation / CAM Industry Review.",
    },
    whyItMatters:
      "HEM의 이점을 CAM이 자동으로 만들어줘서 프로그래머가 수작업으로 chip thinning 계산 안 해도 된다. 현대 CAM의 표준 기능.",
    realWorldExample:
      "P20 금형강 200×150 포켓 Ø10 Z4: 전통 zigzag 4분 + 공구 2 pc / Adaptive(TEA 45°, RDOC 1.2, ADOC 20) 1분 40초 + 공구 5 pc. 2.4배·2.5배.",
    commonPitfall:
      "Adaptive 경로는 G-code block 수 5-10배 증가. 구형 컨트롤러(FANUC 0i 이전) look-ahead 부족으로 programmed feed 못 냄 → 실 사이클 2배.",
    relatedConcepts: ["hem", "trochoidal", "dynamic-milling", "pocketing"],
    sourceAuthority: "Autodesk HSM Documentation / Mastercam Dynamic Milling Technical Guide",
  },

  "dynamic-milling": {
    id: "dynamic-milling",
    korean: "Dynamic Milling (다이나믹 밀링)",
    english: "Dynamic Milling (Mastercam)",
    category: "operation",
    definition: {
      beginner:
        "Mastercam이 만든 똑똑한 가공 전략. Adaptive와 비슷한데 더 정교하게 칩 두께를 관리. 경로가 부드럽고 공구가 오래 감.",
      intermediate:
        "engagement 제어 + micro-lifts(순간 떼기)로 잔열 제거. ADOC 2-3×D, RDOC 5-10%D. Mastercam 전용 용어지만 개념은 HEM과 동일.",
      expert:
        "Dynamic Milling: Mastercam의 HEM 구현. 특징: (1) micro-lift motion (공구가 0.1mm 순간 떨어져 재접촉, 열 해소), (2) peel/core mill 옵션 분리, (3) back-feed motion (비절삭 구간 high feed rapid). 표준 파라미터 RDOC 5-10%D, ADOC 2-3×D, stepdown 2-3×D, entry helical. Chip thinning 자동. SFM +30%, IPT 1.5-2× 상향. 적합 재질: 전 재질 (특히 스테인리스 17-4PH, Inconel, Ti, 하드밀링 55HRC 이하). 대표 머신: rigid BT40/HSK 머시닝센터 룩어헤드 600+ block. 출처: Mastercam Dynamic Motion Technical White Paper (2019).",
    },
    whyItMatters:
      "Mastercam 점유율 한국 40%+, 한국 영업에선 'Dynamic' 용어가 사실상 HEM의 대명사. 고객 대화 시 호환 용어로 숙지 필수.",
    realWorldExample:
      "17-4PH SS Ø8 Z4 포켓 100×80×15: 전통 contour 3:20 + 공구 2 pc / Dynamic(RDOC 0.6, ADOC 14, Vc 180, IPT 0.10) 1:10 + 5 pc. 2.9배 단축.",
    commonPitfall:
      "Dynamic 경로를 구형 컨트롤러(FANUC 0i Mate-D 등)에서 실행 시 block 과다로 feed 50% drop. 최신 31i/MB 또는 Siemens 840D 권장.",
    relatedConcepts: ["hem", "trochoidal", "adaptive-clearing", "pocketing"],
    sourceAuthority: "Mastercam Dynamic Motion Technical White Paper (2019) / Harvey Performance HEM Guidebook",
  },

  "ramping": {
    id: "ramping",
    korean: "Ramping (나선 진입)",
    english: "Ramping / Helical Entry",
    category: "operation",
    definition: {
      beginner:
        "공구가 비스듬하게 또는 나선을 그리며 재료로 들어가는 방식. 수직 찍기보다 부드러워서 공구가 안 부러짐.",
      intermediate:
        "ramp angle 1-5° (linear ramp) 또는 helical (0.3-0.7×D 직경 나선). non-center cutting 엔드밀에서도 사용 가능. 포켓 진입의 기본.",
      expert:
        "Ramping: (1) linear ramp angle 2-5° (일반강), 1-2° (Inconel), 5-8° (Al), (2) helical bore: diameter 0.5-0.7×D_tool, pitch (Z 하강)/rev = ramp_angle·π·D_helix. ADOC_effective = full LOC, RDOC 50%D. 진입 Fz: IPT_ramp = IPT_side × cos(ramp_angle). 적합: 모든 closed pocket 진입, 비관통 hole bore. 대안 plunging(수직)은 center-cutting 엔드밀만, non-center 엔드밀은 반드시 ramping. 출처: Sandvik Milling Entry Strategy Guide / Harvey Performance Tool Engagement Guide.",
    },
    whyItMatters:
      "포켓 가공 100% 진입 단계이며, 진입 실수는 공구 파손 #1 원인. Ramp angle 선택이 CAM 프로그래밍의 기본.",
    realWorldExample:
      "SCM440 closed pocket Ø10 4날: helical bore Ø5 진입, pitch 0.3 mm/rev, Vc 120, n 3,820 rpm, Fz 1,146 mm/min, ADOC 15mm 진입 시간 3.9 sec.",
    commonPitfall:
      "non-center cutting 엔드밀(일반 4날 square)로 수직 plunge → 중심부 날 없어 rubbing → 1-2초 내 공구 파손. ramp 또는 pre-drill 필수.",
    relatedConcepts: ["plunging", "pocketing", "adaptive-clearing"],
    sourceAuthority: "Sandvik Milling Entry Strategy Guide / Harvey Performance Tool Engagement Guide",
  },

  "plunging": {
    id: "plunging",
    korean: "Plunging (수직 진입)",
    english: "Plunging / Z-Axis Drilling",
    category: "operation",
    definition: {
      beginner:
        "드릴처럼 공구를 재료에 수직으로 찍는 방식. center-cutting 엔드밀만 가능. 빠르지만 부하가 큼.",
      intermediate:
        "Z축 방향 직진 진입. center-cutting 엔드밀(중심 날 있음) 또는 plunge mill 전용 공구 필요. ADOC/rev=IPT·Z_teeth. RDOC=100%(slot).",
      expert:
        "Plunging: Z-axis only 진입, Vc (sfm) 드릴링 조건 적용(카탈로그 Vc×0.5-0.7), IPT_plunge = 0.02-0.05 mm/tooth (IPT_side의 30-50%). 공구 요건: center-cutting end mill 또는 전용 plunge mill (2-4 flute, 반경 0.5°-1° relief). 칩 배출 위해 peck cycle (G83) 권장: peck depth 0.5-1×D. ADOC_max 1.5-2×D. 적합: pre-drill 없는 포켓 진입, 깊은 hole bore. 기피: long-reach (L/D>4) tool 파손 위험↑. 출처: Harvey Performance Plunge Milling Guide / Smid §11.",
    },
    whyItMatters:
      "pre-drill 없이 포켓 진입 가능해 CAM setup 시간 절약. 다만 공구·파라미터 잘못 선택 시 ramping보다 파손율 3배.",
    realWorldExample:
      "A5052 Ø10 4F center-cutting plunge, Vc 100 m/min, n 3,183, IPT 0.04, Fz(Z) 509 mm/min, peck 5mm × 3 → 15mm 홀 1.8sec + retract.",
    commonPitfall:
      "카탈로그에 'center cutting'이라고 해도 실제 중심부 직경 ≠ 전체 Ø → chip load 계산 시 유효 날수 효과적으로 2날로 봐야함. IPT 과대 → 파손.",
    relatedConcepts: ["ramping", "slotting", "pocketing"],
    sourceAuthority: "Harvey Performance Plunge Milling Guide / Smid Tool Engineers Handbook §11",
  },
}
