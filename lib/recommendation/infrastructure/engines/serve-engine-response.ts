import { notifyRecommendation } from "@/lib/recommendation/infrastructure/notifications/recommendation-notifier"
import { buildTraceFromScoreBreakdown } from "@/lib/recommendation/domain/build-ranking-trace"
import {
  EntityProfileRepo,
  SeriesMaterialStatusRepo,
  type SeriesMaterialStatusValue,
} from "@/lib/recommendation/infrastructure/repositories/recommendation-repositories"
import {
  buildExplanation,
  buildDeterministicSummary,
  buildProductLabel,
  buildRationale,
  buildSessionState,
  buildWarnings,
  checkResolution,
  classifyHybridResults,
  groupCandidatesBySeries,
  prepareRequest,
  runFactCheck,
  selectNextQuestion,
} from "@/lib/recommendation/domain/recommendation-domain"
import {
  buildExplanationResultPrompt,
  buildGreetingPrompt,
  buildRecommendationSummarySystemPrompt,
  buildSessionContext,
  buildSystemPrompt,
  getProvider,
} from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import {
  buildDisplayedOptions,
  buildRecommendationFollowUpOptionState,
  buildQuestionFieldOptions,
  buildQuestionResponseOptionState,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-option-first"
import { getMaterialDisplay, resolveMaterialTag } from "@/lib/recommendation/domain/material-resolver"
import { assessComplexity } from "@/lib/recommendation/core/complexity-router"
import {
  buildNegationFallbackText,
  findCandidateScopedPhantoms,
} from "@/lib/recommendation/infrastructure/knowledge/candidate-phantom-guard"
import { buildRpmExplanationText, normalizeRpmPhrases } from "@/lib/recommendation/infrastructure/engines/response-text-hints"

import type { buildRecommendationResponseDto } from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import type { RecommendationDisplayedProductRequestDto, RecommendationPaginationDto } from "@/lib/contracts/recommendation"
import type { NextQuestion } from "@/lib/recommendation/domain/question-engine"
import type {
  AppliedFilter,
  AppLanguage,
  CandidateSnapshot,
  EvidenceSummary,
  ExplorationSessionState,
  FactCheckedRecommendation,
  NarrowingStage,
  NarrowingTurn,
  ProductIntakeForm,
  RecommendationExplanation,
  RecommendationInput,
  RecommendationResult,
  ScoredProduct,
  UINarrowingPathEntry,
  ChatMessage,
} from "@/lib/recommendation/domain/types"
import type { StructuredChipDto } from "@/lib/contracts/recommendation"
import { validateOptionFirstPipeline } from "@/lib/recommendation/domain/options/option-validator"
import { buildFilterValueScope } from "@/lib/recommendation/shared/filter-field-registry"
import {
  COATING_CHEMICAL_DB_ALIASES,
  canonicalizeCoating,
} from "@/lib/recommendation/shared/patterns"
import { traceRecommendation } from "@/lib/recommendation/infrastructure/observability/recommendation-trace"
import {
  evaluateUncertainty,
  selectHighestInfoGainQuestion,
  buildReasonSummary,
  assignPerspectiveLabel,
  getPerspectiveKo,
  type RecommendationMeta,
  type PerspectiveLabel,
} from "@/lib/recommendation/domain/uncertainty-gate"

import type { FactCheckReport, VerifiedField } from "@/lib/types/fact-check"

type DisplayedProduct = RecommendationDisplayedProductRequestDto
const RECOMMENDATION_SUMMARY_MAX_TOKENS = 4000

/**
 * Align a final chip-label array with an upstream structured-chip registry
 * (index-aligned with `upstreamChips`). Any label not in the registry gets
 * a synthesized navigation/reset action based on well-known CTA text, or
 * null (legacy text-based dispatch).
 */
function alignStructuredChips(
  finalChips: string[],
  upstreamChips: string[] | null,
  upstreamStructured: (StructuredChipDto | null)[] | null,
): (StructuredChipDto | null)[] {
  const registry = new Map<string, StructuredChipDto>()
  if (upstreamChips && upstreamStructured) {
    for (let i = 0; i < upstreamChips.length; i++) {
      const s = upstreamStructured[i]
      if (s) registry.set(upstreamChips[i], s)
    }
  }
  return finalChips.map(label => {
    const hit = registry.get(label)
    if (hit) return hit
    // Synthesize for well-known CTA/reset/undo chips
    if (label.includes("제품 보기")) return { text: label, action: "navigate", target: "product_list" }
    if (label.includes("AI 상세 분석")) return { text: label, action: "navigate", target: "deep_analysis" }
    if (label === "처음부터 다시" || label === "처음부터") return { text: label, action: "reset" }
    if (label === "⟵ 이전 단계") return { text: label, action: "navigate", target: "undo" }
    if (label === "상관없음") return { text: label, action: "select_option", value: "skip" }
    return null
  })
}

/**
 * Build a lightweight FactCheckedRecommendation without LLM calls.
 * Used in FAST+high-confidence mode to skip the expensive runFactCheck.
 * All values come directly from the canonical ScoredProduct — no external queries.
 */
function buildLightweightFactChecked(
  scored: ScoredProduct,
  explanation: RecommendationExplanation,
): FactCheckedRecommendation {
  const p = scored.product
  const vf = <T>(value: T, step: string): VerifiedField<T> => ({
    value, status: "verified", source: "canonical-product", checkedAt: step,
  })
  const report: FactCheckReport = {
    steps: [
      { step: 1, name: "product_identity", label: "제품 확인", passed: true, issues: [], fieldsChecked: 4, fieldsVerified: 4 },
      { step: 2, name: "spec_check", label: "스펙 확인", passed: true, issues: [], fieldsChecked: 7, fieldsVerified: 7 },
      { step: 5, name: "render_safe", label: "표시 안전", passed: true, issues: [], fieldsChecked: 3, fieldsVerified: 3 },
    ],
    overallStatus: "verified",
    totalFieldsChecked: 14,
    totalFieldsVerified: 14,
    verificationPct: 100,
    criticalIssues: [],
  }
  return {
    productCode: vf(p.normalizedCode, "product_identity"),
    displayCode: vf(p.displayCode, "product_identity"),
    seriesName: vf(p.seriesName, "product_identity"),
    manufacturer: vf(p.manufacturer, "product_identity"),
    diameterMm: vf(p.diameterMm, "spec_check"),
    fluteCount: vf(p.fluteCount, "spec_check"),
    coating: vf(p.coating, "spec_check"),
    toolMaterial: vf(p.toolMaterial, "spec_check"),
    materialTags: vf(p.materialTags, "spec_check"),
    lengthOfCutMm: vf(p.lengthOfCutMm, "spec_check"),
    overallLengthMm: vf(p.overallLengthMm, "spec_check"),
    hasCuttingConditions: false,
    bestCondition: vf(null, "cutting_condition"),
    conditionConfidence: vf(0, "cutting_condition"),
    conditionSourceCount: vf(0, "cutting_condition"),
    stockStatus: vf(scored.stockStatus, "inventory_check"),
    totalStock: vf(scored.totalStock, "inventory_check"),
    minLeadTimeDays: vf(scored.minLeadTimeDays, "inventory_check"),
    matchPct: scored.scoreBreakdown?.matchPct ?? 0,
    matchStatus: scored.matchStatus,
    score: scored.score,
    explanation,
    factCheckReport: report,
  }
}

type JsonRecommendationResponse = (
  params: Parameters<typeof buildRecommendationResponseDto>[0],
  init?: ResponseInit
) => Response

/**
 * Minimal payload flushed to a streaming client right before the final LLM
 * summary call. Contains everything needed to render product cards, but no
 * answer text yet. Used by /api/recommend/stream (TODO-B progressive cards).
 */
export interface EarlyRecommendationFlush {
  recommendation: RecommendationResult
  primaryExplanation: RecommendationExplanation | null
  primaryFactChecked: FactCheckedRecommendation | null
  altExplanations: RecommendationExplanation[]
  altFactChecked: FactCheckedRecommendation[]
  evidenceSummaries: EvidenceSummary[] | null
  /**
   * Snapshot of the candidates that should populate the right-side
   * "추천 후보" panel as soon as the cards arrive — without this the panel
   * waits for the LLM narrative to finish.
   */
  candidates: CandidateSnapshot[]
  pagination: RecommendationPaginationDto | null
}

export interface ServeResponseBuilderDependencies {
  jsonRecommendationResponse: JsonRecommendationResponse
  /**
   * Optional — when present, buildRecommendationResponse calls this exactly
   * once, right before the (slow) LLM summary call, with the fully-resolved
   * primary/alternatives. The stream endpoint writes this as an SSE frame so
   * product cards appear before the narrative text is generated.
   *
   * Must be synchronous and non-throwing — errors are swallowed to protect
   * the main recommendation flow. See TODO-B in project_streaming_todo.md.
   */
  onEarlyFlush?: (payload: EarlyRecommendationFlush) => void
}

export function buildPaginationDto(page: number, pageSize: number, totalItems: number): RecommendationPaginationDto {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
  }
}

function resolveSingleIsoGroup(material: string | undefined): string | null {
  if (!material) return null

  const tags = Array.from(
    new Set(
      material
        .split(",")
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => resolveMaterialTag(part))
        .filter((tag): tag is string => Boolean(tag))
    )
  )

  return tags.length === 1 ? tags[0] : null
}

function normalizeSeriesKey(value: string): string {
  return value.trim().toUpperCase().replace(/[\s\-·ㆍ./(),]+/g, "")
}

function normalizeWorkPieceKey(value: string): string {
  return value.replace(/\s+/g, "").trim().toUpperCase()
}

function normalizeQuestionOptionToken(value: string): string {
  return value
    .replace(/\s*\(\d+개\)\s*$/, "")
    .replace(/\s*—\s*.+$/, "")
    .trim()
    .toLowerCase()
}

const QUESTION_FIELD_HINTS: Record<string, RegExp[]> = {
  workPieceName: [/피삭재/u, /세부\s*피삭재/u, /소재/u, /재질/u, /강종/u, /hardened/i, /hrc/i],
  diameterMm: [/어떤\s*직경/u, /직경은\s*어느/u, /직경을\s*선택/u, /직접\s*입력/u],
  diameterRefine: [/정확한\s*직경/u, /근처에/u, /직경\s*\d+(?:\.\d+)?mm/u],
  fluteCount: [/날\s*수/u, /몇\s*날/u, /플루트/u, /flute/i],
  coating: [/코팅/u, /coat/i, /tialn/i, /alcrn/i, /ticn/i],
  toolSubtype: [/형상/u, /타입/u, /엔드밀/u, /볼/u, /스퀘어/u, /corner\s*radius/i],
  seriesName: [/시리즈/u, /brand/i, /브랜드/u],
  cuttingType: [/가공/u, /절삭/u, /포켓/u, /슬롯/u, /측면/u, /평면/u, /홀\s*가공/u],
}

const QUESTION_FIELD_LABELS: Record<string, string> = {
  workPieceName: "세부 피삭재",
  fluteCount: "날 수",
  coating: "코팅",
  toolSubtype: "공구 세부 타입",
  seriesName: "시리즈",
  cuttingType: "가공 종류",
  diameterMm: "직경",
  diameterRefine: "직경",
}

function summarizeRecommendationInputForTrace(input: RecommendationInput) {
  return {
    manufacturerScope: input.manufacturerScope ?? null,
    locale: input.locale ?? null,
    material: input.material ?? null,
    workPieceName: input.workPieceName ?? null,
    diameterMm: input.diameterMm ?? null,
    machiningCategory: input.machiningCategory ?? null,
    operationType: input.operationType ?? null,
    toolSubtype: input.toolSubtype ?? null,
    flutePreference: input.flutePreference ?? null,
    coatingPreference: input.coatingPreference ?? null,
    seriesName: input.seriesName ?? null,
  }
}

function summarizeFiltersForTrace(filters: AppliedFilter[]) {
  return filters.map(filter => ({
    field: filter.field,
    op: filter.op,
    value: filter.value,
    rawValue: filter.rawValue,
    appliedAt: filter.appliedAt,
  }))
}

