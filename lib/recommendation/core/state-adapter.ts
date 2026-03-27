/**
 * State Adapter — Bidirectional conversion between legacy ExplorationSessionState
 * and V2 RecommendationSessionState.
 *
 * Enables the V2 orchestrator to coexist with the legacy pipeline behind
 * the USE_NEW_ORCHESTRATOR feature flag.
 */

import type {
  ExplorationSessionState,
  AppliedFilter,
  CandidateSnapshot,
  DisplayedOption,
} from "@/lib/types/exploration"
import type {
  RecommendationSessionState,
  ConstraintState,
  CandidateRef,
  ResultContext,
  JourneyPhase,
  PendingQuestion,
} from "./types"
import { createInitialSessionState } from "./turn-orchestrator"
import { buildAppliedFilterFromValue } from "../shared/filter-field-registry"
import type { RecommendationInput } from "../domain/types"

// ── Field mapping tables ────────────────────────────────────

/** Maps legacy AppliedFilter field names to V2 constraint keys. */
const LEGACY_FIELD_TO_BASE: Record<string, string> = {
  material: "material",
  workPieceName: "materialDetail",
  diameterMm: "diameter",
  operation: "operation",
  cuttingType: "operation",
  toolType: "toolType",
  toolSubtype: "endType",
  seriesName: "seriesName",
  brand: "brand",
  country: "country",
}

const LEGACY_FIELD_TO_REFINEMENT: Record<string, string> = {
  fluteCount: "flute",
  coating: "coating",
  toolMaterial: "toolMaterial",
  helixAngleDeg: "helixAngle",
  lengthOfCutMm: "lengthOfCut",
  overallLengthMm: "overallLength",
  shankDiameterMm: "shankDiameter",
}

/** Reverse mapping: V2 constraint key → legacy AppliedFilter field. */
const BASE_TO_LEGACY_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_FIELD_TO_BASE).map(([k, v]) => [v, k])
)

const REFINEMENT_TO_LEGACY_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(LEGACY_FIELD_TO_REFINEMENT).map(([k, v]) => [v, k])
)

// ── Legacy → V2 ────────────────────────────────────────────

export function convertToV2State(
  legacy: ExplorationSessionState | null
): RecommendationSessionState {
  if (!legacy) return createInitialSessionState()

  const constraints = mergeConstraintStates(
    buildConstraintsFromResolvedInput(legacy.resolvedInput),
    buildConstraintsFromFilters(legacy.appliedFilters ?? [])
  )
  const journeyPhase = mapLegacyPhase(legacy)
  const resultContext = buildResultContextFromCandidates(legacy, constraints)
  const pendingQuestion = buildPendingQuestion(legacy)

  return {
    journeyPhase,
    constraints,
    resultContext,
    pendingQuestion,
    pendingAction: legacy.pendingAction ?? null,
    revisionNodes: [],
    currentRevisionId: null,
    sideThreadActive: !!legacy.suspendedFlow,
    turnCount: legacy.turnCount ?? 0,
  }
}

function buildConstraintsFromResolvedInput(input: RecommendationInput | null | undefined): ConstraintState {
  const base: Record<string, string | number | boolean> = {}
  const refinements: Record<string, string | number | boolean> = {}

  if (!input) return { base, refinements }

  if (input.material) base.material = input.material
  if (input.workPieceName) base.materialDetail = input.workPieceName
  if (input.diameterMm != null) base.diameter = input.diameterMm
  if (input.operationType) base.operation = input.operationType
  if (input.toolType) base.toolType = input.toolType
  if (input.toolSubtype) base.endType = input.toolSubtype
  if (input.seriesName) base.seriesName = input.seriesName
  if (input.brand) base.brand = input.brand
  if (input.country && String(input.country).trim().toUpperCase() !== "ALL") {
    base.country = input.country
  }

  if (input.flutePreference != null) refinements.flute = input.flutePreference
  if (input.coatingPreference) refinements.coating = input.coatingPreference
  if (input.toolMaterial) refinements.toolMaterial = input.toolMaterial
  if (input.coolantHole != null) refinements.coolantHole = input.coolantHole
  if (input.helixAngleDeg != null) refinements.helixAngle = input.helixAngleDeg
  if (input.lengthOfCutMm != null) refinements.lengthOfCut = input.lengthOfCutMm
  if (input.overallLengthMm != null) refinements.overallLength = input.overallLengthMm
  if (input.shankDiameterMm != null) refinements.shankDiameter = input.shankDiameterMm
  if (input.ballRadiusMm != null) refinements.ballRadius = input.ballRadiusMm
  if (input.taperAngleDeg != null) refinements.taperAngle = input.taperAngleDeg

  return { base, refinements }
}

