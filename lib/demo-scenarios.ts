// 12 Demo Scenarios for CEO Presentation
export interface DemoScenario {
  id: string
  name: string
  description: string
  turn1Message: string
  missingFields: { field: string; label: string; severity: 'critical' | 'important' }[]
  turn1Questions: { question: string; options: string[] }[]
  funnelNumbers: { start: number; afterTurn1: number; afterTurn2: number; final: number }
  turn2Answers: string[]
  topRecommendations: {
    id: string
    name: string
    sku: string
    confidence: number
    reasons: string[]
    caution: string
    price: number
    leadTime: string
    availability: string
    competitorMatch?: string
  }[]
  uncertaintyBefore: 'high' | 'medium' | 'low'
  uncertaintyAfter: 'high' | 'medium' | 'low'
}

export const demoScenarios: DemoScenario[] = [
  {
    id: 'S01',
    name: 'SUS 엔드밀 (정보 부족)',
    description: '스테인리스 엔드밀만 요청, 직경/가공목적 누락',
    turn1Message: '스테인리스 가공할 엔드밀 하나 추천해주세요',
    missingFields: [
      { field: 'diameter', label: '직경', severity: 'critical' },
      { field: 'processGoal', label: '가공목적', severity: 'critical' },
      { field: 'depth', label: '가공깊이', severity: 'important' }
    ],
    turn1Questions: [
      { question: '필요한 직경은 얼마인가요?', options: ['6mm', '8mm', '10mm', '12mm', '모르겠음'] },
      { question: '황삭인가요, 정삭인가요?', options: ['황삭 (거친가공)', '정삭 (마무리)', '둘 다', '모르겠음'] }
    ],
    funnelNumbers: { start: 120, afterTurn1: 45, afterTurn2: 12, final: 3 },
    turn2Answers: ['10mm', '황삭 (거친가공)'],
    topRecommendations: [
      { id: 'P001', name: 'I-Xmill 4F SUS황삭', sku: 'YG-EM4-SUS-10', confidence: 94, reasons: ['SUS304/316 난삭재 최적화', '고강성 4날 설계로 진동 감소', '황삭 시 칩 배출 우수'], caution: '절삭유 충분히 사용 권장', price: 58000, leadTime: '즉시', availability: '즉시', competitorMatch: 'SANDVIK 2P160-1000' },
      { id: 'P002', name: 'Inox-Pro 4F', sku: 'YG-INX4-10', confidence: 89, reasons: ['스테인리스 전용 코팅', '내열성 우수한 TiAlN', '긴 공구 수명'], caution: '고속 가공 시 발열 주의', price: 52000, leadTime: '즉시', availability: '즉시' },
      { id: 'P003', name: 'Gen-Mill SUS', sku: 'YG-GM-SUS-10', confidence: 82, reasons: ['가성비 우수', '범용 SUS 가공', '안정적 성능'], caution: '깊은 가공 시 성능 저하 가능', price: 38000, leadTime: '3일', availability: '재고' }
    ],
    uncertaintyBefore: 'high',
    uncertaintyAfter: 'low'
  },
  {
    id: 'S02',
    name: '직경만 있음 (6파이 엔드밀)',
    description: '직경만 명시, 소재/가공목적 누락',
    turn1Message: '6파이 엔드밀 추천해주세요',
    missingFields: [
      { field: 'material', label: '피삭재', severity: 'critical' },
      { field: 'processGoal', label: '가공목적', severity: 'critical' }
    ],
    turn1Questions: [
      { question: '어떤 소재를 가공하시나요?', options: ['스틸/탄소강', '스테인리스', '알루미늄', 'SKD 금형강', '모르겠음'] },
      { question: '어떤 가공을 하시나요?', options: ['측면가공', '포켓가공', '곡면가공', '홈가공', '모르겠음'] }
    ],
    funnelNumbers: { start: 85, afterTurn1: 30, afterTurn2: 8, final: 3 },
    turn2Answers: ['스틸/탄소강', '측면가공'],
    topRecommendations: [
      { id: 'P004', name: 'Gen-Mill 4F D6', sku: 'YG-GM4-STL-06', confidence: 92, reasons: ['범용 스틸 가공 최적화', '4날 안정적 절삭', '측면가공 우수'], caution: 'ap 1D 이하 권장', price: 28000, leadTime: '즉시', availability: '즉시' },
      { id: 'P005', name: 'X-Mill Pro D6', sku: 'YG-XMP-06', confidence: 87, reasons: ['고강성 설계', '진동 최소화', '긴 수명'], caution: '고속 이송 시 주의', price: 35000, leadTime: '즉시', availability: '즉시' },
      { id: 'P006', name: 'Eco-Mill D6', sku: 'YG-ECO-06', confidence: 78, reasons: ['경제적 선택', '기본 성능 확보', '범용성'], caution: '난삭재 비권장', price: 22000, leadTime: '즉시', availability: '즉시' }
    ],
    uncertaintyBefore: 'high',
    uncertaintyAfter: 'low'
  },
  {
    id: 'S03',
    name: '정삭/표면조도 중요',
    description: '표면조도 Ra0.8 요구',
    turn1Message: '표면조도 Ra0.8 이하로 맞춰야 하는데 엔드밀 추천해주세요',
    missingFields: [
      { field: 'material', label: '피삭재', severity: 'critical' },
      { field: 'diameter', label: '직경', severity: 'important' }
    ],
    turn1Questions: [
      { question: '가공 소재가 무엇인가요?', options: ['알루미늄', '스틸', 'SKD금형강', '스테인리스', '모르겠음'] },
      { question: '필요한 직경 범위는?', options: ['6mm 이하', '8-10mm', '12mm 이상', '모르겠음'] }
    ],
    funnelNumbers: { start: 95, afterTurn1: 25, afterTurn2: 6, final: 3 },
    turn2Answers: ['알루미늄', '8-10mm'],
    topRecommendations: [
      { id: 'P007', name: 'Finish-Pro 2F', sku: 'YG-FIN2-AL-08', confidence: 96, reasons: ['2날 경면 가공용', 'Ra0.4 달성 가능', 'DLC 코팅으로 알루미늄 최적'], caution: '절삭 속도 높게 유지', price: 45000, leadTime: '즉시', availability: '즉시' },
      { id: 'P008', name: 'Mirror-Mill', sku: 'YG-MIR-08', confidence: 91, reasons: ['초정밀 연삭 가공', '버 최소화', '고광택면 가공'], caution: '이송속도 낮게 설정', price: 52000, leadTime: '3일', availability: '재고' },
      { id: 'P009', name: 'Alu-Finish', sku: 'YG-ALF-08', confidence: 85, reasons: ['알루미늄 정삭 전용', '무코팅으로 용착 방지', '깨끗한 표면'], caution: '절삭유 사용 권장', price: 38000, leadTime: '즉시', availability: '즉시' }
    ],
    uncertaintyBefore: 'high',
    uncertaintyAfter: 'low'
  },
  {
    id: 'S04',
    name: '고이송/생산성 (사이클타임)',
    description: '생산성, 사이클타임 단축 요청',
    turn1Message: '가공 시간을 줄이고 싶어요. 생산성 좋은 공구 추천해주세요',
    missingFields: [
      { field: 'material', label: '피삭재', severity: 'critical' },
      { field: 'toolType', label: '공구종류', severity: 'critical' },
      { field: 'diameter', label: '직경', severity: 'important' }
    ],
    turn1Questions: [
      { question: '가공 소재는 무엇인가요?', options: ['스틸/주철', '스테인리스', 'SKD금형강', '알루미늄', '모르겠음'] },
      { question: '어떤 가공을 주로 하시나요?', options: ['포켓황삭', '측면가공', '3D곡면', '홀가공', '모르겠음'] }
    ],
    funnelNumbers: { start: 150, afterTurn1: 40, afterTurn2: 10, final: 3 },
    turn2Answers: ['스틸/주철', '포켓황삭'],
    topRecommendations: [
      { id: 'P010', name: 'Hi-Feed 6F', sku: 'YG-HF6-STL-10', confidence: 95, reasons: ['고이송 전용 6날 설계', '사이클타임 40% 단축', '낮은 ap + 높은 fz 전략'], caution: '기계 강성 확인 필요', price: 85000, leadTime: '5일', availability: '재고' },
      { id: 'P011', name: 'Rapid-Mill', sku: 'YG-RAP-10', confidence: 88, reasons: ['고속가공 최적화', '진동 감쇠 설계', '높은 이송속도'], caution: '클램핑 확인', price: 72000, leadTime: '즉시', availability: '즉시' },
      { id: 'P012', name: 'Power-Cut 4F', sku: 'YG-PWC-10', confidence: 82, reasons: ['고절삭량 가능', '범용 황삭', '안정적 가공'], caution: '칩 배출 확인', price: 55000, leadTime: '즉시', availability: '즉시' }
    ],
    uncertaintyBefore: 'high',
    uncertaintyAfter: 'low'
  },
  {
    id: 'S05',
    name: '깊은 홀 드릴 (5D)',
    description: '깊은 홀 가공, 칩배출 문제',
    turn1Message: '깊은 홀 가공인데 칩이 잘 안 빠져요. 5D 이상 가공해야 해요',
    missingFields: [
      { field: 'material', label: '피삭재', severity: 'critical' },
      { field: 'diameter', label: '직경', severity: 'important' }
    ],
    turn1Questions: [
      { question: '가공 소재는 무엇인가요?', options: ['스틸', '스테인리스', '알루미늄', '주철', '모르겠음'] },
      { question: '필요한 직경은?', options: ['6mm', '8mm', '10mm', '12mm 이상', '모르겠음'] }
    ],
    funnelNumbers: { start: 60, afterTurn1: 18, afterTurn2: 5, final: 3 },
    turn2Answers: ['스틸', '8mm'],
    topRecommendations: [
      { id: 'P013', name: 'Deep-Drill 15D', sku: 'YG-DD15-STL-08', confidence: 97, reasons: ['15D 깊이 가공 전용', '특수 칩브레이커로 칩배출 우수', '내부 쿨런트 홀'], caution: '절삭유 압력 20bar 이상 권장', price: 75000, leadTime: '7일', availability: '주문제작' },
      { id: 'P014', name: 'Chip-Free Drill', sku: 'YG-CFD-08', confidence: 90, reasons: ['10D 대응 가능', '자동 칩 분쇄', '안정적 가공'], caution: '스텝 드릴링 권장', price: 58000, leadTime: '3일', availability: '재고' },
      { id: 'P015', name: 'Long-Drill Pro', sku: 'YG-LDP-08', confidence: 83, reasons: ['8D 깊이 가공', '범용 깊은홀', '경제적'], caution: '5D 초과 시 펙킹 필요', price: 42000, leadTime: '즉시', availability: '즉시' }
    ],
    uncertaintyBefore: 'high',
    uncertaintyAfter: 'low'
  },
  {
    id: 'S06',
    name: '탭 (M6, 스테인리스)',
    description: '스테인리스 탭 파손 문제',
    turn1Message: '스테인리스에 M6 탭 작업하는데 자꾸 부러져요',
    missingFields: [
      { field: 'threadType', label: '탭종류', severity: 'important' },
      { field: 'depth', label: '깊이', severity: 'important' }
    ],
    turn1Questions: [
      { question: '관통 홀인가요, 막힌 홀인가요?', options: ['관통 홀', '막힌 홀 (블라인드)', '모르겠음'] },
      { question: '나사 깊이는 얼마인가요?', options: ['1D 이하', '1.5D', '2D 이상', '모르겠음'] }
    ],
    funnelNumbers: { start: 45, afterTurn1: 15, afterTurn2: 4, final: 3 },
    turn2Answers: ['막힌 홀 (블라인드)', '1.5D'],
    topRecommendations: [
      { id: 'P016', name: 'Inox-Tap SP', sku: 'YG-IXT-M6-SP', confidence: 96, reasons: ['스테인리스 전용 스파이럴 탭', '파손 방지 설계', '블라인드 홀 최적화'], caution: '탭핑 속도 5-8m/min 권장', price: 32000, leadTime: '즉시', availability: '즉시' },
      { id: 'P017', name: 'SUS-Tap Pro', sku: 'YG-STP-M6', confidence: 89, reasons: ['고인성 소재', 'TiCN 코팅', '안정적 나사산'], caution: '탭핑 오일 사용 필수', price: 28000, leadTime: '즉시', availability: '즉시' },
      { id: 'P018', name: 'Synchro-Tap M6', sku: 'YG-SNT-M6', confidence: 82, reasons: ['동기 탭핑 대응', '범용 사용', '경제적'], caution: 'SUS304 한정 권장', price: 22000, leadTime: '즉시', availability: '즉시' }
    ],
    uncertaintyBefore: 'medium',
    uncertaintyAfter: 'low'
  },
  {
    id: 'S07',
    name: '알루미늄 (버 발생)',
    description: '알루미늄 가공 시 버 문제',
    turn1Message: '알루미늄 가공하는데 버가 너무 많이 생겨요',
    missingFields: [
      { field: 'toolType', label: '공구종류', severity: 'critical' },
      { field: 'diameter', label: '직경', severity: 'important' }
    ],
    turn1Questions: [
      { question: '어떤 가공을 하시나요?', options: ['밀링(엔드밀)', '홀가공(드릴)', '모따기', '모르겠음'] },
      { question: '필요한 직경은?', options: ['6mm', '8mm', '10mm', '12mm 이상', '모르겠음'] }
    ],
    funnelNumbers: { start: 80, afterTurn1: 25, afterTurn2: 7, final: 3 },
    turn2Answers: ['밀링(엔드밀)', '10mm'],
    topRecommendations: [
      { id: 'P019', name: 'Alu-Power Deburr', sku: 'YG-APD-10', confidence: 95, reasons: ['버 최소화 특수 날각', '3날 설계로 칩 배출 우수', 'DLC 코팅 용착 방지'], caution: '고속 회전 권장 (15000rpm+)', price: 42000, leadTime: '즉시', availability: '즉시' },
      { id: 'P020', name: 'Clean-Cut AL', sku: 'YG-CCA-10', confidence: 88, reasons: ['날끝 예각 처리', '깨끗한 절삭면', '무코팅 폴리시'], caution: '건식 가공 시 용착 주의', price: 38000, leadTime: '즉시', availability: '즉시' },
      { id: 'P021', name: 'Alu-Mill 3F', sku: 'YG-AM3-10', confidence: 81, reasons: ['알루미늄 범용', '안정적 성능', '경제적'], caution: '이송속도 조절 필요', price: 32000, leadTime: '즉시', availability: '즉시' }
    ],
    uncertaintyBefore: 'medium',
    uncertaintyAfter: 'low'
  },
  {
    id: 'S08',
    name: '티타늄 (수명 최우선)',
    description: '티타늄 가공, 공구 수명 중시',
    turn1Message: '티타늄 가공하는데 공구가 너무 빨리 마모돼요. 수명 긴 거 추천해주세요',
    missingFields: [
      { field: 'toolType', label: '공구종류', severity: 'important' },
      { field: 'diameter', label: '직경', severity: 'important' }
    ],
    turn1Questions: [
      { question: '어떤 공구가 필요하신가요?', options: ['엔드밀', '드릴', '탭', '볼엔드밀', '모르겠음'] },
      { question: '가공 조건이 어떻게 되나요?', options: ['황삭 (고절삭량)', '정삭 (정밀)', '범용', '모르겠음'] }
    ],
    funnelNumbers: { start: 35, afterTurn1: 12, afterTurn2: 4, final: 3 },
    turn2Answers: ['엔드밀', '황삭 (고절삭량)'],
    topRecommendations: [
      { id: 'P022', name: 'Titan-Master', sku: 'YG-TM4-TI-10', confidence: 94, reasons: ['티타늄 전용 초내열 코팅', '공구 수명 3배 향상', '극저 마찰 설계'], caution: '절삭속도 30-50m/min 엄수', price: 120000, leadTime: '10일', availability: '주문제작', competitorMatch: 'KENNAMETAL HARVI III' },
      { id: 'P023', name: 'Aero-Mill Ti', sku: 'YG-AMT-10', confidence: 87, reasons: ['항공우주용 인증', 'AlCrN 특수 코팅', '안정적 수명'], caution: '쿨런트 필수', price: 95000, leadTime: '7일', availability: '재고' },
      { id: 'P024', name: 'Inconel-Ti Mill', sku: 'YG-ITM-10', confidence: 80, reasons: ['내열합금 범용', '고강성', '경제적 선택'], caution: '낮은 절삭속도 유지', price: 78000, leadTime: '5일', availability: '재고' }
    ],
    uncertaintyBefore: 'medium',
    uncertaintyAfter: 'low'
  },
  {
    id: 'S09',
    name: '형상가공/코너R',
    description: '코너R 가공, 볼엔드밀 필요',
    turn1Message: '금형 코너R 부분 가공해야 하는데 R3 필요해요',
    missingFields: [
      { field: 'material', label: '피삭재', severity: 'critical' },
      { field: 'processGoal', label: '가공목적', severity: 'important' }
    ],
    turn1Questions: [
      { question: '금형 소재가 무엇인가요?', options: ['SKD11', 'SKD61', 'NAK80', 'S50C', '모르겠음'] },
      { question: '황삭인가요, 정삭인가요?', options: ['황삭', '중삭', '정삭', '모르겠음'] }
    ],
    funnelNumbers: { start: 55, afterTurn1: 18, afterTurn2: 5, final: 3 },
    turn2Answers: ['SKD11', '정삭'],
    topRecommendations: [
      { id: 'P025', name: 'Mold-Ball R3', sku: 'YG-MBR3-SKD', confidence: 96, reasons: ['SKD11 정삭 전용', 'R3 고정밀 형상', 'CBN 코팅 초장수명'], caution: '가공 여유량 0.05mm 이하', price: 95000, leadTime: '5일', availability: '재고', competitorMatch: 'HITACHI EPBP-R3' },
      { id: 'P026', name: 'Corner-Pro R3', sku: 'YG-CPR3', confidence: 89, reasons: ['코너R 전용', '고정밀 연삭', '금형 정삭 최적'], caution: '스텝오버 10% 이하', price: 78000, leadTime: '3일', availability: '재고' },
      { id: 'P027', name: 'Ball-Mill R3', sku: 'YG-BM-R3', confidence: 82, reasons: ['범용 볼엔드밀', '안정적 R가공', '경제적'], caution: '고경도 가공 시 수명 감소', price: 55000, leadTime: '즉시', availability: '즉시' }
    ],
    uncertaintyBefore: 'medium',
    uncertaintyAfter: 'low'
  },
  {
    id: 'S10',
    name: '경쟁사 SKU 기반',
    description: 'Sandvik 제품 대체품 요청',
    turn1Message: '지금 쓰는 Sandvik 2P160-1000 대체품 있나요?',
    missingFields: [
      { field: 'reason', label: '교체 이유', severity: 'important' }
    ],
    turn1Questions: [
      { question: '교체 이유가 무엇인가요?', options: ['가격', '납기', '성능 개선', '단순 대체', '모르겠음'] },
      { question: '현재 사용 조건에 만족하시나요?', options: ['만족, 동등품 원함', '불만, 더 좋은 것 원함', '모르겠음'] }
    ],
    funnelNumbers: { start: 120, afterTurn1: 8, afterTurn2: 3, final: 3 },
    turn2Answers: ['가격', '만족, 동등품 원함'],
    topRecommendations: [
      { id: 'P028', name: 'I-Xmill 4F (Sandvik 대응)', sku: 'YG-EM4-SUS-10', confidence: 97, reasons: ['Sandvik 2P160-1000 100% 호환', '동등 스펙 검증완료', '가격 30% 절감'], caution: '절삭 조건 동일 적용 가능', price: 58000, leadTime: '즉시', availability: '즉시', competitorMatch: 'SANDVIK 2P160-1000' },
      { id: 'P029', name: 'Inox-Pro 4F', sku: 'YG-INX4-10', confidence: 91, reasons: ['유사 성능', '자체 기술 적용', '국내 AS 가능'], caution: '초기 테스트 권장', price: 52000, leadTime: '즉시', availability: '즉시' },
      { id: 'P030', name: 'Gen-Mill Pro', sku: 'YG-GMP-10', confidence: 84, reasons: ['범용 대체품', '안정적 성능', '최저가'], caution: '난삭재 성능 차이 있을 수 있음', price: 42000, leadTime: '즉시', availability: '즉시' }
    ],
    uncertaintyBefore: 'low',
    uncertaintyAfter: 'low'
  },
  {
    id: 'S11',
    name: '납기/재고 우선',
    description: '급한 납기, 재고 우선',
    turn1Message: '급해요! 당장 쓸 수 있는 엔드밀 필요해요',
    missingFields: [
      { field: 'material', label: '피삭재', severity: 'critical' },
      { field: 'diameter', label: '직경', severity: 'critical' }
    ],
    turn1Questions: [
      { question: '가공 소재는 무엇인가요?', options: ['스틸', '스테인리스', '알루미늄', '아무거나', '모르겠음'] },
      { question: '필요한 직경은?', options: ['6mm', '8mm', '10mm', '12mm', '모르겠음'] }
    ],
    funnelNumbers: { start: 120, afterTurn1: 35, afterTurn2: 8, final: 3 },
    turn2Answers: ['스틸', '10mm'],
    topRecommendations: [
      { id: 'P031', name: 'Gen-Mill 4F D10', sku: 'YG-GM4-STL-10', confidence: 92, reasons: ['즉시 출하 가능', '스틸 범용', '안정적 성능'], caution: '특수 가공 시 성능 제한', price: 32000, leadTime: '즉시', availability: '즉시 (재고 50+)' },
      { id: 'P032', name: 'X-Mill D10', sku: 'YG-XM-10', confidence: 87, reasons: ['즉시 출하', '고강성', '범용 가공'], caution: '황삭 전용 아님', price: 38000, leadTime: '즉시', availability: '즉시 (재고 30+)' },
      { id: 'P033', name: 'Eco-Mill D10', sku: 'YG-ECO-10', confidence: 80, reasons: ['최저가 즉시 출하', '기본 성능', '대량 재고'], caution: '난삭재 비권장', price: 25000, leadTime: '즉시', availability: '즉시 (재고 100+)' }
    ],
    uncertaintyBefore: 'high',
    uncertaintyAfter: 'low'
  },
  {
    id: 'S12',
    name: '"모르겠음" 다수',
    description: '정보 매우 부족, 가정 포함 추천',
    turn1Message: '공구 하나 추천해주세요',
    missingFields: [
      { field: 'material', label: '피삭재', severity: 'critical' },
      { field: 'toolType', label: '공구종류', severity: 'critical' },
      { field: 'diameter', label: '직경', severity: 'critical' },
      { field: 'processGoal', label: '가공목적', severity: 'critical' }
    ],
    turn1Questions: [
      { question: '어떤 소재를 가공하시나요?', options: ['스틸', '스테인리스', '알루미늄', '금형강', '모르겠음'] },
      { question: '어떤 공구가 필요하신가요?', options: ['엔드밀', '드릴', '탭', '볼엔드밀', '모르겠음'] }
    ],
    funnelNumbers: { start: 200, afterTurn1: 80, afterTurn2: 25, final: 3 },
    turn2Answers: ['모르겠음', '엔드밀'],
    topRecommendations: [
      { id: 'P034', name: 'Gen-Mill 4F D10 (가정: 스틸)', sku: 'YG-GM4-10', confidence: 55, reasons: ['가장 범용적 선택', '스틸 가정 시 최적', '가성비 우수'], caution: '정확한 소재 확인 필요 - 성능 차이 발생 가능', price: 32000, leadTime: '즉시', availability: '즉시' },
      { id: 'P035', name: 'Multi-Mill 4F D10', sku: 'YG-MM4-10', confidence: 52, reasons: ['다목적 설계', '여러 소재 대응', '무난한 선택'], caution: '최적 성능 아닐 수 있음', price: 35000, leadTime: '즉시', availability: '즉시' },
      { id: 'P036', name: 'Uni-Mill D10', sku: 'YG-UNI-10', confidence: 48, reasons: ['초범용 공구', '기본 성능 보장', '낮은 가격'], caution: '전문가 검토 강력 권장', price: 28000, leadTime: '즉시', availability: '즉시' }
    ],
    uncertaintyBefore: 'high',
    uncertaintyAfter: 'high'
  }
]