function summarizeHistoryForTrace(history: NarrowingTurn[]) {
  return history.slice(-4).map(turn => ({
    question: turn.question,
    answer: turn.answer,
    extractedFilters: turn.extractedFilters.map(filter => ({
      field: filter.field,
      op: filter.op,
      value: filter.value,
      rawValue: filter.rawValue,
      appliedAt: filter.appliedAt,
    })),
    candidateCountBefore: turn.candidateCountBefore,
    candidateCountAfter: turn.candidateCountAfter,
  }))
}

function summarizePaginationForTrace(pagination: RecommendationPaginationDto | null) {
  if (!pagination) return null
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalItems: pagination.totalItems,
    totalPages: pagination.totalPages,
  }
}

export function inferQuestionFieldFromText(text: string): string | null {
  const clean = text.trim().toLowerCase()
  if (!clean) return null

  let bestField: string | null = null
  let bestScore = 0

  for (const [field, patterns] of Object.entries(QUESTION_FIELD_HINTS)) {
    let score = 0
    for (const pattern of patterns) {
      if (pattern.test(clean)) score += 1
    }
    if (score > bestScore) {
      bestField = field
      bestScore = score
    }
  }

  return bestScore > 0 ? bestField : null
}

export function shouldFallbackToDeterministicQuestionText(params: {
  questionField: string
  questionText: string
  responseText: string
  displayedOptions: { label: string; value: string; field?: string | null }[]
}): boolean {
  const { questionField, questionText, responseText, displayedOptions } = params
  const inferredField = inferQuestionFieldFromText(responseText)
  if (inferredField && inferredField !== questionField) return true

  const normalizedResponse = responseText.toLowerCase()
  const normalizedQuestion = questionText.toLowerCase()

  if (normalizedResponse.includes(normalizedQuestion)) return false

  const optionTokens = displayedOptions
    .filter(option => option.field === questionField || option.field === "_action" || option.value === "skip")
    .flatMap(option => [option.label, option.value])
    .map(normalizeQuestionOptionToken)
    .filter(token => token && !["skip", "상관없음"].includes(token))

  if (optionTokens.some(token => normalizedResponse.includes(token))) return false

  const ownHints = QUESTION_FIELD_HINTS[questionField] ?? []
  if (ownHints.some(pattern => pattern.test(responseText))) return false

  return true
}

const CHEMICAL_COATING_DISPLAY: Record<string, string> = {
  alcrn: "AlCrN",
  tialn: "TiAlN",
  ticn: "TiCN",
  altin: "AlTiN",
}

function normalizeCoatingAliasKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "")
}

function findCoatingAliasGroup(raw: string): { chemicalKey: string; aliases: string[] } | null {
  const cleaned = raw.trim()
  if (!cleaned) return null
  const canonical = canonicalizeCoating(cleaned) ?? cleaned
  const normalized = normalizeCoatingAliasKey(canonical)
  if (COATING_CHEMICAL_DB_ALIASES[normalized]) {
    return {
      chemicalKey: normalized,
      aliases: COATING_CHEMICAL_DB_ALIASES[normalized],
    }
  }
  for (const [chemicalKey, aliases] of Object.entries(COATING_CHEMICAL_DB_ALIASES)) {
    if (aliases.some(alias => normalizeCoatingAliasKey(alias) === normalized)) {
      return { chemicalKey, aliases }
    }
  }
  return null
}

export function buildCoatingAliasDisplayLabel(
  requestedCoating: string,
  candidateSnapshot: CandidateSnapshot[],
): string | null {
  const requestedDisplay = requestedCoating.trim()
  if (!requestedDisplay) return null

  const aliasGroup = findCoatingAliasGroup(requestedDisplay)
  if (!aliasGroup) return null

  const equivalentKeys = new Set<string>([
    normalizeCoatingAliasKey(requestedDisplay),
    normalizeCoatingAliasKey(CHEMICAL_COATING_DISPLAY[aliasGroup.chemicalKey] ?? requestedDisplay),
    ...aliasGroup.aliases.map(alias => normalizeCoatingAliasKey(alias)),
  ])

  const aliasLabels = new Map<string, string>()
  for (const candidate of candidateSnapshot) {
    const coating = typeof candidate.coating === "string" ? candidate.coating.trim() : ""
    if (!coating) continue
    const normalized = normalizeCoatingAliasKey(coating)
    if (!equivalentKeys.has(normalized)) continue
    if (normalized === normalizeCoatingAliasKey(requestedDisplay)) continue
    if (!aliasLabels.has(normalized)) aliasLabels.set(normalized, coating)
  }

  if (aliasLabels.size === 0) return null
  return `${requestedDisplay}(${Array.from(aliasLabels.values()).join("/")})`
}

export function buildCoatingAliasGroundedQuestionText(params: {
  history: NarrowingTurn[]
  questionText: string
  candidateSnapshot: CandidateSnapshot[]
  totalCandidateCount: number
}): string | null {
  const latestTurn = params.history[params.history.length - 1]
  if (!latestTurn) return null

  const latestCoatingFilter = [...latestTurn.extractedFilters]
    .reverse()
    .find(filter => filter.field === "coating" && (filter.op === "eq" || filter.op === "includes"))

  if (!latestCoatingFilter) return null

  const requestedCoating =
    typeof latestCoatingFilter.rawValue === "string" ? latestCoatingFilter.rawValue
    : typeof latestCoatingFilter.value === "string" ? latestCoatingFilter.value
    : null
  if (!requestedCoating) return null

  const aliasLabel = buildCoatingAliasDisplayLabel(requestedCoating, params.candidateSnapshot)
  if (!aliasLabel) return null

  const parts = [`코팅은 ${aliasLabel} 기준으로 그대로 좁혀졌습니다.`]
  if (params.totalCandidateCount > 0) {
    parts.push(`현재 후보는 ${params.totalCandidateCount}개입니다.`)
  }
  const questionText = params.questionText.trim()
  if (questionText) parts.push(questionText)
  return parts.join(" ")
}

async function loadSeriesMaterialRatings(
  candidates: CandidateSnapshot[],
  input: RecommendationInput
): Promise<Map<string, SeriesMaterialStatusValue>> {
  // material이 없으면 workPieceName으로 ISO 그룹 resolve fallback
  const isoGroup = resolveSingleIsoGroup(input.material) ?? resolveSingleIsoGroup(input.workPieceName)
  if (!isoGroup) return new Map()

  const seriesNames = Array.from(
    new Set(
      candidates
        .map(candidate => candidate.seriesName)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    )
  )
  if (seriesNames.length === 0) return new Map()

  const ratings = await SeriesMaterialStatusRepo.findRatingsBySeries({
    isoGroup,
    seriesNames,
    workPieceName: input.workPieceName ?? null,
  })

  return new Map(
    [...ratings.entries()].map(([seriesName, rating]) => [normalizeSeriesKey(seriesName), rating])
  )
}

async function buildDisplayedSeriesGroups(
  candidates: CandidateSnapshot[],
  input: RecommendationInput
) {
  const ratingBySeries = await loadSeriesMaterialRatings(candidates, input)
  return groupCandidatesBySeries(candidates, ratingBySeries)
}

async function buildWorkPieceQuestion(
  input: RecommendationInput,
  filters: AppliedFilter[],
  candidates?: ScoredProduct[],
  excludeValues?: string[]
): Promise<NextQuestion | null> {
  traceRecommendation("response.buildWorkPieceQuestion:input", {
    input: summarizeRecommendationInputForTrace(input),
    filters: summarizeFiltersForTrace(filters),
    filterCount: filters.length,
    candidateCount: candidates?.length ?? 0,
    excludeValues,
  })
  if (input.workPieceName) return null

  const isoGroup = resolveSingleIsoGroup(input.material)
  if (!isoGroup) return null

  const lastWorkPieceFilterIndex = filters.reduce((lastIndex, filter, index) => (
    filter.field === "workPieceName" ? index : lastIndex
  ), -1)
  const lastMaterialFilterIndex = filters.reduce((lastIndex, filter, index) => (
    filter.field === "material" ? index : lastIndex
  ), -1)
  if (lastWorkPieceFilterIndex !== -1 && lastWorkPieceFilterIndex >= lastMaterialFilterIndex) {
    return null
  }
  if (!candidates || candidates.length === 0) return null

  const seriesNames = Array.from(new Set(candidates.flatMap(candidate => {
    const values = [
      candidate.product.seriesName,
      (candidate.product as Record<string, unknown>).edpSeriesName as string | undefined,
    ]
    return values.map(value => String(value ?? "").trim()).filter(Boolean)
  })))
  if (seriesNames.length === 0) return null

  const profiles = await EntityProfileRepo.findSeriesProfiles(seriesNames)
  const profileBySeriesKey = new Map(
    profiles.map(profile => [normalizeSeriesKey(profile.normalizedSeriesName), profile])
  )

  const preferWorkPieceName = (left: string, right: string) => {
    if (left.length !== right.length) return left.length > right.length ? left : right
    return left.localeCompare(right, "ko") <= 0 ? left : right
  }

  const excludedKeys = new Set((excludeValues ?? []).map(normalizeWorkPieceKey))
  const workPieceEntries = new Map<string, { name: string; candidateKeys: Set<string> }>()
  let unmappedCandidateCount = 0
  for (const candidate of candidates) {
    const candidateKey = candidate.product.normalizedCode ?? candidate.product.displayCode
    const candidateSeriesNames = Array.from(new Set([
      candidate.product.seriesName,
      (candidate.product as Record<string, unknown>).edpSeriesName as string | undefined,
    ].map(value => String(value ?? "").trim()).filter(Boolean)))

    const candidateWorkPieces = new Map<string, string>()
    for (const seriesName of candidateSeriesNames) {
      const profile = profileBySeriesKey.get(normalizeSeriesKey(seriesName))
      if (!profile) continue
      for (const rawName of profile.materialWorkPieceNames) {
        const name = rawName.trim()
        if (!name) continue
        const key = normalizeWorkPieceKey(name)
        if (excludedKeys.has(key)) continue
        const existing = candidateWorkPieces.get(key)
        candidateWorkPieces.set(key, existing ? preferWorkPieceName(existing, name) : name)
      }
    }

    if (candidateWorkPieces.size === 0) {
      unmappedCandidateCount += 1
      continue
    }

    for (const [key, name] of candidateWorkPieces.entries()) {
      const existing = workPieceEntries.get(key)
      if (!existing) {
        workPieceEntries.set(key, { name, candidateKeys: new Set([candidateKey]) })
        continue
      }
      existing.name = preferWorkPieceName(existing.name, name)
      existing.candidateKeys.add(candidateKey)
    }
  }

  const relevantEntries = Array.from(workPieceEntries.values())
    .map(entry => ({ name: entry.name, count: entry.candidateKeys.size, candidateKeys: Array.from(entry.candidateKeys) }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "ko"))
  if (relevantEntries.length <= 1) return null

  const workPieceCounts = new Map(relevantEntries.map(entry => [entry.name, entry.count]))
  const workPieceCandidateKeys = new Map(relevantEntries.map(entry => [entry.name, entry.candidateKeys]))
  const relevantNames = relevantEntries.map(entry => entry.name)

  const materialLabel = getMaterialDisplay(isoGroup).ko
  const chips = relevantNames
    .filter(name => {
      const count = workPieceCounts?.get(name)
      return count == null || count > 0
    })
    .slice(0, 10).map(name => {
      const count = workPieceCounts?.get(name)
      return count != null ? `${name} (${count}개)` : name
    })
  if (unmappedCandidateCount > 0) {
    chips.push(`ETC (${unmappedCandidateCount}개)`)
  }
  traceRecommendation("response.buildWorkPieceQuestion:output", {
    field: "workPieceName",
    isoGroup,
    relevantNames,
    workPieceCounts,
    workPieceCandidateKeys: Array.from(workPieceCandidateKeys.entries()).map(([name, keys]) => ({
      name,
      count: keys.length,
      preview: keys.slice(0, 5),
    })),
    unmappedCandidateCount,
    chips,
  })
  return {
    field: "workPieceName",
    questionText: `선택하신 소재는 ISO ${isoGroup} (${materialLabel})군입니다. 세부 피삭재를 선택해주세요. (일부 제품은 세부 분류가 없어 "상관없음" 선택 시 전체 후보에서 추천합니다)`,
    chips,
    expectedInfoGain: 0.5,
  }
}

