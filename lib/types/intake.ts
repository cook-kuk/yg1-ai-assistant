// ============================================================
// YG-1 Intake Form Types
// AnswerState: unanswered / unknown / known
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

export interface ProductIntakeForm {
  inquiryPurpose: AnswerState<InquiryPurpose>
  material: AnswerState<string>
  operationType: AnswerState<string>
  machiningIntent: AnswerState<MachiningIntent>
  toolTypeOrCurrentProduct: AnswerState<string>
  diameterInfo: AnswerState<string>
  country?: AnswerState<string>
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
}

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
  ].filter(field => field.status !== "unanswered").length
}

export function countUnknowns(form: ProductIntakeForm): number {
  return [
    form.material,
    form.operationType,
    form.toolTypeOrCurrentProduct,
    form.diameterInfo,
  ].filter(field => field.status === "unknown").length
}

export function getKnownValue<T>(state: AnswerState<T>): T | undefined {
  return state.status === "known" ? state.value : undefined
}

export const INQUIRY_PURPOSE_LABELS: Record<InquiryPurpose, string> = {
  new: "신규 제품 추천",
  substitute: "YG-1 대체품 찾기",
  inventory_substitute: "재고 없는 대체품",
  cutting_condition: "가공 조건 참고",
  product_lookup: "현재 제품 정보 확인",
}

export const MACHINING_INTENT_LABELS: Record<MachiningIntent, string> = {
  roughing: "황삭",
  semi: "중삭",
  finishing: "정삭",
}

export interface IntakeOption {
  value: string
  label: string
  tag?: string
  emoji?: string
  disabled?: boolean
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
  multiSelect?: boolean
}

export const OPERATION_SHAPE_OPTIONS: IntakeOption[] = [
  { value: "Side_Milling", label: "Side Milling" },
  { value: "Facing", label: "Facing" },
  { value: "Profiling", label: "Profiling" },
  { value: "Die-Sinking", label: "Die-Sinking" },
  { value: "Helical_Interpolation", label: "Helical Interpolation" },
  { value: "Chamfering", label: "Chamfering" },
  { value: "Corner_Radius", label: "Corner Radius" },
  { value: "Trochoidal", label: "Trochoidal" },
  { value: "Taper Side Milling", label: "Taper Side Milling" },
  { value: "Small Part", label: "Small Part" },
  { value: "Slotting", label: "Slotting" },
  { value: "Side Milling", label: "Side Milling" },
  { value: "Helical Interpolation", label: "Helical Interpolation" },
  { value: "Corner Radius", label: "Corner Radius" },
  { value: "Taper_Side_Milling", label: "Taper Side Milling" },
  { value: "Small_Part", label: "Small Part" },
  { value: "Ramping", label: "Ramping" },
  { value: "Plunging", label: "Plunging" },
]

export const FIELD_CONFIGS: IntakeFieldConfig[] = [
  {
    key: "inquiryPurpose",
    label: "문의 목적",
    emoji: "🧭",
    description: "어떤 목적의 추천이 필요한지 선택하세요.",
    options: [
      { value: "new", label: "신규 제품 추천" },
      { value: "substitute", label: "YG-1 대체품 찾기", disabled: true },
      { value: "inventory_substitute", label: "재고 없는 대체품", disabled: true },
      { value: "cutting_condition", label: "가공 조건 참고", disabled: true },
      { value: "product_lookup", label: "현재 제품 정보 확인", disabled: true },
    ],
    unknownLabel: "해당 없음",
  },
  {
    key: "material",
    label: "가공 소재",
    emoji: "🧱",
    description: "가공할 소재를 선택하세요. 복수 선택도 가능합니다.",
    multiSelect: true,
    options: [
      { value: "P", label: "탄소강", tag: "P" },
      { value: "M", label: "스테인리스강", tag: "M" },
      { value: "K", label: "주철", tag: "K" },
      { value: "N", label: "비철금속", tag: "N" },
      { value: "S", label: "초내열합금", tag: "S" },
      { value: "H", label: "고경도강", tag: "H" },
    ],
    unknownLabel: "모름",
  },
  {
    key: "operationType",
    label: "가공 형상",
    emoji: "📐",
    description: "필요한 가공 형상을 선택하세요. 복수 선택도 가능합니다.",
    multiSelect: true,
    options: OPERATION_SHAPE_OPTIONS,
    unknownLabel: "모름",
  },
  {
    key: "toolTypeOrCurrentProduct",
    label: "가공 방식",
    emoji: "🛠️",
    description: "찾고 싶은 공구 계열을 선택하세요.",
    options: [
      { value: "Milling", label: "Milling" },
      { value: "Holemaking", label: "Holemaking" },
      { value: "Threading", label: "Threading" },
      { value: "Turning", label: "Turning" },
    ],
    unknownLabel: "모름",
  },
  {
    key: "diameterInfo",
    label: "공구 직경",
    emoji: "📏",
    description: "공구 직경을 선택하거나 직접 입력하세요.",
    options: [
      { value: "2mm", label: "2mm" },
      { value: "4mm", label: "4mm" },
      { value: "6mm", label: "6mm" },
      { value: "8mm", label: "8mm" },
      { value: "10mm", label: "10mm" },
      { value: "12mm", label: "12mm" },
    ],
    unknownLabel: "모름",
    hasCustomInput: true,
    customInputLabel: "직접 입력",
    customInputPlaceholder: "예: 3.5mm, 1/4인치, 6.35",
  },
]
