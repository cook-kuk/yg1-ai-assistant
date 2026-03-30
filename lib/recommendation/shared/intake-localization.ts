import type { AppLanguage } from "@/lib/contracts/app-language"
import type {
  AnswerState,
  InquiryPurpose,
  MachiningIntent,
  ProductIntakeForm,
} from "@/lib/types/intake"

type LocalizedIntakeFieldKey = Exclude<keyof ProductIntakeForm, "advanced">

const FIELD_LABELS: Record<LocalizedIntakeFieldKey, { ko: string; en: string }> = {
  country: { ko: "국가", en: "Country" },
  inquiryPurpose: { ko: "문의 목적", en: "Inquiry Purpose" },
  material: { ko: "가공 소재", en: "Workpiece Material" },
  operationType: { ko: "가공 형상", en: "Operation Shape" },
  machiningIntent: { ko: "가공 성격", en: "Machining Intent" },
  toolTypeOrCurrentProduct: { ko: "가공 방식", en: "Machining Category" },
  diameterInfo: { ko: "공구 직경", en: "Tool Diameter" },
}

const INQUIRY_PURPOSE_LABELS_LOCALIZED: Record<InquiryPurpose, { ko: string; en: string }> = {
  new: { ko: "신규 제품 추천", en: "New Product Recommendation" },
  substitute: { ko: "YG-1 대체품 찾기", en: "Find a YG-1 Substitute" },
  inventory_substitute: { ko: "재고 없는 대체품", en: "Out-of-Stock Substitute" },
  cutting_condition: { ko: "가공 조건 참고", en: "Cutting Condition Reference" },
  product_lookup: { ko: "현재 제품 정보 확인", en: "Current Product Lookup" },
}

const MACHINING_INTENT_LABELS_LOCALIZED: Record<MachiningIntent, { ko: string; en: string }> = {
  roughing: { ko: "황삭", en: "Roughing" },
  semi: { ko: "중삭", en: "Semi-finishing" },
  finishing: { ko: "정삭", en: "Finishing" },
}

const ISO_MATERIAL_LABELS: Record<string, { ko: string; en: string }> = {
  P: { ko: "탄소강", en: "Carbon Steel" },
  M: { ko: "스테인리스강", en: "Stainless Steel" },
  K: { ko: "주철", en: "Cast Iron" },
  N: { ko: "비철금속", en: "Non-ferrous" },
  S: { ko: "초내열합금", en: "Superalloy" },
  H: { ko: "고경도강", en: "Hardened Steel" },
}

const MACHINING_CATEGORY_DISPLAY_LABELS: Record<string, { ko: string; en: string }> = {
  Holemaking: { ko: "Holemaking", en: "Holemaking" },
  Threading: { ko: "Threading", en: "Threading" },
  Milling: { ko: "Milling", en: "Milling" },
  Turning: { ko: "Turning", en: "Turning" },
  "Tooling System": { ko: "Tooling System", en: "Tooling System" },
}