function mergeConstraintStates(
  baseState: ConstraintState,
  overrideState: ConstraintState
): ConstraintState {
  return {
    base: {
      ...baseState.base,
      ...overrideState.base,
    },
    refinements: {
      ...baseState.refinements,
      ...overrideState.refinements,
    },
  }
}

function buildConstraintsFromFilters(filters: AppliedFilter[]): ConstraintState {
  const base: Record<string, string | number | boolean> = {}
  const refinements: Record<string, string | number | boolean> = {}

  for (const filter of filters) {
    const raw = filter.rawValue ?? filter.value
    const baseKey = LEGACY_FIELD_TO_BASE[filter.field]
    if (baseKey) {
      base[baseKey] = (
        typeof raw === "number" || typeof raw === "boolean"
          ? raw
          : (filter.field === "diameterMm" ? Number(raw) : String(raw))
      )
      continue
    }
    const refKey = LEGACY_FIELD_TO_REFINEMENT[filter.field]
    if (refKey) {
      refinements[refKey] = typeof raw === "number" || typeof raw === "boolean" ? raw : String(raw)
      continue
    }
    // Unknown fields go into refinements to avoid data loss
    refinements[filter.field] = typeof raw === "number" || typeof raw === "boolean" ? raw : String(raw)
  }

  return { base, refinements }
}

function buildResultContextFromCandidates(
  legacy: ExplorationSessionState,
  constraints: ConstraintState
): ResultContext | null {
  const candidates = legacy.displayedCandidates
  if (!candidates?.length) return null

  const refs: CandidateRef[] = candidates.map((c) => ({
    productCode: c.productCode,
    displayCode: c.displayCode,
    rank: c.rank,
    score: c.score,
    seriesName: c.seriesName,
  }))

  return {
    candidates: refs,
    totalConsidered: legacy.candidateCount ?? candidates.length,
    searchTimestamp: Date.now(),
    constraintsUsed: constraints,
  }
}

function buildPendingQuestion(
  legacy: ExplorationSessionState
): PendingQuestion | null {
  if (!legacy.lastAskedField) return null

  return {
    field: legacy.lastAskedField,
    questionText: "",
    options: legacy.displayedOptions ?? [],
    turnAsked: legacy.turnCount ?? 0,
    context: null,
  }
}

export function mapLegacyPhase(legacy: ExplorationSessionState): JourneyPhase {
  const hasResolved = legacy.resolutionStatus?.startsWith("resolved") ?? false
  const hasDisplayedProducts = (legacy.displayedCandidates?.length ?? 0) > 0
  const isRecMode = legacy.currentMode === "recommendation"

  if (hasResolved || (hasDisplayedProducts && isRecMode)) return "results_displayed"
  if (legacy.lastAskedField) return "narrowing"
  return "intake"
}

// ── V2 → Legacy ────────────────────────────────────────────

export function convertFromV2State(
  v2: RecommendationSessionState,
  prevLegacy: ExplorationSessionState | null
): ExplorationSessionState {
  const filters = buildFiltersFromConstraints(v2.constraints, prevLegacy)

  return {
    ...(prevLegacy ?? createEmptyLegacyShell()),
    appliedFilters: filters,
    lastAskedField: v2.pendingQuestion?.field ?? undefined,
    displayedChips: [],
    displayedOptions: [],
    turnCount: v2.turnCount,
    currentMode: mapV2PhaseToMode(v2.journeyPhase),
    pendingAction: v2.pendingAction,
    suspendedFlow: v2.sideThreadActive
      ? (prevLegacy?.suspendedFlow ?? undefined)
      : undefined,
  } as ExplorationSessionState
}

