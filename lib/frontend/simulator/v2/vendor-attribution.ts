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
}
