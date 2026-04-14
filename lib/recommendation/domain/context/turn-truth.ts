import type {
  AppliedFilter,
  CandidateSnapshot,
  EvidenceSummary,
  ExplorationSessionState,
} from "@/lib/recommendation/domain/types"
import {
  buildAppliedFilterFromValue,
  getFilterFieldLabel,
} from "@/lib/recommendation/shared/filter-field-registry"

type TurnTruthLocale = "ko" | "en"

const TURN_TRUTH_MESSAGES = {
  ko: {
    issue: {
      stale_reasoning_none_mismatch:
        "reasoning summary says filters are none while current truth has active filters or display scope filters",
      answer_denies_cutting_conditions:
        "answer denies cutting conditions while displayed truth shows cutting-condition evidence",
      answer_denies_inventory:
        "answer denies inventory while displayed truth shows in-stock candidates",
    },
    summary: {
      noFilters: "filters=없음",
      activeScopePrefix: "active_scope=",
      displayedScopePrefix: "displayed_scope=",
      inventoryOnly: "재고 있음",
      inventoryAtLeastSuffix: "재고 있음 + {minimumStock}개 이상",
    },
    filter: {
      hasCuttingConditionsLabel: "절삭 조건 있는 후보만",
      instockOnlyLabel: "재고 있는 후보만",
    },
    fallback: {
      displayedCountPrefix: "현재 표시 후보 {displayedCount}개 중",
      cuttingConditionEvidence: "절삭 조건 근거가 있는 제품은 {count}개입니다.",
      inventoryEvidence: "재고 확인 가능한 제품은 {count}개입니다.",
    },
  },
  en: {
    issue: {
      stale_reasoning_none_mismatch:
        "reasoning summary says filters are none while current truth has active filters or display scope filters",
      answer_denies_cutting_conditions:
        "answer denies cutting conditions while displayed truth shows cutting-condition evidence",
      answer_denies_inventory:
        "answer denies inventory while displayed truth shows in-stock candidates",
    },
    summary: {
      noFilters: "filters=none",
      activeScopePrefix: "active_scope=",
      displayedScopePrefix: "displayed_scope=",
      inventoryOnly: "in stock",
      inventoryAtLeastSuffix: "in stock + {minimumStock}+",
    },
    filter: {
      hasCuttingConditionsLabel: "showing candidates with cutting conditions only",
      instockOnlyLabel: "showing candidates in stock only",
    },
    fallback: {
      displayedCountPrefix: "Among the {displayedCount} displayed candidates,",
      cuttingConditionEvidence: "{count} have cutting-condition evidence.",
      inventoryEvidence: "{count} are available in stock.",
    },
  },
} as const

export type TurnTruthConsistencyIssueCode =
  | "stale_reasoning_none_mismatch"
  | "answer_denies_cutting_conditions"
  | "answer_denies_inventory"

type TurnTruthConsistencyIssueMessageArgs = Record<string, string | number | boolean>