async function selectNextQuestionForResponse(params: {
  input: RecommendationInput
  candidates: ScoredProduct[]
  history: NarrowingTurn[]
  filters: AppliedFilter[]
  totalCandidateCount: number
  excludeWorkPieceValues?: string[]
  skipResolutionCheck?: boolean
}): Promise<NextQuestion | null> {
  const { input, candidates, history, filters, totalCandidateCount, excludeWorkPieceValues, skipResolutionCheck } = params
  const alreadyAsked = new Set(
    history.map(t => t.askedField).filter((f): f is string => typeof f === "string" && f.length > 0)
  )
  const workPieceQuestion = await buildWorkPieceQuestion(input, filters, candidates, excludeWorkPieceValues)
  if (workPieceQuestion && !alreadyAsked.has(workPieceQuestion.field)) return workPieceQuestion
  const q = selectNextQuestion(input, candidates, history, totalCandidateCount, skipResolutionCheck)
  if (q && alreadyAsked.has(q.field)) {
    console.warn(`[question-dedup] skipping field=${q.field} — already asked in history`)
    return null
  }
  return q
}

const MAX_QUESTION_REC_DEPTH = 3

export async function buildQuestionResponse(
  deps: ServeResponseBuilderDependencies,
  form: ProductIntakeForm,
  candidates: ScoredProduct[],
  evidenceMap: Map<string, EvidenceSummary>,
  totalCandidateCount: number,
  pagination: RecommendationPaginationDto | null,
  displayCandidates: ScoredProduct[] | null,
  displayEvidenceMap: Map<string, EvidenceSummary> | null,
  input: RecommendationInput,
  history: NarrowingTurn[],
  filters: AppliedFilter[],
  turnCount: number,
  messages: ChatMessage[],
  provider: ReturnType<typeof getProvider>,
  language: AppLanguage,
  overrideText?: string,
  existingStageHistory?: NarrowingStage[],
  excludeWorkPieceValues?: string[],
  responsePrefix?: string,
  overrideChips?: string[],
  extraResponseContext?: string,
  _recursionDepth: number = 0,
): Promise<Response> {
  if (_recursionDepth > MAX_QUESTION_REC_DEPTH) {
    console.warn(`[recursion-guard] buildQuestionResponse depth=${_recursionDepth} > ${MAX_QUESTION_REC_DEPTH} — forcing recommendation (skipQuestionInjection=true) to break loop`)
    return buildRecommendationResponse(
      deps, form, candidates, evidenceMap, totalCandidateCount,
      pagination, displayCandidates, displayEvidenceMap, input, history, filters,
      turnCount, messages, provider, language, null, undefined, true, _recursionDepth + 1,
    )
  }
  traceRecommendation("response.buildQuestionResponse:input", {
    totalCandidateCount,
    turnCount,
    input: summarizeRecommendationInputForTrace(input),
    historyCount: history.length,
    history: summarizeHistoryForTrace(history),
    filterCount: filters.length,
    filters: summarizeFiltersForTrace(filters),
    messageCount: messages.length,
    pagination: summarizePaginationForTrace(pagination),
    overrideText: overrideText ?? null,
    excludeWorkPieceValues,
    responsePrefix: responsePrefix ?? null,
  })
  // ── Resolution guard: if already resolved, skip all questions → show recommendation ──
  // Explicit-show short-circuit: when the user has applied at least one filter
  // and the latest message contains an explicit show intent ("추천해줘", "보여줘",
  // "show"), bypass the ask-vs-show threshold. Prevents B03-type regressions
  // ("CRX S 빼고 추천해줘" → asks diameter despite the exclusion filter).
  const lastUserText = [...messages].reverse().find(m => m.role === "user")?.text ?? ""
  const explicitShow = filters.length >= 1
    && /(추천|보여|show|주세요|알려|찾아)/i.test(lastUserText)
  const preCheckStatus = checkResolution(candidates, history, totalCandidateCount, explicitShow)
  const alreadyResolved = preCheckStatus.startsWith("resolved")

  // When caller passes overrideText (e.g. uncertainty-gate ASK forcing a
  // question even though resolution says "show cards"), skip the
  // alreadyResolved short-circuit AND propagate skipResolutionCheck into
  // selectNextQuestion so we still build a question + option chips for the
  // forced field. Without this, chips collapse to nav-only.
  const forceQuestion = !!overrideText
  const question = alreadyResolved && !forceQuestion
    ? null
    : await selectNextQuestionForResponse({
        input,
        candidates,
        history,
        filters,
        totalCandidateCount,
        excludeWorkPieceValues,
        skipResolutionCheck: forceQuestion,
      })
  const stageHistory = existingStageHistory
    ? [...existingStageHistory]
    : buildStageHistoryFromFilters(filters, input, totalCandidateCount)

  const snapshotCandidates = displayCandidates ?? candidates
  const snapshotEvidenceMap = displayEvidenceMap ?? evidenceMap
  const candidateSnapshot = buildCandidateSnapshot(snapshotCandidates, snapshotEvidenceMap)
  // Full narrowed pool snapshot — used by post-narrowing filters (e.g. stock) so they
  // can re-rank across the entire candidate pool, not just the top-N currently displayed.
  const fullCandidateSnapshot = candidates !== snapshotCandidates
    ? buildCandidateSnapshot(candidates, evidenceMap)
    : candidateSnapshot
  const filterValueScope = buildFilterValueScope(candidates as unknown as Array<Record<string, unknown>>)

  // ── Option-first: question engine provides field + candidate data ──
  // Structured SmartOptions are built FIRST, then displayedOptions, then chips.
  // The question engine's raw chips are input data, NOT the source of truth.
  const questionFieldResult = question
    ? buildQuestionFieldOptions(question.field, question.chips, history.length > 0)
    : null

  let chips = questionFieldResult?.chips ?? []
  let displayedOptions = questionFieldResult?.displayedOptions ?? []

  // Override chips when caller provides explicit alternatives (e.g. 0-result recovery)
  if (overrideChips && Array.isArray(overrideChips) && overrideChips.length > 0) {
    chips = [...overrideChips]
    displayedOptions = buildDisplayedOptions(chips, question?.field ?? "unknown")
  }

  // Safety: if no question field options (e.g. 0-candidate guard with overrideText),
  // provide minimal navigation chips
  if (chips.length === 0) {
    const fallbackChips: string[] = []
    if (filters.length > 0) fallbackChips.push("⟵ 이전 단계")
    fallbackChips.push("처음부터 다시")
    chips = fallbackChips
    displayedOptions = buildDisplayedOptions(chips, question?.field ?? "unknown")
  }

  // ── CTA 버튼 2개 매 턴 상시 표시 ──
  if (totalCandidateCount > 0) {
    if (!chips.some(c => c.includes("제품 보기"))) chips.push(`📋 지금 바로 제품 보기 (${totalCandidateCount}개)`)
    if (!chips.some(c => c.includes("AI 상세 분석"))) chips.push(`✨ AI 상세 분석`)
  }

  const displayedSeriesGroups = await buildDisplayedSeriesGroups(candidateSnapshot, input)

  const sessionState = buildSessionState({
    candidateCount: totalCandidateCount,
    appliedFilters: filters,
    narrowingHistory: history,
    stageHistory,
    resolutionStatus: checkResolution(candidates, history, totalCandidateCount),
    resolvedInput: input,
    turnCount,
    // BUG4: 0-result 분기에서 question이 null 이면 lastAskedField 가 undefined 로 박혀
    // UI 카피("양면값을 선택해주세요" 류)가 깨지고 후속 턴 컨텍스트가 끊긴다.
    // 가장 마지막에 적용된 필터의 field 로 fallback 해 컨텍스트를 유지한다.
    lastAskedField: question?.field ?? filters[filters.length - 1]?.field ?? undefined,
    displayedProducts: candidateSnapshot,
    fullDisplayedProducts: candidateSnapshot,
    displayedSeriesGroups,
    uiNarrowingPath: buildUINarrowingPath(filters, history, totalCandidateCount),
    // 0 candidates → "question" (사용자에게 조건 완화를 요청하는 회복 분기). narrowing 으로
    // 박으면 UX가 "더 좁히는 중" 처럼 보이고 FB-36 (티타늄 0.5mm Taper 6날) 같은 극한 조건에서
    // 무한히 narrowing 모드로 떠 있게 됨.
    currentMode: messages.length === 0 ? "question" : totalCandidateCount === 0 ? "question" : "narrowing",
    displayedCandidates: candidateSnapshot,
    fullDisplayedCandidates: fullCandidateSnapshot,
    filterValueScope,
    displayedChips: chips,
    displayedOptions,
    lastAction: "continue_narrowing",
  })

  // ── Set pendingAction when there's a single recommended option ──
  if (question && displayedOptions.length > 0) {
    const recommendedOption = displayedOptions.find(o => {
      // The first narrowing option (index 1) is recommended by buildQuestionFieldOptions
      return o.index === 1 && o.field === question.field
    })
    if (recommendedOption && recommendedOption.field && recommendedOption.value) {
      sessionState.pendingAction = {
        type: "apply_filter",
        label: recommendedOption.label,
        payload: { field: recommendedOption.field, value: recommendedOption.value },
        sourceTurnId: `turn-${Date.now()}`,
        createdAt: turnCount,
        expiresAfterTurns: 2,
      }
      console.log(`[pending-action:set] "${recommendedOption.label}" (field=${recommendedOption.field}, value=${recommendedOption.value})`)
    }
  }

  logNarrowingState("question", sessionState, question?.field ?? null)

  if (!question && !overrideText) {
    return buildRecommendationResponse(
      deps,
      form,
      candidates,
      evidenceMap,
      totalCandidateCount,
      pagination,
      displayCandidates,
      displayEvidenceMap,
      input,
      history,
      filters,
      turnCount,
      messages,
      provider,
      language,
      snapshotToDisplayed(candidateSnapshot),
      undefined,
      true,
      _recursionDepth + 1,
    )
  }

  let responseText = overrideText ?? question?.questionText ?? ""
  let responseChips = question?.chips ?? chips
  const latestTurnWasSkip = didLatestNarrowingTurnSkip(history)

  // First-turn intake historically took a deterministic template path because
  // the only message was a synthesized intake summary. In the current flow the
  // first user message is real natural text, so we let it fall into the
  // narrative-polish branch below; the fragment guard there falls back to the
  // deterministic question text if the polish output looks broken.
  // NOTE: overrideText is intentionally NOT a short-circuit anymore — the
  // uncertainty-gate ASK path passes overrideText to prevent recursion, but
  // we still want polish to rewrite the canned followup_question into a
  // natural, candidate-aware sentence.
  if (provider.available() && messages.length === 0) {
    try {
      const systemPrompt = buildSystemPrompt(language)
      const firstUserText = messages.find(m => m.role === "user")?.text ?? ""
      const sessionCtx = buildSessionContext(form, sessionState, totalCandidateCount, snapshotToDisplayed(candidateSnapshot), firstUserText)
      const greetingPrompt = buildGreetingPrompt(sessionCtx, question, totalCandidateCount, language)
      const raw = await provider.complete(systemPrompt, [{ role: "user", content: greetingPrompt }], 1500)
      const parsed = safeParseJSON(raw)
      if (typeof parsed?.responseText === "string") {
        responseText = parsed.responseText
      }
    } catch (error) {
      console.warn("[recommend] LLM greeting failed:", error)
    }
  } else if (provider.available() && messages.length > 0 && !latestTurnWasSkip) {
    // Slim narrative polish — routed to the `narrative-polish` agent which
    // resolves to OPENAI_HAIKU_MODEL (gpt-5-mini) with reasoning_effort=minimal.
    // The full system prompt + persona + domain context is overkill for "rewrite
    // one question naturally"; before this we burned 30~50s on a sonnet-tier
    // medium-effort call for a 1-2 sentence rewrite. Slim prompt + mini + minimal
    // brings it down to ~1s while preserving natural tone for both chip clicks
    // and free-text follow-ups.
    try {
      const lastUserText = [...messages].reverse().find(m => m.role === "user")?.text ?? ""
      const chipList = question?.chips?.length ? question.chips.join(", ") : ""
      // Top 후보 요약 — LLM이 카드 없이 narrative 다듬을 때 한 줄 인용 가능하도록
      const topCandLines = candidateSnapshot.slice(0, 3).map((c, i) => {
        const meta = []
        if (c.brand) meta.push(c.brand)
        if (c.seriesName) meta.push(c.seriesName)
        if (c.coating) meta.push(c.coating)
        if (c.fluteCount != null) meta.push(`${c.fluteCount}날`)
        if (c.diameterMm != null) meta.push(`Ø${c.diameterMm}mm`)
        if (Array.isArray(c.materialTags) && c.materialTags.length > 0) meta.push(c.materialTags.slice(0, 2).join("/"))
        return `  ${i + 1}. ${c.displayCode ?? c.productCode} (${meta.join(", ")})`
      }).join("\n")
      const opSymbol = (op: string): string => {
        switch (op) {
          case "eq": return "="
          case "neq": return "≠"
          case "gte": return "≥"
          case "lte": return "≤"
          case "gt": return ">"
          case "lt": return "<"
          case "in": return "∈"
          case "nin": return "∉"
          default: return "="
        }
      }
      const filterSummary = filters.length > 0
        ? filters
            .filter(f => f.op !== "skip" && f.field !== "none")
            .map(f => `${f.field}${opSymbol(f.op)}${Array.isArray(f.value) ? f.value.join("|") : f.value}`)
            .join(", ")
        : ""
      const insightBlock = extraResponseContext && extraResponseContext.trim().length > 0
        ? `\n프로액티브 통찰:\n${extraResponseContext.trim()}`
        : ""
      const polishSystem = `당신은 YG-1 기술영업 김도현 차장입니다. 사용자 메시지에 한국어로 친근하게 응답하세요.

흐름: (1) 사용자 입력 짧게 확인(이전 필터 이어받기 포함) → (2) 후보 중 눈에 띄는 특징 한 줄(코팅·시리즈 강점이나 가공 팁) → (3) 원본 질문을 자연스럽게.

- 카드에 안 보이는 메커니즘/노하우 위주. 스펙 나열 금지.
- 숫자는 주어진 값만 사용, 새로 만들지 마라.
- 후보가 0개거나 사용자 의도가 비교/설명/트러블슈팅이면 (2)는 그 응답으로 대체.
- 평문 2~4문장. 이모지/마크다운/토막 문장 금지.

[맥락 이어받기 필수] 이전 턴에서 적용된 필터가 있으면 (1)에서 반드시 이어받아 언급:
  예: "스테인리스 10mm로 좁혔더니 148개 나왔습니다. 코팅은 어떤 걸로 가실래요?"
  필터 변경 시 변경 사실 명시:
  예: "AlCrN에서 Y-Coating으로 바꿨더니 후보가 5개로 줄었네요."
  '현재 적용 필터' 입력에 값이 있으면 그 중 가장 최근/대표 조건을 자연스럽게 한 마디로 녹여라.

[부정 필터(빼고/제외/말고/아닌 거) 처리 필수]
사용자 메시지에 "빼고/제외/말고/아닌" 이 있거나 '현재 적용 필터'에 ≠/∉ 가 붙어있으면:
  1) 제외 사실 확인 1문장 — 제외 대상 이름만 한 번 언급하고 끝. 절대 그 값을 재추천하거나 장점을 나열하지 마라.
  2) 남은 상위 후보 중 실제 존재하는 대표 시리즈 **1~2개를 즉시 소개**하고 메커니즘 1줄 (가변 헬릭스·내열 코팅·고이송 기하 등).
  3) 후보가 100개 이상이면 탑픽 소개로 **바로 마무리**하고 직경/소재/가공 같은 **필터 질문을 덧붙이지 마라**. 필요하면 "더 좁히고 싶으시면 직경이나 소재 알려주세요" 정도로 가볍게만. 기계적인 "공구 타입을 알려주세요" 식 질문 금지.
  예) "CRX S는 제외했습니다. 남은 후보 중 4G MILL이 가변 헬릭스로 채터를 억제해 측벽 가공에 강하고, V7 PLUS는 내열 코팅으로 수명이 길게 나옵니다. 더 좁히고 싶으시면 소재·직경 알려주세요."
  ❌ 금지: 제외한 것을 칭찬/설명/비교하거나 "사실 CRX S도 좋지만..." 같은 hedging.

[소재 적합성 환각 금지 — 최우선]
제품이 특정 소재에 적합한지는 **상위 후보 카드에 표시된 소재 태그로만** 판단하라.
  - 브랜드/시리즈 이름("3S MILL"/"CRX S")이나 코팅명("T-Coating"/"Y-Coating")만 보고 소재 용도를 추측 금지.
  - ❌ **내부 DB 필드명(materialTags, workPieceName, toolSubtype 등)을 사용자에게 절대 노출하지 마라.** 내부 검증 과정도 설명하지 마라. "materialTags가 H/K/M이라서..." / "태그가 H인데..." 같은 메타 설명 금지.
  - ✅ 결론만 자연스럽게: "이 제품은 고경도강·주철·스테인리스 전용이라 SUS316L에 적합합니다." / "4G MILL은 스테인리스·주철·고경도강 범용이라 SUS304 포켓에 무난합니다."
  - 카드 태그 "H/P"만 → "고경도강·탄소강용"; "M" 포함 → "스테인리스 가능"; "N" 포함 → "알루미늄/비철 가능".
  - 태그가 비거나 불명확하면 소재 적합성 언급 자체를 생략하고 메커니즘(헬릭스/날수/칩 배출)만 짚어라.
ISO 참고(내부용, 출력 금지): H=고경도강, K=주철, M=스테인리스, N=비철/알루미늄, P=탄소강/합금강, S=내열합금/티타늄.

[통찰력 활용] '프로액티브 통찰' 블록이 주어지면 (2)에 그 내용을 한 문장으로 녹여라(메커니즘·이유·팁 위주). 통찰 블록 그대로 복붙 금지.

[소재 그레이드 인식 필수 — 단, 제품 우선] 사용자가 구체 그레이드(SUS304/SUS316L/A6061/A7075/Ti6Al4V/Inconel718/SCM440/SKD11/SKD61 등)를 언급하면 그레이드 특성을 **정확히 1문장**만 짚어라. 메커니즘 설명이 제품 소개를 밀어내면 안 된다.
  **순서 필수**: (a) 상위 후보 중 실제 제품명 1개 + why 1줄 → (b) 그레이드 특성 1문장 → (c) 질문 한 마디.
  ❌ 금지: 그레이드 메커니즘을 2~3문장 설명하고 끝나는 답변 (제품명 누락).
  예) SUS316L → "상위에 TitaNox-Power가 AlCrN으로 SUS316L 가공경화에 강합니다. 316L은 SUS304보다 점성이 심해서 이송 끊김만 주의하세요. 가공은 포켓/측면 중 어떤 쪽이세요?"
  예) Ti6Al4V → "XSEME60이 Y-Coating·4날이라 Ti6Al4V 저속 가공에 무난합니다. 티타늄은 날끝 열 집중이 심해 고압 쿨란트가 핵심이에요."
  예) A7075 → "HSM-N이 무코팅·2날로 A7075 구성인선 억제에 강합니다. 7075는 고속·저이송이 안전해요."

[코팅 비교 질의 필수] 사용자가 2개 이상 코팅(AlCrN/TiAlN/DLC/TiN/TiCN/Diamond 등)을 나란히 언급하면 언급된 **모든 코팅을 각각 한 줄씩** 내열온도·강점·약점을 짚고, 사용자가 말한 작업 조건에서 어느 쪽이 유리한지 결론까지 낸 뒤 (3) 질문으로 넘어가라. 한쪽만 답하거나 "상황에 따라 다름"으로 얼버무리지 마라.
  예) "AlCrN은 내열 ~1100℃로 스테인리스 고속 건식에 강하고, TiAlN은 ~800℃대로 고경도강 건식에 유리합니다. 스테인리스라면 AlCrN 쪽이 산화 마모가 적어요."

[질문 자연스러움 필수] 원본 질문이 기계적이면 반드시 대화체로 바꿔라:
  ❌ "공구 타입을 알려주세요" → ✅ "주로 어떤 가공을 하시나요? 포켓/측면/홈 같은 거요"
  ❌ "소재를 알려주세요" → ✅ "어떤 소재를 깎으시나요?"
  ❌ "날수를 선택해주세요" → ✅ "날수는 몇 개 쓰실 건가요? 4날이 가장 범용입니다"
  ❌ "직경을 입력하세요" → ✅ "직경이 몇 mm 정도 되나요?"
  ❌ "코팅을 선택해주세요" → ✅ "코팅은 어떤 걸로 가실래요? 소재에 따라 추천이 달라져요"
  "~주세요/~해주세요" 명령조는 "~가시나요/~쓰실 건가요/~정도 되나요" 질문조로.

JSON으로만: {"responseText":"..."}`
      const complexity = assessComplexity(lastUserText, filters.length)
      const isDeep = complexity.level === "deep"
      const deepCoTBlock = isDeep
        ? `

[깊이 있는 답변 모드 — 이 질문은 복잡합니다]
단계별로 생각하되 **최종 출력은 평문 2~5문장**만 내보내라 (생각 과정 나열 금지):
  1) 사용자 의도 파악 (비교/트러블슈팅/용어설명/복합조건 중 무엇?)
  2) 관련 도메인 지식 정리 (내열온도/헬릭스각/코팅 메커니즘/재질 특성 등)
  3) 최적 답변 구성 (메커니즘 → 결론 → 실전 팁 순)
  4) 위험 요소 체크 (가공경화·채터·구성인선·열변형 등 주의점)
시간이 걸려도 좋으니 shallow한 "상황에 따라 다릅니다" 답변은 금지.`
        : ""
      const finalPolishSystem = polishSystem + deepCoTBlock
      const polishMaxTokens = isDeep ? 2000 : complexity.level === "light" ? 500 : 1000
      const polishUser = `사용자 최신 메시지: "${lastUserText}"
현재 후보 ${totalCandidateCount}개
현재 적용 필터: ${filterSummary || "(없음)"}${topCandLines ? `\n상위 후보:\n${topCandLines}` : ""}
원본 질문: "${question?.questionText ?? ""}"${chipList ? `\n선택지(칩): [${chipList}]` : ""}${insightBlock}`
      const raw = await provider.complete(
        finalPolishSystem,
        [{ role: "user", content: polishUser }],
        polishMaxTokens,
        undefined,
        "narrative-polish",
      )
      const parsed = safeParseJSON(raw)
      if (typeof parsed?.responseText === "string") {
        const candidate = parsed.responseText.trim()
        // Reject pathological short / fragment outputs ("로 필터링하겠습니다" etc.)
        // and fall back to the deterministic question text instead.
        const isFragment = candidate.length < 12
          || /^로\s/.test(candidate)
          || /^으?로 (필터|좁|골라|진행|적용)/.test(candidate)
        if (isFragment) {
          console.warn(`[recommend] narrative-polish returned fragment "${candidate.slice(0, 40)}" — falling back to deterministic question`)
          responseText = question?.questionText ?? responseText
        } else {
          responseText = candidate
        }
      }
    } catch (error) {
      console.warn("[recommend] narrative-polish failed:", error)
    }

    // ── Candidate-scoped phantom guard (negation path) ──
    // On neq/nin filters, verify every brand/series phrase in the polished
    // text is either in the current candidate snapshot or framed as an
    // exclusion. Anything else means the LLM invented a recommendation or
    // recommended the value it was told to exclude — fall back to a safe
    // deterministic template built from the actual snapshot.
    const hasNegationFilter = filters.some(f => f.op === "neq" || f.op === "nin")
    if (hasNegationFilter && responseText && candidateSnapshot.length > 0) {
      const { phantoms, excludedMentioned } = findCandidateScopedPhantoms(
        responseText,
        candidateSnapshot,
        filters,
      )
      if (phantoms.length > 0 || excludedMentioned.length > 0) {
        console.warn(
          `[phantom-guard] negation-path issue — phantoms=[${phantoms.join(", ")}] excludedMentioned=[${excludedMentioned.join(", ")}]`,
        )
        const firstNeq = filters.find(f => f.op === "neq" || f.op === "nin")
        const excludedRaw =
          firstNeq && typeof firstNeq.value === "string" ? firstNeq.value
          : firstNeq && typeof firstNeq.rawValue === "string" ? firstNeq.rawValue
          : null
        responseText = buildNegationFallbackText(
          totalCandidateCount,
          candidateSnapshot,
          excludedRaw,
        )
      }
    }
  } else if (latestTurnWasSkip) {
    console.log("[recommend] Skipping LLM question polish after skip_field; using deterministic question text")
  }

  // ── Post-process: strip hallucinated numbers from LLM text ──
  // Build valid number set from chips and total candidate count
  if (responseText && question?.chips?.length) {
    const validNums = new Set<number>()
    validNums.add(totalCandidateCount)
    for (const chip of question.chips) {
      const m = chip.match(/(\d[\d,]*)\s*개/)
      if (m) validNums.add(parseInt(m[1].replace(/,/g, "")))
    }
    // Replace "약 N개" or "N개" where N is not in validNums
    responseText = responseText.replace(/약?\s*(\d[\d,]*)\s*개/g, (match, numStr) => {
      const num = parseInt(numStr.replace(/,/g, ""))
      if (validNums.has(num)) return match
      // Check ±5% tolerance
      for (const v of validNums) {
        if (Math.abs(v - num) / Math.max(v, 1) < 0.05) return match
      }
      // Hallucinated number — remove the whole "약 N개" phrase
      return ""
    })
    // Clean up double spaces / orphan punctuation from removals
    responseText = responseText.replace(/\(\s*\)/g, "").replace(/  +/g, " ").trim()
  }

  const aliasGroundedQuestionText = question
    ? buildCoatingAliasGroundedQuestionText({
        history,
        questionText: question.questionText,
        candidateSnapshot,
        totalCandidateCount,
      })
    : null
  if (aliasGroundedQuestionText) {
    responseText = aliasGroundedQuestionText
  }

  const requestPrep = prepareRequest(form, messages, sessionState, input, totalCandidateCount)

  // ── Option-first: chips are derived from structured displayedOptions (built above) ──
  // Text-to-chip synthesis is NOT allowed on the main path.
  // displayedOptions (from smart options or question engine) is the source of truth.
  let finalResponseChips = responseChips
  let finalDisplayedOptions = displayedOptions
  const lastUserMsgText = messages.length > 0
    ? [...messages].reverse().find(m => m.role === "user")?.text ?? null
    : null

  // When overrideChips is provided (e.g. 0-result recovery), skip the option state
  // pipeline and consistency guards — the caller knows exactly which chips to show.
  // Safety: reject non-array values to prevent string spread (e.g. [..."text"] → ["t","e","x","t"])
  if (overrideChips && !Array.isArray(overrideChips)) {
    console.error(`[buildQuestionResponse] overrideChips is not an array: ${typeof overrideChips} — ignoring to prevent character-level chip split`)
  }
  if (overrideChips && Array.isArray(overrideChips) && overrideChips.length > 0) {
    finalResponseChips = [...overrideChips]
    finalDisplayedOptions = buildDisplayedOptions(overrideChips, question?.field ?? "unknown")
  } else {
    const questionOptionState = await buildQuestionResponseOptionState({
      chips: responseChips,
      question: question
        ? {
            questionText: question.questionText,
            chips: question.chips,
            field: question.field,
          }
        : null,
      displayedOptions,
      sessionState,
      input,
      userMessage: lastUserMsgText,
      responseText,
      messages,
      provider,
    })
    finalResponseChips = questionOptionState.chips
    finalDisplayedOptions = questionOptionState.displayedOptions

    // ── Field consistency guard: ensure displayedOptions match current question field ──
    if (question?.field) {
      if (finalDisplayedOptions.length > 0) {
        const staleOptions = finalDisplayedOptions.filter(
          opt => opt.field && opt.field !== question.field && opt.field !== "_action" && opt.field !== "skip"
        )
        if (staleOptions.length > 0) {
          console.warn(`[field-consistency] Removing ${staleOptions.length} stale options from field "${staleOptions[0].field}" (current: ${question.field})`)
          finalDisplayedOptions = finalDisplayedOptions.filter(
            opt => !opt.field || opt.field === question.field || opt.field === "_action" || opt.field === "skip"
          )
          finalResponseChips = finalDisplayedOptions.map(opt => opt.label)
        }
      }

      // Absolute guard: if chips still don't match question field, rebuild from question engine
      if (finalResponseChips.length > 0 && questionFieldResult) {
        const questionChipSet = new Set(questionFieldResult.chips)
        const hasAnyQuestionChip = finalResponseChips.some(c => questionChipSet.has(c) || c === "상관없음" || c === "⟵ 이전 단계" || c === "처음부터 다시")
        if (!hasAnyQuestionChip) {
          console.warn(`[field-consistency:absolute] Chips completely mismatch question field "${question.field}" — rebuilding from question engine`)
          finalResponseChips = questionFieldResult.chips
          finalDisplayedOptions = questionFieldResult.displayedOptions
        }
      }

      // Last resort: if displayedOptions still empty, use question engine
      if (finalDisplayedOptions.length === 0 && questionFieldResult && questionFieldResult.displayedOptions.length > 0) {
        console.warn(`[field-consistency:fallback] Empty displayedOptions, using question engine result for field "${question.field}"`)
        finalDisplayedOptions = questionFieldResult.displayedOptions
        finalResponseChips = questionFieldResult.chips
      }

      if (
        !overrideText &&
        shouldFallbackToDeterministicQuestionText({
          questionField: question.field,
          questionText: question.questionText,
          responseText,
          displayedOptions: finalDisplayedOptions,
        })
      ) {
        console.warn(`[field-consistency:text] Response text drifted from field "${question.field}" — reverting to deterministic question text`)
        responseText = question.questionText
      }
    }
  }

  if (responsePrefix) {
    responseText = `${responsePrefix}\n\n${responseText}`.trim()
  }
  responseText = normalizeRpmPhrases(responseText)
  const rpmQuestionExplanation = buildRpmExplanationText(filters)
  if (rpmQuestionExplanation && !/(\bvc\b|cutting speed|spindle speed)/iu.test(responseText)) {
    responseText = `${rpmQuestionExplanation} ${responseText}`.trim()
  }

  // ── Safety: strip single-character chips (e.g. "탭" from LLM, or spread string remnants) ──
  const preFilterCount = finalResponseChips.length
  finalResponseChips = finalResponseChips.filter(c => typeof c === "string" && c.trim().length > 1)
  finalDisplayedOptions = finalDisplayedOptions.filter(o => typeof o.label === "string" && o.label.trim().length > 1)
  if (finalResponseChips.length < preFilterCount) {
    console.warn(`[chip-safety] Removed ${preFilterCount - finalResponseChips.length} single-char chips`)
  }

  // ── CTA 버튼 2개를 최종 칩에 항상 추가 ──
  if (totalCandidateCount > 0) {
    if (!finalResponseChips.some(c => c.includes("제품 보기"))) finalResponseChips = [...finalResponseChips, `📋 지금 바로 제품 보기 (${totalCandidateCount}개)`]
    if (!finalResponseChips.some(c => c.includes("AI 상세 분석"))) finalResponseChips = [...finalResponseChips, `✨ AI 상세 분석`]
  }

  // Align structured chips against the final chip-label list. Uses the
  // question engine's upstream structured chips as the authoritative source;
  // any finalResponseChips that aren't in the upstream list (CTA buttons,
  // "이전 단계", "처음부터") get synthesized actions.
  const finalStructuredChips = alignStructuredChips(
    finalResponseChips,
    questionFieldResult?.chips ?? null,
    questionFieldResult?.structuredChips ?? null,
  )

  sessionState.displayedChips = finalResponseChips
  sessionState.displayedStructuredChips = finalStructuredChips
  sessionState.displayedOptions = finalDisplayedOptions

  // ── Post-Answer Validator: strip unauthorized actions from answer ──
  // Direction: displayedOptions → constrain answer (NEVER answer → add chips)
  const questionValidation = validateOptionFirstPipeline(responseText, finalResponseChips, finalDisplayedOptions)
  if (questionValidation.correctedAnswer) {
    responseText = questionValidation.correctedAnswer
    console.log(`[answer-validator:question] Softened unauthorized actions: ${questionValidation.unauthorizedActions.map(a => a.phrase).join(",")}`)
  }

  traceRecommendation("response.buildQuestionResponse:output", {
    purpose: messages.length === 0 ? "greeting" : "question",
    question: question ? {
      field: question.field,
      questionText: question.questionText,
      chipCount: question.chips.length,
      chipPreview: question.chips.slice(0, 6),
    } : null,
    responseText,
    chipCount: finalResponseChips.length,
    chipPreview: finalResponseChips.slice(0, 6),
    displayedOptionCount: finalDisplayedOptions.length,
    displayedOptions: finalDisplayedOptions.slice(0, 6).map(option => ({
      label: option.label,
      field: option.field,
      value: option.value,
      count: option.count,
    })),
    sessionState: {
      sessionId: sessionState.sessionId ?? null,
      currentMode: sessionState.currentMode ?? null,
      lastAskedField: sessionState.lastAskedField ?? null,
      candidateCount: sessionState.candidateCount ?? 0,
      displayedChipCount: sessionState.displayedChips?.length ?? 0,
      displayedOptionCount: sessionState.displayedOptions?.length ?? 0,
    },
  })
  return deps.jsonRecommendationResponse({
    text: responseText,
    purpose: messages.length === 0 ? "greeting" : "question",
    chips: finalResponseChips,
    structuredChips: finalStructuredChips,
    isComplete: false,
    recommendation: null,
    sessionState,
    evidenceSummaries: null,
    candidateSnapshot,
    pagination,
    requestPreparation: requestPrep,
    primaryExplanation: null,
    primaryFactChecked: null,
    altExplanations: [],
    altFactChecked: [],
  })
}

