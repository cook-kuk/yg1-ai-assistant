import {
  FIELD_CONFIGS,
  type AnswerState,
  type ProductIntakeForm,
} from "@/lib/frontend/recommendation/intake-types"
import {
  getIntakeDisplayValue,
  getIntakeFieldLabel,
  localizeIntakeText,
} from "@/lib/frontend/recommendation/intake-localization"
import type {
  RecommendationPublicSessionDto,
} from "@/lib/contracts/recommendation"
import type {
  ExplorationSessionState,
  RecommendationInput,
} from "@/lib/recommendation/domain/types"

export type SidebarConditionItem = {
  key: string
  label: string
  value: string
  emoji: string
  source: "input" | "filter"
  order: number
}

const FILTER_FORM_EQUIVALENTS: Partial<Record<string, keyof ProductIntakeForm>> = {
  diameterMm: "diameterInfo",
  diameterRefine: "diameterInfo",
  material: "material",
  toolType: "toolTypeOrCurrentProduct",
}

const FORM_EMOJI_BY_KEY = new Map(
  FIELD_CONFIGS.map(config => [config.key, config.emoji] as const)
)

function formatResolvedInputValue(
  formKey: keyof ProductIntakeForm,
  resolvedInput: RecommendationInput | null | undefined,
  fallbackValue: string,
  language: "ko" | "en"
): string {
  if (!resolvedInput) return fallbackValue

  if (formKey === "diameterInfo" && typeof resolvedInput.diameterMm === "number") {
    return `${resolvedInput.diameterMm}mm`
  }

  if (formKey === "toolTypeOrCurrentProduct" && typeof resolvedInput.toolType === "string" && resolvedInput.toolType.trim()) {
    return localizeIntakeText(resolvedInput.toolType.trim(), language)
  }

  return fallbackValue
}

export function getFilterDisplayValue(
  filter: RecommendationPublicSessionDto["appliedFilters"][number],
  language: "ko" | "en"
): string {
  if (filter.op === "skip") {
    return language === "ko" ? "상관없음" : "No Preference"
  }
  const baseValue = localizeIntakeText(filter.value, language)
  // Surface comparison operators in the chip so users see "10mm 이상" not "10mm".
  // The eq case is the common path and gets no suffix.
  switch (filter.op) {
    case "gte":
      return language === "ko" ? `${baseValue} 이상` : `≥ ${baseValue}`
    case "lte":
      return language === "ko" ? `${baseValue} 이하` : `≤ ${baseValue}`
    case "between":
      return language === "ko" ? `${baseValue} 사이` : `${baseValue} range`
    case "neq":
    case "exclude":
      return language === "ko" ? `${baseValue} 제외` : `≠ ${baseValue}`
    default:
      return baseValue
  }
}

function getFilterFieldLabel(field: string, language: "ko" | "en"): string {
  switch (field) {
    case "toolSubtype":
      return language === "ko" ? "형상" : "Shape"
    case "fluteCount":
      return language === "ko" ? "날수" : "Flutes"
    case "coating":
      return language === "ko" ? "코팅" : "Coating"
    case "workPieceName":
      return language === "ko" ? "세부 피삭재" : "Workpiece"
    case "seriesName":
      return language === "ko" ? "시리즈" : "Series"
    case "cuttingType":
      return language === "ko" ? "가공 종류" : "Cutting Type"
    case "diameterRefine":
    case "diameterMm":
      return language === "ko" ? "직경" : "Diameter"
    case "brand":
      return language === "ko" ? "브랜드" : "Brand"
    case "toolMaterial":
      return language === "ko" ? "공구 소재" : "Tool Material"
    default:
      return localizeIntakeText(field, language)
  }
}

function getFilterFieldEmoji(field: string): string {
  switch (field) {
    case "toolSubtype":
      return "🧩"
    case "fluteCount":
      return "🪶"
    case "coating":
      return "🛡️"
    case "workPieceName":
      return "🔩"
    case "seriesName":
      return "🗂️"
    case "cuttingType":
      return "⚙️"
    case "diameterRefine":
    case "diameterMm":
      return "📏"
    case "brand":
      return "🏭"
    case "toolMaterial":
      return "🔧"
    default:
      return "🏷️"
  }
}

export function buildSidebarConditionItems(
  form: ProductIntakeForm,
  sessionState: RecommendationPublicSessionDto | null,
  engineSessionState: ExplorationSessionState | null,
  language: "ko" | "en"
): SidebarConditionItem[] {
  const itemsByKey = new Map<string, SidebarConditionItem>()
  const orderByKey = new Map<string, number>()
  const resolvedInput = engineSessionState?.resolvedInput ?? null

  FIELD_CONFIGS.forEach((config, index) => {
    orderByKey.set(config.key, index)
    const state = form[config.key as keyof ProductIntakeForm] as AnswerState<string>
    if (!state || state.status === "unanswered") return

    const displayValue = formatResolvedInputValue(
      config.key as keyof ProductIntakeForm,
      resolvedInput,
      getIntakeDisplayValue(config.key as keyof ProductIntakeForm, state, language),
      language
    )

    itemsByKey.set(config.key, {
      key: config.key,
      label: getIntakeFieldLabel(config.key as keyof ProductIntakeForm, language),
      value: displayValue,
      emoji: config.emoji,
      source: "input",
      order: index,
    })
  })

  const activeFilters = sessionState?.appliedFilters ?? []
  activeFilters.forEach((filter, index) => {
    const equivalentFormKey = FILTER_FORM_EQUIVALENTS[filter.field]
    const itemKey = equivalentFormKey ?? filter.field
    const existing = itemsByKey.get(itemKey)

    itemsByKey.set(itemKey, {
      key: itemKey,
      label: equivalentFormKey
        ? getIntakeFieldLabel(equivalentFormKey, language)
        : getFilterFieldLabel(filter.field, language),
      value: getFilterDisplayValue(filter, language),
      emoji: existing?.emoji
        ?? (equivalentFormKey ? FORM_EMOJI_BY_KEY.get(equivalentFormKey) : undefined)
        ?? getFilterFieldEmoji(filter.field),
      source: "filter",
      order: existing?.order ?? orderByKey.get(equivalentFormKey ?? "") ?? FIELD_CONFIGS.length + index,
    })
  })

  return Array.from(itemsByKey.values()).sort((left, right) => left.order - right.order)
}
