// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 교육 모드 콘텐츠 DB · Coolant 카테고리
// 쿨런트 방식 7 entries (Flood/MQL/Mist/Air/Dry/Through-Spindle/Multiplier)

import type { EducationDb } from "../education-content"

export const COOLANT_ENTRIES: EducationDb = {
  "flood-coolant": {
    id: "flood-coolant",
    korean: "Flood (대량 범람)",
    english: "Flood Coolant",
    category: "coolant",
    definition: {
      beginner:
        "공작기계 위에 쿨런트를 마구 쏟아붓는 방식. 가장 확실한 냉각. 바닥에 떨어진 쿨런트를 펌프로 순환시킴.",
      intermediate:
        "수용성 절삭유 5-10% 에멀전, 20-100 L/min, 압력 2-10 bar. 열 제거 효율 80-90%, 칩 배출·윤활·냉각 3역할. 범용 표준.",
      expert:
        "Flood: water-soluble emulsion 5-10% (Blasocut, Hysol, Houghton), 유량 20-100 L/min, 압력 2-10 bar, 열 제거 효율 ~85% (vs dry). Vc multiplier = 1.0 (기준). 환경/비용: 수질오염 폐수 처리 필요 (kg당 폐기비 ₩200-500), 관리 비용 연간 머신당 ₩500k-1M (농도 관리·박테리아 방지). 적합 재질: 전 재질 범용 (Ti는 flood 금기 — 화재 위험으로 WC-Co 전용 수용성 or dry). 노동자 피부염·호흡기 이슈 있어 유럽 EHS 규제 강화. 출처: ISO 6743-7 / Harvey Performance Coolant Application Guide.",
    },
    whyItMatters:
      "Vc 카탈로그 값의 '기본 전제'가 flood 쿨런트. 다른 방식은 여기서 multiplier로 보정. 시뮬레이터 coolant multiplier의 기준점(1.0).",
    realWorldExample:
      "SUS304 Ø10 4F 슬로팅 Vc 90(flood 기준) / mist 80 / dry 60. Flood 없으면 공구수명 45분 → 15분 (dry) → 30분 (mist).",
    commonPitfall:
      "농도 부족(<3%) → 윤활 부실, 박테리아 증식, 악취, 공구수명 20-30% 저하. 주 1회 굴절계 측정 필수. 과도(>10%) → 거품·경제적 낭비.",
    relatedConcepts: ["mql", "mist-coolant", "dry-machining", "through-spindle", "coolant-multiplier"],
    sourceAuthority: "ISO 6743-7 / Harvey Performance Coolant Application Guide / Blaser Swisslube Handbook",
  },

  "mql": {
    id: "mql",
    korean: "MQL (Minimum Quantity Lubrication)",
    english: "MQL — Minimum Quantity Lubrication",
    category: "coolant",
    definition: {
      beginner:
        "기름 한 방울을 공기에 실어 공구로 쏘는 방식. 쿨런트를 거의 안 씀. 친환경이고 쓰레기가 안 나옴. 칩이 말라서 재활용도 쉬움.",
      intermediate:
        "식물성 에스테르유 5-50 mL/hr + 압축공기 4-6 bar. 열 제거는 공기가, 윤활은 극미량 오일이. 항공 Al·Ti 가공에서 보급.",
      expert:
        "MQL: vegetable ester oil 5-50 mL/hr (flood 대비 1/1000-1/10000), compressed air 4-6 bar, aerosol droplet 2-5 µm. 열 제거 효율 40-60% (flood 대비), 윤활 효율 100+% (극압제 포함). Vc multiplier 0.85-0.95 (Al에서 1.0 가능). 환경/비용: 친환경 (오일 칩과 함께 소각 or 재활용), 폐수 제로, 비용 flood 대비 1/5-1/10, EU RoHS/REACH 친화적. 적합 재질: Al (특히 Al2024, 6061, 7075) 최적, Ti/CFRP 2순위, 스테인리스·Inconel 부적합(열부하 과다). 대표: MQL 펌프 Bielomatik, Unist, Lubrix. 출처: Harvey Performance MQL Study / SAE 2020-01-1304.",
    },
    whyItMatters:
      "친환경+비용절감+칩 재활용 3박자. Airbus/Boeing 등 항공 Al 가공은 MQL 표준. 탄소중립 공장 요건 만족. 미래형 주류.",
    realWorldExample:
      "Al7075 항공 부품 Ø12 4F 러핑 Vc 450(flood) → Vc 430(MQL), IPT 동일, 공구수명 -5%. 연간 쿨런트 비용 ₩800만 → ₩90만, 폐수 처리 0.",
    commonPitfall:
      "스테인리스/Inconel에 MQL 적용 시 열부하 과다로 공구수명 flood 대비 50% 감소. MQL은 재료별 상성 엄격 — Al·Ti·공구강 일부에 한정.",
    relatedConcepts: ["flood-coolant", "mist-coolant", "air-blast", "dry-machining", "coolant-multiplier"],
    sourceAuthority: "Harvey Performance MQL Application Study / SAE Technical Paper 2020-01-1304",
  },

  "mist-coolant": {
    id: "mist-coolant",
    korean: "Mist (분무)",
    english: "Mist Coolant",
    category: "coolant",
    definition: {
      beginner:
        "쿨런트를 안개처럼 뿌리는 방식. Flood보다 적게, MQL보다 많이. 중간 단계. 작은 공작기계에서 흔함.",
      intermediate:
        "수용성 쿨런트 50-500 mL/hr, 압력 3-5 bar. 열 제거 효율 60-70%. Flood 폐수 설비 없는 소형 공장에서 대안.",
      expert:
        "Mist: water-based 또는 straight oil, flow 50-500 mL/hr, air pressure 3-5 bar, droplet 20-100 µm. 열 제거 효율 ~65%, Vc multiplier 0.90-0.95. 환경/비용: mid-tier (flood의 1/5 사용량, MQL보다 5-10배), 호흡기 유해 aerosol 배출 → OSHA PEL 5 mg/m³ 주의, 집진기 필수. 적합 재질: 중경도 강, 주철, Al 범용. 기피: Ti (화재 위험), 정밀가공(droplet이 측정 센서·표면에 잔류). 대표: Noga MC1700, Fog Buster, Kool Mist. 출처: OSHA 29 CFR 1910.1000 / Harvey Performance Coolant Guide.",
    },
    whyItMatters:
      "소형 머시닝센터·CNC 수작업에 주로. Flood 설비 없이도 80% 냉각 효과. 다만 작업장 공기질·보건 리스크 설계 필요.",
    realWorldExample:
      "SS400 Ø8 2F 엔드밀 사이드밀링 Vc 140(flood) → Vc 128(mist), IPT 동일, 공구수명 -10%, 쿨런트 소비 20 L/shift → 0.3 L/shift.",
    commonPitfall:
      "작업장 환기·집진기 없이 mist 장시간 사용 → PEL 초과 → 폐 질환. 반드시 local exhaust ventilation (LEV) 설치 (EN 626).",
    relatedConcepts: ["flood-coolant", "mql", "air-blast", "coolant-multiplier"],
    sourceAuthority: "OSHA 29 CFR 1910.1000 / Harvey Performance Coolant Application Guide",
  },

  "air-blast": {
    id: "air-blast",
    korean: "Air Blast (공기)",
    english: "Air Blast / Compressed Air",
    category: "coolant",
    definition: {
      beginner:
        "오일 없이 압축공기만 훅훅 부는 방식. 냉각 효과는 약하지만 칩을 날려줘서 재절삭을 막음. 흑연·세라믹 가공에 필수.",
      intermediate:
        "4-7 bar compressed air, nozzle Ø3-5 mm. 열 제거 효율 20-30%, 칩 배출 효과가 주 목적. 흑연/CFRP/세라믹 가공 표준.",
      expert:
        "Air blast: 압축공기 4-7 bar, flow 200-1,000 L/min, nozzle 3-10 mm. 열 제거 효율 ~25% (flood 대비), Vc multiplier 0.70-0.85. 환경/비용: 매우 친환경 (배출 없음), 에너지 비용만 발생 (컴프레서 전력 ₩0.3-0.5 /m³), 친환경성 MQL과 동급. 적합 재질: 흑연 (쿨런트 흡수로 금기), CFRP (박리 방지), Al 박판 (warp 방지), 세라믹. 기피: 일반강·스테인리스(열부하 해소 불가). 쿨드 에어(Cold Air Gun, Exair vortex tube) 사용 시 -20~-30°C 공기로 효율 +40%. 출처: Exair Technical Bulletin / Harvey Performance Dry Machining Guide.",
    },
    whyItMatters:
      "흑연/CFRP/세라믹은 쿨런트 접촉 시 제품 오염·강도 저하. Air blast가 유일한 '쿨링' 옵션. 복합재·전극 가공 필수.",
    realWorldExample:
      "흑연 EDM 전극 Ø6 볼엔드밀 Vc 500(air+dust collector), n 26,525 rpm, IPT 0.03. 공구수명 180분(air) vs 20분(flood — 흑연이 쿨런트 흡수로 공구 clogging).",
    commonPitfall:
      "압축공기 내 수분·오일 미제거 → 공구 표면 부식 또는 재료 오염 (특히 Al·금형강). 반드시 refrigerated dryer + coalescing filter 경유.",
    relatedConcepts: ["dry-machining", "mql", "mist-coolant", "coolant-multiplier"],
    sourceAuthority: "Exair Compressed Air Technical Bulletin / Harvey Performance Dry Machining Guide",
  },

  "dry-machining": {
    id: "dry-machining",
    korean: "Dry (건식)",
    english: "Dry Machining",
    category: "coolant",
    definition: {
      beginner:
        "쿨런트·공기 다 없이 그냥 깎는 방식. 공구 코팅이 좋아야 함. 주철·하드밀링에 흔함. 제일 친환경.",
      intermediate:
        "코팅(TiAlN/AlTiN/TiSiN)+WC 공구의 내열성에 의존. Vc 카탈로그 대비 30-40% 감. 주철·하드밀링 표준, 일부 강재 가능.",
      expert:
        "Dry machining: no coolant, no air. 열 제거 효율 0% (공구·칩·공기 자연대류만), Vc multiplier 0.60-0.75. 환경/비용: 최고 (쿨런트·폐수·필터 zero), 폐기 칩 완전 건조로 즉시 재활용 가능(₩가치 +10-15%). 필요 조건: (1) 코팅 AlTiN/TiSiN (내산화 900-1200°C), (2) rigid machine, (3) 열전도 낮은 재료 (주철 최적, 담금질강 가능, Al·Ti·SS 부적합). 적합 재질: 주철(GG25, GGG60), 담금질강 55-65HRC (하드밀링), 흑연 (air blast 병용). 출처: ISO 8688 / Sandvik Coromant Dry Machining Application Guide.",
    },
    whyItMatters:
      "친환경 + 폐기 칩 100% 재활용 + 설비비 최저. 주철 가공은 dry가 표준(쿨런트 시 오히려 cast iron 균열). 하드밀링 금형업계 보편.",
    realWorldExample:
      "GG25 주철 Ø16 인덱서블 페이스밀 Vc 250(dry) + 코팅 AlTiN Z6, IPT 0.20, Fz 4,974 mm/min, 공구수명 90분. Flood 적용 시 Vc 270 but 공구수명 60분(열충격).",
    commonPitfall:
      "코팅 없는 HSS 공구로 dry 시도 → 공구 날 적열(600°C 이상) → 즉시 소프트닝·파손. Dry는 초경+코팅 전제 조건.",
    relatedConcepts: ["air-blast", "flood-coolant", "mql", "altin-coating", "coolant-multiplier"],
    sourceAuthority: "ISO 8688 / Sandvik Coromant Dry Machining Application Guide",
  },

  "through-spindle": {
    id: "through-spindle",
    korean: "Through-Spindle (스핀들 관통 내부 급유)",
    english: "Through-Spindle Coolant (TSC) / High-Pressure Coolant",
    category: "coolant",
    definition: {
      beginner:
        "공구 안에 구멍이 뚫려 있어서 쿨런트가 그 안으로 고압으로 쏘아져 나오는 방식. 깊은 구멍·포켓에서 칩 확실히 빼줌.",
      intermediate:
        "쿨런트가 스핀들 중심 → 공구 내부 채널 → 날끝 직접 분사. 압력 20-70 bar, 유량 10-30 L/min. 딥홀 드릴·Inconel 가공 필수.",
      expert:
        "Through-spindle coolant (TSC): 스핀들 rotary union + tool internal channel (Ø1-3 mm), 압력 20-70 bar (고압 타입 100-300 bar), 유량 10-30 L/min. 열 제거 효율 ~95% (flood +10%p), Vc multiplier 1.10-1.25 (고압 타입 1.30까지). 환경/비용: flood와 동일 폐수 처리 + 고압 펌프(₩500만-2000만) 초기 투자, ROI 공구수명 향상으로 1-2년. 적합 재질: Inconel/Ti/SS 딥홀(L/D>4), 포켓 deep(closed), 드릴 Ø5-20 모든 재질. 머신 요건: through-spindle 옵션 + rotary union, HSK63 ≥70 bar 대응 일반. 출처: Sandvik CoroDrill TSC White Paper / Makino High-Pressure Coolant Technical Bulletin.",
    },
    whyItMatters:
      "Inconel/Ti 딥드릴 L/D>5에서 chip packing으로 공구 파손이 주 문제. TSC는 유일한 해결책. 공구수명 3-10배 향상.",
    realWorldExample:
      "Inconel 718 Ø10 deep hole drill 50mm(L/D=5): 외부 coolant Vc 20·수명 12 홀 / TSC 70bar Vc 28·수명 85 홀. 7배 수명 + Vc 40% 상승.",
    commonPitfall:
      "TSC 공구를 외부 쿨런트 머신에 쓰면 내부 채널로 칩 역류 → 채널 막힘·공구 파손. 머신 TSC 옵션 확인 후 공구 선택.",
    relatedConcepts: ["flood-coolant", "coolant-multiplier", "slotting", "pocketing", "hsk63"],
    sourceAuthority: "Sandvik CoroDrill Through-Spindle Coolant Technical Paper / Makino High-Pressure Coolant Bulletin",
  },

  "coolant-multiplier": {
    id: "coolant-multiplier",
    korean: "Coolant Multiplier (Vc 보정 계수)",
    english: "Coolant Multiplier — Vc Adjustment Factor",
    category: "coolant",
    definition: {
      beginner:
        "쿨런트 방식마다 공구가 낼 수 있는 속도가 달라짐. 이걸 숫자로 나타낸 '보정 값'. Flood=1.0 기준, 건식은 0.7 같은 식.",
      intermediate:
        "Vc_effective = Vc_catalog × k_coolant. Flood 1.0, TSC 1.15, Mist 0.92, MQL 0.90, Air 0.80, Dry 0.70. 시뮬레이터 계산식에 곱셈 진입.",
      expert:
        "Coolant multiplier k_coolant (flood=1.0 기준): Through-spindle high-pressure(70bar+) 1.20-1.30, Through-spindle standard(20-40bar) 1.10-1.15, Flood 1.00, Mist 0.90-0.95, MQL 0.85-0.95 (Al 0.95, SS 0.80), Air blast 0.70-0.85 (흑연 1.0 — dry보다 유리), Dry 0.60-0.75. 계산: Vc_eff = Vc_cat × k_coolant × k_material × k_L/D... 누적 multiplicative. 열 제거 효율 η_heat [%]: TSC 95, Flood 85, Mist 65, MQL 50, Air 25, Dry 0. 환경 부하 순위 (저→고): MQL ≈ Air < Dry < Mist < Flood < TSC. 출처: Sandvik Coromant Multiplier Tables §3.4 / Kennametal Machining Performance Guide.",
    },
    whyItMatters:
      "카탈로그 Vc 값은 'flood 조건'이라 다른 쿨런트 환경 현장에선 보정 없이 그대로 쓰면 공구 수명 50% 감소. 시뮬레이터가 이 multiplier를 자동 적용하는 이유.",
    realWorldExample:
      "Ti-6Al-4V Ø10 카탈로그 Vc 60 (flood): TSC 적용 시 Vc_eff = 60×1.20 = 72 m/min. MQL 적용 시 Vc_eff = 60×0.85 = 51 m/min. 공구수명 편차 ±35%.",
    commonPitfall:
      "multiplier를 SFM에만 곱하고 IPT는 그대로 두는 실수. 열부하 변화는 IPT에도 영향 → Dry 전환 시 IPT도 10-15% 낮춰야 열균열 방지.",
    relatedConcepts: ["flood-coolant", "mql", "mist-coolant", "air-blast", "dry-machining", "through-spindle"],
    sourceAuthority: "Sandvik Coromant Multiplier Tables §3.4 / Kennametal Machining Performance Guide",
  },
}