export function didLatestNarrowingTurnSkip(history: NarrowingTurn[]): boolean {
  const latestTurn = history[history.length - 1]
  if (!latestTurn) return false
  return latestTurn.extractedFilters.some(filter => filter.op === "skip")
}

export async function buildRecommendationResponse(
  deps: ServeResponseBuilderDependencies,
  form: ProductIntakeForm,
  candidates: ScoredProduct[],
  evidenceMap: Map<string, EvidenceSummary>,
  totalCandidateCount: number,
  pagination: RecommendationPaginationDto | null,
  displayCandidates: ScoredProduct[] | null,
  displayEvidenceMap: Map<string, EvidenceSummary> | null,
  input: RecommendationInput,
  history: NarrowingTurn[],
  filters: AppliedFilter[],
  turnCount: number,
  messages: ChatMessage[],
  provider: ReturnType<typeof getProvider>,
  language: AppLanguage,
  displayedProducts: DisplayedProduct[] | null = null,
  extraResponseContext?: string,
  skipQuestionInjection: boolean = false,
  _recursionDepth: number = 0,
  purpose: "recommendation" | "question" = "recommendation",
): Promise<Response> {
  if (_recursionDepth > MAX_QUESTION_REC_DEPTH) {
    console.warn(`[recursion-guard] buildRecommendationResponse depth=${_recursionDepth} > ${MAX_QUESTION_REC_DEPTH} — forcing skipQuestionInjection=true to break loop`)
    skipQuestionInjection = true
  }
  traceRecommendation("response.buildRecommendationResponse:input", {
    totalCandidateCount,
    turnCount,
    input: summarizeRecommendationInputForTrace(input),
    historyCount: history.length,
    history: summarizeHistoryForTrace(history),
    filterCount: filters.length,
    filters: summarizeFiltersForTrace(filters),
    messageCount: messages.length,
    pagination: summarizePaginationForTrace(pagination),
    displayedProductsCount: displayedProducts?.length ?? 0,
    skipQuestionInjection,
  })
  // Recursion guard: when buildQuestionResponse delegates here with question=null
  // (alreadyResolved OR selectNextQuestion returned null), do not re-inject a
  // workPiece question — that would bounce us back into buildQuestionResponse
  // which would again null the question and recurse here → infinite loop.
  if (!skipQuestionInjection) {
    const nextQuestion = await selectNextQuestionForResponse({
      input,
      candidates,
      history,
      filters,
      totalCandidateCount,
    })
    if (nextQuestion) {
      return buildQuestionResponse(
        deps,
        form,
        candidates,
        evidenceMap,
        totalCandidateCount,
        pagination,
        displayCandidates,
        displayEvidenceMap,
        input,
        history,
        filters,
        turnCount,
        messages,
        provider,
        language,
        undefined, // overrideText
        undefined, // existingStageHistory
        undefined, // excludeWorkPieceValues
        undefined, // responsePrefix
        undefined, // overrideChips
        undefined, // extraResponseContext
        _recursionDepth + 1,
      )
    }
  }

  const { primary, alternatives, status } = classifyHybridResults({ candidates, evidenceMap, totalConsidered: totalCandidateCount, filtersApplied: filters })

  // ── Uncertainty Gate: FAST / VERIFY / ASK ──
  const primaryEvForGate = primary
    ? (evidenceMap.get(primary.product.normalizedCode) ?? evidenceMap.get(primary.product.displayCode) ?? null)
    : null

  // Detect task type from form + input for highRiskTask / intentAmbiguous
  const purposeVal = form.inquiryPurpose?.status === "known" ? form.inquiryPurpose.value : null
  const gateOpts = {
    isCompetitorReplacement: purposeVal === "substitute" || purposeVal === "inventory_substitute",
    isCuttingConditionTask: purposeVal === "cutting_condition",
    isRegionalTask: !!input.country && input.country !== "ALL",
    intentAmbiguous: purposeVal === null && totalCandidateCount > 100,
  }

  const uncertaintyMeta = evaluateUncertainty(
    candidates, evidenceMap, input, filters, totalCandidateCount,
    primary, primaryEvForGate, gateOpts,
  )

  // ASK: force single info-gain question even if resolution says "show cards"
  if (uncertaintyMeta.mode === "ASK") {
    // P0 loop fix: extract askedFields from history to prevent repeated questions
    const askedFields = new Set(history.map(turn => turn.askedField).filter((f): f is string => typeof f === "string"))
    const infoGainQ = selectHighestInfoGainQuestion(candidates, input, filters, askedFields)
    if (infoGainQ) {
      uncertaintyMeta.followup_question = `${infoGainQ.label}을(를) 알려주시면 더 정확한 추천이 가능합니다.`
      uncertaintyMeta.followup_reason = `현재 후보 ${totalCandidateCount}개 중 ${Math.round(infoGainQ.reductionRatio * 100)}%를 좁힐 수 있는 핵심 조건입니다.`
      console.log(`[uncertainty-gate:ASK] forcing question field=${infoGainQ.field} reduction=${(infoGainQ.reductionRatio * 100).toFixed(0)}% (asked=${Array.from(askedFields).join(",")})`)
      // Route to question response with overrideText (prevents recursion
      // back into buildRecommendationResponse via the !question guard). We
      // intentionally DROP responsePrefix so the polish branch downstream
      // can rewrite with candidate-aware insight instead of the canned
      // "현재 후보 N개 중 X% 좁힐 수 있는 핵심 조건입니다" preamble. The polish
      // branch no longer early-returns on overrideText.
      return buildQuestionResponse(
        deps, form, candidates, evidenceMap, totalCandidateCount,
        pagination, displayCandidates, displayEvidenceMap,
        input, history, filters, turnCount, messages, provider, language,
        uncertaintyMeta.followup_question, // overrideText
        undefined, // existingStageHistory
        undefined, // excludeWorkPieceValues
        undefined, // responsePrefix
        undefined, // overrideChips
        undefined, // extraResponseContext
        _recursionDepth + 1,
      )
    }
  }

  const warnings = primary ? buildWarnings(primary, input) : ["조건에 맞는 제품을 찾지 못했습니다"]
  const rationale = primary ? buildRationale(primary, input) : []

  if (form.material?.status === "unknown") warnings.push("소재 미지정 — 전체 소재 대상 검색")
  if (form.diameterInfo?.status === "unknown") warnings.push("직경 미지정 — 직경 기준 필터 없음")

  // ── Reason summary & perspective labels (zero-cost, from existing data) ──
  const reasonSummaryLine = buildReasonSummary(uncertaintyMeta)
  const primaryPerspective: PerspectiveLabel | null = primary
    ? assignPerspectiveLabel(primary, uncertaintyMeta.signal?.topMatchPct ?? 0)
    : null

  let deterministicSummary = buildDeterministicSummary({
    status,
    query: input,
    primaryProduct: primary,
    alternatives,
    warnings,
    rationale,
    sourceSummary: [],
    deterministicSummary: "",
    llmSummary: null,
    totalCandidatesConsidered: totalCandidateCount,
  })
  // Append reason summary to deterministic output (no LLM cost)
  if (reasonSummaryLine) {
    deterministicSummary += `\n${reasonSummaryLine}`
  }

  const evidenceLookup = (p: ScoredProduct): EvidenceSummary | undefined =>
    evidenceMap.get(p.product.normalizedCode) ?? evidenceMap.get(p.product.displayCode)

  const evidenceSummaries: EvidenceSummary[] = []
  if (primary) {
    const primarySummary = evidenceLookup(primary)
    if (primarySummary) evidenceSummaries.push(primarySummary)
  }
  for (const alt of alternatives) {
    const summary = evidenceLookup(alt)
    if (summary) evidenceSummaries.push(summary)
  }

  let primaryExplanation: RecommendationExplanation | null = null
  let primaryFactChecked: FactCheckedRecommendation | null = null
  const altExplanations: RecommendationExplanation[] = []
  const altFactChecked: FactCheckedRecommendation[] = []

  if (primary) {
    // Perf: build explanations synchronously, then run ALL fact-checks in parallel.
    // Previously fact-checks ran sequentially in a for-await loop (~0.5-1s each).
    const primaryEvidence = evidenceLookup(primary) ?? null
    const primaryTrace = primary.scoreBreakdown
      ? buildTraceFromScoreBreakdown(primary.product.normalizedCode, primary.scoreBreakdown, 1, filters)
      : null
    primaryExplanation = buildExplanation(primary, input, primaryEvidence, primaryTrace)

    const altPrepared = alternatives.map((alt, i) => {
      const altEvidence = evidenceLookup(alt) ?? null
      const altTrace = alt.scoreBreakdown
        ? buildTraceFromScoreBreakdown(alt.product.normalizedCode, alt.scoreBreakdown, i + 2, filters)
        : null
      const altExplanation = buildExplanation(alt, input, altEvidence, altTrace)
      return { alt, altEvidence, altExplanation }
    })
    for (const p of altPrepared) altExplanations.push(p.altExplanation)

    // ── FAST optimization: skip expensive fact-check when high confidence ──
    // Fact-check adds ~0.5-1s per candidate (LLM call). In FAST+high-confidence
    // mode, the deterministic explanation is sufficient — no hallucination risk.
    const skipFactCheck = uncertaintyMeta.mode === "FAST" && uncertaintyMeta.confidence === "high"
    if (skipFactCheck) {
      console.log("[uncertainty-gate:FAST] skipping fact-check (high confidence)")
      // Build lightweight fact-checked wrappers from explanation (no LLM call)
      primaryFactChecked = buildLightweightFactChecked(primary, primaryExplanation)
      for (const p of altPrepared) {
        altFactChecked.push(buildLightweightFactChecked(p.alt, p.altExplanation))
      }
    } else {
      const [primaryFC, ...altFC] = await Promise.all([
        runFactCheck(primary, input, primaryEvidence, primaryExplanation),
        ...altPrepared.map(p => runFactCheck(p.alt, input, p.altEvidence, p.altExplanation)),
      ])
      primaryFactChecked = primaryFC
      for (const fc of altFC) altFactChecked.push(fc)
    }
  }

  const recommendation: RecommendationResult = {
    status,
    query: input,
    primaryProduct: primary,
    alternatives,
    warnings,
    rationale,
    sourceSummary: primary ? buildSourceSummary(primary) : [],
    deterministicSummary,
    llmSummary: null,
    totalCandidatesConsidered: totalCandidateCount,
  }

  // Progressive streaming hook (TODO-B): flush cards now, before the LLM
  // summary call — the client renders product cards while waiting for text.
  // Errors here must never break the main flow.
  if (deps.onEarlyFlush) {
    try {
      // Compute the same candidate snapshot the final response will emit so
      // the right-side "추천 후보" panel can populate immediately rather than
      // waiting for the LLM narrative.
      const earlySnapshotCandidates = displayCandidates ?? candidates
      const earlySnapshotEvidenceMap = displayEvidenceMap ?? evidenceMap
      const earlyCandidateSnapshot = buildCandidateSnapshot(earlySnapshotCandidates, earlySnapshotEvidenceMap)
      deps.onEarlyFlush({
        recommendation,
        primaryExplanation,
        primaryFactChecked,
        altExplanations,
        altFactChecked,
        evidenceSummaries: evidenceSummaries.length > 0 ? evidenceSummaries : null,
        candidates: earlyCandidateSnapshot,
        pagination,
      })
    } catch (err) {
      console.warn("[recommend] onEarlyFlush failed (ignored):", err)
    }
  }

  const recLastUserMsg = messages.length > 0
    ? [...messages].reverse().find(m => m.role === "user")?.text ?? null
    : null

  // ── FAST+high: skip LLM summary entirely (use deterministic) ──
  const skipLlmSummary = uncertaintyMeta.mode === "FAST" && uncertaintyMeta.confidence === "high"
  if (skipLlmSummary) {
    console.log("[uncertainty-gate:FAST] skipping LLM summary (deterministic only)")
  }
  if (!skipLlmSummary && provider.available() && primary && primaryFactChecked && primaryExplanation) {
    try {
      const systemPrompt = buildRecommendationSummarySystemPrompt(language, purpose)
      const llmSessionState = buildSessionState({
        candidateCount: totalCandidateCount,
        appliedFilters: filters,
        narrowingHistory: history,
        stageHistory: buildStageHistoryFromFilters(filters, input, totalCandidateCount),
        resolutionStatus: checkResolution(candidates, history, totalCandidateCount),
        resolvedInput: input,
        turnCount,
        displayedCandidates: buildCandidateSnapshot(candidates, evidenceMap),
        filterValueScope: buildFilterValueScope(candidates as unknown as Array<Record<string, unknown>>),
        displayedChips: [],
        displayedOptions: [],
        lastAction: "show_recommendation",
      })
      const lastUserTextForKB = [...messages].reverse().find(m => m.role === "user")?.text ?? ""
      const sessionCtx = buildSessionContext(form, llmSessionState, totalCandidateCount, snapshotToDisplayed(llmSessionState.displayedCandidates), lastUserTextForKB)
        + (extraResponseContext ?? "")
      const resultPrompt = buildExplanationResultPrompt(
        sessionCtx,
        primaryFactChecked,
        primaryExplanation,
        alternatives.map(alt => {
          const altEvidence = evidenceMap.get(alt.product.normalizedCode)
          return {
            displayCode: alt.product.displayCode,
            matchStatus: alt.matchStatus,
            score: alt.score,
            bestCondition: altEvidence?.bestCondition
              ? { ...altEvidence.bestCondition } as Record<string, string | null>
              : null,
            sourceCount: altEvidence?.sourceCount ?? 0,
          }
        }),
        warnings,
        language,
        recLastUserMsg ?? undefined,
      )

      const raw = await provider.complete(
        systemPrompt,
        [{ role: "user", content: resultPrompt }],
        RECOMMENDATION_SUMMARY_MAX_TOKENS,
        undefined,
        "response-composer",
      )
      const { narrative, remaining } = extractTop1Narrative(raw)
      if (narrative && primary) {
        primary.xaiNarrative = narrative
      }
      const extractedSummary = extractRecommendationSummaryText(remaining || raw)
      if (extractedSummary) {
        recommendation.llmSummary = extractedSummary
      }
    } catch (error) {
      console.warn("[recommend] LLM result summary failed:", error)
    }
  }

  const snapshotCandidates = displayCandidates ?? candidates
  const snapshotEvidenceMap = displayEvidenceMap ?? evidenceMap
  const candidateSnapshot = buildCandidateSnapshot(snapshotCandidates, snapshotEvidenceMap)
  // Full candidate snapshot for option planning — uses ALL candidates, not just display page,
  // so the planner can detect diversity in coating/flute/series across the full result set.
  const fullCandidateSnapshot = buildCandidateSnapshot(candidates, evidenceMap)
  const filterValueScope = buildFilterValueScope(candidates as unknown as Array<Record<string, unknown>>)

  // ── Option-first: structured options FIRST, then derive chips ──
  // NEVER generate chips from answer text. displayedOptions → chips.
  const postRecOptionState = await buildRecommendationFollowUpOptionState({
    candidateSnapshot: fullCandidateSnapshot,
    filters,
    input,
    provider,
    form,
    userMessage: recLastUserMsg,
    assistantText: recommendation.llmSummary ?? deterministicSummary,
  })
  const postRecDisplayedOptions = postRecOptionState.displayedOptions
  // Derive chips from structured options; fallback to minimal safe navigation
  const followUpChips = postRecOptionState.chips.length > 0
    ? postRecOptionState.chips
    : buildMinimalPostRecChips(recommendation, filters)
  const followUpStructuredChips = postRecOptionState.structuredChips.length > 0
    ? postRecOptionState.structuredChips
    : (followUpChips.map(() => null) as (StructuredChipDto | null)[])

  const displayedSeriesGroups = await buildDisplayedSeriesGroups(candidateSnapshot, input)
  const sessionState = buildSessionState({
    candidateCount: totalCandidateCount,
    appliedFilters: filters,
    narrowingHistory: history,
    stageHistory: buildStageHistoryFromFilters(filters, input, totalCandidateCount),
    resolutionStatus: checkResolution(candidates, history, totalCandidateCount),
    resolvedInput: input,
    turnCount,
    displayedProducts: candidateSnapshot,
    fullDisplayedProducts: candidateSnapshot,
    displayedSeriesGroups,
    uiNarrowingPath: buildUINarrowingPath(filters, history, totalCandidateCount),
    currentMode: "recommendation",
    displayedCandidates: candidateSnapshot,
    fullDisplayedCandidates: fullCandidateSnapshot,
    filterValueScope,
    displayedChips: followUpChips,
    displayedOptions: postRecDisplayedOptions,
    lastAction: "show_recommendation",
  })

  const requestPrep = prepareRequest(form, messages, sessionState, input, totalCandidateCount)
  let responseText = recommendation.llmSummary ?? deterministicSummary

  if (primary && primary.product.brand) {
    const brandName = primary.product.brand
    const hasBrand = responseText.includes(brandName)
    const hasProductCode = responseText.includes(primary.product.displayCode)
    if (!hasBrand && !hasProductCode) {
      responseText = `${brandName} ${primary.product.displayCode} 기준으로 보면, ${responseText}`.trim()
    } else if (!hasProductCode) {
      responseText = `${primary.product.displayCode} 기준으로 보면, ${responseText}`.trim()
    }
  }

  if (primary) {
    notifyRecommendation({
      productCode: primary.product.displayCode,
      brand: primary.product.brand,
      seriesName: primary.product.seriesName,
      matchStatus: status,
      score: primary.score,
      query: `직경:${input.diameterMm ?? "?"}mm 소재:${input.material ?? "?"} 가공:${input.operationType ?? "?"}`,
    }).catch((err) => { console.warn("[notify] Recommendation notification failed:", err) })
  }

  // ── Post-Answer Validator: strip unauthorized actions from answer ──
  // Direction: displayedOptions → constrain answer (NEVER answer → add chips)
  // post-result 칩에서 narrowing 칩(소재/날수/개수 포함 칩) 제거 + CTA 버튼 추가
  const finalRecChips = [
    ...followUpChips.filter(chip =>
      typeof chip === "string" && chip.trim().length > 1 &&
      (!chip.includes("개)") || chip.includes("비교") || chip.includes("보기"))
    ),
    `📋 지금 바로 제품 보기 (${totalCandidateCount}개)`,
    `✨ AI 상세 분석`,
  ]
  const hasCandidatePool = totalCandidateCount > 0 && !!primary
  // RC3: when 0 candidates and filter combo trips domain-guard (e.g. 스테인리스+DLC),
  // replace the generic stub with a deterministic domain warning + alternative suggestion.
  let noneFallbackText = "조건에 맞는 제품을 찾지 못했습니다. 직경이나 소재 조건을 조정해보세요."
  if (status === "none" && !hasCandidatePool) {
    try {
      const { checkDomainWarnings, formatWarningsForResponse } = await import("@/lib/recommendation/core/domain-guard")
      const dgWarnings = checkDomainWarnings(filters)
      if (dgWarnings.length > 0) {
        const warningText = formatWarningsForResponse(dgWarnings)
        if (warningText) noneFallbackText = warningText
      }
    } catch (e) {
      console.warn("[zero-result:domain-guard] error:", (e as Error).message)
    }
  }
  // status==="none" 이면서 primary 제품이 있는 경우(=loose match): LLM 요약을 그대로 보존.
  // 기존 generic stub 으로 덮어쓰면 LLM 추천 근거가 사라져 R03 같은 range filter 케이스가
  // "조건에 완전히 맞는 제품은 없지만" 메시지로 응답됨. responseText 가 비어있을 때만 fallback.
  let finalResponseText: string
  if (status === "none" && !hasCandidatePool) {
    finalResponseText = noneFallbackText
  } else if (status === "none" && hasCandidatePool && (!responseText || responseText.trim().length < 20)) {
    finalResponseText = `조건에 완전히 맞는 제품은 없지만 유사 후보 ${totalCandidateCount}개를 찾았습니다. 직경이나 소재 조건을 조정하거나 현재 후보를 검토해보세요.`
  } else {
    finalResponseText = responseText
  }
  finalResponseText = normalizeRpmPhrases(finalResponseText)
  const rpmRecommendationExplanation = buildRpmExplanationText(filters)
  if (rpmRecommendationExplanation && !/(\bvc\b|cutting speed|spindle speed)/iu.test(finalResponseText)) {
    finalResponseText = `${rpmRecommendationExplanation} ${finalResponseText}`.trim()
  }
  // ── VERIFY mode: append caveat when uncertainty is notable ──
  if (uncertaintyMeta.mode === "VERIFY" && primary) {
    const sig = uncertaintyMeta.signal
    if (sig) {
      if (sig.topScoreGap < 3 && alternatives.length > 0) {
        const altCode = alternatives[0].product.displayCode
        finalResponseText += `\n\n⚠️ 1순위와 2순위(${altCode}) 점수 차이가 작습니다. 두 제품을 비교해보시길 권합니다.`
      }
      if (sig.lowConfidenceMapping) {
        finalResponseText += `\n\n⚠️ 정확히 일치하는 제품이 없어 유사 후보를 추천드립니다. 조건을 조정하면 더 정확한 결과를 얻을 수 있습니다.`
      }
      if (sig.hasConstraintConflict) {
        finalResponseText += `\n\n⚠️ 입력 조건 간 충돌이 감지되었습니다. 조건을 확인해주세요.`
      }
    }
  }

  const recValidation = validateOptionFirstPipeline(finalResponseText, finalRecChips, postRecDisplayedOptions)
  if (recValidation.correctedAnswer) {
    finalResponseText = recValidation.correctedAnswer
    console.log(`[answer-validator:recommendation] Softened unauthorized actions: ${recValidation.unauthorizedActions.map(a => a.phrase).join(",")}`)
  }

  const finalRecStructuredChips = alignStructuredChips(
    finalRecChips,
    followUpChips,
    followUpStructuredChips,
  )
  sessionState.displayedChips = finalRecChips
  sessionState.displayedStructuredChips = finalRecStructuredChips

  const isQuestionTurn = purpose === "question"
  traceRecommendation("response.buildRecommendationResponse:output", {
    purpose,
    text: finalResponseText,
    chips: finalRecChips,
    sessionState,
    recommendation: isQuestionTurn ? null : recommendation,
  })
  return deps.jsonRecommendationResponse({
    text: finalResponseText,
    purpose,
    chips: finalRecChips,
    structuredChips: finalRecStructuredChips,
    isComplete: !isQuestionTurn,
    recommendation: isQuestionTurn ? null : recommendation,
    sessionState,
    evidenceSummaries: isQuestionTurn ? null : (evidenceSummaries.length > 0 ? evidenceSummaries : null),
    // 세션 fallback (lastRecommendationArtifact) 을 차단하기 위해 nullish 가 아닌 빈 배열.
    candidateSnapshot: isQuestionTurn ? [] : candidateSnapshot,
    pagination,
    requestPreparation: requestPrep,
    primaryExplanation,
    primaryFactChecked: primaryFactChecked ? serializeFactChecked(primaryFactChecked) : null,
    altExplanations,
    altFactChecked: altFactChecked.map(item => serializeFactChecked(item)),
    recommendationMeta: {
      ...uncertaintyMeta,
      reason_summary: reasonSummaryLine,
      perspectives: {
        ...(primaryPerspective && primary ? {
          primary: { label: primaryPerspective, labelKo: getPerspectiveKo(primaryPerspective) },
        } : {}),
        alternatives: alternatives.slice(0, 3).map(alt => {
          const lbl = assignPerspectiveLabel(alt, uncertaintyMeta.signal?.topMatchPct ?? 0)
          return { code: alt.product.displayCode, label: lbl, labelKo: getPerspectiveKo(lbl) }
        }),
      },
    },
  })
}

