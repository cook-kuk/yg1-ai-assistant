/**
 * Vendor Attribution SSOT
 * ---------------------------------------------------------------------------
 * ARIA v3 는 업계 주요 벤더의 베스트 프랙티스에서 영감을 받아 설계되었다.
 * 본 파일은 "어떤 기능이 어느 벤더에서 영감을 받았고, ARIA 가 무엇을 다르게
 * 만들었는가" 를 단일 진실의 출처로 관리한다.
 *
 * 주의:
 *  - 하드코딩 금지 원칙에 따라 feature/벤더 메타데이터는 반드시 이 파일에서만
 *    추가·수정한다.
 *  - UI 는 vendor-tags.tsx 에서 이 SSOT 를 소비한다.
 */

export type VendorSource =
  | "harvey"
  | "sandvik"
  | "walter"
  | "iscar"
  | "kennametal"
  | "mitsubishi"
  | "osg"
  | "yg1-original"

export interface VendorInfo {
  key: VendorSource
  name: string
  country: string // "🇺🇸 USA" 형식
  productName: string
  coreStrength: string
  url: string
}

export interface FeatureAttribution {
  featureId: string
  featureName: string
  primarySource: VendorSource
  secondarySources?: VendorSource[]
  howAriaDiffers: string
  yg1Original: boolean
}

export const VENDORS: Record<VendorSource, VendorInfo> = {
  harvey: {
    key: "harvey",
    name: "Harvey Tool",
    country: "🇺🇸 USA",
    productName: "MAP (Machining Advisor Pro)",
    coreStrength: "UX 최강 + 공구별 PDF DB",
    url: "https://map.harveyperformance.com",
  },
  sandvik: {
    key: "sandvik",
    name: "Sandvik Coromant",
    country: "🇸🇪 Sweden",
    productName: "CoroPlus ToolGuide",
    coreStrength: "물리 정확도 + 공구 마모 예측",
    url: "https://www.sandvik.coromant.com",
  },
  walter: {
    key: "walter",
    name: "Walter AG",
    country: "🇩🇪 Germany",
    productName: "GPS",
    coreStrength: "부품당 원가 + 전체 공정 최적화",
    url: "https://www.walter-tools.com",
  },
  iscar: {
    key: "iscar",
    name: "ISCAR",
    country: "🇮🇱 Israel",
    productName: "ITA (Tool Advisor)",
    coreStrength: "모바일 + 채터 방지",
    url: "https://www.iscar.com",
  },
  kennametal: {
    key: "kennametal",
    name: "Kennametal",
    country: "🇺🇸 USA",
    productName: "NOVO",
    coreStrength: "AI 개인화 + ML",
    url: "https://www.kennametal.com",
  },
  mitsubishi: {
    key: "mitsubishi",
    name: "Mitsubishi Materials",
    country: "🇯🇵 Japan",
    productName: "Milling Navi",
    coreStrength: "금형 정밀도",
    url: "https://www.mitsubishicarbide.com",
  },
  osg: {
    key: "osg",
    name: "OSG",
    country: "🇯🇵 Japan",
    productName: "Phoenix",
    coreStrength: "범용 공구",
    url: "https://www.osgtool.com",
  },
  "yg1-original": {
    key: "yg1-original",
    name: "YG-1",
    country: "🇰🇷 Korea",
    productName: "ARIA Original",
    coreStrength: "한국 제조 현장 최적화",
    url: "https://www.yg1.kr",
  },
}

