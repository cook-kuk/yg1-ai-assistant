// Types
export type InquiryStatus = 'new' | 'in-review' | 'need-info' | 'quote-drafted' | 'sent' | 'escalated' | 'won' | 'lost'
export type UserRole = 'sales' | 'rnd' | 'admin'
export type Urgency = 'high' | 'medium' | 'low'
export type ConfidenceLevel = 'high' | 'medium' | 'low'
export type PriceType = 'confirmed' | 'estimated'

export interface Inquiry {
  id: string
  customer: string
  company: string
  country: string
  region: string
  industry: string
  workpieceMaterial: string
  process: string
  machine: string
  hasDrawing: boolean
  hasSpec: boolean
  requestedToolType: string
  quantity: number
  targetDelivery: string
  budgetHint: string
  competitorReference?: string
  status: InquiryStatus
  urgency: Urgency
  createdAt: string
  messages: Message[]
  aiSummary?: string
  missingFields: string[]
  recommendedProducts?: ProductRecommendation[]
  assignedTo?: string
  flagged?: boolean
  flagReason?: string
}

export interface Message {
  id: string
  sender: 'customer' | 'sales' | 'ai' | 'system'
  content: string
  timestamp: string
  attachments?: string[]
}

export interface ProductRecommendation {
  product: Product
  confidence: ConfidenceLevel
  reason: string
  alternativeIds: string[]
}

export interface Product {
  id: string
  sku: string
  name: string
  toolType: string
  diameter: number
  flute: number
  coating: string
  application: string
  compatibleMaterials: string[]
  keySellingPoints: string[]
  unitPrice: number
  priceType: PriceType
  leadTime: string
  leadTimeType: PriceType
  leadTimeDays?: number
  availability?: string
  moq: number
  competitorEquivalents?: string[]
  imageUrl?: string
  modelNumber?: string
}

export interface Quote {
  id: string
  inquiryId: string
  items: QuoteItem[]
  tone: 'formal' | 'concise' | 'friendly'
  status: 'draft' | 'pending-approval' | 'approved' | 'sent'
  notes: string
  createdAt: string
}

export interface QuoteItem {
  product: Product
  quantity: number
  unitPrice: number
  priceType: PriceType
  leadTime: string
  leadTimeType: PriceType
}

export interface EscalationCase {
  id: string
  inquiry: Inquiry
  reason: string
  requestedBy: string
  status: 'pending' | 'approved' | 'rejected'
  specialistNotes?: string
  reviewedBy?: string
  reviewedAt?: string
}

export interface KnowledgeNote {
  id: string
  title: string
  content: string
  category: string
  tags: string[]
  linkedInquiryIds: string[]
  createdAt: string
  updatedAt: string
}

// Demo scenarios
export type DemoScenario = string | null

export const demoScenarios: Record<string, { name: string; description: string; targetInquiryId: string }> = {
  A: {
    name: '시나리오 A',
    description: '정보가 부족한 문의 → AI가 추가 질문 → 추천 정확도 상승',
    targetInquiryId: 'INQ-001'
  },
  B: {
    name: '시나리오 B',
    description: '경쟁사 제품 기준 문의 → 매칭 추천 + 비교함 → 견적 초안 생성',
    targetInquiryId: 'INQ-002'
  },
  C: {
    name: '시나리오 C',
    description: '가격/납기 문의 포함 → 확정/추정 표시 + 승인 워크플로우',
    targetInquiryId: 'INQ-003'
  },
  D: {
    name: '시나리오 D',
    description: '불확실 케이스 → 전문가 이관 → 승인 후 고객 발송',
    targetInquiryId: 'INQ-004'
  },
  E: {
    name: '시나리오 E',
    description: '문의 처리 후 결과(Won/Lost) 입력 → 대시보드 지표 업데이트',
    targetInquiryId: 'INQ-005'
  }
}