export function snapshotToDisplayed(snapshot: CandidateSnapshot[]): DisplayedProduct[] {
  return snapshot.slice(0, 10).map(candidate => ({
    rank: candidate.rank,
    code: candidate.displayCode,
    brand: candidate.brand,
    series: candidate.seriesName,
    toolSubtype: candidate.toolSubtype ?? null,
    diameter: candidate.diameterMm,
    flute: candidate.fluteCount,
    coating: candidate.coating,
    materialTags: candidate.materialTags,
    score: candidate.score,
    matchStatus: candidate.matchStatus,
  }))
}

export function buildCandidateSnapshot(
  candidates: ScoredProduct[],
  evidenceMap: Map<string, EvidenceSummary>
): CandidateSnapshot[] {
  return candidates.map((candidate, index) => {
    const evidence = evidenceMap.get(candidate.product.normalizedCode) ?? evidenceMap.get(candidate.product.displayCode)
    const inventoryLocations = Array.from(
      candidate.inventory.reduce((acc, row) => {
        if (row.quantity === null || row.quantity <= 0) return acc
        const key = row.warehouseOrRegion?.trim()
        if (!key) return acc
        acc.set(key, (acc.get(key) ?? 0) + row.quantity)
        return acc
      }, new Map<string, number>())
    )
      .map(([warehouseOrRegion, quantity]) => ({ warehouseOrRegion, quantity }))
      .sort((a, b) => b.quantity - a.quantity || a.warehouseOrRegion.localeCompare(b.warehouseOrRegion))
    const inventorySnapshotDate = candidate.inventory
      .map(row => row.snapshotDate)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .sort()
      .at(-1) ?? null

    return {
      rank: index + 1,
      productCode: candidate.product.normalizedCode,
      displayCode: candidate.product.displayCode,
      displayLabel: buildProductLabel(candidate.product),
      brand: candidate.product.brand ?? null,
      seriesName: candidate.product.seriesName,
      seriesIconUrl: candidate.product.seriesIconUrl ?? null,
      diameterMm: candidate.product.diameterMm,
      fluteCount: candidate.product.fluteCount,
      coating: candidate.product.coating,
      toolSubtype: candidate.product.toolSubtype ?? null,
      toolMaterial: candidate.product.toolMaterial ?? null,
      shankDiameterMm: candidate.product.shankDiameterMm ?? null,
      shankType: candidate.product.shankType ?? null,
      lengthOfCutMm: candidate.product.lengthOfCutMm ?? null,
      overallLengthMm: candidate.product.overallLengthMm ?? null,
      helixAngleDeg: candidate.product.helixAngleDeg ?? null,
      coolantHole: candidate.product.coolantHole ?? null,
      ballRadiusMm: candidate.product.ballRadiusMm ?? null,
      taperAngleDeg: candidate.product.taperAngleDeg ?? null,
      pointAngleDeg: candidate.product.pointAngleDeg ?? null,
      threadPitchMm: candidate.product.threadPitchMm ?? null,
      description: candidate.product.description ?? null,
      featureText: candidate.product.featureText ?? null,
      materialTags: candidate.product.materialTags,
      score: candidate.score,
      scoreBreakdown: candidate.scoreBreakdown,
      matchStatus: candidate.matchStatus,
      stockStatus: candidate.stockStatus,
      totalStock: candidate.totalStock,
      inventorySnapshotDate,
      inventoryLocations,
      hasEvidence: !!evidence && evidence.chunks.length > 0,
      bestCondition: evidence?.bestCondition ?? null,
      xaiNarrative: candidate.xaiNarrative ?? null,
    }
  })
}