export const FEATURES: Record<string, FeatureAttribution> = {
  "dial-percent": {
    featureId: "dial-percent",
    featureName: "Dial % 조정",
    primarySource: "harvey",
    howAriaDiffers:
      "Harvey의 ±20% 범위를 유지하되, 실시간 MRR 영향도를 시각화 (Harvey에 없음)",
    yg1Original: false,
  },
  "wear-gauge": {
    featureId: "wear-gauge",
    featureName: "공구 마모 게이지",
    primarySource: "sandvik",
    howAriaDiffers:
      "Sandvik은 유료 센서 필요. ARIA는 Taylor 공식 + 누적 가공시간으로 무료 예측",
    yg1Original: false,
  },
  "cost-calc": {
    featureId: "cost-calc",
    featureName: "부품당 원가 계산",
    primarySource: "walter",
    howAriaDiffers:
      "한국 원화 + 한국 평균 기계 시간비·인건비 기본값 제공",
    yg1Original: false,
  },
  "chatter-analyzer": {
    featureId: "chatter-analyzer",
    featureName: "채터 분석",
    primarySource: "iscar",
    secondarySources: ["sandvik"],
    howAriaDiffers:
      "ISCAR의 ChatterFree 개념 + Sandvik 물리 모델 통합",
    yg1Original: false,
  },
  "alt-tool-compare": {
    featureId: "alt-tool-compare",
    featureName: "대체 공구 비교",
    primarySource: "walter",
    secondarySources: ["harvey"],
    howAriaDiffers:
      "Walter는 자사 카탈로그만. ARIA는 타사 벤치마크 포함 비교",
    yg1Original: false,
  },
  "education-mode": {
    featureId: "education-mode",
    featureName: "교육 모드",
    primarySource: "yg1-original",
    howAriaDiffers: "업계 최초 기능. Harvey/Sandvik에 없음.",
    yg1Original: true,
  },
  "provenance-panel": {
    featureId: "provenance-panel",
    featureName: "근거 패널 (Provenance)",
    primarySource: "yg1-original",
    howAriaDiffers:
      "RAG + CoT 기반 근거 투명성. B2B 신뢰도 확보",
    yg1Original: true,
  },
  "pdf-autoload": {
    featureId: "pdf-autoload",
    featureName: "PDF 자동 로드",
    primarySource: "harvey",
    howAriaDiffers:
      "Harvey MAP과 동일한 PDF 기반 자동 로드, YG-1 카탈로그로 확장",
    yg1Original: false,
  },
  "beginner-matrix": {
    featureId: "beginner-matrix",
    featureName: "초보자용 매트릭스",
    primarySource: "iscar",
    howAriaDiffers:
      "ISCAR Matrix의 재질×가공 2D 셀 선택 + YG-1 추천 통합",
    yg1Original: false,
  },
  "ai-personalization": {
    featureId: "ai-personalization",
    featureName: "AI 개인화",
    primarySource: "kennametal",
    howAriaDiffers:
      "Kennametal NOVO의 ML 추천을 localStorage 이력 기반 규칙 엔진으로 경량화",
    yg1Original: false,
  },
  "heat-estimation": {
    featureId: "heat-estimation",
    featureName: "절삭열 추정",
    primarySource: "sandvik",
    howAriaDiffers:
      "Blok 모델 기반 칩/공구/공작물 온도 분배, 무료 구현",
    yg1Original: false,
  },
  "monte-carlo": {
    featureId: "monte-carlo",
    featureName: "Monte Carlo 수명 분포",
    primarySource: "yg1-original",
    howAriaDiffers:
      "Taylor 불확실성 Monte Carlo P10/P50/P90, 업계 최초",
    yg1Original: true,
  },
  "breakeven-chart": {
    featureId: "breakeven-chart",
    featureName: "손익분기 차트",
    primarySource: "walter",
    howAriaDiffers:
      "Walter GPS의 Gilbert economic Vc를 실시간 차트로 시각화",
    yg1Original: false,
  },
  "shopfloor-card": {
    featureId: "shopfloor-card",
    featureName: "샵플로어 카드",
    primarySource: "yg1-original",
    howAriaDiffers:
      "A6 1장 QR 포함 인쇄 카드, 업계 표준 없음",
    yg1Original: true,
  },
  "real-time-warnings": {
    featureId: "real-time-warnings",
    featureName: "실시간 경고",
    primarySource: "iscar",
    howAriaDiffers:
      "ISCAR의 실시간 경고를 플로팅 HUD로 재설계",
    yg1Original: false,
  },
  "snapshot-abcd": {
    featureId: "snapshot-abcd",
    featureName: "스냅샷 A/B/C/D",
    primarySource: "harvey",
    howAriaDiffers:
      "Harvey MAP A/B 비교를 4-슬롯 + ΔMax로 확장",
    yg1Original: false,
  },
  "speeds-feeds-cascade": {
    featureId: "speeds-feeds-cascade",
    featureName: "Speeds & Feeds Cascade",
    primarySource: "harvey",
    secondarySources: ["sandvik"],
    howAriaDiffers:
      "7단계 cascade matching으로 공구 없을 때도 fallback",
    yg1Original: false,
  },
  "command-palette": {
    featureId: "command-palette",
    featureName: "Command Palette",
    primarySource: "yg1-original",
    howAriaDiffers:
      "Ctrl+K 통합 검색, 업계 공작기계 계산기 중 최초",
    yg1Original: true,
  },
  "ai-chat": {
    featureId: "ai-chat",
    featureName: "AI 채팅 사이드바",
    primarySource: "yg1-original",
    howAriaDiffers:
      "Claude Sonnet 4.6 SSE + localStorage 50-turn 기록 + 시뮬 컨텍스트 주입. 업계 시뮬레이터 중 최초.",
    yg1Original: true,
  },
  "auto-agent": {
    featureId: "auto-agent",
    featureName: "AI 자율 에이전트",
    primarySource: "yg1-original",
    howAriaDiffers:
      "6회 iteration 자율 실험 + 베이지안-like 탐색 + SSE 실시간 사고 과정 스트리밍. Harvey/Kennametal 개념 확장.",
    yg1Original: true,
  },
  "ai-optimize": {
    featureId: "ai-optimize",
    featureName: "AI 1-click 최적화",
    primarySource: "walter",
    secondarySources: ["kennametal"],
    howAriaDiffers:
      "Walter GPS의 목표 기반 조정을 Claude Sonnet 4.6으로 자연어 이유 설명 추가.",
    yg1Original: false,
  },
  "nl-query": {
    featureId: "nl-query",
    featureName: "AI 자연어 검색",
    primarySource: "yg1-original",
    howAriaDiffers:
      "'알루미늄 빠르게' 같은 한국어 → Claude Haiku로 JSON 프리셋 자동 변환. 시뮬레이터 중 최초.",
    yg1Original: true,
  },
  "explain-warning": {
    featureId: "explain-warning",
    featureName: "AI 경고 해설",
    primarySource: "yg1-original",
    howAriaDiffers:
      "각 검증 경고에 대해 '왜 위험한가 / 왜 발생했나 / 해결법' AI 인터뷰식 설명. 업계 전무.",
    yg1Original: true,
  },
  "3d-scene": {
    featureId: "3d-scene",
    featureName: "3D WebGL 가공 씬",
    primarySource: "yg1-original",
    secondarySources: ["kennametal"],
    howAriaDiffers:
      "three.js + R3F 기반 진짜 3D (공작물·공구·파티클·스파크·OrbitControls). Kennametal NOVO 3D 모델보다 실시간 가공 연출.",
    yg1Original: true,
  },
  "operation-picker": {
    featureId: "operation-picker",
    featureName: "공정 선택기 8종",
    primarySource: "iscar",
    howAriaDiffers:
      "ISCAR Matrix 2D 선택을 각 공정별 SVG 일러스트 + 피삭제 시각화로 확장.",
    yg1Original: false,
  },
  "work-instruction": {
    featureId: "work-instruction",
    featureName: "가공 지시서 PDF",
    primarySource: "yg1-original",
    howAriaDiffers:
      "A4 4페이지 · 결재란 · QR · 안전 주의사항 자동 생성. 업계 시뮬레이터 중 최초.",
    yg1Original: true,
  },
  "favorites": {
    featureId: "favorites",
    featureName: "즐겨찾기 북마크",
    primarySource: "yg1-original",
    howAriaDiffers:
      "localStorage 기반 태그·star·메모 지원 북마크. JSON import/export로 팀 공유.",
    yg1Original: true,
  },
  "leaderboard": {
    featureId: "leaderboard",
    featureName: "벤치마크 리더보드",
    primarySource: "yg1-original",
    howAriaDiffers:
      "MRR / 수명 / 원가 3 카테고리 TOP 10 순위. 사용자 조건 비교. 업계 최초 '게이미피케이션'.",
    yg1Original: true,
  },
  "session-export": {
    featureId: "session-export",
    featureName: "세션 내보내기 (Excel/JSON)",
    primarySource: "walter",
    howAriaDiffers:
      "Walter GPS는 리포트만. ARIA는 조건·결과·스냅샷·경고를 4 시트 Excel로 export.",
    yg1Original: false,
  },
  "gcode-download": {
    featureId: "gcode-download",
    featureName: "G-code 실파일 다운로드",
    primarySource: "yg1-original",
    howAriaDiffers:
      "Fanuc(.nc) / Heidenhain(.h) / Siemens(.mpf) 3 방언 실제 파일 다운로드. 시뮬레이터 중 최초.",
    yg1Original: true,
  },
  "voice-input": {
    featureId: "voice-input",
    featureName: "음성 입력",
    primarySource: "yg1-original",
    howAriaDiffers:
      "Web Speech API + Claude Haiku → 한국어 음성 → 프리셋. CNC 시뮬레이터 중 최초.",
    yg1Original: true,
  },
  "yg1-video": {
    featureId: "yg1-video",
    featureName: "YG-1 실가공 YouTube 영상",
    primarySource: "yg1-original",
    howAriaDiffers:
      "ISO 재질별 큐레이션된 실제 YG-1 가공 영상 임베드. 공구 선택과 연동.",
    yg1Original: true,
  },
  "before-after": {
    featureId: "before-after",
    featureName: "Before/After 비교 대시보드",
    primarySource: "yg1-original",
    howAriaDiffers:
      "AI 최적화 전/후 10 지표 자동 비교 + 월 절감액 임팩트 배너. 영업 proposal 도구.",
    yg1Original: true,
  },
  "analog-gauges": {
    featureId: "analog-gauges",
    featureName: "아날로그 계기판",
    primarySource: "yg1-original",
    howAriaDiffers:
      "자동차 계기판 스타일 4종 RPM/Vf/Pc/Life+Chatter. Spring 바늘 + CRT glow.",
    yg1Original: true,
  },
  "hero-display": {
    featureId: "hero-display",
    featureName: "영웅 KPI 디스플레이",
    primarySource: "yg1-original",
    howAriaDiffers:
      "IMAX 스케일 4 KPI 카드 (그라디언트 텍스트 · 스캔라인 · 위험 시 shake).",
    yg1Original: true,
  },
  "undo-redo": {
    featureId: "undo-redo",
    featureName: "Undo/Redo 히스토리",
    primarySource: "yg1-original",
    howAriaDiffers:
      "50개 히스토리 + 300ms 디바운스 + Ctrl+Z/Y. Harvey/Sandvik에 없음.",
    yg1Original: true,
  },
  "wizard": {
    featureId: "wizard",
    featureName: "초보자 위저드 5단계",
    primarySource: "iscar",
    howAriaDiffers:
      "ISCAR Matrix 개념을 5단계 대화형 질문으로 확장 + 추천 이유 자연어.",
    yg1Original: false,
  },
  "tutorial": {
    featureId: "tutorial",
    featureName: "인터랙티브 튜토리얼",
    primarySource: "yg1-original",
    howAriaDiffers:
      "9 step spotlight 투어 + data-tour selector. 업계 시뮬레이터 중 최초.",
    yg1Original: true,
  },
}
