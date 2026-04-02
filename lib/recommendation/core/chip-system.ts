/**
 * Chip System — State-driven, deterministic chip generation
 *
 * STEP 4 of incremental refactor.
 * Generates chips from state using ChipPolicy rules.
 * NO inline strings in logic — all text from CHIP_LABELS.
 * Currently dry-run only (DebugTrace). Future: replace hardcoded chips.
 */

// ── Types ──

export type ChipIntent =
  // Narrowing
  | "select_material"
  | "select_diameter"
  | "select_operation"
  | "select_flute_count"
  | "select_coating"
  | "skip_field"
  | "confirm_recommend"
  | "view_products"
  // Post-recommendation
  | "show_cutting_condition"
  | "change_diameter"
  | "compare_top"
  | "competitor_compare"
  | "show_inventory"
  | "series_compare"
  | "product_detail"
  // Navigation
  | "go_back"
  | "reset"
  | "change_condition"

export type ChipType = "primary" | "filter" | "info" | "warning" | "navigation"

export interface ChipDefinition {
  intent: ChipIntent
  type: ChipType
  labelKey: string
  priority: number
}

export interface RenderedChip {
  key: string
  label: string
  type: ChipType
}

// ── Labels (locale dictionary) ──

const CHIP_LABELS: Record<string, Record<"ko" | "en", string>> = {
  "chip.select_material":      { ko: "소재 선택",             en: "Select material" },
  "chip.select_diameter":      { ko: "직경 선택",             en: "Select diameter" },
  "chip.select_operation":     { ko: "가공형상 선택",         en: "Select operation" },
  "chip.select_flute_count":   { ko: "날수 선택",             en: "Select flutes" },
  "chip.select_coating":       { ko: "코팅 선택",             en: "Select coating" },
  "chip.skip":                 { ko: "상관없음",              en: "Skip" },
  "chip.confirm_recommend":    { ko: "이 조건으로 추천",      en: "Recommend with these" },
  "chip.view_products":        { ko: "제품 보기",             en: "View products" },
  "chip.cutting_condition":    { ko: "절삭조건 알려줘",       en: "Cutting conditions" },
  "chip.change_diameter":      { ko: "다른 직경 검색",        en: "Different diameter" },
  "chip.compare_top":          { ko: "상위 제품 비교",        en: "Compare top products" },
  "chip.competitor_compare":   { ko: "경쟁사 비교",           en: "Competitor compare" },
  "chip.show_inventory":       { ko: "재고 있는 대안 보기",   en: "In-stock alternatives" },
  "chip.series_compare":       { ko: "시리즈 비교",           en: "Compare series" },
  "chip.product_detail":       { ko: "상세 정보",             en: "Product detail" },
  "chip.go_back":              { ko: "⟵ 이전 단계",          en: "⟵ Go back" },
  "chip.reset":                { ko: "처음부터 다시",         en: "Start over" },
  "chip.change_condition":     { ko: "조건 변경",             en: "Change conditions" },
}

function getLabel(key: string, locale: "ko" | "en"): string {
  return CHIP_LABELS[key]?.[locale] ?? CHIP_LABELS[key]?.["ko"] ?? key
}

// ── Minimal State Interface (decoupled from full ExplorationSessionState) ──

export interface ChipState {
  currentMode: string | null          // "narrowing" | "recommendation" | "question" | null
  candidateCount: number
  appliedFilters: Array<{ field: string; op: string }>
  lastAskedField: string | null
  turnCount: number
  resolutionStatus: string | null
  displayedCandidateCount: number
  hasHistory: boolean
}

function hasFilter(state: ChipState, field: string): boolean {
  return state.appliedFilters.some(f => f.field === field && f.op !== "skip")
}

function isRecommendationPhase(state: ChipState): boolean {
  return state.currentMode === "recommendation" || state.resolutionStatus?.startsWith("resolved") === true
}

function isNarrowingPhase(state: ChipState): boolean {
  return !isRecommendationPhase(state) && state.turnCount > 0
}

// ── Policy Rules ──

interface ChipPolicy {
  intent: ChipIntent
  type: ChipType
  labelKey: string
  priority: number
  visible: (state: ChipState) => boolean
}