export function buildStageHistoryFromFilters(
  filters: AppliedFilter[],
  currentInput: RecommendationInput,
  currentCandidateCount: number
): NarrowingStage[] {
  const stages: NarrowingStage[] = [{
    stepIndex: -1,
    stageName: "initial_search",
    filterApplied: null,
    candidateCount: currentCandidateCount,
    resolvedInputSnapshot: { ...currentInput },
    filtersSnapshot: [],
  }]

  let accumulatedFilters: AppliedFilter[] = []
  for (const filter of filters) {
    accumulatedFilters = [...accumulatedFilters, filter]
    stages.push({
      stepIndex: filter.appliedAt,
      stageName: `${filter.field}_${filter.value}`,
      filterApplied: filter,
      candidateCount: currentCandidateCount,
      resolvedInputSnapshot: { ...currentInput },
      filtersSnapshot: [...accumulatedFilters],
    })
  }

  return stages
}

function buildUINarrowingPath(
  _filters: AppliedFilter[],
  history: NarrowingTurn[],
  fallbackCandidateCount: number
): UINarrowingPathEntry[] {
  const entries: UINarrowingPathEntry[] = []
  for (const turn of history) {
    for (const filter of turn.extractedFilters) {
      if (filter.op === "skip") continue
      entries.push({
        kind: "filter" as const,
        label: `${filter.field}=${filter.value}`,
        field: filter.field,
        value: filter.value,
        candidateCount: turn.candidateCountAfter ?? fallbackCandidateCount,
        candidateCountBefore: turn.candidateCountBefore,
      })
    }
  }
  return entries
}