// Mock Products (20 items)
export const mockProducts: Product[] = [
  {
    id: 'PRD-001',
    sku: 'YG-EM4-D10-TiAlN',
    name: '4날 엔드밀 D10 TiAlN',
    toolType: '엔드밀',
    diameter: 10,
    flute: 4,
    coating: 'TiAlN',
    application: '일반 가공',
    compatibleMaterials: ['스틸', '합금강', '스테인리스'],
    keySellingPoints: ['고속 가공 가능', '우수한 내마모성', '긴 공구 수명'],
    unitPrice: 45000,
    priceType: 'confirmed',
    leadTime: '3-5일',
    leadTimeType: 'confirmed',
    leadTimeDays: 4,
    availability: '즉시',
    moq: 5,
    competitorEquivalents: ['SANDVIK 2P160-1000', 'MITSUBISHI VCMHD1000'],
    imageUrl: '/images/tools/endmill-4flute.jpg',
    modelNumber: 'EM4-1000-TiAlN'
  },
  {
    id: 'PRD-002',
    sku: 'YG-EM4-D12-AlCrN',
    name: '4날 엔드밀 D12 AlCrN',
    toolType: '엔드밀',
    diameter: 12,
    flute: 4,
    coating: 'AlCrN',
    application: '고경도 가공',
    compatibleMaterials: ['고경도강', 'SKD', 'DAC'],
    keySellingPoints: ['고경도 소재 전용', '내열성 우수', '안정적 절삭'],
    unitPrice: 58000,
    priceType: 'confirmed',
    leadTime: '5-7일',
    leadTimeType: 'estimated',
    leadTimeDays: 6,
    availability: '재고',
    moq: 3,
    competitorEquivalents: ['KENNAMETAL 25A3SE120', 'OSG WX-EMS'],
    imageUrl: '/images/tools/endmill-4flute.jpg',
    modelNumber: 'EM4-1200-AlCrN'
  },
  {
    id: 'PRD-003',
    sku: 'YG-BN2-D8-CBN',
    name: '2날 볼엔드밀 D8 CBN',
    toolType: '볼엔드밀',
    diameter: 8,
    flute: 2,
    coating: 'CBN',
    application: '금형 가공',
    compatibleMaterials: ['경화강', 'SKD11', 'SKD61'],
    keySellingPoints: ['초경질 코팅', '고정밀 가공', '미세 곡면 가공'],
    unitPrice: 120000,
    priceType: 'estimated',
    leadTime: '7-10일',
    leadTimeType: 'estimated',
    leadTimeDays: 8,
    availability: '주문제작',
    moq: 1,
    imageUrl: '/images/tools/ball-endmill.jpg',
    modelNumber: 'BN2-0800-CBN',
    competitorEquivalents: ['OSG CBN-BN', 'HITACHI CBNB2008']
  },
  {
    id: 'PRD-004',
    sku: 'YG-DR-D6.5-TiN',
    name: '솔리드 드릴 D6.5 TiN',
    toolType: '드릴',
    diameter: 6.5,
    flute: 2,
    coating: 'TiN',
    application: '일반 홀 가공',
    compatibleMaterials: ['스틸', '주철', '알루미늄'],
    keySellingPoints: ['범용성', '경제적', '안정적 칩 배출'],
    unitPrice: 25000,
    priceType: 'confirmed',
    leadTime: '2-3일',
    leadTimeType: 'confirmed',
    leadTimeDays: 2,
    availability: '즉시',
    moq: 10,
    competitorEquivalents: ['NACHI L6520-065', 'MITSUBISHI MWS0650'],
    imageUrl: '/images/tools/drill-carbide.jpg',
    modelNumber: 'DR-0650-TiN'
  },
  {
    id: 'PRD-005',
    sku: 'YG-TAP-M8-HSS',
    name: '스파이럴 탭 M8 HSS',
    toolType: '탭',
    diameter: 8,
    flute: 3,
    coating: 'TiN',
    application: '나사 가공',
    compatibleMaterials: ['스틸', '알루미늄', '황동'],
    keySellingPoints: ['원활한 칩 배출', '범용 사용', '높은 정밀도'],
    unitPrice: 18000,
    priceType: 'confirmed',
    leadTime: '2-3일',
    leadTimeType: 'confirmed',
    leadTimeDays: 2,
    availability: '즉시',
    moq: 10,
    competitorEquivalents: ['OSG A-TAP M8', 'YAMAWA SP-M8'],
    imageUrl: '/images/tools/tap-thread.jpg',
    modelNumber: 'TAP-M8-HSS'
  },
  {
    id: 'PRD-006',
    sku: 'YG-RM3-D16-TiAlN',
    name: '3날 황삭 엔드밀 D16',
    toolType: '엔드밀',
    diameter: 16,
    flute: 3,
    coating: 'TiAlN',
    application: '황삭 가공',
    compatibleMaterials: ['스틸', '합금강', '주철'],
    keySellingPoints: ['고절삭량', '진동 감소', '빠른 가공'],
    unitPrice: 72000,
    priceType: 'confirmed',
    leadTime: '3-5일',
    leadTimeType: 'confirmed',
    leadTimeDays: 4,
    availability: '재고',
    moq: 3,
    competitorEquivalents: ['SANDVIK R216.34-16050', 'WALTER M4132-016'],
    imageUrl: '/images/tools/endmill-4flute.jpg',
    modelNumber: 'RM3-1600-TiAlN'
  },
  {
    id: 'PRD-007',
    sku: 'YG-EM6-D20-nACo',
    name: '6날 엔드밀 D20 nACo',
    toolType: '엔드밀',
    diameter: 20,
    flute: 6,
    coating: 'nACo',
    application: '정삭 가공',
    compatibleMaterials: ['스틸', '스테인리스', '티타늄'],
    keySellingPoints: ['최고급 코팅', '극한 내열성', '항공우주용'],
    unitPrice: 150000,
    priceType: 'estimated',
    leadTime: '10-14일',
    leadTimeType: 'estimated',
    leadTimeDays: 12,
    availability: '주문제작',
    moq: 1,
    competitorEquivalents: ['KENNAMETAL HARVI III', 'SANDVIK CoroMill Plura'],
    imageUrl: '/images/tools/endmill-4flute.jpg',
    modelNumber: 'EM6-2000-nACo'
  },
  {
    id: 'PRD-008',
    sku: 'YG-CH-D10-TiAlN',
    name: '챔퍼밀 D10 90도 TiAlN',
    toolType: '챔퍼밀',
    diameter: 10,
    flute: 4,
    coating: 'TiAlN',
    application: '모따기',
    compatibleMaterials: ['스틸', '합금강', '스테인리스'],
    keySellingPoints: ['정밀 모따기', '버 제거', '다목적'],
    unitPrice: 38000,
    priceType: 'confirmed',
    leadTime: '3-5일',
    leadTimeType: 'confirmed',
    leadTimeDays: 4,
    availability: '재고',
    moq: 5,
    competitorEquivalents: ['SANDVIK 316L-10', 'OSG CA-CR'],
    imageUrl: '/images/tools/endmill-4flute.jpg',
    modelNumber: 'CH-1000-TiAlN'
  },
  {
    id: 'PRD-009',
    sku: 'YG-FR-D12-PCD',
    name: '페이스밀 인서트 D12 PCD',
    toolType: '인서트',
    diameter: 12,
    flute: 1,
    coating: 'PCD',
    application: '비철금속 가공',
    compatibleMaterials: ['알루미늄', '구리', '플라스틱'],
    keySellingPoints: ['비철 전용', '고광택 면', '초장수명'],
    unitPrice: 85000,
    priceType: 'confirmed',
    leadTime: '5-7일',
    leadTimeType: 'estimated',
    leadTimeDays: 6,
    availability: '재고',
    moq: 2,
    competitorEquivalents: ['SUMITOMO DIA-PCD12', 'KYOCERA PCD-12'],
    imageUrl: '/images/tools/endmill-4flute.jpg',
    modelNumber: 'FR-1200-PCD'
  },
  {
    id: 'PRD-010',
    sku: 'YG-RM-D8-CRN',
    name: '리머 D8 CRN',
    toolType: '리머',
    diameter: 8,
    flute: 6,
    coating: 'CRN',
    application: '정밀 홀 가공',
    compatibleMaterials: ['스틸', '합금강'],
    keySellingPoints: ['고정밀 IT6', '우수한 면조도', '장수명'],
    unitPrice: 55000,
    priceType: 'confirmed',
    leadTime: '5-7일',
    leadTimeType: 'confirmed',
    leadTimeDays: 6,
    availability: '재고',
    moq: 3,
    competitorEquivalents: ['GUHRING 4954-8', 'OSG HY-PRO-8'],
    imageUrl: '/images/tools/reamer-precision.jpg',
    modelNumber: 'RM-0800-CRN'
  },
  {
    id: 'PRD-011',
    sku: 'YG-EM2-D6-DLC',
    name: '2날 엔드밀 D6 DLC',
    toolType: '엔드밀',
    diameter: 6,
    flute: 2,
    coating: 'DLC',
    application: '알루미늄 가공',
    compatibleMaterials: ['알루미늄', '비철금속', '플라스틱'],
    keySellingPoints: ['낮은 마찰계수', '칩 부착 방지', '고속 가공'],
    unitPrice: 35000,
    priceType: 'confirmed',
    leadTime: '3-5일',
    leadTimeType: 'confirmed',
    moq: 5,
    competitorEquivalents: ['MITSUBISHI DLC-ALU6']
  },
  {
    id: 'PRD-012',
    sku: 'YG-DR-D10.2-TiAlN',
    name: '초경 드릴 D10.2 TiAlN',
    toolType: '드릴',
    diameter: 10.2,
    flute: 2,
    coating: 'TiAlN',
    application: '깊은 홀 가공',
    compatibleMaterials: ['스틸', '스테인리스', '합금강'],
    keySellingPoints: ['5xD 깊이', '내부 쿨런트', '고속 가공'],
    unitPrice: 68000,
    priceType: 'confirmed',
    leadTime: '5-7일',
    leadTimeType: 'confirmed',
    moq: 3,
    competitorEquivalents: ['SANDVIK 860.1-1020']
  },
  {
    id: 'PRD-013',
    sku: 'YG-TAP-M12-HSSE',
    name: '스파이럴 탭 M12 HSSE',
    toolType: '탭',
    diameter: 12,
    flute: 3,
    coating: 'TiCN',
    application: '스테인리스 나사',
    compatibleMaterials: ['스테인리스', '티타늄', '인코넬'],
    keySellingPoints: ['난삭재 전용', '고강도', '정밀 피치'],
    unitPrice: 42000,
    priceType: 'confirmed',
    leadTime: '5-7일',
    leadTimeType: 'estimated',
    moq: 5,
    competitorEquivalents: ['OSG VX-OT-M12']
  },
  {
    id: 'PRD-014',
    sku: 'YG-BN4-D10-TiAlN',
    name: '4날 볼엔드밀 D10',
    toolType: '볼엔드밀',
    diameter: 10,
    flute: 4,
    coating: 'TiAlN',
    application: '3D 곡면 가공',
    compatibleMaterials: ['스틸', '합금강', 'SKD'],
    keySellingPoints: ['고속 곡면', '우수한 면조도', '금형 정삭'],
    unitPrice: 65000,
    priceType: 'confirmed',
    leadTime: '3-5일',
    leadTimeType: 'confirmed',
    moq: 3,
    competitorEquivalents: ['MITSUBISHI VF4SVBR1000']
  },
  {
    id: 'PRD-015',
    sku: 'YG-TM-D25-ISO',
    name: 'T-슬롯 밀 D25',
    toolType: 'T-슬롯밀',
    diameter: 25,
    flute: 6,
    coating: 'TiN',
    application: 'T-홈 가공',
    compatibleMaterials: ['스틸', '주철'],
    keySellingPoints: ['T-홈 전용', '안정적 가공', '표준 규격'],
    unitPrice: 95000,
    priceType: 'confirmed',
    leadTime: '7-10일',
    leadTimeType: 'estimated',
    moq: 1,
    competitorEquivalents: ['DORMER T-SLOT 25']
  },
  {
    id: 'PRD-016',
    sku: 'YG-EM4-D8-AlTiN',
    name: '4날 엔드밀 D8 AlTiN',
    toolType: '엔드밀',
    diameter: 8,
    flute: 4,
    coating: 'AlTiN',
    application: '고온 가공',
    compatibleMaterials: ['스테인리스', '티타늄', '내열합금'],
    keySellingPoints: ['1000°C 내열', '난삭재 전용', '항공 산업용'],
    unitPrice: 78000,
    priceType: 'estimated',
    leadTime: '7-10일',
    leadTimeType: 'estimated',
    moq: 2,
    competitorEquivalents: ['ISCAR EC-H4-CF-08']
  },
  {
    id: 'PRD-017',
    sku: 'YG-DR-D5-CARBIDE',
    name: '초경 드릴 D5 무코팅',
    toolType: '드릴',
    diameter: 5,
    flute: 2,
    coating: '무코팅',
    application: '알루미늄 홀',
    compatibleMaterials: ['알루미늄', '구리', '황동'],
    keySellingPoints: ['비철 전용', '경제적', '고속 가공'],
    unitPrice: 15000,
    priceType: 'confirmed',
    leadTime: '2-3일',
    leadTimeType: 'confirmed',
    moq: 20,
    competitorEquivalents: ['NACHI AG-SD5']
  },
  {
    id: 'PRD-018',
    sku: 'YG-THR-M10-FORM',
    name: '전조 탭 M10',
    toolType: '탭',
    diameter: 10,
    flute: 0,
    coating: 'TiN',
    application: '소성 가공 나사',
    compatibleMaterials: ['알루미늄', '연강', '황동'],
    keySellingPoints: ['칩 없음', '강한 나사산', '고속 가공'],
    unitPrice: 35000,
    priceType: 'confirmed',
    leadTime: '3-5일',
    leadTimeType: 'confirmed',
    moq: 5,
    competitorEquivalents: ['EMUGE FORM M10']
  },
  {
    id: 'PRD-019',
    sku: 'YG-EM3-D14-CVD',
    name: '3날 엔드밀 D14 CVD',
    toolType: '엔드밀',
    diameter: 14,
    flute: 3,
    coating: 'CVD',
    application: '주철 가공',
    compatibleMaterials: ['주철', 'FC', 'FCD'],
    keySellingPoints: ['주철 전용', '내마모성', '안정적 수명'],
    unitPrice: 62000,
    priceType: 'confirmed',
    leadTime: '5-7일',
    leadTimeType: 'confirmed',
    moq: 3,
    competitorEquivalents: ['SANDVIK 1P231-1400']
  },
  {
    id: 'PRD-020',
    sku: 'YG-SL-D6-LONG',
    name: '롱넥 엔드밀 D6 x50L',
    toolType: '엔드밀',
    diameter: 6,
    flute: 2,
    coating: 'TiAlN',
    application: '깊은 포켓 가공',
    compatibleMaterials: ['스틸', '알루미늄', '합금강'],
    keySellingPoints: ['깊은 가공', '진동 방지', '고강성'],
    unitPrice: 48000,
    priceType: 'confirmed',
    leadTime: '5-7일',
    leadTimeType: 'estimated',
    moq: 3,
    competitorEquivalents: ['OSG AE-LNBD-N 6x50']
  }
]