const CHIP_POLICIES: ChipPolicy[] = [
  // ── Narrowing phase ──
  {
    intent: "confirm_recommend",
    type: "primary",
    labelKey: "chip.confirm_recommend",
    priority: 5,
    visible: (s) => isNarrowingPhase(s) && s.candidateCount > 0 && s.candidateCount <= 50,
  },
  {
    intent: "view_products",
    type: "primary",
    labelKey: "chip.view_products",
    priority: 6,
    visible: (s) => isNarrowingPhase(s) && s.candidateCount > 50,
  },
  {
    intent: "select_material",
    type: "filter",
    labelKey: "chip.select_material",
    priority: 10,
    visible: (s) => isNarrowingPhase(s) && !hasFilter(s, "material"),
  },
  {
    intent: "select_diameter",
    type: "filter",
    labelKey: "chip.select_diameter",
    priority: 20,
    visible: (s) => isNarrowingPhase(s) && !hasFilter(s, "diameterMm"),
  },
  {
    intent: "select_operation",
    type: "filter",
    labelKey: "chip.select_operation",
    priority: 30,
    visible: (s) => isNarrowingPhase(s) && !hasFilter(s, "operationType"),
  },
  {
    intent: "select_flute_count",
    type: "filter",
    labelKey: "chip.select_flute_count",
    priority: 40,
    visible: (s) => isNarrowingPhase(s) && !hasFilter(s, "fluteCount") && s.candidateCount > 20,
  },
  {
    intent: "select_coating",
    type: "filter",
    labelKey: "chip.select_coating",
    priority: 50,
    visible: (s) => isNarrowingPhase(s) && !hasFilter(s, "coating") && s.candidateCount > 10,
  },
  {
    intent: "skip_field",
    type: "navigation",
    labelKey: "chip.skip",
    priority: 90,
    visible: (s) => isNarrowingPhase(s) && s.lastAskedField !== null,
  },

  // ── Recommendation phase ──
  {
    intent: "show_cutting_condition",
    type: "info",
    labelKey: "chip.cutting_condition",
    priority: 10,
    visible: isRecommendationPhase,
  },
  {
    intent: "compare_top",
    type: "primary",
    labelKey: "chip.compare_top",
    priority: 15,
    visible: (s) => isRecommendationPhase(s) && s.displayedCandidateCount >= 2,
  },
  {
    intent: "change_diameter",
    type: "filter",
    labelKey: "chip.change_diameter",
    priority: 20,
    visible: isRecommendationPhase,
  },
  {
    intent: "show_inventory",
    type: "info",
    labelKey: "chip.show_inventory",
    priority: 25,
    visible: isRecommendationPhase,
  },
  {
    intent: "competitor_compare",
    type: "info",
    labelKey: "chip.competitor_compare",
    priority: 30,
    visible: isRecommendationPhase,
  },
  {
    intent: "change_condition",
    type: "filter",
    labelKey: "chip.change_condition",
    priority: 40,
    visible: (s) => isRecommendationPhase(s) && s.appliedFilters.length > 0,
  },

  // ── Always available ──
  {
    intent: "go_back",
    type: "navigation",
    labelKey: "chip.go_back",
    priority: 95,
    visible: (s) => s.hasHistory && s.appliedFilters.length > 0,
  },
  {
    intent: "reset",
    type: "warning",
    labelKey: "chip.reset",
    priority: 100,
    visible: (s) => s.turnCount > 0,
  },
]

// ── Main derivation function ──

export function deriveChips(state: ChipState, locale: "ko" | "en" = "ko", maxChips = 6): RenderedChip[] {
  return CHIP_POLICIES
    .filter(policy => policy.visible(state))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, maxChips)
    .map(policy => ({
      key: policy.intent,
      label: getLabel(policy.labelKey, locale),
      type: policy.type,
    }))
}

// ── Helper: convert ExplorationSessionState to ChipState ──

export function toChipState(prevState: {
  currentMode?: string | null
  candidateCount?: number
  appliedFilters?: Array<{ field: string; op: string }>
  lastAskedField?: string | null
  turnCount?: number
  resolutionStatus?: string | null
  displayedCandidates?: unknown[]
  narrowingHistory?: unknown[]
} | null): ChipState {
  return {
    currentMode: prevState?.currentMode ?? null,
    candidateCount: prevState?.candidateCount ?? 0,
    appliedFilters: (prevState?.appliedFilters ?? []).map(f => ({ field: f.field, op: f.op })),
    lastAskedField: prevState?.lastAskedField ?? null,
    turnCount: prevState?.turnCount ?? 0,
    resolutionStatus: prevState?.resolutionStatus ?? null,
    displayedCandidateCount: prevState?.displayedCandidates?.length ?? 0,
    hasHistory: (prevState?.narrowingHistory?.length ?? 0) > 0,
  }
}

// ── Chip Comparison (shadow mode) ──

export interface ChipComparison {
  match: boolean
  oldCount: number
  newCount: number
  onlyInOld: string[]
  onlyInNew: string[]
  common: string[]
}

export function compareChips(oldChips: string[], newChips: RenderedChip[]): ChipComparison {
  const oldSet = new Set(oldChips.map(c => c.trim()))
  const newLabels = newChips.map(c => c.label)
  const newSet = new Set(newLabels)

  const onlyInOld = [...oldSet].filter(c => !newSet.has(c))
  const onlyInNew = newLabels.filter(c => !oldSet.has(c))
  const common = newLabels.filter(c => oldSet.has(c))

  return {
    match: onlyInOld.length === 0 && onlyInNew.length === 0,
    oldCount: oldChips.length,
    newCount: newChips.length,
    onlyInOld,
    onlyInNew,
    common,
  }
}

/**
 * Safe chip application: returns new chips if valid, falls back to old chips.
 * - Empty new chips → fallback
 * - Abnormal count (>10 or 0) → fallback
 */
export function safeApplyChips(
  oldChips: string[],
  newChips: RenderedChip[],
  useNewSystem: boolean,
): string[] {
  if (!useNewSystem) return oldChips

  // Safety: fallback if new chips are empty or abnormal
  if (newChips.length === 0) {
    console.log("[chip-system] empty chips → fallback to old")
    return oldChips
  }
  if (newChips.length > 10) {
    console.log(`[chip-system] abnormal chip count (${newChips.length}) → fallback to old`)
    return oldChips
  }

  return newChips.map(c => c.label)
}
