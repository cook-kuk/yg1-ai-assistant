// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 교육 콘텐츠: 가공 기법 (technique)
// Climb vs Conventional, Dial 조정, Taylor 경제속도, 최적화 모드 등 실전 기법.

import type { EducationDb } from "../education-content"

export const TECHNIQUE_ENTRIES: EducationDb = {
  "climb-vs-conventional": {
    id: "climb-vs-conventional",
    korean: "Climb vs Conventional — 다운컷 vs 업컷",
    english: "Climb vs Conventional Milling",
    category: "technique",
    definition: {
      beginner:
        "공구 회전 방향과 이송 방향이 같으면 클라임(다운컷), 반대면 컨벤셔널(업컷). 다운컷은 칩이 두꺼운 데서 시작해 얇게 끝남. 현대 CNC 표준.",
      intermediate:
        "Climb(다운컷): 칩두께 h_max → 0, 공구 아래로 누르는 힘, 표면 좋음, 공구수명 ↑. Conventional(업컷): h 0 → h_max, 공구 위로 들어올림, rubbing 진입, 백래시 있으면 위험. CNC 볼스크류는 Climb 기본.",
      expert:
        "Climb: 칩 진입 h=h_max → 이탈 h=0. 장점: 공구수명 +30~50%, Ra 30% 개선, 가공경화 층 얇게 이탈. 단점: 첫 접촉 충격(단조 스킨에 치명). Conventional: h=0 진입 → 임계 h_min 이하 구간에서 rubbing 불가피. 사용: 리지드 CNC(백래시<5μm)는 climb 99%. 업컷은 주철 스킨·단조 흑피·수동밀·백래시 있는 머신에만. 출처: Sandvik Handbook §3.2, Shaw (2005) Ch.2.",
    },
    whyItMatters:
      "같은 조건에서 공구수명·표면·정밀도가 모두 30~50% 차이. CNC에서 업컷 쓰면 비용 손해.",
    realWorldExample:
      "SM45C 사이드 밀링 Climb: Ra 1.2, T=60 min. 같은 조건 Conventional: Ra 2.1, T=40 min. 경제적으로 Climb 우세.",
    commonPitfall:
      "백래시 있는 수동 범용 밀링에서 Climb 쓰면 공구가 끌려가 사망. 머신 강성 먼저 확인.",
    relatedConcepts: ["hex-chip-thickness", "rubbing", "tool-life"],
    sourceAuthority: "Sandvik Handbook §3.2, Shaw (2005) Ch.2",
  },

  "speed-dial": {
    id: "speed-dial",
    korean: "Speed dial ±% — 속도 미세조정",
    english: "Spindle Speed Override Dial",
    category: "technique",
    definition: {
      beginner:
        "RPM을 가공 중에 ±10~20% 조정하는 다이얼. 채터가 나면 속도를 조금 바꿔 진동 주파수를 틀어준다.",
      intermediate:
        "언제: 채터 징후(소음·줄무늬)·표면 악화·공구수명 미달. 얼마나: 통상 ±5~15%, SLD 로브 간 이동용. 주의: 20% 이상은 Taylor에 의해 공구수명 급변(Vc+20% → T −60%).",
      expert:
        "언제: ① 채터 risk > 70% ② 로브 로컬 최적점 탐색 ③ Vc를 Economic 값으로 미세 조정. 얼마나: SLD 로브 주기 Δn ≈ f_chatter·60/z·(1±1/k), 통상 ±10~15%. 주의: ① V·T^n=C로 +10%는 T −35% ② Pc = f(n)이므로 스핀들 kW·토크 재확인 ③ 이송 f=fz·z·n 연동 변경 ④ 이송은 Feed dial로 별도 조정. 출처: Altintas (2000) Ch.3.3, Tlusty (2000).",
    },
    whyItMatters:
      "현장에서 '채터 나면 RPM 바꿔봐'가 통하는 이유. 근본 변경 없이 즉시 안정화 가능한 1차 대응책.",
    realWorldExample:
      "Ø10 엔드밀 n=3000에서 채터. +12%(3360)로 이동 시 안정. 반대로 -8%(2760)도 안정. 사이 영역은 여전히 불안정.",
    commonPitfall:
      "±20% 이상 감소로 '안전하게' 가려다 오히려 rubbing·BUE 진입. 또는 +20% 상승으로 수명 절반 희생.",
    relatedConcepts: ["chatter", "chatter-risk", "taylor-equation", "vc"],
    sourceAuthority: "Altintas (2000) Manufacturing Automation Ch.3.3",
  },

  "feed-dial": {
    id: "feed-dial",
    korean: "Feed dial ±% — 이송 미세조정",
    english: "Feed Override Dial",
    category: "technique",
    definition: {
      beginner:
        "이송속도를 가공 중에 ±퍼센트로 바꾸는 다이얼. 떨리면 줄이고, 여유 있으면 올려서 시간을 줄인다.",
      intermediate:
        "언제: 절삭력 피크·공구 편향 관찰·신규 재료 탐색 첫 커트. 얼마나: 황삭 ±20% 허용, 정삭 ±10%. 주의: fz 감소는 rubbing, 증가는 Fc·파손.",
      expert:
        "언제: ① 신규 공정 ramp-up 시 안전마진 확보 ② 실시간 Fc 모니터링 피드백 ③ 코너·진입부 동적 감소. 얼마나: 범위 50~150% (머신 표준), 권장 80~120%. 주의: ① fz ↓ → hex < h_min → rubbing·경화 ② fz ↑ → Fc ∝ fz^0.75 → 편향·파손 ③ Ra ∝ fz² → 정삭 영향 큼 ④ 공구수명 ∝ fz^−a, a ≈ 0.5n (Taylor 확장형). 출처: Colding (1959), Sandvik Handbook §3.4.",
    },
    whyItMatters:
      "가공시간의 직접 지배 변수. 안전한 상한을 실시간으로 탐색하는 유일한 수단.",
    realWorldExample:
      "SCM440 황삭 시작 fz=0.08 (override 100%). 5분 모니터링 후 Fc 여유 확인, override 125%로 올려 사이클 4분 단축.",
    commonPitfall:
      "Feed override 100% 고정. 소재 편차·공구 마모 미반영. 실시간 적응 제어가 생산성의 핵심.",
    relatedConcepts: ["fz", "rubbing", "fc-cutting-force", "corner-adjustment"],
    sourceAuthority: "Colding (1959), Sandvik Handbook §3.4",
  },

  "corner-adjustment": {
    id: "corner-adjustment",
    korean: "Corner Adjustment — 코너 이송 보정",
    english: "Corner Feed Reduction",
    category: "technique",
    definition: {
      beginner:
        "공구가 코너를 돌 때는 살짝 더 깊이 먹히게 된다. 그래서 코너에서만 이송을 줄여줘야 공구가 안 부러진다.",
      intermediate:
        "언제: 내측 코너(in-corner) 진입 시 실질 ae 증가. 얼마나: 통상 fz의 50~70%로 감소. 또는 R_tool < R_corner 조건 확보(R_tool ≤ 0.7·R_corner).",
      expert:
        "언제: 내측 코너에서 engagement angle 순간 증가 → ae_eff 최대 2x, Fc 2x, 공구 편향 급증·파손 빈발. 얼마나: ae_corner = ae_straight · (1 + R_tool/(R_corner−R_tool)). fz 감소비 = √(ae_straight/ae_corner), 통상 0.5~0.7x. 또는 CAM에서 arc-fitting, smoothing R, 또는 ae 자체를 직선부 70%로 낮추고 코너 통과. 주의: 외측 코너는 반대로 engagement 감소 → 이송 유지 가능. 출처: Sandvik Handbook §3.8, Mastercam Dynamic Mill.",
    },
    whyItMatters:
      "현장 공구 파손 원인 #1. 직선부만 최적화하고 코너를 잊으면 공구비 폭증.",
    realWorldExample:
      "Ø10 엔드밀 ae=5 (0.5D)로 R6 내측 코너 진입 시 ae_eff = 10 (=D, full slot!). fz 65% 감소 + CAM 트로코이달로 평탄화.",
    commonPitfall:
      "CAM에 'Corner feed reduction' 옵션 체크 안 하고 바로 가공. 첫 내측코너에서 공구 직행.",
    relatedConcepts: ["ae", "fz", "feed-dial", "trochoidal"],
    sourceAuthority: "Sandvik Handbook §3.8, Iscar Hi-Feed Guide",
  },

  "pass-plan": {
    id: "pass-plan",
    korean: "Pass Plan — 다단 패스 계획",
    english: "Multi-Pass Planning",
    category: "technique",
    definition: {
      beginner:
        "한 번에 깊게 깎을지, 여러 번에 걸쳐 얕게 깎을지 결정하는 계획. 황삭-중삭-정삭 단계로 나누는 것이 기본.",
      intermediate:
        "언제: 전체 제거 체적 > 공구 1패스 한계(ap_max·ae_max). 얼마나: 황삭 ap=D·1~2, 정삭 ap=D·0.2, 정삭 여유 0.2~0.5mm. 주의: 가공경화 재료는 패스 수 최소화.",
      expert:
        "언제: ① Pc·Fc가 기계·공구 한계 초과 ② 변형·잔류응력 제어 필요 ③ 공차/표면 요구 상이. 얼마나: 황삭 ap_rough = 1~2·D, ae_rough = 0.5~1·D / 중삭 stock 0.5~1mm / 정삭 ap_finish = 0.05~0.2·D, ae_finish = 0.1~0.3·D, stock 0.1~0.3mm. 주의: ① 오스테나이트계 STS는 패스 수 ↓ (가공경화 회피), fz 유지 ② 변형 큰 얇은 벽은 대칭 제거 + 2~3회 반복 ③ 열처리 전/후 분리 ④ 정삭 Ra ∝ fz² 이므로 패스 수가 아닌 fz가 지배. 출처: Sandvik Handbook §6, Smith (2008) Cutting Tool Technology.",
    },
    whyItMatters:
      "사이클타임·공구수명·정밀도·변형 모두를 결정. 잘못된 패스 계획은 좋은 조건을 무의미하게 만듦.",
    realWorldExample:
      "SCM440 30mm 깊이 포켓: 황삭 ap=15 2패스 + 정삭 ap=0.3 1패스. 사이클 18분, Ra 1.6 / 잘못된 계획: ap=3 10패스 = 45분, Ra 3.2.",
    commonPitfall:
      "'안전하게' 얕은 ap로 패스 많이 나누기. 총 시간 ↑ + rubbing + 가공경화 + 공구수명 ↓. 역효과.",
    relatedConcepts: ["ap", "ae", "work-hardening", "tool-life"],
    sourceAuthority: "Sandvik Handbook §6, Smith (2008) Cutting Tool Technology",
  },

  "economic-vc": {
    id: "economic-vc",
    korean: "Economic Vc — Taylor-Ackoff 최저원가 속도",
    english: "Economic Cutting Speed (Taylor-Ackoff)",
    category: "technique",
    definition: {
      beginner:
        "가공원가(기계비 + 공구비)가 최저가 되는 속도. 너무 느리면 시간이 오래 걸리고, 너무 빠르면 공구비가 폭증한다. 그 중간의 황금점.",
      intermediate:
        "V_econ = C · [(1−n)/n · Ct/Co · 1/Tc]^n. 원가 함수의 dCost/dV=0 점. n=0.25 초경 기준 Vc_max_production(생산성)보다 약 30% 낮음.",
      expert:
        "V_econ = C / T_econ^n, 여기서 T_econ = (1/n − 1) · (Ct + t_ct·Co) / Co. Co = 기계+인건비(원/min), Ct = 공구비/인서트(원), t_ct = 교체시간(min). n=0.25, C=250 (SM45C 초경) 예: Co=1000원/min, Ct=5000원, t_ct=2min → T_econ = 3·(5000 + 2000)/1000 = 21min → V_econ = 250/21^0.25 ≈ 117 m/min. 대비 V_max_MRR = 150 m/min은 T=7.7min, 공구비 3배. 출처: Taylor (1907) §20, Ackoff (1956) Operations Research.",
    },
    whyItMatters:
      "'빠를수록 좋다'는 본능을 뒤엎는 정량 근거. 공장 원가의 직접 최적화 지표.",
    realWorldExample:
      "SCM440 n=0.25, C=240, Co=1200, Ct=8000, t_ct=3 → T_econ = 3·(8000+3600)/1200 ≈ 29min → V_econ ≈ 103 m/min. 현장 기본 140을 103으로 내리니 월 공구비 42% 감소, 사이클 12% 증가, 순이익 +18%.",
    commonPitfall:
      "n·C 상수를 추정값으로 쓰기. 실측 없이 공식만 쓰면 오차 ±30%. 1주일 실가공 로그로 Co·Ct·t_ct 교정 필수.",
    relatedConcepts: ["taylor-equation", "tool-life", "taylor-curve", "optimization-mode"],
    sourceAuthority: "Taylor (1907) §20, Ackoff (1956), Gilbert (1950)",
  },

  "taylor-curve": {
    id: "taylor-curve",
    korean: "Taylor Curve — 수명곡선",
    english: "Taylor Tool Life Curve",
    category: "technique",
    definition: {
      beginner:
        "속도(가로축)에 따라 공구수명(세로축)이 어떻게 변하는지 그린 곡선. 로그로 그리면 직선이 된다. 기울기가 공구재 성질을 말해준다.",
      intermediate:
        "log T = (1/n)·log C − (1/n)·log V. log-log 평면에서 직선, 기울기 = −1/n. 제조사 카탈로그 곡선 = 특정 재료·조건의 실측 피팅.",
      expert:
        "V·T^n=C를 log 변환: log V = log C − n·log T → V-T log-log 평면 직선, 기울기 m = −n (절대값 n). HSS: n=0.125 (기울기 완만, 속도 영향 작음) / 초경 0.25 / 세라믹 0.5 / CBN/PCD 0.6~0.7. Taylor 확장형 V·T^n·f^a·d^b = C 는 3D 표면. 곡선 사용법: 제조사 V-T 그래프에서 원하는 T(예 60min)의 V 읽기 → Vc 설정. 주의: 그래프 조건(재료·냉각)과 실제 일치 여부 확인. 출처: Taylor (1907) §15, Sandvik Tool Life Curves Handbook.",
    },
    whyItMatters:
      "공구 선정·속도 설정의 정량적 출발점. 카탈로그의 V-T 곡선이 실제 결정 자료.",
    realWorldExample:
      "Sandvik TiAlN 초경 엔드밀 P재(강) 수명곡선: Vc=200→T=45min, Vc=250→T=20min, Vc=300→T=10min. n≈0.25, C≈260 피팅.",
    commonPitfall:
      "log-log가 아닌 선형 스케일로 보고 '속도-수명이 직선적'이라 오해. 실제는 지수적 감소.",
    relatedConcepts: ["taylor-equation", "tool-life", "economic-vc"],
    sourceAuthority: "Taylor (1907) §15, Sandvik Tool Life Curves Handbook",
  },

  "optimization-mode": {
    id: "optimization-mode",
    korean: "최적화 모드 — 생산성/균형/공구수명",
    english: "Optimization Mode (Productivity / Balanced / Tool Life)",
    category: "technique",
    definition: {
      beginner:
        "무엇을 더 중요하게 볼지 고르는 스위치. '빨리 끝내기'(생산성), '공구 아끼기'(공구수명), 가운데(균형) 3가지.",
      intermediate:
        "Productivity: V_max_MRR ≈ V_econ·(1/n)^n 로 속도 상향 → T 짧음. Tool life: V = 0.7~0.8 · V_econ, T 길고 안정. Balanced: V_econ 기준.",
      expert:
        "세 모드의 선택: ① Productivity — V = C/(T_min)^n, T_min = 공구 교체 허용 최소시간(예 15min). MRR 최대, 공구비 최대. 긴급 납기·공구 충분 시. ② Balanced — V = V_econ (Taylor-Ackoff). 원가 최소. 표준 양산. ③ Tool Life — V = 0.75·V_econ, T ≈ 2·T_econ. 공구조달 어려움·무인 야간가공·정밀 정삭. 얼마나: 모드 간 Vc 차이 통상 20~35%. 주의: ① 모드 전환 시 Fc·Pc·Ra·채터 risk 모두 재계산 ② 사이클타임 변화 ±20~40% ③ 공구비 ±50~200%. 출처: Sandvik Handbook §2, Gilbert (1950).",
    },
    whyItMatters:
      "고객 상황(납기 vs 원가 vs 무인운전)에 따라 정답이 다름. 일관된 정량 프레임이 필요.",
    realWorldExample:
      "SCM440 Ø12 기본 V_econ=115: Productivity Vc=150 T=12min, Balanced Vc=115 T=30min, Tool Life Vc=90 T=75min. 야간 8시간 무인운전 → Tool Life 선택.",
    commonPitfall:
      "항상 Productivity만 선택. 인력·공구조달·품질 요구를 무시. 모드 선택이 공정설계의 전제조건.",
    relatedConcepts: ["economic-vc", "taylor-equation", "taylor-curve", "tool-life"],
    sourceAuthority: "Sandvik Handbook §2, Gilbert (1950), Ackoff (1956)",
  },
}