// Mock Inquiries (12 items)
export const mockInquiries: Inquiry[] = [
  {
    id: 'INQ-001',
    customer: '데모-A 담당자',
    company: 'DEMO반도체',
    country: '한국',
    region: '아시아',
    industry: '반도체',
    workpieceMaterial: '', // Missing - for Scenario A
    process: '밀링',
    machine: '', // Missing
    hasDrawing: false,
    hasSpec: false,
    requestedToolType: '엔드밀',
    quantity: 50,
    targetDelivery: '2주 내',
    budgetHint: '단가 5만원 이하',
    status: 'new',
    urgency: 'high',
    createdAt: '2024-01-15T09:30:00Z',
    messages: [
      {
        id: 'MSG-001-1',
        sender: 'customer',
        content: '안녕하세요, 엔드밀 견적 요청드립니다. 50개 정도 필요합니다. 급하게 필요해서 2주 내로 받을 수 있을까요?',
        timestamp: '2024-01-15T09:30:00Z'
      }
    ],
    missingFields: ['피삭재', '가공기계', '직경', '도면/스펙']
  },
  {
    id: 'INQ-002',
    customer: '데모-B 담당자',
    company: 'DEMO자동차',
    country: '한국',
    region: '아시아',
    industry: '자동차',
    workpieceMaterial: '알루미늄 6061',
    process: '밀링',
    machine: '마자크 VTC-530C',
    hasDrawing: true,
    hasSpec: true,
    requestedToolType: '엔드밀',
    quantity: 100,
    targetDelivery: '1개월',
    budgetHint: '',
    competitorReference: 'SANDVIK 2P160-1000', // For Scenario B
    status: 'in-review',
    urgency: 'medium',
    createdAt: '2024-01-14T14:20:00Z',
    messages: [
      {
        id: 'MSG-002-1',
        sender: 'customer',
        content: '현재 SANDVIK 2P160-1000 사용 중인데 YG-1 대체품 있을까요? 알루미늄 6061 가공용입니다.',
        timestamp: '2024-01-14T14:20:00Z',
        attachments: ['drawing_001.pdf', 'spec_001.xlsx']
      }
    ],
    missingFields: [],
    recommendedProducts: [
      {
        product: mockProducts[0],
        confidence: 'high',
        reason: 'SANDVIK 2P160-1000과 동등 사양. 알루미늄 가공에 최적화된 TiAlN 코팅.',
        alternativeIds: ['PRD-011', 'PRD-006']
      }
    ]
  },
  {
    id: 'INQ-003',
    customer: '데모-C 담당자',
    company: 'DEMO전자부품',
    country: '한국',
    region: '아시아',
    industry: '반도체',
    workpieceMaterial: 'SKD11',
    process: '정삭',
    machine: 'DMG MORI DMC 80H',
    hasDrawing: true,
    hasSpec: true,
    requestedToolType: '볼엔드밀',
    quantity: 20,
    targetDelivery: '긴급',
    budgetHint: '예산 무관',
    status: 'quote-drafted',
    urgency: 'high',
    createdAt: '2024-01-13T11:00:00Z',
    messages: [
      {
        id: 'MSG-003-1',
        sender: 'customer',
        content: 'SKD11 금형 정삭용 볼엔드밀 견적 부탁드립니다. 정확한 가격과 납기일이 필요합니다.',
        timestamp: '2024-01-13T11:00:00Z',
        attachments: ['mold_drawing.pdf']
      },
      {
        id: 'MSG-003-2',
        sender: 'sales',
        content: '견적서 준비 중입니다. 곧 보내드리겠습니다.',
        timestamp: '2024-01-13T14:00:00Z'
      }
    ],
    missingFields: [],
    recommendedProducts: [
      {
        product: mockProducts[2],
        confidence: 'high',
        reason: 'SKD11 고경도강 가공에 최적화된 CBN 코팅 볼엔드밀',
        alternativeIds: ['PRD-014']
      }
    ]
  },
  {
    id: 'INQ-004',
    customer: '데모-D 담당자',
    company: 'DEMO디스플레이',
    country: '한국',
    region: '아시아',
    industry: '디스플레이',
    workpieceMaterial: '인코넬 718',
    process: '황삭 + 정삭',
    machine: 'MAKINO A61nx',
    hasDrawing: true,
    hasSpec: true,
    requestedToolType: '엔드밀',
    quantity: 30,
    targetDelivery: '3주',
    budgetHint: '고품질 우선',
    status: 'escalated', // For Scenario D
    urgency: 'medium',
    createdAt: '2024-01-12T16:45:00Z',
    messages: [
      {
        id: 'MSG-004-1',
        sender: 'customer',
        content: '인코넬 718 가공용 공구 추천 부탁드립니다. 황삭과 정삭 모두 필요합니다.',
        timestamp: '2024-01-12T16:45:00Z',
        attachments: ['inconel_part.step']
      },
      {
        id: 'MSG-004-2',
        sender: 'system',
        content: '[AI 알림] 난삭재 가공 문의로 전문가 검토가 필요합니다.',
        timestamp: '2024-01-12T17:00:00Z'
      }
    ],
    missingFields: [],
    recommendedProducts: [
      {
        product: mockProducts[6],
        confidence: 'medium',
        reason: 'nACo 코팅으로 인코넬 가공 가능하나, 전문가 확인 필요',
        alternativeIds: ['PRD-016']
      }
    ]
  },
  {
    id: 'INQ-005',
    customer: '데모-E 담당자',
    company: 'DEMO중공업',
    country: '한국',
    region: '아시아',
    industry: '중장비',
    workpieceMaterial: 'S45C',
    process: '드릴링',
    machine: '화천 Hi-TECH 230',
    hasDrawing: true,
    hasSpec: true,
    requestedToolType: '드릴',
    quantity: 200,
    targetDelivery: '2주',
    budgetHint: '대량 할인 문의',
    status: 'sent', // For Scenario E
    urgency: 'low',
    createdAt: '2024-01-11T10:30:00Z',
    messages: [
      {
        id: 'MSG-005-1',
        sender: 'customer',
        content: 'S45C 강재 드릴링용 D6.5 드릴 200개 견적 부탁드립니다.',
        timestamp: '2024-01-11T10:30:00Z'
      },
      {
        id: 'MSG-005-2',
        sender: 'sales',
        content: '견적서 발송드렸습니다. 확인 부탁드립니다.',
        timestamp: '2024-01-12T09:00:00Z'
      }
    ],
    missingFields: [],
    recommendedProducts: [
      {
        product: mockProducts[3],
        confidence: 'high',
        reason: 'S45C 가공에 적합한 범용 TiN 코팅 드릴',
        alternativeIds: ['PRD-012']
      }
    ]
  },
  {
    id: 'INQ-006',
    customer: 'Demo-F Manager',
    company: 'DEMO Aerospace',
    country: '미국',
    region: '북미',
    industry: '항공우주',
    workpieceMaterial: 'Ti-6Al-4V',
    process: '정삭',
    machine: 'Haas VF-5',
    hasDrawing: true,
    hasSpec: true,
    requestedToolType: '엔드밀',
    quantity: 50,
    targetDelivery: '1개월',
    budgetHint: 'Quality priority',
    status: 'in-review',
    urgency: 'medium',
    createdAt: '2024-01-14T08:00:00Z',
    flagged: true,
    flagReason: '수출 규제 확인 필요 (미국 항공우주)',
    messages: [
      {
        id: 'MSG-006-1',
        sender: 'customer',
        content: 'Need end mills for Ti-6Al-4V aerospace parts. High precision required.',
        timestamp: '2024-01-14T08:00:00Z',
        attachments: ['aerospace_spec.pdf']
      }
    ],
    missingFields: [],
    recommendedProducts: [
      {
        product: mockProducts[15],
        confidence: 'high',
        reason: '티타늄 가공 전용 AlTiN 코팅, 항공우주 산업 적합',
        alternativeIds: ['PRD-007']
      }
    ]
  },
  {
    id: 'INQ-007',
    customer: 'デモ-G 担当者',
    company: 'DEMO自動車JP',
    country: '일본',
    region: '아시아',
    industry: '자동차',
    workpieceMaterial: 'FC250',
    process: '밀링',
    machine: 'Mazak INTEGREX',
    hasDrawing: false,
    hasSpec: true,
    requestedToolType: '엔드밀',
    quantity: 80,
    targetDelivery: '2주',
    budgetHint: '',
    status: 'need-info',
    urgency: 'medium',
    createdAt: '2024-01-13T06:00:00Z',
    messages: [
      {
        id: 'MSG-007-1',
        sender: 'customer',
        content: '鋳鉄FC250加工用エンドミルの見積もりをお願いします。',
        timestamp: '2024-01-13T06:00:00Z'
      },
      {
        id: 'MSG-007-2',
        sender: 'sales',
        content: '도면이 필요합니다. 첨부 부탁드립니다.',
        timestamp: '2024-01-13T10:00:00Z'
      }
    ],
    missingFields: ['도면']
  },
  {
    id: 'INQ-008',
    customer: '演示-H 负责人',
    company: 'DEMO汽车CN',
    country: '중국',
    region: '아시아',
    industry: '전기차',
    workpieceMaterial: '알루미늄 7075',
    process: '고속 가공',
    machine: 'Brother TC-S2DN',
    hasDrawing: true,
    hasSpec: true,
    requestedToolType: '엔드밀',
    quantity: 500,
    targetDelivery: '즉시',
    budgetHint: '대량 구매',
    status: 'new',
    urgency: 'high',
    createdAt: '2024-01-15T03:00:00Z',
    messages: [
      {
        id: 'MSG-008-1',
        sender: 'customer',
        content: '电池壳体加工用铝合金端铣刀报价，需要500支，急单。',
        timestamp: '2024-01-15T03:00:00Z',
        attachments: ['battery_case.dwg']
      }
    ],
    missingFields: []
  },
  {
    id: 'INQ-009',
    customer: 'Demo-I Manager',
    company: 'DEMO Auto EU',
    country: '독일',
    region: '유럽',
    industry: '자동차',
    workpieceMaterial: '42CrMo4',
    process: '나사 가공',
    machine: 'DMG MORI CTX',
    hasDrawing: true,
    hasSpec: true,
    requestedToolType: '탭',
    quantity: 100,
    targetDelivery: '3주',
    budgetHint: '',
    competitorReference: 'OSG A-TAP M8',
    status: 'in-review',
    urgency: 'low',
    createdAt: '2024-01-12T14:00:00Z',
    messages: [
      {
        id: 'MSG-009-1',
        sender: 'customer',
        content: 'We need M8 taps equivalent to OSG A-TAP for 42CrMo4 steel threading.',
        timestamp: '2024-01-12T14:00:00Z'
      }
    ],
    missingFields: [],
    recommendedProducts: [
      {
        product: mockProducts[4],
        confidence: 'high',
        reason: 'OSG A-TAP M8 대체품. 동일 사양 및 성능.',
        alternativeIds: ['PRD-013']
      }
    ]
  },
  {
    id: 'INQ-010',
    customer: '데모-J 담당자',
    company: 'DEMO철강',
    country: '한국',
    region: '아시아',
    industry: '철강',
    workpieceMaterial: 'SUS304',
    process: '홀 가공',
    machine: 'CNC VMC-500',
    hasDrawing: true,
    hasSpec: false,
    requestedToolType: '리머',
    quantity: 30,
    targetDelivery: '1주',
    budgetHint: '',
    status: 'quote-drafted',
    urgency: 'high',
    createdAt: '2024-01-14T11:30:00Z',
    messages: [
      {
        id: 'MSG-010-1',
        sender: 'customer',
        content: 'SUS304 스테인리스 정밀 홀 가공용 D8 리머 견적 요청합니다.',
        timestamp: '2024-01-14T11:30:00Z',
        attachments: ['hole_spec.pdf']
      }
    ],
    missingFields: ['스펙시트'],
    recommendedProducts: [
      {
        product: mockProducts[9],
        confidence: 'high',
        reason: 'SUS304 가공에 적합한 CRN 코팅 리머, IT6 정밀도',
        alternativeIds: []
      }
    ]
  },
  {
    id: 'INQ-011',
    customer: 'Demo-K Manager',
    company: 'DEMO Aviation EU',
    country: '프랑스',
    region: '유럽',
    industry: '항공우주',
    workpieceMaterial: 'CFRP',
    process: '드릴링',
    machine: 'FIDIA K199',
    hasDrawing: true,
    hasSpec: true,
    requestedToolType: '드릴',
    quantity: 25,
    targetDelivery: '2주',
    budgetHint: '',
    status: 'escalated',
    urgency: 'high',
    createdAt: '2024-01-13T09:00:00Z',
    flagged: true,
    flagReason: '수출 규제 확인 필요 (EU 항공우주)',
    messages: [
      {
        id: 'MSG-011-1',
        sender: 'customer',
        content: 'CFRP composite drilling tools for aircraft wing assembly.',
        timestamp: '2024-01-13T09:00:00Z',
        attachments: ['cfrp_wing.pdf']
      }
    ],
    missingFields: []
  },
  {
    id: 'INQ-012',
    customer: '데모-L 담당자',
    company: 'DEMO항공',
    country: '한국',
    region: '아시아',
    industry: '항공방산',
    workpieceMaterial: 'Waspaloy',
    process: '황삭',
    machine: 'Makino D500',
    hasDrawing: true,
    hasSpec: true,
    requestedToolType: '엔드밀',
    quantity: 15,
    targetDelivery: '1개월',
    budgetHint: '',
    status: 'need-info',
    urgency: 'medium',
    createdAt: '2024-01-11T15:00:00Z',
    messages: [
      {
        id: 'MSG-012-1',
        sender: 'customer',
        content: 'Waspaloy 초내열합금 황삭용 엔드밀 추천 부탁드립니다.',
        timestamp: '2024-01-11T15:00:00Z'
      },
      {
        id: 'MSG-012-2',
        sender: 'sales',
        content: '가공 조건(절삭 속도, 이송 속도) 정보가 필요합니다.',
        timestamp: '2024-01-12T09:00:00Z'
      }
    ],
    missingFields: ['가공 조건']
  }
]