function formatTemplate(template: string, vars: Record<string, string | number | boolean>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`))
}

function formatIssueMessage(issue: TurnTruthConsistencyIssue, locale: TurnTruthLocale): string {
  const messages = localeToMessages(locale)
  const template = messages.issue[issue.messageKey]
  return formatTemplate(template, issue.messageArgs)
}

export type TurnTruthIntent =
  | "recommendation"
  | "clarification"
  | "inventory_constraint"
  | "displayed_candidate_filtering"
  | "explanation"
  | "unknown"

export type SpecialDisplayedCandidateFilterKind =
  | "has_cutting_conditions"
  | "instock_only"

export interface TurnTruth {
  intent: TurnTruthIntent
  message: string
  locale: TurnTruthLocale
  appliedFilters: AppliedFilter[]
  activeCandidateScope: {
    source: "full_displayed_candidates" | "displayed_candidates" | "last_recommendation" | "none"
    count: number
  }
  displayedCandidateScope: {
    count: number
    codes: string[]
    activeDisplayFilter: ExplorationSessionState["displayedSetFilter"]
  }
  evidenceAvailabilitySummary: {
    displayedCount: number
    candidatesWithEvidence: number
    candidatesWithCuttingConditions: number
    candidatesWithInventory: number
  }
  explanationInputs: {
    referencesDisplayedCandidates: boolean
    hasRecommendationContext: boolean
    filterSummary: string[]
  }
  inventoryConstraint: {
    minimumStock: number | null
    requiresInStock: boolean
  } | null
  displayedCandidateFilter: {
    kind: SpecialDisplayedCandidateFilterKind
    label: string
  } | null
}

export interface TurnTruthConsistencyIssue {
  code: TurnTruthConsistencyIssueCode
  messageKey: TurnTruthConsistencyIssueCode
  messageArgs: TurnTruthConsistencyIssueMessageArgs
}

interface BuildTurnTruthParams {
  userMessage: string
  sessionState?: ExplorationSessionState | null
  appliedFilters?: AppliedFilter[] | null
  candidateSnapshot?: CandidateSnapshot[] | null
  evidenceSummaries?: EvidenceSummary[] | null
}

function resolveTurnTruthLocale(sessionState?: ExplorationSessionState | null): TurnTruthLocale {
  const locale = sessionState?.resolvedInput?.locale
  if (locale?.toLowerCase().startsWith("en")) return "en"
  return "ko"
}

function inferTurnTruthLocaleFromMessage(message: string): TurnTruthLocale {
  const hasKorean = /[\uAC00-\uD7AF]/.test(message)
  const hasLatin = /[A-Za-z]/.test(message)
  if (hasLatin && !hasKorean) return "en"
  return "ko"
}

function resolveTurnTruthLocaleForMessage(
  sessionState: ExplorationSessionState | null | undefined,
  message: string,
): TurnTruthLocale {
  const resolved = resolveTurnTruthLocale(sessionState)
  if (resolved === "en") return "en"
  return inferTurnTruthLocaleFromMessage(message)
}

function localeToMessages(locale: TurnTruthLocale) {
  return TURN_TRUTH_MESSAGES[locale]
}

const DISPLAY_SCOPE_RE_KO =
  /(?:\uC5EC\uAE30|\uC9C0\uAE08\s*(?:\uBCF4\uC5EC\uC900|\uBCF4\uC774\uB294|\uD6C4\uBCF4)|\uD604\uC7AC\s*(?:\uBCF4\uC774\uB294|\uD6C4\uBCF4|\uCE74\uB4DC)|\uC774\s*\uC911(?:\uC5D0\uC11C)?|\uC81C\uD488\s*\uCE74\uB4DC(?:\uB9CC)?|\uC9C0\uAE08\s*\uD6C4\uBCF4)/iu
const DISPLAY_SCOPE_RE_EN =
  /(?:\b(?:these|those|current|shown|displayed)\s+(?:candidates?|cards?|products?)\b|\bshow(?:ing)?\s+candidate(?:s)?\b|\blatest\s+(?:candidates?|recommendations?)\b)/iu
const FILTERING_RE_KO =
  /(?:\uB9CC\s*(?:\uBCF4\uC5EC|\uB0A8\uACA8|\uCD94\uB824|\uACE8\uB77C|\uD544\uD130|\uC881\uD600)|\uB9CC.*(?:\uBCF4\uC5EC|\uCE74\uB4DC|\uB0A8\uACA8|\uCD94\uB824|\uACE8\uB77C)|(?:\uBCF4\uC5EC|\uB0A8\uACA8|\uCD94\uB824|\uACE8\uB77C).{0,12}\uB9CC|\uBCF4\uC5EC\uC904\s*\uC218|\uBCF4\uC5EC\uC904\uC218|\uBCF4\uC5EC\uC918|filter\s*\uB123\uC5B4|\uD544\uD130\s*\uB123\uC5B4|\uD6C4\uCC98\uB9AC|subset)/iu
const FILTERING_RE_EN =
  /(?:\b(?:filter|filters?|narrow|refine|only|keep|leave|show)\b.{0,16}\b(?:candidate|candidates|card|cards|product|products|list|recommendation|recommendations)\b|(?:candidate|candidates|card|cards|product|products)\s+(?:filter|filters?|subset|only|only\s+show)|(?:only|show)\s+(?:\w+\s+){0,4}\b(?:candidates?|cards?|products?)\b)/iu
const CUTTING_CONDITION_RE = /(?:\uC808\uC0AD\s*\uC870\uAC74|cutting\s*conditions?)/iu
const INVENTORY_RE = /(?:\uC7AC\uACE0|stock|inventory|\uC8FC\uBB38|order|\uBC1C\uC8FC|\uC218\uB7C9|\uC989\uC2DC\s*\uCD9C\uD558)/iu
const INVENTORY_FILTER_RE = /(?:\uD544\uD130|\uAC78\uC5B4|\uB123\uC5B4|\uC881\uD600|\uBCF4\uC5EC|\uB0A8\uACA8|\uD655\uC778)/iu
const EXPLANATION_RE =
  /(?:\uC124\uBA85|\uC774\uC720|\uC65C|\uADFC\uAC70|\uBB34\uC2A8\s*\uB73B|\uBB34\uC2A8\s*\uB9D0|\uB73B\uC774|\uBB54\uC9C0)/iu
const RECOMMENDATION_RE =
  /(?:\uCD94\uCC9C|\uCD94\uCC9C\uD574\uB2EC\uB77C|\uCD94\uCC9C\uD574\s*\uB2EC\uB77C|\uC5B4\uC6B8\uB9AC|\uC801\uD569|\uC88B(?:\uC740|\uC744)?\s*\uAC70|\uAD1C\uCC2E(?:\uC740|\uC744)?\s*\uAC70|\uACE8\uB77C\uC918|\uACE8\uB77C\s*\uC918)/iu
const QUANTITY_RE = /(\d[\d,]*)\s*(?:\uAC1C|ea|pcs?|pc|set)/iu
const NO_FILTER_REASONING_RE =
  /(?:Currently Applied Filters:\s*(?:none|\(none\))|existing filters:\s*\(none\)|\uBD80\uD638\uD55C\s*\uC801\uC6A9\s*\uD544\uD130\s*\uC5C6\uC74C|\uC801\uC6A9\uB41C\s*\uD544\uD130\s*:\s*\uC5C6\uC74C)/iu
const DENY_CUTTING_CONDITION_RE =
  /(?:\b(?:no|not|none)\b.{0,24}(?:\uC808\uC0AD\s*\uC870\uAC74|cutting\s*conditions?)|(?:\uC808\uC0AD\s*\uC870\uAC74|cutting\s*conditions?).{0,24}(?:\uC5C6|\uC5C6\uB2E4|\uC5C6\uC2B5\uB2C8\uB2E4|\uC5C6\uC5B4\uC694|\uBD88\uAC00|\uBABB\s*\uBCF4\uC5EC|no|not|none))/iu
const DENY_INVENTORY_RE =
  /(?:\b(?:not|no|none)\b.{0,24}(?:\uC7AC\uACE0|stock|inventory)|(?:\uC7AC\uACE0|stock|inventory).{0,24}(?:\uC5C6|\uC5C6\uB2E4|\uC5C6\uC2B5\uB2C8\uB2E4|\uC5C6\uC5B4\uC694|\uBD88\uAC00|\uBABB\s*\uBCF4\uC5EC|no|not|none))/iu

function deniesCuttingCondition(text: string): boolean {
  return (
    DENY_CUTTING_CONDITION_RE.test(text)
    || /(?:no|without)\s+cutting\s*conditions?/iu.test(text)
    || /cutting\s*conditions?.{0,20}(?:no|none|not\s+available|unavailable)/iu.test(text)
  )
}

function deniesInventory(text: string): boolean {
  return (
    DENY_INVENTORY_RE.test(text)
    || /(?:no|without)\s+(?:stock|inventory)/iu.test(text)
    || /(?:stock|inventory).{0,20}(?:no|none|not\s+available|unavailable)/iu.test(text)
    || /out\s+of\s+stock/iu.test(text)
  )
}

function uniqueCodes(candidates: CandidateSnapshot[]): string[] {
  const seen = new Set<string>()
  const codes: string[] = []
  for (const candidate of candidates) {
    const code = candidate.displayCode || candidate.productCode
    if (!code || seen.has(code)) continue
    seen.add(code)
    codes.push(code)
  }
  return codes
}

function normalizeFilters(filters: AppliedFilter[] | null | undefined): AppliedFilter[] {
  return (filters ?? []).filter(filter => filter.op !== "skip")
}

function parseRequestedQuantity(message: string): number | null {
  const match = message.match(QUANTITY_RE)
  if (!match) return null
  const parsed = Number.parseInt(match[1].replace(/,/g, ""), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function detectSpecialDisplayedCandidateFilter(
  message: string,
  referencesDisplayedCandidates: boolean,
  locale: TurnTruthLocale,
): TurnTruth["displayedCandidateFilter"] {
  if (!referencesDisplayedCandidates) return null

  const messages = localeToMessages(locale)
  const filteringRe = locale === "en" ? FILTERING_RE_EN : FILTERING_RE_KO

  if (CUTTING_CONDITION_RE.test(message) && filteringRe.test(message)) {
    return {
      kind: "has_cutting_conditions",
      label: messages.filter.hasCuttingConditionsLabel,
    }
  }

  if (/(?:\uC7AC\uACE0|stock|inventory)/iu.test(message) && filteringRe.test(message)) {
    return {
      kind: "instock_only",
      label: messages.filter.instockOnlyLabel,
    }
  }

  return null
}

function detectInventoryConstraint(message: string): TurnTruth["inventoryConstraint"] {
  const hasInventoryCue = INVENTORY_RE.test(message)
  const hasFilterCue = INVENTORY_FILTER_RE.test(message)
  const minimumStock = parseRequestedQuantity(message)

  if (!hasInventoryCue && minimumStock == null) return null
  if (!hasInventoryCue && minimumStock != null && !/(?:\uC8FC\uBB38|order|\uBC1C\uC8FC)/iu.test(message)) return null
  if (!hasFilterCue && minimumStock == null && !/(?:\uC7AC\uACE0\s*\uD655\uC778|stock\s*check|inventory\s*check)/iu.test(message)) return null

  return {
    minimumStock,
    requiresInStock: true,
  }
}

function classifyTurnTruthIntent(
  message: string,
  locale: TurnTruthLocale,
  sessionState?: ExplorationSessionState | null,
): TurnTruthIntent {
  const displayScopeRe = locale === "en" ? DISPLAY_SCOPE_RE_EN : DISPLAY_SCOPE_RE_KO
  const referencesDisplayedCandidates = displayScopeRe.test(message)
  const filteringRe = locale === "en" ? FILTERING_RE_EN : FILTERING_RE_KO
  const displayedCandidateFilter = detectSpecialDisplayedCandidateFilter(
    message,
    referencesDisplayedCandidates,
    locale,
  )

  if (displayedCandidateFilter) return "displayed_candidate_filtering"
  if (referencesDisplayedCandidates && filteringRe.test(message)) return "displayed_candidate_filtering"
  if (detectInventoryConstraint(message)) return "inventory_constraint"
  if (RECOMMENDATION_RE.test(message)) return "recommendation"
  if (EXPLANATION_RE.test(message)) return "explanation"

  if (
    sessionState?.lastAskedField
    && !sessionState.resolutionStatus?.startsWith("resolved")
    && /(?:\uB2E4\uC2DC|\uC815\uD655\uD788|\uC815\uB9AC\uD558\uBA74|\uBB34\uC2A8\s*\uB73B|\uADF8\uAC8C\s*\uC544\uB2C8\uB77C)/iu.test(message)
  ) {
    return "clarification"
  }

  return "unknown"
}

function summarizeFilters(filters: AppliedFilter[]): string[] {
  return filters.map(filter => {
    const label = getFilterFieldLabel(filter.field)
    const raw = Array.isArray(filter.rawValue)
      ? filter.rawValue.join(", ")
      : String(filter.rawValue ?? filter.value)
    switch (filter.op) {
      case "neq":
        return `${label} 제외=${raw}`
      case "gte":
        return `${label}>=${raw}`
      case "lte":
        return `${label}<=${raw}`
      default:
        return `${label}=${raw}`
    }
  })
}

function getTruthCandidatePool(
  sessionState?: ExplorationSessionState | null,
  candidateSnapshot?: CandidateSnapshot[] | null,
): { source: TurnTruth["activeCandidateScope"]["source"]; candidates: CandidateSnapshot[] } {
  const session = sessionState ?? null
  if (session?.fullDisplayedCandidates?.length) {
    return { source: "full_displayed_candidates", candidates: session.fullDisplayedCandidates }
  }
  if (session?.displayedCandidates?.length) {
    return { source: "displayed_candidates", candidates: session.displayedCandidates }
  }
  if (session?.lastRecommendationArtifact?.length) {
    return { source: "last_recommendation", candidates: session.lastRecommendationArtifact }
  }
  return { source: "none", candidates: candidateSnapshot ?? [] }
}

function summarizeEvidenceAvailability(
  displayedCandidates: CandidateSnapshot[],
  evidenceSummaries?: EvidenceSummary[] | null,
): TurnTruth["evidenceAvailabilitySummary"] {
  const evidenceCodes = new Set(
    (evidenceSummaries ?? [])
      .map(summary => summary.productCode)
      .filter((code): code is string => typeof code === "string" && code.length > 0),
  )

  let candidatesWithEvidence = 0
  let candidatesWithCuttingConditions = 0
  let candidatesWithInventory = 0

  for (const candidate of displayedCandidates) {
    const code = candidate.productCode || candidate.displayCode
    const hasEvidence = candidate.hasEvidence || candidate.bestCondition != null || evidenceCodes.has(code)
    if (hasEvidence) candidatesWithEvidence += 1
    if (candidate.bestCondition != null || evidenceCodes.has(code)) candidatesWithCuttingConditions += 1
    if ((candidate.totalStock ?? 0) > 0 || candidate.stockStatus === "instock" || candidate.stockStatus === "limited") {
      candidatesWithInventory += 1
    }
  }

  return {
    displayedCount: displayedCandidates.length,
    candidatesWithEvidence,
    candidatesWithCuttingConditions,
    candidatesWithInventory,
  }
}

export function buildTurnTruth(params: BuildTurnTruthParams): TurnTruth {
  const message = params.userMessage.trim()
  const appliedFilters = normalizeFilters(params.appliedFilters ?? params.sessionState?.appliedFilters)
  const activePool = getTruthCandidatePool(params.sessionState, params.candidateSnapshot)
  const locale = resolveTurnTruthLocaleForMessage(params.sessionState, message)
  const displayedCandidates =
    params.candidateSnapshot
    ?? params.sessionState?.displayedCandidates
    ?? params.sessionState?.lastRecommendationArtifact
    ?? []
  const displayScopeRe = locale === "en" ? DISPLAY_SCOPE_RE_EN : DISPLAY_SCOPE_RE_KO
  const referencesDisplayedCandidates = displayScopeRe.test(message)
  const displayedCandidateFilter = detectSpecialDisplayedCandidateFilter(
    message,
    referencesDisplayedCandidates,
    locale,
  )
  const inventoryConstraint =
    displayedCandidateFilter?.kind === "instock_only"
      ? null
      : detectInventoryConstraint(message)

  return {
    intent: classifyTurnTruthIntent(message, locale, params.sessionState),
    message,
    locale,
    appliedFilters,
    activeCandidateScope: {
      source: activePool.source,
      count: activePool.candidates.length,
    },
    displayedCandidateScope: {
      count: displayedCandidates.length,
      codes: uniqueCodes(displayedCandidates),
      activeDisplayFilter: params.sessionState?.displayedSetFilter ?? null,
    },
    evidenceAvailabilitySummary: summarizeEvidenceAvailability(displayedCandidates, params.evidenceSummaries),
    explanationInputs: {
      referencesDisplayedCandidates,
      hasRecommendationContext:
        Boolean(params.sessionState?.lastRecommendationArtifact?.length)
        || params.sessionState?.currentMode === "recommendation",
      filterSummary: summarizeFilters(appliedFilters),
    },
    inventoryConstraint,
    displayedCandidateFilter,
  }
}

export function buildTurnTruthThinkingSummary(truth: TurnTruth): string | null {
  const messages = localeToMessages(truth.locale)

  const segments: string[] = []
  segments.push(`intent=${truth.intent}`)
  segments.push(
    truth.appliedFilters.length > 0
      ? `filters=${truth.explanationInputs.filterSummary.join(", ")}`
      : messages.summary.noFilters,
  )
  segments.push(
    `${messages.summary.activeScopePrefix}${truth.activeCandidateScope.source}:${truth.activeCandidateScope.count}`,
  )
  segments.push(`${messages.summary.displayedScopePrefix}${truth.displayedCandidateScope.count}`)

  if (truth.inventoryConstraint) {
    const inventorySummary = truth.inventoryConstraint.minimumStock != null
      ? formatTemplate(messages.summary.inventoryAtLeastSuffix, { minimumStock: truth.inventoryConstraint.minimumStock })
      : messages.summary.inventoryOnly
    segments.push(`inventory=${inventorySummary}`)
  }

  if (truth.displayedCandidateFilter) {
    segments.push(`display_filter=${truth.displayedCandidateFilter.label}`)
  }

  return segments.join(" | ")
}

export function detectStaleReasoningSummary(
  reasoning: string | null | undefined,
  truth: TurnTruth,
): TurnTruthConsistencyIssue[] {
  const clean = reasoning?.trim()
  if (!clean) return []

  if (
    NO_FILTER_REASONING_RE.test(clean)
    && (truth.appliedFilters.length > 0 || truth.displayedCandidateScope.activeDisplayFilter != null)
  ) {
    return [{
      code: "stale_reasoning_none_mismatch",
      messageKey: "stale_reasoning_none_mismatch",
      messageArgs: {
        appliedFilterCount: truth.appliedFilters.length,
        activeDisplayFilter: Boolean(truth.displayedCandidateScope.activeDisplayFilter),
      },
    }]
  }

  return []
}

export function sanitizeReasoningSummary(
  reasoning: string | null | undefined,
  truth: TurnTruth,
): string | null {
  const issues = detectStaleReasoningSummary(reasoning, truth)
  if (issues.length > 0) return buildTurnTruthThinkingSummary(truth)
  return reasoning?.trim() ? reasoning.trim() : null
}

export function detectAnswerCardEvidenceConsistencyIssues(params: {
  text: string
  truth: TurnTruth
}): TurnTruthConsistencyIssue[] {
  const clean = params.text.trim()
  if (!clean) return []

  const issues: TurnTruthConsistencyIssue[] = []
  if (
    deniesCuttingCondition(clean)
    && params.truth.evidenceAvailabilitySummary.candidatesWithCuttingConditions > 0
  ) {
    issues.push({
      code: "answer_denies_cutting_conditions",
      messageKey: "answer_denies_cutting_conditions",
      messageArgs: {
        candidatesWithCuttingConditions: params.truth.evidenceAvailabilitySummary.candidatesWithCuttingConditions,
      },
    })
  }
  if (
    deniesInventory(clean)
    && params.truth.evidenceAvailabilitySummary.candidatesWithInventory > 0
  ) {
    issues.push({
      code: "answer_denies_inventory",
      messageKey: "answer_denies_inventory",
      messageArgs: {
        candidatesWithInventory: params.truth.evidenceAvailabilitySummary.candidatesWithInventory,
      },
    })
  }
  return issues
}

export function assertFreshReasoningSummary(
  reasoning: string | null | undefined,
  truth: TurnTruth,
): void {
  const issues = detectStaleReasoningSummary(reasoning, truth)
  if (issues.length === 0) return
  throw new Error(issues.map(issue => formatIssueMessage(issue, truth.locale)).join("; "))
}

export function assertAnswerCardEvidenceConsistency(params: {
  text: string
  truth: TurnTruth
}): void {
  const issues = detectAnswerCardEvidenceConsistencyIssues(params)
  if (issues.length === 0) return
  throw new Error(issues.map(issue => formatIssueMessage(issue, params.truth.locale)).join("; "))
}

export function buildTruthConsistentAnswerFallback(
  truth: TurnTruth,
  text: string,
): string {
  const issues = detectAnswerCardEvidenceConsistencyIssues({ text, truth })
  if (issues.length === 0) return text

  const messages = localeToMessages(truth.locale)
  const lines: string[] = []
  if (issues.some(issue => issue.code === "answer_denies_cutting_conditions")) {
    lines.push(formatTemplate(messages.fallback.displayedCountPrefix, {
      displayedCount: truth.evidenceAvailabilitySummary.displayedCount,
    }) + " " +
      formatTemplate(messages.fallback.cuttingConditionEvidence, {
        count: truth.evidenceAvailabilitySummary.candidatesWithCuttingConditions,
      }))
  }
  if (issues.some(issue => issue.code === "answer_denies_inventory")) {
    lines.push(formatTemplate(messages.fallback.displayedCountPrefix, {
      displayedCount: truth.evidenceAvailabilitySummary.displayedCount,
    }) + " " +
      formatTemplate(messages.fallback.inventoryEvidence, {
        count: truth.evidenceAvailabilitySummary.candidatesWithInventory,
      }))
  }
  return lines.join(" ")
}

export function mergeInventoryTruthFilters(
  filters: AppliedFilter[],
  truth: TurnTruth,
  turnCount: number,
): AppliedFilter[] {
  if (!truth.inventoryConstraint) return [...filters]

  const next = filters.filter(filter => filter.field !== "stockStatus" && filter.field !== "totalStock")
  if (truth.inventoryConstraint.requiresInStock) {
    const stockFilter = buildAppliedFilterFromValue("stockStatus", "instock", turnCount, "eq")
    if (stockFilter) next.push(stockFilter)
  }
  if (truth.inventoryConstraint.minimumStock != null) {
    const totalStockFilter = buildAppliedFilterFromValue("totalStock", truth.inventoryConstraint.minimumStock, turnCount, "gte")
    if (totalStockFilter) next.push(totalStockFilter)
  }
  return next
}

export function filterDisplayedCandidatesByTruth(
  candidates: CandidateSnapshot[],
  truth: TurnTruth,
): CandidateSnapshot[] | null {
  if (!truth.displayedCandidateFilter) return null

  if (truth.displayedCandidateFilter.kind === "has_cutting_conditions") {
    return candidates.filter(candidate => candidate.bestCondition != null || candidate.hasEvidence)
  }
  if (truth.displayedCandidateFilter.kind === "instock_only") {
    return candidates.filter(candidate => (candidate.totalStock ?? 0) > 0 || candidate.stockStatus === "instock")
  }
  return null
}