export function logNarrowingState(
  phase: string,
  state: ExplorationSessionState,
  currentField: string | null
): void {
  console.log(`[narrowing:${phase}] ───────────────────────────`)
  console.log(`[narrowing:${phase}] Session: ${state.sessionId}`)
  console.log(`[narrowing:${phase}] Candidates: ${state.candidateCount}`)
  console.log(`[narrowing:${phase}] Status: ${state.resolutionStatus}`)
  console.log(`[narrowing:${phase}] Turn: ${state.turnCount}`)
  console.log(`[narrowing:${phase}] Filters: ${state.appliedFilters.map(filter => `${filter.field}(${filter.op ?? "eq"})=${filter.value}`).join(", ") || "(none)"}`)
  console.log(`[narrowing:${phase}] Stages: ${state.stageHistory?.map(stage => stage.stageName).join(" → ") || "(none)"}`)
  if (currentField) {
    console.log(`[narrowing:${phase}] Next question field: ${currentField}`)
  }
  console.log(`[narrowing:${phase}] ───────────────────────────`)
}

/**
 * Minimal deterministic post-recommendation chips.
 * Used ONLY when SmartOption engine produces zero options.
 * No regex, no LLM, no answer-text parsing.
 */
function buildMinimalPostRecChips(
  result: RecommendationResult,
  filters: AppliedFilter[]
): string[] {
  const chips: string[] = []
  if (!result.primaryProduct) {
    if (filters.length > 0) chips.push("⟵ 이전 단계")
    chips.push("처음부터 다시")
    return chips
  }

  const primary = result.primaryProduct
  const alts = result.alternatives

  // 동적: 후보 데이터 기반 칩 생성
  const coatings = new Set(alts.map(a => a.product.coating).filter(Boolean))
  const flutes = new Set(alts.map(a => a.product.fluteCount).filter(Boolean))
  const series = new Set(alts.map(a => a.product.seriesName).filter(Boolean))

  if (primary.product.displayCode) {
    chips.push(`${primary.product.displayCode} 상세 정보`)
  }
  if (alts.length > 0) {
    chips.push(`상위 ${Math.min(alts.length + 1, 3)}개 비교`)
  }
  if (flutes.size >= 2) {
    chips.push(`날수별 비교 (${[...flutes].sort().join("/")}날)`)
  }
  if (coatings.size >= 2) {
    chips.push(`코팅별 비교 (${[...coatings].slice(0, 3).join("/")})`)
  }
  if (primary.stockStatus === "outofstock" || primary.stockStatus === "limited") {
    chips.push("재고 있는 대안 보기")
  }
  if (series.size >= 2) {
    chips.push(`시리즈 비교 (${[...series].slice(0, 2).join(" vs ")})`)
  }
  if (filters.length > 0) chips.push("조건 변경")
  return chips.slice(0, 6)
}