const TEXT_REPLACEMENTS_EN: Array<[string, string]> = [
  ["문의 목적", "Inquiry Purpose"],
  ["가공 소재", "Workpiece Material"],
  ["가공 형상", "Operation Shape"],
  ["가공 성격", "Machining Intent"],
  ["가공 방식", "Machining Category"],
  ["공구 직경", "Tool Diameter"],
  ["국가", "Country"],
  ["신규 제품 추천", "New Product Recommendation"],
  ["YG-1 대체품 찾기", "Find a YG-1 Substitute"],
  ["재고 없는 대체품", "Out-of-Stock Substitute"],
  ["가공 조건 참고", "Cutting Condition Reference"],
  ["현재 제품 정보 확인", "Current Product Lookup"],
  ["가공할 소재를 선택하세요. 복수 선택도 가능합니다.", "Select the workpiece material. Multiple selection is allowed."],
  ["필요한 가공 형상을 선택하세요. 복수 선택도 가능합니다.", "Select the required operation shape. Multiple selection is allowed."],
  ["찾고 싶은 공구 계열을 선택하세요.", "Select the machining category to search."],
  ["공구 직경을 선택하거나 직접 입력하세요.", "Select the tool diameter or enter it directly."],
  ["직접 입력", "Custom Input"],
  ["모름", "Unknown"],
  ["해당 없음", "Not Applicable"],
  ["탄소강", "Carbon Steel"],
  ["스테인리스강", "Stainless Steel"],
  ["주철", "Cast Iron"],
  ["비철금속", "Non-ferrous"],
  ["초내열합금", "Superalloy"],
  ["고경도강", "Hardened Steel"],
  ["예: 3.5mm, 1/4인치, 6.35", "e.g. 3.5mm, 1/4in, 6.35"],
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function translateFreeTextToEnglish(text: string): string {
  let translated = text
  for (const [source, target] of [...TEXT_REPLACEMENTS_EN].sort((a, b) => b[0].length - a[0].length)) {
    translated = translated.replace(new RegExp(escapeRegExp(source), "g"), target)
  }
  return translated
}

function isIsoMaterialToken(value: string): boolean {
  return /^[PMKNSH]$/i.test(value.trim())
}

function formatIsoMaterialToken(value: string, language: AppLanguage): string | null {
  const normalized = value.trim().toUpperCase()
  if (!isIsoMaterialToken(normalized)) return null
  return ISO_MATERIAL_LABELS[normalized]?.[language] ?? normalized
}

export function canonicalizeToolCategorySelection(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ""
  if (trimmed in MACHINING_CATEGORY_DISPLAY_LABELS) return trimmed

  const normalized = translateFreeTextToEnglish(trimmed)
  if (normalized in MACHINING_CATEGORY_DISPLAY_LABELS) return normalized
  return normalized
}

export function getMachiningCategoryDisplayValue(value: string, language: AppLanguage): string {
  return MACHINING_CATEGORY_DISPLAY_LABELS[value.trim()]?.[language] ?? value
}

export function canonicalizeMaterialSelection(text: string): string {
  const parts = text.split(",").map(value => value.trim()).filter(Boolean)
  if (parts.length > 0 && parts.every(isIsoMaterialToken)) {
    return parts.map(value => value.toUpperCase()).join(",")
  }
  return translateFreeTextToEnglish(text)
}

export function getMaterialDisplayValue(value: string, language: AppLanguage): string {
  const parts = value.split(",").map(part => part.trim()).filter(Boolean)
  if (parts.length === 0) return localizeIntakeText(value, language)
  return parts
    .map(part => formatIsoMaterialToken(part, language) ?? localizeIntakeText(part, language))
    .join(", ")
}

export function getIntakeFieldLabel(key: keyof ProductIntakeForm, language: AppLanguage): string {
  if (key === "advanced") return language === "ko" ? "고급 조건" : "Advanced Filters"
  return FIELD_LABELS[key][language]
}

export function localizeIntakeText(text: string, language: AppLanguage): string {
  const machiningCategory = MACHINING_CATEGORY_DISPLAY_LABELS[text.trim()]
  if (machiningCategory) return machiningCategory[language]
  if (language === "ko") return text
  return translateFreeTextToEnglish(text)
}

export function canonicalizeIntakeSearchText(text: string): string {
  return translateFreeTextToEnglish(text)
}

export function getIntakeDisplayValue(
  key: keyof ProductIntakeForm,
  state: AnswerState<string>,
  language: AppLanguage
): string {
  if (key === "advanced") return language === "ko" ? "미입력" : "Not provided"
  if (state.status === "unknown") return language === "ko" ? "모름" : "Unknown"
  if (state.status === "unanswered") return language === "ko" ? "미입력" : "Not provided"

  const value = state.value
  if (key === "inquiryPurpose") {
    return INQUIRY_PURPOSE_LABELS_LOCALIZED[value as InquiryPurpose]?.[language] ?? value
  }
  if (key === "machiningIntent") {
    return MACHINING_INTENT_LABELS_LOCALIZED[value as MachiningIntent]?.[language] ?? value
  }
  if (key === "material") {
    return getMaterialDisplayValue(value, language)
  }
  if (key === "toolTypeOrCurrentProduct") {
    return getMachiningCategoryDisplayValue(value, language)
  }

  return localizeIntakeText(value, language)
}
