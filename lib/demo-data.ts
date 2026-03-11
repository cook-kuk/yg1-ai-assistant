//
// YG-1 AI Agent - Complete Demo Data Model
//

// ======== TYPES ========

export type UserRole = "customer" | "dealer" | "sales" | "cs"

export interface MachineProfile {
  type: string
  spindle: string
  rpmMax: number
  power: number
  holder: string
  coolant: string
  stability: "high" | "medium" | "low"
}

export interface MaterialProfile {
  isoGroup: string
  grade: string
  hardness: string
  condition: string
  machinability: "easy" | "normal" | "hard" | "extreme"
  riskTags: string[]
}

export interface OperationProfile {
  type: string
  mode: "roughing" | "finishing" | "semi-finishing"
  priority: "cost" | "time" | "quality"
  tolerance?: string
  roughness?: string
}

export interface ConstraintProfile {
  diameter: number
  depth?: number
  overhang?: string
  clampingIssue: boolean
  interruptedCut: boolean
}

export interface ScoreBreakdown {
  gatePass: boolean
  performance: number
  stability: number
  delivery: number
  cost: number
  total: number
  changeReason?: string
}

export interface CandidateProduct {
  id: string
  sku: string
  name: string
  imageUrl: string
  fitTag: string
  score: ScoreBreakdown
  metrics: {
    cycleTime: number
    toolLife: number
    costIndex: number
    co2Index: number
  }
  reasons: string[]
  risks: { text: string; mitigation: string }[]
  alternatives: string[]
  competitorEquivalents: { brand: string; model: string; level: "equivalent" | "upgrade" }[]
  price: {
    customer: string
    dealer: string
    internal: string
  }
  stock: "instock" | "limited" | "outofstock"
  stockQty?: number
  leadTimeDays: number
  warehouse: string
}

export interface SpecialTicket {
  id: string
  reason: string
  summary: string
  missingInfo: string[]
  reviewReason: string
  priority: "urgent" | "normal" | "low"
  status: "open" | "assigned" | "resolved"
}

export interface CrossReference {
  competitorBrand: string
  competitorModel: string
  ygSku: string
  ygName: string
  confidence: number
  level: "equivalent" | "upgrade" | "cost-optimized"
}

export interface WowScenario {
  id: string
  title: string
  subtitle: string
  input: string
  tags: string[]
  kpis: { label: string; value: string; delta: string }[]
  flow: string[]
}

// ======== DATA ========

export const crossReferences: CrossReference[] = [
  { competitorBrand: "SANDVIK", competitorModel: "2P160-1000", ygSku: "YG-EM4-SUS-10", ygName: "I-Xmill 4F", confidence: 95, level: "equivalent" },
  { competitorBrand: "SANDVIK", competitorModel: "R216.34-16050", ygSku: "YG-EM6-HF-10", ygName: "Hi-Feed 6F", confidence: 90, level: "upgrade" },
  { competitorBrand: "MITSUBISHI", competitorModel: "VCMHD1000", ygSku: "YG-EM4-STL-10", ygName: "Gen-Mill 4F", confidence: 88, level: "cost-optimized" },
  { competitorBrand: "KENNAMETAL", competitorModel: "HARVI-III", ygSku: "YG-EM-INCONEL", ygName: "Inconel-Master", confidence: 85, level: "equivalent" },
  { competitorBrand: "OSG", competitorModel: "A-TAP-M8", ygSku: "YG-TAP-M8", ygName: "Synchro-Tap M8", confidence: 92, level: "equivalent" },
  { competitorBrand: "WALTER", competitorModel: "MC166-10", ygSku: "YG-EM4-STL-10", ygName: "Gen-Mill 4F", confidence: 87, level: "upgrade" },
  { competitorBrand: "HITACHI", competitorModel: "EPBP-10", ygSku: "YG-BEM-SKD-10", ygName: "Mold-Max 볼엔드밀", confidence: 91, level: "equivalent" },
  { competitorBrand: "NACHI", competitorModel: "L6520-065", ygSku: "YG-DR-SUS-10", ygName: "Inox-Drill", confidence: 89, level: "upgrade" },
]