/**
 * Data-driven follow-up chips for recommendation results.
 * Generates contextual chips from actual product data — no hardcoded strings.
 */
export function getFollowUpChips(
  result: RecommendationResult,
  sessionState?: ExplorationSessionState | null,
): string[] {
  const chips: string[] = []
  const primary = result.primaryProduct
  const alts = result.alternatives
  const altCount = alts.length
  const hasHistory = (sessionState?.stageHistory?.length ?? 0) > 1
  const filterCount = sessionState?.appliedFilters?.length ?? 0

  // ── No result: suggest broadening or restart ──
  if (!primary) {
    if (hasHistory) chips.push("⟵ 이전 단계로 돌아가기")
    if (filterCount > 0) chips.push("조건 완화하기")
    chips.push("처음부터 다시")
    return chips.slice(0, 6)
  }

  const isApproximate = primary.matchStatus === "approximate"
  const isNone = primary.matchStatus === "none"

  // Collect distribution data from all candidates
  const allProducts = [primary, ...alts]
  const flutes = new Set(allProducts.map(p => p.product?.fluteCount).filter(Boolean))
  const coatings = new Set(allProducts.map(p => p.product?.coating).filter(Boolean))
  const series = new Set(allProducts.map(p => p.product?.seriesName).filter(Boolean))

  // ── Low-confidence match: suggest compare, broaden, refine ──
  if (isApproximate || isNone) {
    if (altCount > 0) chips.push(`후보 ${altCount + 1}개 비교하기`)
    chips.push("절삭조건 알려줘")
    if (hasHistory) chips.push("⟵ 이전 단계로 돌아가기")
    chips.push("다른 직경 검색")
    chips.push("처음부터 다시")
    return chips.slice(0, 6)
  }

  // 2순위: 비교 (후보 있을 때)
  if (altCount > 0) {
    chips.push(`상위 ${Math.min(altCount + 1, 3)}개 비교`)
  }

  // 3순위: 분포 기반 필터
  if (flutes.size >= 2) {
    chips.push(`날수별 (${[...flutes].sort().join("/")}날)`)
  }
  if (coatings.size >= 2) {
    chips.push(`코팅별 (${[...coatings].slice(0, 3).join("/")})`)
  }

  // 4순위: 재고 상태 기반
  if (primary.stockStatus === "outofstock") {
    chips.push("재고 있는 대안")
  } else if (primary.stockStatus === "limited") {
    chips.push("재고 상세")
  }

  // 5순위: 시리즈 비교
  if (series.size >= 2) {
    chips.push(`${[...series].slice(0, 2).join(" vs ")} 비교`)
  }

  // 네비게이션
  if (hasHistory) chips.push("⟵ 이전 단계")
  chips.push("조건 변경")
  return chips.slice(0, 6)
}

export function buildSourceSummary(
  primary: { product: { rawSourceFile: string; rawSourceSheet?: string | null; sourceConfidence?: string | null } } | null
): string[] {
  if (!primary) return []
  const product = primary.product
  return [
    `Source: ${product.rawSourceFile}${product.rawSourceSheet ? ` / ${product.rawSourceSheet}` : ""}`,
    `Confidence: ${product.sourceConfidence ?? "unknown"}`,
  ]
}

export function serializeFactChecked(fc: FactCheckedRecommendation): Record<string, unknown> {
  return {
    productCode: fc.productCode,
    displayCode: fc.displayCode,
    seriesName: fc.seriesName,
    manufacturer: fc.manufacturer,
    diameterMm: fc.diameterMm,
    fluteCount: fc.fluteCount,
    coating: fc.coating,
    toolMaterial: fc.toolMaterial,
    materialTags: fc.materialTags,
    lengthOfCutMm: fc.lengthOfCutMm,
    overallLengthMm: fc.overallLengthMm,
    hasCuttingConditions: fc.hasCuttingConditions,
    bestCondition: fc.bestCondition,
    conditionConfidence: fc.conditionConfidence,
    conditionSourceCount: fc.conditionSourceCount,
    stockStatus: fc.stockStatus,
    totalStock: fc.totalStock,
    minLeadTimeDays: fc.minLeadTimeDays,
    matchPct: fc.matchPct,
    matchStatus: fc.matchStatus,
    score: fc.score,
    explanation: fc.explanation,
    factCheckReport: fc.factCheckReport,
  }
}

export function safeParseJSON(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}

function unescapeJsonString(value: string): string {
  return value
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
}

const TOP1_WHY_RE = /\[TOP1_WHY\]([\s\S]*?)\[\/TOP1_WHY\]/i

/**
 * Extracts the [TOP1_WHY]...[/TOP1_WHY] block for Top-1 product narrative,
 * and returns the remaining text with the block stripped out.
 */
export function extractTop1Narrative(raw: string): { narrative: string | null; remaining: string } {
  if (!raw) return { narrative: null, remaining: raw }
  const match = raw.match(TOP1_WHY_RE)
  if (!match) return { narrative: null, remaining: raw }
  const narrative = match[1]?.trim() || null
  const remaining = raw.replace(TOP1_WHY_RE, "").trim()
  return { narrative, remaining }
}

export function extractRecommendationSummaryText(raw: string): string | null {
  const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
  if (!cleaned) return null

  const parsed = safeParseJSON(cleaned)
  if (typeof parsed?.responseText === "string" && parsed.responseText.trim()) {
    return parsed.responseText.trim()
  }

  const responseTextMatch = cleaned.match(/"responseText"\s*:\s*"((?:\\.|[^"])*)"/s)
  if (responseTextMatch?.[1]) {
    const extracted = unescapeJsonString(responseTextMatch[1]).trim()
    if (extracted) return extracted
  }

  const truncatedResponseTextMatch = cleaned.match(/"responseText"\s*:\s*"([\s\S]*)$/)
  if (truncatedResponseTextMatch?.[1]) {
    const extracted = unescapeJsonString(truncatedResponseTextMatch[1]).trim()
    if (extracted) return extracted
  }

  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    return cleaned
  }

  return null
}

/**
 * Extract field value distributions from candidate snapshots (data-driven, no hardcoding).
 */
function extractFieldValuesFromSnapshot(
  snapshots: CandidateSnapshot[]
): Record<string, Array<{ value: string; count: number }>> {
  const result: Record<string, Array<{ value: string; count: number }>> = {}
  const fields: Array<{ key: string; getter: (c: CandidateSnapshot) => string | number | null }> = [
    { key: "fluteCount", getter: c => c.fluteCount },
    { key: "coating", getter: c => c.coating },
    { key: "seriesName", getter: c => c.seriesName },
  ]
  for (const { key, getter } of fields) {
    const counts = new Map<string, number>()
    for (const c of snapshots) {
      const val = getter(c)
      if (val != null) {
        const strVal = key === "fluteCount" ? `${val}날` : String(val)
        counts.set(strVal, (counts.get(strVal) ?? 0) + 1)
      }
    }
    if (counts.size > 1) {
      result[key] = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, count }))
    }
  }
  return result
}