// Pipeline steps for visualization
export const pipelineSteps = [
  { id: 1, name: '입력 해석', description: '필드 추출 및 확신도 계산' },
  { id: 2, name: '추가 질문', description: '누락 정보 2개 질문' },
  { id: 3, name: '후보 검색', description: 'Top-K 후보군 추출' },
  { id: 4, name: '호환/규격 필터', description: '부적합 제품 제거' },
  { id: 5, name: 'Top-3 랭킹', description: '최적 3개 선정' },
  { id: 6, name: '가격/납기/재고', description: '실시간 정보 반영' },
  { id: 7, name: '근거/주의사항', description: '추천 이유 생성' },
  { id: 8, name: '전문가 승인', description: '불확실도 높을 시 검토' }
]

// Learning log entries (simulated)
export const learningLogEntries = [
  { date: '2024-01-15', type: '동의어 추가', detail: '"스텐" → "스테인리스" 매핑 추가' },
  { date: '2024-01-14', type: '룰 조정', detail: 'SUS304 황삭 시 4날 우선 추천으로 변경' },
  { date: '2024-01-13', type: '필터 보완', detail: '깊은홀 가공 시 쿨런트 홀 유무 체크 추가' },
  { date: '2024-01-12', type: '랭킹 개선', detail: '알루미늄 가공 시 DLC 코팅 가중치 상향' },
  { date: '2024-01-11', type: '동의어 추가', detail: '"6파이" → "6mm" 직경 매핑' },
  { date: '2024-01-10', type: '룰 조정', detail: '티타늄 가공 시 절삭속도 상한 제한 추가' }
]

// Feedback outcome options
export const feedbackOutcomes = [
  { value: 'won', label: '수주 성공' },
  { value: 'lost', label: '수주 실패' },
  { value: 'no_response', label: '응답 없음' }
]

export const feedbackReasons = {
  won: ['가격 경쟁력', '납기 우수', '기술 지원', '기존 거래'],
  lost: ['가격 높음', '납기 길음', '스펙 불일치', '경쟁사 선택'],
  no_response: ['검토 중', '프로젝트 보류', '연락 두절']
}
