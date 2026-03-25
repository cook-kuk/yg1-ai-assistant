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
  ResultContext,
  ResolvedAction,
} from "./types"
import { createRevisionNode } from "./constraint-helpers"
import { validateSurfaceV2 } from "./response-validator"
import {
  constraintsToFilters,
  buildResultContext,
  shouldSearch,
} from "./search-adapter"

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

// Step 2: Default decision (fallback on LLM failure)
function getDefaultDecision(snapshot: TurnSnapshot): LlmTurnDecision {
  return {
    phaseInterpretation: { currentPhase: snapshot.journeyPhase, confidence: 0.5 },
    actionInterpretation: {
      type: "continue_narrowing",
      rationale: "fallback",
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

const TURN_DECISION_SYSTEM = "YG-1 cutting tool recommendation turn orchestrator. Return JSON only."

function buildTurnDecisionPrompt(snapshot: TurnSnapshot): string {
  const constraintEntries = [
    ...Object.entries(snapshot.constraints.base).map(([k, v]) => `${k}=${v}`),
    ...Object.entries(snapshot.constraints.refinements).map(([k, v]) => `${k}=${v} (refinement)`),
  ]
  const constraintStr = constraintEntries.length > 0 ? constraintEntries.join(", ") : "none"

  const pendingQ = snapshot.pendingQuestion
    ? `field="${snapshot.pendingQuestion.field}", question="${snapshot.pendingQuestion.questionText.slice(0, 80)}"`
    : "none"

  const pendingA = snapshot.pendingAction
    ? `type="${snapshot.pendingAction.type}", label="${snapshot.pendingAction.label}"`
    : "none"

  const recentTurnsStr = snapshot.recentTurns.length > 0
    ? snapshot.recentTurns.map(t => `${t.role}: ${t.text.slice(0, 60)}`).join("\n")
    : "none"

  const hasResults = snapshot.displayedProducts.length > 0

  return `User: "${snapshot.userMessage}"
Phase: ${snapshot.journeyPhase}
Constraints: ${constraintStr}
PendingQuestion: ${pendingQ}
PendingAction: ${pendingA}
ResultsDisplayed: ${hasResults} (${snapshot.displayedProducts.length} products)
RecentTurns:
${recentTurnsStr}

Decide turn plan as JSON:
{"phaseInterpretation":{"currentPhase":"intake|narrowing|results_displayed|post_result_exploration|comparison|revision","confidence":0.0-1.0},"actionInterpretation":{"type":"continue_narrowing|replace_slot|show_recommendation|go_back|compare_products|answer_general|redirect_off_topic|reset_session|skip_field|ask_clarification","rationale":"...","confidence":0.0-1.0},"answerIntent":{"topic":"...","needsGroundedFact":false,"shouldUseCurrentResultContext":false,"shouldResumePendingQuestion":false},"uiPlan":{"optionMode":"question_options|result_followups|none|comparison_options|no_options"},"nextQuestion":{"field":"...","suggestedOptions":[{"label":"...","value":"..."}],"allowSkip":true},"answerDraft":"..."}`
}

// Step 2: Get LLM decision via Haiku call (falls back to defaults on failure)
async function getLlmTurnDecision(snapshot: TurnSnapshot, provider: LLMProvider): Promise<LlmTurnDecision> {
  const fallback = getDefaultDecision(snapshot)

  if (!provider.available()) {
    return fallback
  }

  try {
    const prompt = buildTurnDecisionPrompt(snapshot)
    const raw = await provider.complete(
      TURN_DECISION_SYSTEM,
      [{ role: "user", content: prompt }],
      500,
      "haiku"
    )

    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
    const p = JSON.parse(cleaned)

    const decision: LlmTurnDecision = {
      phaseInterpretation: {
        currentPhase: p.phaseInterpretation?.currentPhase ?? snapshot.journeyPhase,
        confidence: p.phaseInterpretation?.confidence ?? 0.5,
      },
      actionInterpretation: {
        type: p.actionInterpretation?.type ?? "continue_narrowing",
        rationale: p.actionInterpretation?.rationale ?? "",
        confidence: p.actionInterpretation?.confidence ?? 0.5,
      },
      answerIntent: {
        topic: p.answerIntent?.topic ?? "narrowing",
        needsGroundedFact: p.answerIntent?.needsGroundedFact ?? false,
        shouldUseCurrentResultContext: p.answerIntent?.shouldUseCurrentResultContext ?? false,
        shouldResumePendingQuestion: p.answerIntent?.shouldResumePendingQuestion ?? false,
      },
      uiPlan: {
        optionMode: p.uiPlan?.optionMode ?? "question_options",
      },
      answerDraft: p.answerDraft ?? "Processing...",
    }

    console.log(`[orchestrator-v2] LLM decision: phase=${decision.phaseInterpretation.currentPhase} action=${decision.actionInterpretation.type} confidence=${decision.actionInterpretation.confidence}`)

    return decision
  } catch (error) {
    console.warn("[orchestrator-v2] Haiku turn decision failed, using fallback:", error)
    return fallback
  }
}

// Step 3: Apply state transition — maps LlmTurnDecision action types to state changes.
// Constraint-modifying actions record a RevisionNode via createRevisionNode.
export function applyStateTransition(
  state: RecommendationSessionState,
  decision: LlmTurnDecision
): RecommendationSessionState {
  let next: RecommendationSessionState = {
    ...state,
    turnCount: state.turnCount + 1,
    journeyPhase: decision.phaseInterpretation.currentPhase,
  }

  const actionType = decision.actionInterpretation.type

  switch (actionType) {
    case "continue_narrowing": {
      // Continue the current narrowing flow. Record a no_op revision
      // to keep the audit trail. Actual constraint extraction from the
      // user message happens in a separate step (TODO: wire extraction).
      const action: ResolvedAction = {
        type: "no_op",
        field: null,
        oldValue: null,
        newValue: null,
      }
      next = createRevisionNode(next, action)
      break
    }

    case "replace_slot": {
      // The user wants to replace an existing constraint value.
      // Field and value come from a separate extraction step (TODO).
      // Record a no_op placeholder for now.
      const action: ResolvedAction = {
        type: "no_op",
        field: null,
        oldValue: null,
        newValue: null,
      }
      next = createRevisionNode(next, action)
      break
    }

    case "show_recommendation": {
      // Transition to results_displayed — no constraint change.
      // The search step (Step 4-5) will populate resultContext.
      const action: ResolvedAction = {
        type: "no_op",
        field: null,
        oldValue: null,
        newValue: null,
      }
      next = createRevisionNode(next, action)
      break
    }

    case "go_back": {
      // Undo the last constraint change by reverting to the previous
      // revision's constraintsBefore snapshot.
      if (next.revisionNodes.length > 0) {
        const lastNode = next.revisionNodes[next.revisionNodes.length - 1]
        next = {
          ...next,
          constraints: { ...lastNode.constraintsBefore },
          revisionNodes: next.revisionNodes.slice(0, -1),
          currentRevisionId: lastNode.parentRevisionId,
        }
      }
      // Clear pending question since we're going back
      next = { ...next, pendingQuestion: null }
      break
    }

    case "compare_products": {
      // TODO: Wire to comparison surface builder.
      // No constraint change — presentation mode switch only.
      const action: ResolvedAction = {
        type: "no_op",
        field: null,
        oldValue: null,
        newValue: null,
      }
      next = createRevisionNode(next, action)
      break
    }

    case "answer_general": {
      // Side question / general knowledge — no constraint change.
      // Mark side thread active so the next turn knows context.
      next = { ...next, sideThreadActive: true }
      break
    }

    case "redirect_off_topic": {
      // Off-topic — no state change beyond turn increment.
      break
    }

    case "reset_session": {
      // Full reset — return to initial state but preserve turnCount.
      const turnCount = next.turnCount
      next = createInitialSessionState()
      next.turnCount = turnCount
      break
    }

    case "skip_field": {
      // User chose to skip the current pending question.
      next = { ...next, pendingQuestion: null }
      break
    }

    case "ask_clarification": {
      // System needs to ask clarification — no constraint change.
      // The pending question will be set by the surface builder.
      break
    }

    default: {
      // Exhaustive check — TypeScript will error if a case is missing.
      const _exhaustive: never = actionType
      console.warn(`[orchestrator-v2] Unknown action type: ${_exhaustive}`)
      break
    }
  }

  // If side thread was active but user is back on-topic, deactivate it.
  if (state.sideThreadActive && actionType !== "answer_general") {
    next = { ...next, sideThreadActive: false }
  }

  return next
}

// Step 4-5: Search planning + execution — delegates to hybrid-retrieval engine
async function executeSearchIfNeeded(
  state: RecommendationSessionState,
  decision: LlmTurnDecision
): Promise<{ resultContext: ResultContext; evidenceMap: Map<string, unknown> } | null> {
  if (!shouldSearch(decision)) {
    return null
  }

  try {
    const { input, filters } = constraintsToFilters(state)
    console.log(`[orchestrator-v2] Running hybrid retrieval: input=${JSON.stringify(input)}, filters=${filters.length}`)

    const { runHybridRetrieval } = await import("../domain/hybrid-retrieval")
    const hybridResult = await runHybridRetrieval(input, filters)
    const resultContext = buildResultContext(hybridResult.candidates, state)

    console.log(`[orchestrator-v2] Search complete: ${hybridResult.candidates.length} candidates, ${hybridResult.evidenceMap.size} with evidence`)

    return { resultContext, evidenceMap: hybridResult.evidenceMap as Map<string, unknown> }
  } catch (error) {
    console.error("[orchestrator-v2] Search failed:", error)
    return null
  }
}

// Step 6: Build surface (displayedOptions → chips → answer)
export function buildSurface(
  decision: LlmTurnDecision,
  _state: RecommendationSessionState
): { answer: string; displayedOptions: DisplayedOption[]; chips: string[] } {
  let displayedOptions: DisplayedOption[] = []

  const mode = decision.uiPlan.optionMode

  if (mode === "question_options" && decision.nextQuestion) {
    displayedOptions = decision.nextQuestion.suggestedOptions.map((opt, i) => ({
      index: i + 1,
      label: opt.label,
      field: decision.nextQuestion!.field,
      value: opt.value,
      count: 0,
    }))
    if (decision.nextQuestion.allowSkip) {
      displayedOptions.push({
        index: displayedOptions.length + 1,
        label: "상관없음",
        field: decision.nextQuestion.field,
        value: "skip",
        count: 0,
      })
    }
  } else if (mode === "result_followups") {
    displayedOptions = [
      { index: 1, label: "왜 이 제품을 추천했나요?", field: "_action", value: "explain", count: 0 },
      { index: 2, label: "절삭조건 알려줘", field: "_action", value: "cutting_conditions", count: 0 },
      { index: 3, label: "대체 후보 비교하기", field: "_action", value: "compare", count: 0 },
    ]
  }
  // "none" and other modes: displayedOptions stays empty

  // Surface contract: chips MUST derive from displayedOptions
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
  decision: LlmTurnDecision,
  hasGroundedFacts: boolean
): { answer: string; displayedOptions: DisplayedOption[]; chips: string[]; valid: boolean } {
  const result = validateSurfaceV2(surface, decision, hasGroundedFacts)
  if (result.warnings.length > 0) {
    console.warn(`[orchestrator-v2] Validation warnings: ${result.warnings.join(", ")}`)
  }
  if (result.rewrites.length > 0) {
    console.log(`[orchestrator-v2] Validation rewrites: ${result.rewrites.join(", ")}`)
  }
  return {
    answer: result.answer,
    displayedOptions: result.displayedOptions as DisplayedOption[],
    chips: result.chips,
    valid: result.valid,
  }
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

  // Attach search results to state if search was executed
  let stateAfterSearch = nextState
  if (searchResult) {
    stateAfterSearch = { ...nextState, resultContext: searchResult.resultContext }
  }

  // Step 6: Build surface
  const surface = buildSurface(decision, stateAfterSearch)

  // Step 7: Validate
  const hasGroundedFacts = !!searchResult && searchResult.resultContext.candidates.length > 0
  const validated = validateSurface(surface, decision, hasGroundedFacts)

  // Step 8: Write revision
  const finalState = writeRevision(stateAfterSearch, decision)

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