// Mock Escalation Cases
export const mockEscalationCases: EscalationCase[] = [
  {
    id: 'ESC-001',
    inquiry: mockInquiries[3], // INQ-004
    reason: '인코넬 718 난삭재 가공으로 전문가 확인 필요',
    requestedBy: '김민준',
    status: 'pending'
  },
  {
    id: 'ESC-002',
    inquiry: mockInquiries[10], // INQ-011
    reason: 'CFRP 복합재 가공 + 수출 규제 확인 필요',
    requestedBy: '이수진',
    status: 'pending'
  }
]

// Mock Knowledge Notes
export const mockKnowledgeNotes: KnowledgeNote[] = [
  {
    id: 'KN-001',
    title: '인코넬 가공 시 주의사항',
    content: '인코넬 718 가공 시 절삭 속도는 30-40m/min 권장. 충분한 쿨런트 공급 필수. nACo 또는 AlTiN 코팅 권장.',
    category: '난삭재 가공',
    tags: ['인코넬', '내열합금', '항공우주'],
    linkedInquiryIds: ['INQ-004'],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-10T00:00:00Z'
  },
  {
    id: 'KN-002',
    title: '알루미늄 고속 가공 가이드',
    content: 'Al6061, Al7075 고속 가공 시 DLC 코팅 권장. 절삭 속도 300-500m/min 가능. 칩 배출에 주의.',
    category: '비철금속 가공',
    tags: ['알루미늄', '고속가공', 'DLC'],
    linkedInquiryIds: ['INQ-002', 'INQ-008'],
    createdAt: '2024-01-02T00:00:00Z',
    updatedAt: '2024-01-08T00:00:00Z'
  },
  {
    id: 'KN-003',
    title: '경쟁사 제품 매칭 가이드',
    content: 'SANDVIK, OSG, MITSUBISHI 등 주요 경쟁사 제품 대응표. 정확한 매칭을 위해 사양 확인 필수.',
    category: '제품 비교',
    tags: ['경쟁사', 'SANDVIK', 'OSG', 'MITSUBISHI'],
    linkedInquiryIds: ['INQ-002', 'INQ-009'],
    createdAt: '2024-01-03T00:00:00Z',
    updatedAt: '2024-01-12T00:00:00Z'
  },
  {
    id: 'KN-004',
    title: 'SKD 금형강 가공 최적화',
    content: 'SKD11, SKD61 가공 시 CBN 또는 AlCrN 코팅 권장. 절삭 속도 80-120m/min. 건식 가공 가능.',
    category: '금형 가공',
    tags: ['SKD', '금형', 'CBN'],
    linkedInquiryIds: ['INQ-003'],
    createdAt: '2024-01-04T00:00:00Z',
    updatedAt: '2024-01-11T00:00:00Z'
  },
  {
    id: 'KN-005',
    title: '수출 규제 체크리스트',
    content: '항공우주, 방산 관련 수출 시 수출 규제 확인 필수. 미국, EU, 일본 등 국가별 규정 상이.',
    category: '규정/가이드',
    tags: ['수출규제', '항공우주', '방산'],
    linkedInquiryIds: ['INQ-006', 'INQ-011'],
    createdAt: '2024-01-05T00:00:00Z',
    updatedAt: '2024-01-14T00:00:00Z'
  }
]