export const candidateProducts: CandidateProduct[] = [
  {
    id: "C001", sku: "YG-EM4-SUS-10", name: "I-Xmill 4F SUS 전용 엔드밀 D10",
    imageUrl: "/images/tools/endmill-4flute.jpg",
    fitTag: "최적",
    score: { gatePass: true, performance: 92, stability: 88, delivery: 95, cost: 78, total: 89, changeReason: "SUS 전용 코팅으로 성능 가중치 증가" },
    metrics: { cycleTime: 82, toolLife: 91, costIndex: 75, co2Index: 80 },
    reasons: ["SUS304/316 전용 TiAlN 코팅으로 내열성 극대화", "4날 고강성 설계로 난삭재 진동 최소화", "칩 배출 최적화 날 형상으로 가공 안정성 확보"],
    risks: [{ text: "단속 절삭 시 미세 치핑 가능", mitigation: "절삭 깊이 0.5D 이하로 제한" }],
    alternatives: ["YG-EM4-SUS-08"],
    competitorEquivalents: [{ brand: "SANDVIK", model: "2P160-1000", level: "equivalent" }, { brand: "MITSUBISHI", model: "VCMHD1000", level: "equivalent" }],
    price: { customer: "계약조건별 예상가 58,000원", dealer: "채널가 46,400원 (할인 적용)", internal: "기준단가 52,200원 (마진 12%)" },
    stock: "instock", stockQty: 150, leadTimeDays: 0, warehouse: "화성 중앙창고"
  },
  {
    id: "C002", sku: "YG-EM4-SUS-08", name: "I-Xmill 4F SUS 전용 엔드밀 D8",
    imageUrl: "/images/tools/endmill-4flute.jpg",
    fitTag: "적합",
    score: { gatePass: true, performance: 85, stability: 90, delivery: 95, cost: 82, total: 87, changeReason: "소구경으로 정밀도 가중치 증가" },
    metrics: { cycleTime: 78, toolLife: 88, costIndex: 80, co2Index: 82 },
    reasons: ["소구경 정밀 가공에 최적화", "SUS 전용 코팅 동일 적용", "가격 대비 성능비 우수"],
    risks: [{ text: "깊은 홈 가공 시 강성 부족 가능", mitigation: "L/D 비율 4 이하 권장" }],
    alternatives: ["YG-EM4-SUS-06"],
    competitorEquivalents: [{ brand: "SANDVIK", model: "2P160-0800", level: "equivalent" }],
    price: { customer: "계약조건별 예상가 48,000원", dealer: "채널가 38,400원", internal: "기준단가 43,200원 (마진 12%)" },
    stock: "instock", stockQty: 200, leadTimeDays: 0, warehouse: "화성 중앙창고"
  },
  {
    id: "C003", sku: "YG-EM6-HF-10", name: "Hi-Feed 6F 고이송 엔드밀 D10",
    imageUrl: "/images/tools/endmill-4flute.jpg",
    fitTag: "고성능",
    score: { gatePass: true, performance: 95, stability: 82, delivery: 70, cost: 65, total: 82, changeReason: "고이송 모드로 cycle time 극적 감소" },
    metrics: { cycleTime: 60, toolLife: 85, costIndex: 65, co2Index: 70 },
    reasons: ["6날 고이송 설계로 생산성 40% 향상", "AlCrN 코팅으로 고온 가공 안정", "난삭재 황삭 시 타 제품 대비 속도 우위"],
    risks: [{ text: "정삭 표면조도 불리", mitigation: "황삭 후 별도 정삭 공정 권장" }, { text: "납기 5일 소요", mitigation: "긴급 시 대체품 C001 활용" }],
    alternatives: ["YG-EM4-SUS-10"],
    competitorEquivalents: [{ brand: "SANDVIK", model: "R216.34-16050", level: "equivalent" }, { brand: "KENNAMETAL", model: "HARVI-III", level: "equivalent" }],
    price: { customer: "계약조건별 예상가 85,000원", dealer: "채널가 68,000원", internal: "기준단가 76,500원 (마진 10%)" },
    stock: "limited", stockQty: 12, leadTimeDays: 5, warehouse: "오산 물류센터"
  },
]

