/**
 * Turn Orchestrator V2 — Skeleton
 *
 * 8-step pipeline: snapshot → LLM decision → state transition → search →
 * build surface → validate → write revision → return result.
 *
 * Phase 1: All steps are stubs. Phase 2 will wire real implementations.
 */

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { DisplayedOption } from "@/lib/types/exploration"
import type {
  RecommendationSessionState,
  TurnSnapshot,
  LlmTurnDecision,
  TurnResult,
  CandidateRef,
} from "./types"

// Step 1: Build snapshot from current state + user message
function buildTurnSnapshot(userMessage: string, state: RecommendationSessionState): TurnSnapshot {
  return {
    snapshotId: `snap-${Date.now()}`,
    userMessage,
    journeyPhase: state.journeyPhase,
    constraints: state.constraints,
    pendingQuestion: state.pendingQuestion,
    pendingAction: state.pendingAction,
    latestResultContext: state.resultContext,
    displayedProducts: state.resultContext?.candidates ?? [],
    recentTurns: [],
    revisionSummary: "",
    sideThreadActive: state.sideThreadActive,
  }
}

// Step 2: Get LLM decision (stub - returns safe defaults)
async function getLlmTurnDecision(snapshot: TurnSnapshot, _provider: LLMProvider): Promise<LlmTurnDecision> {
  // TODO: Replace with actual LLM call
  return {
    phaseInterpretation: { currentPhase: snapshot.journeyPhase, confidence: 0.5 },
    actionInterpretation: {
      type: "continue_narrowing",
      rationale: "stub",
      confidence: 0.5,
    },
    answerIntent: {
      topic: "narrowing",
      needsGroundedFact: false,
      shouldUseCurrentResultContext: false,
      shouldResumePendingQuestion: false,
    },
    uiPlan: { optionMode: "question_options" },
    answerDraft: "Processing...",
  }
}

// Step 3: Apply state transition
function applyStateTransition(
  state: RecommendationSessionState,
  decision: LlmTurnDecision
): RecommendationSessionState {
  const next = { ...state }
  next.journeyPhase = decision.phaseInterpretation.currentPhase
  next.turnCount++
  // TODO: Apply ResolvedAction to constraints
  return next
}

// Step 4-5: Search planning + execution (stub)
async function executeSearchIfNeeded(
  _state: RecommendationSessionState,
  _decision: LlmTurnDecision
): Promise<{ candidates: CandidateRef[]; evidenceMap: Map<string, unknown> } | null> {
  // TODO: Wire to hybrid-retrieval.ts
  return null
}

// Step 6: Build surface (displayedOptions → chips → answer)
function buildSurface(
  decision: LlmTurnDecision,
  _state: RecommendationSessionState
): { answer: string; displayedOptions: DisplayedOption[]; chips: string[] } {
  // Surface contract: chips MUST derive from displayedOptions
  const displayedOptions: DisplayedOption[] = []
  const chips = displayedOptions.map((opt) => opt.label)
  return {
    answer: decision.answerDraft,
    displayedOptions,
    chips,
  }
}

// Step 7: Validate surface
function validateSurface(
  surface: { answer: string; displayedOptions: DisplayedOption[]; chips: string[] },
  _decision: LlmTurnDecision
): { answer: string; displayedOptions: DisplayedOption[]; chips: string[]; valid: boolean } {
  // TODO: Wire to option-validator
  return { ...surface, valid: true }
}

// Step 8: Write revision node
function writeRevision(
  state: RecommendationSessionState,
  _decision: LlmTurnDecision
): RecommendationSessionState {
  // TODO: Create RevisionNode and append
  return state
}

// Main orchestrator
export async function orchestrateTurnV2(
  userMessage: string,
  currentState: RecommendationSessionState,
  provider: LLMProvider
): Promise<TurnResult> {
  console.log(`[orchestrator-v2] Starting turn ${currentState.turnCount + 1}`)

  // Step 1: Build snapshot
  const snapshot = buildTurnSnapshot(userMessage, currentState)

  // Step 2: LLM decision
  const decision = await getLlmTurnDecision(snapshot, provider)

  // Step 3: State transition
  const nextState = applyStateTransition(currentState, decision)

  // Step 4-5: Search
  const searchResult = await executeSearchIfNeeded(nextState, decision)

  // Step 6: Build surface
  const surface = buildSurface(decision, nextState)

  // Step 7: Validate
  const validated = validateSurface(surface, decision)

  // Step 8: Write revision
  const finalState = writeRevision(nextState, decision)

  console.log(`[orchestrator-v2] Turn complete: phase=${finalState.journeyPhase}, action=${decision.actionInterpretation.type}`)

  return {
    answer: validated.answer,
    displayedOptions: validated.displayedOptions,
    chips: validated.chips,
    sessionState: finalState,
    trace: {
      snapshotId: snapshot.snapshotId,
      phase: finalState.journeyPhase,
      action: decision.actionInterpretation.type,
      confidence: decision.actionInterpretation.confidence,
      searchExecuted: !!searchResult,
      validated: validated.valid,
    },
  }
}

// Helper: Create initial state
export function createInitialSessionState(): RecommendationSessionState {
  return {
    journeyPhase: "intake",
    constraints: { base: {}, refinements: {} },
    resultContext: null,
    pendingQuestion: null,
    pendingAction: null,
    revisionNodes: [],
    currentRevisionId: null,
    sideThreadActive: false,
    turnCount: 0,
  }
}