// Dashboard Stats
export const dashboardStats = {
  statusCounts: {
    new: 3,
    'in-review': 3,
    'need-info': 2,
    'quote-drafted': 2,
    sent: 1,
    escalated: 2
  },
  topRequestedProducts: [
    { name: '4날 엔드밀', count: 35 },
    { name: '드릴', count: 28 },
    { name: '볼엔드밀', count: 22 },
    { name: '탭', count: 18 },
    { name: '리머', count: 12 }
  ],
  topMissingFields: [
    { name: '도면', count: 45 },
    { name: '피삭재', count: 32 },
    { name: '가공기계', count: 28 },
    { name: '스펙시트', count: 20 },
    { name: '가공 조건', count: 15 }
  ],
  avgTimeToQuote: '4.2시간',
  winRate: 68,
  dataProgress: 72
}

// Filter Options
export const filterOptions = {
  regions: ['아시아', '북미', '유럽', '기타'],
  industries: ['반도체', '자동차', '항공우주', '디스플레이', '중장비', '철강', '전기차', '항공방산', '기타'],
  materials: ['스틸', '알루미늄', '스테인리스', '티타늄', '인코넬', '주철', 'SKD', 'CFRP', '기타'],
  processes: ['밀링', '드릴링', '나사 가공', '황삭', '정삭', '홀 가공', '고속 가공', '기타'],
  urgencies: ['high', 'medium', 'low'] as Urgency[],
  statuses: ['new', 'in-review', 'need-info', 'quote-drafted', 'sent', 'escalated', 'won', 'lost'] as InquiryStatus[]
}

