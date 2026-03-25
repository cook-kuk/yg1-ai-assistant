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

// ── Field mapping tables ────────────────────────────────────

/** Maps legacy AppliedFilter field names to V2 constraint keys. */
const LEGACY_FIELD_TO_BASE: Record<string, string> = {
  material: "material",
  workPieceName: "materialDetail",
  diameterMm: "diameter",
  toolSubtype: "endType",
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

  const constraints = buildConstraintsFromFilters(legacy.appliedFilters ?? [])
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

function buildConstraintsFromFilters(filters: AppliedFilter[]): ConstraintState {
  const base: Record<string, string | number | boolean> = {}
  const refinements: Record<string, string | number | boolean> = {}

  for (const filter of filters) {
    const raw = filter.rawValue ?? filter.value
    const baseKey = LEGACY_FIELD_TO_BASE[filter.field]
    if (baseKey) {
      base[baseKey] = filter.field === "diameterMm" ? Number(raw) : String(raw)
      continue
    }
    const refKey = LEGACY_FIELD_TO_REFINEMENT[filter.field]
    if (refKey) {
      refinements[refKey] = String(raw)
      continue
    }
    // Unknown fields go into refinements to avoid data loss
    refinements[filter.field] = String(raw)
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
  const filters = buildFiltersFromConstraints(v2.constraints)

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

function buildFiltersFromConstraints(constraints: ConstraintState): AppliedFilter[] {
  const filters: AppliedFilter[] = []

  for (const [key, value] of Object.entries(constraints.base)) {
    const legacyField = BASE_TO_LEGACY_FIELD[key] ?? key
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
    filters.push({
      field: legacyField,
      op: "eq",
      value: String(value),
      rawValue: String(value),
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
