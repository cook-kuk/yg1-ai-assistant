// ============================================================
// YG-1 Intake Form Types
// AnswerState: unanswered → unknown or known
// null    = 아직 안 건드림 (unanswered)
// unknown = 사용자가 명시적으로 "모름" 선택
// known   = 실제 값 입력
// ============================================================

export type AnswerStatus = "unanswered" | "unknown" | "known"

export type AnswerState<T> =
  | { status: "unanswered" }
  | { status: "unknown" }
  | { status: "known"; value: T }

export type InquiryPurpose =
  | "new"
  | "substitute"
  | "inventory_substitute"
  | "cutting_condition"
  | "product_lookup"

export type MachiningIntent = "roughing" | "semi" | "finishing"

export type MarketCountry = string  // DB country codes from prod_edp_option_* tables, or "ALL"
export type UnitSystem = "METRIC" | "INCH" | "ALL"

export interface ProductIntakeForm {
  inquiryPurpose: AnswerState<InquiryPurpose>
  material: AnswerState<string>
  operationType: AnswerState<string>
  machiningIntent: AnswerState<MachiningIntent>
  toolTypeOrCurrentProduct: AnswerState<string>
  diameterInfo: AnswerState<string>
  country: AnswerState<MarketCountry>
  unitSystem: AnswerState<UnitSystem>
  advanced?: {
    fluteCount?: AnswerState<number>
    coating?: AnswerState<string>
    symptom?: AnswerState<string>
  }
}