export const toolTypes = ['엔드밀', '볼엔드밀', '드릴', '탭', '리머', '챔퍼밀', '인서트', 'T-슬롯밀']
export const coatings = ['TiAlN', 'AlCrN', 'CBN', 'TiN', 'DLC', 'PCD', 'CRN', 'nACo', 'AlTiN', 'CVD', '무코팅', 'TiCN']
export const materials = ['스틸', '알루미늄', '스테인리스', '티타늄', '인코넬', '주철', 'SKD', '합금강', '고경도강', '황동', '구리']
export const applications = ['일반 가공', '황삭 가공', '정삭 가공', '고속 가공', '금형 가공', '홀 가공', '나사 가공', '깊은 가공', '고정밀 가공']

// Product Finder Demo Scenarios
export type ProductFinderScenario = 'PF1' | 'PF2' | 'PF3' | null

export const productFinderScenarios: Record<string, { name: string; description: string; tab: string }> = {
  PF1: {
    name: '시나리오 1',
    description: '정보 부족 → 추가 질문으로 좁히기',
    tab: 'guided'
  },
  PF2: {
    name: '시나리오 2',
    description: '경쟁사 SKU → 매칭 + 비교함',
    tab: 'competitor'
  },
  PF3: {
    name: '시나리오 3',
    description: '도면/스펙 → 추출값 확인 후 추천',
    tab: 'drawing'
  }
}