export const wowScenarios: WowScenario[] = [
  {
    id: "S1",
    title: "모호한 문의를 매출 기회로",
    subtitle: "정보 부족한 문의 → AI 질문 → 3후보 추천 → 견적 전환",
    input: "가공 품질 안 좋고 수명도 짧아요. 빨리 해결 원함.",
    tags: ["정보부족", "2턴수렴", "견적전환"],
    kpis: [
      { label: "문의→견적 전환", value: "87%", delta: "+32%p" },
      { label: "평균 응답시간", value: "45초", delta: "-85%" },
      { label: "예상 수주율", value: "62%", delta: "+18%p" },
    ],
    flow: ["자연어 문의 접수", "AI 핵심질문 2회", "후보군 120→18→3", "추천근거+견적CTA"],
  },
  {
    id: "S2",
    title: "경쟁사 품번 대체 30초 제안",
    subtitle: "경쟁사 파트넘버 → 크로스레퍼런스 → 동등/상위 대체 제안",
    input: "경쟁사 SANDVIK 2P160-1000 대체 가능한가요?",
    tags: ["크로스레퍼런스", "대체제안", "30초완료"],
    kpis: [
      { label: "대체 성공률", value: "94%", delta: "+25%p" },
      { label: "매출 전환", value: "73%", delta: "+28%p" },
      { label: "처리시간", value: "28초", delta: "-92%" },
    ],
    flow: ["경쟁사 품번 인식", "크로스레퍼런스 매핑", "동등/상위/절감 3안", "즉시 재고+납기"],
  },
  {
    id: "S3",
    title: "도면 업로드 자동 판정",
    subtitle: "도면 파일 → 형상 추출 → 표준품 가능 여부 → 특주 티켓",
    input: "이거 표준품으로 가능한가요?",
    tags: ["도면분석", "자동판정", "특주분기"],
    kpis: [
      { label: "판정 정확도", value: "96%", delta: "+15%p" },
      { label: "특주 접수시간", value: "2분", delta: "-90%" },
      { label: "실패 방지", value: "100%", delta: "안전망" },
    ],
    flow: ["도면 업로드", "형상 자동 추출", "가능/주의/특주 판정", "특주 시 티켓 자동생성"],
  },
  {
    id: "S4",
    title: "납기 우선 긴급 대응",
    subtitle: "즉시 출고 가능 제품만 필터 → 대체품 자동 제안 → 영업 연결",
    input: "이번 주 출고 가능한 것만 보여주세요",
    tags: ["긴급납기", "재고필터", "대체제안"],
    kpis: [
      { label: "긴급 대응률", value: "98%", delta: "+40%p" },
      { label: "출고 리드타임", value: "당일", delta: "-7일" },
      { label: "대체 수용률", value: "81%", delta: "+35%p" },
    ],
    flow: ["긴급 필터 적용", "즉시출고 필터링", "품절 시 대체안", "가까운 대리점 연결"],
  },
  {
    id: "S5",
    title: "영업/CS 협업 시연",
    subtitle: "동일 추천 → 역할별 가격/액션 차이 → 거버넌스 증명",
    input: "SUS304 엔드밀 10mm 추천해주세요",
    tags: ["역할기반", "가격정책", "거버넌스"],
    kpis: [
      { label: "정보 통제율", value: "100%", delta: "완벽" },
      { label: "마진 보호", value: "12%+", delta: "유지" },
      { label: "정책 준수율", value: "100%", delta: "자동화" },
    ],
    flow: ["동일 문의 입력", "고객/대리점/영업/CS 전환", "가격 표현 변화 확인", "액션 버튼 차이 확인"],
  },
  {
    id: "S6",
    title: "정밀모드 엔지니어 대응",
    subtitle: "상세 장비/소재/제약 입력 → 심층 분석 → 기술 리포트",
    input: "DMG MORI DMU 50, SUS316L, Ra0.8 이하, 단속절삭",
    tags: ["정밀모드", "기술심층", "리포트"],
    kpis: [
      { label: "기술 정합도", value: "98%", delta: "+20%p" },
      { label: "재선정 비율", value: "3%", delta: "-85%" },
      { label: "고객 신뢰도", value: "극상", delta: "엔지니어급" },
    ],
    flow: ["상세 스펙 입력", "6단계 심층 분석", "점수 변동 근거 공개", "기술 요약 리포트"],
  },
]

export const warehouses = [
  { id: "WH1", name: "화성 중앙창고", region: "경기 남부", address: "경기도 화성시 동탄산단로 123" },
  { id: "WH2", name: "오산 물류센터", region: "경기 중부", address: "경기도 오산시 가장동 456" },
  { id: "WH3", name: "부산 남부창고", region: "경남", address: "부산시 강서구 녹산동 789" },
]

export const distributors = [
  { id: "D1", name: "서울공구", region: "서울/경기북부", tel: "02-1234-5678", stock: true },
  { id: "D2", name: "인천정밀", region: "인천/경기서부", tel: "032-1234-5678", stock: true },
  { id: "D3", name: "대전공구산업", region: "대전/충남", tel: "042-1234-5678", stock: false },
  { id: "D4", name: "대구정밀공구", region: "대구/경북", tel: "053-1234-5678", stock: true },
  { id: "D5", name: "부산공구센터", region: "부산/경남", tel: "051-1234-5678", stock: true },
  { id: "D6", name: "광주공구마트", region: "광주/전남", tel: "062-1234-5678", stock: false },
]