export const INITIAL_INTAKE_FORM: ProductIntakeForm = {
  inquiryPurpose: { status: "unanswered" },
  material: { status: "unanswered" },
  operationType: { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: { status: "unanswered" },
  diameterInfo: { status: "unanswered" },
  country: { status: "unanswered" },
  unitSystem: { status: "unanswered" },
}

// ── Helpers ──────────────────────────────────────────────────

export function isAnswered(state: AnswerState<unknown>): boolean {
  return state.status !== "unanswered"
}

export function allRequiredAnswered(form: ProductIntakeForm): boolean {
  return (
    isAnswered(form.inquiryPurpose) &&
    isAnswered(form.material) &&
    isAnswered(form.operationType) &&
    isAnswered(form.toolTypeOrCurrentProduct) &&
    isAnswered(form.diameterInfo)
  )
}

export function countAnswered(form: ProductIntakeForm): number {
  return [
    form.inquiryPurpose,
    form.material,
    form.operationType,
    form.toolTypeOrCurrentProduct,
    form.diameterInfo,
  ].filter((f) => f.status !== "unanswered").length
}

export function countUnknowns(form: ProductIntakeForm): number {
  return [
    form.material,
    form.operationType,
    form.toolTypeOrCurrentProduct,
    form.diameterInfo,
  ].filter((f) => f.status === "unknown").length
}

export function getKnownValue<T>(state: AnswerState<T>): T | undefined {
  return state.status === "known" ? state.value : undefined
}

// ── Display label maps ─────────────────────────────────────────

export const INQUIRY_PURPOSE_LABELS: Record<InquiryPurpose, string> = {
  new: "신규 제품 추천",
  substitute: "YG-1 대체품 찾기",
  inventory_substitute: "재고 없는 대체품",
  cutting_condition: "가공조건 참고",
  product_lookup: "현재 제품 정보 확인",
}

export const MACHINING_INTENT_LABELS: Record<MachiningIntent, string> = {
  roughing: "황삭",
  semi: "중삭",
  finishing: "정삭",
}

// ── Field display config ───────────────────────────────────────

export interface IntakeOption {
  value: string
  label: string
  tag?: string       // e.g. ISO group "N", "M"
  emoji?: string
  disabled?: boolean  // true = shown but not selectable (준비 중)
}

export interface IntakeFieldConfig {
  key: keyof ProductIntakeForm
  label: string
  emoji: string
  description: string
  options: IntakeOption[]
  unknownLabel: string
  hasCustomInput?: boolean
  customInputLabel?: string
  customInputPlaceholder?: string
  multiSelect?: boolean   // true = allow multiple option selection (comma-separated value)
}

export const FIELD_CONFIGS: IntakeFieldConfig[] = [
  {
    key: "inquiryPurpose",
    label: "문의 목적",
    emoji: "🎯",
    description: "어떤 목적으로 제품을 찾으시나요?",
    options: [
      { value: "new", label: "신규 제품 추천" },
      { value: "substitute", label: "YG-1 대체품 찾기", disabled: true },
      { value: "inventory_substitute", label: "재고 없는 대체품", disabled: true },
      { value: "cutting_condition", label: "가공조건 참고", disabled: true },
      { value: "product_lookup", label: "현재 제품 정보 확인", disabled: true },
    ],
    unknownLabel: "해당없음",
  },
  {
    key: "material",
    label: "피삭재 (소재)",
    emoji: "🔩",
    description: "가공할 소재를 선택하세요 (복수 선택 가능)",
    multiSelect: true,
    options: [
      { value: "알루미늄", label: "알루미늄 / 비철", tag: "N" },
      { value: "일반강", label: "일반강 / 탄소강", tag: "P" },
      { value: "스테인리스", label: "스테인리스 (SUS)", tag: "M" },
      { value: "주철", label: "주철", tag: "K" },
      { value: "고경도강", label: "고경도강 (HRC40+)", tag: "H" },
      { value: "티타늄", label: "티타늄 / 내열합금", tag: "S" },
      { value: "구리", label: "구리 / 흑연", tag: "N" },
    ],
    unknownLabel: "모름",
  },
  {
    key: "operationType",
    label: "가공 형상",
    emoji: "⚙️",
    description: "어떤 형태의 가공인가요? (복수 선택 가능)",
    multiSelect: true,
    options: [
      { value: "측면가공", label: "측면가공 (Side)" },
      { value: "슬롯", label: "슬롯 (Slot)" },
      { value: "포켓", label: "포켓 (Pocket)" },
      { value: "헬리컬", label: "헬리컬 진입" },
      { value: "정면가공", label: "정면가공 (Face)" },
      { value: "프로파일", label: "프로파일 / 윤곽" },
    ],
    unknownLabel: "모름",
  },
  // NOTE: machiningIntent 비활성화 — DB에 황삭/중삭/정삭 실데이터 없음 (추정 매핑만 존재)
  // {
  //   key: "machiningIntent",
  //   label: "가공 성격",
  //   emoji: "🎚️",
  //   description: "황삭 / 중삭 / 정삭 중 어느 쪽인가요?",
  //   options: [
  //     { value: "roughing", label: "황삭 (Roughing)" },
  //     { value: "semi", label: "중삭 (Semi-finishing)" },
  //     { value: "finishing", label: "정삭 (Finishing)" },
  //   ],
  //   unknownLabel: "모름",
  // },
  {
    key: "toolTypeOrCurrentProduct",
    label: "공구 타입 / 현재 제품",
    emoji: "🔧",
    description: "원하는 공구 타입 또는 현재 사용 중인 EDP를 알려주세요",
    options: [
      { value: "엔드밀", label: "엔드밀 (Square / Ball / CR)" },
      { value: "드릴", label: "드릴 (Drill)", disabled: true },
      { value: "탭", label: "탭 (Tap)", disabled: true },
    ],
    unknownLabel: "모름",
    hasCustomInput: true,
    customInputLabel: "EDP 코드 직접입력",
    customInputPlaceholder: "예: CE5G60030",
  },
  {
    key: "diameterInfo",
    label: "공구 직경",
    emoji: "📏",
    description: "공구 직경을 선택하거나 직접 입력하세요",
    options: [
      { value: "2mm", label: "φ2mm" },
      { value: "4mm", label: "φ4mm" },
      { value: "6mm", label: "φ6mm" },
      { value: "8mm", label: "φ8mm" },
      { value: "10mm", label: "φ10mm" },
      { value: "12mm", label: "φ12mm" },
    ],
    unknownLabel: "모름",
    hasCustomInput: true,
    customInputLabel: "직접입력",
    customInputPlaceholder: "예: 3.5mm, 1/4인치, 6.35",
  },
  // unitSystem 필드 제거 — 초기 화면에서 불필요
  // {
  //   key: "unitSystem",
  //   label: "단위 계열",
  //   emoji: "📐",
  //   description: "제품 규격 단위를 선택하세요",
  //   options: [
  //     { value: "METRIC", label: "미터법 (mm)" },
  //     { value: "INCH", label: "인치 (inch)" },
  //     { value: "ALL", label: "전체 (mm+inch)" },
  //   ],
  //   unknownLabel: "상관없음",
  // },
  // NOTE: country 필드는 사이드바 국가 선택값 주입에 사용된다.
  // {
  //   key: "country",
  //   label: "시장 / 국가",
  //   emoji: "🌏",
  //   options: [
  //     { value: "KOREA", label: "한국 (국내 시장)" },
  //     { value: "GLOBAL", label: "글로벌 (해외 시장)" },
  //     { value: "ALL", label: "전체 (국내+해외)" },
  //   ],
  //   unknownLabel: "상관없음",
  // },
]