function getComparableResolvedInputValue(
  resolvedInput: RecommendationInput | null | undefined,
  legacyField: string
): string | number | boolean | null {
  if (!resolvedInput) return null

  switch (legacyField) {
    case "material":
      return resolvedInput.material ?? null
    case "workPieceName":
      return resolvedInput.workPieceName ?? null
    case "diameterMm":
      return resolvedInput.diameterMm ?? null
    case "operation":
    case "cuttingType":
      return resolvedInput.operationType ?? null
    case "toolType":
      return resolvedInput.toolType ?? null
    case "toolSubtype":
      return resolvedInput.toolSubtype ?? null
    case "seriesName":
      return resolvedInput.seriesName ?? null
    case "brand":
      return resolvedInput.brand ?? null
    case "country": {
      const country = resolvedInput.country ?? null
      if (!country) return null
      const normalized = String(country).trim().toUpperCase()
      return normalized === "ALL" ? null : normalized
    }
    case "fluteCount":
      return resolvedInput.flutePreference ?? null
    case "coating":
      return resolvedInput.coatingPreference ?? null
    case "toolMaterial":
      return resolvedInput.toolMaterial ?? null
    case "coolantHole":
      return resolvedInput.coolantHole ?? null
    case "helixAngleDeg":
      return resolvedInput.helixAngleDeg ?? null
    case "lengthOfCutMm":
      return resolvedInput.lengthOfCutMm ?? null
    case "overallLengthMm":
      return resolvedInput.overallLengthMm ?? null
    case "shankDiameterMm":
      return resolvedInput.shankDiameterMm ?? null
    case "ballRadiusMm":
      return resolvedInput.ballRadiusMm ?? null
    case "taperAngleDeg":
      return resolvedInput.taperAngleDeg ?? null
    default:
      return null
  }
}

function normalizeComparableConstraintValue(value: string | number | boolean | null): string {
  if (value == null) return ""
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return String(value).trim().toUpperCase()
}

function shouldMaterializeConstraintAsFilter(
  legacyField: string,
  value: string | number | boolean,
  prevLegacy: ExplorationSessionState | null
): boolean {
  if (legacyField === "country" && normalizeComparableConstraintValue(value) === "ALL") {
    return false
  }

  const previousAppliedFilters = prevLegacy?.appliedFilters ?? []
  if (previousAppliedFilters.some(filter => filter.field === legacyField)) {
    return true
  }

  const resolvedComparable = normalizeComparableConstraintValue(
    getComparableResolvedInputValue(prevLegacy?.resolvedInput, legacyField)
  )
  if (!resolvedComparable) return true

  return resolvedComparable !== normalizeComparableConstraintValue(value)
}

function buildFiltersFromConstraints(
  constraints: ConstraintState,
  prevLegacy: ExplorationSessionState | null
): AppliedFilter[] {
  const filters: AppliedFilter[] = []

  for (const [key, value] of Object.entries(constraints.base)) {
    const legacyField = BASE_TO_LEGACY_FIELD[key] ?? key
    if (!shouldMaterializeConstraintAsFilter(legacyField, value, prevLegacy)) continue
    const filter = buildAppliedFilterFromValue(legacyField, value)
    if (filter) {
      filters.push(filter)
      continue
    }
    filters.push({
      field: legacyField,
      op: "eq",
      value: String(value),
      rawValue: typeof value === "number" ? value : String(value),
      appliedAt: 0,
    })
  }

  for (const [key, value] of Object.entries(constraints.refinements)) {
    const legacyField = REFINEMENT_TO_LEGACY_FIELD[key] ?? key
    if (!shouldMaterializeConstraintAsFilter(legacyField, value, prevLegacy)) continue
    const filter = buildAppliedFilterFromValue(legacyField, value)
    if (filter) {
      filters.push(filter)
      continue
    }
    filters.push({
      field: legacyField,
      op: "eq",
      value: String(value),
      rawValue: typeof value === "number" ? value : String(value),
      appliedAt: 0,
    })
  }

  return filters
}

export function mapV2PhaseToMode(phase: JourneyPhase): string {
  switch (phase) {
    case "intake":
      return "question"
    case "narrowing":
      return "narrowing"
    case "results_displayed":
      return "recommendation"
    case "post_result_exploration":
      return "recommendation"
    case "comparison":
      return "comparison"
    case "revision":
      return "question"
    default:
      return "question"
  }
}

// ── Helpers ────────────────────────────────────────────────

function createEmptyLegacyShell(): Partial<ExplorationSessionState> {
  return {
    sessionId: "",
    candidateCount: 0,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "broad",
    resolvedInput: {} as ExplorationSessionState["resolvedInput"],
    turnCount: 0,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
  }
}
