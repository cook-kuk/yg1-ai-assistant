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
import { refineResults, buildRefinementOptions } from "./result-refiner"

// Step 1: Build snapshot from current state + user message
function buildTurnSnapshot(
  userMessage: string,
  state: RecommendationSessionState,
  recentTurns?: Array<{ role: "user" | "assistant"; text: string }>
): TurnSnapshot {
  // Use provided recentTurns, or build a minimal summary from revision history
  const turns: Array<{ role: "user" | "assistant"; text: string }> = recentTurns ?? []

  // Build revision summary from revision nodes for context
  const revisionSummary = state.revisionNodes.length > 0
    ? state.revisionNodes
        .slice(-3) // last 3 revisions
        .map(r => `${r.action.type}${r.action.field ? `(${r.action.field})` : ""}`)
        .join(" → ")
    : ""

  return {
    snapshotId: `snap-${Date.now()}`,
    userMessage,
    journeyPhase: state.journeyPhase,
    constraints: state.constraints,
    pendingQuestion: state.pendingQuestion,
    pendingAction: state.pendingAction,
    latestResultContext: state.resultContext,
    displayedProducts: state.resultContext?.candidates ?? [],
    recentTurns: turns.slice(-6), // last 6 turns (3 exchanges) for context window efficiency
    revisionSummary,
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

const TURN_DECISION_SYSTEM = `YG-1 cutting tool recommendation assistant. You make routing decisions AND generate the user-facing answer in a single call.
Your answer must be natural Korean. Generate actionable chips (suggestedChips) that help the user proceed.
Return JSON only — no markdown fences.`

function buildTurnDecisionPrompt(snapshot: TurnSnapshot): string {
  // Constraints summary
  const constraintEntries = [
    ...Object.entries(snapshot.constraints.base).map(([k, v]) => `${k}=${v}`),
    ...Object.entries(snapshot.constraints.refinements).map(([k, v]) => `${k}=${v} (refinement)`),
  ]
  const constraintStr = constraintEntries.length > 0 ? constraintEntries.join(", ") : "none"

  // Pending question/action
  const pendingQ = snapshot.pendingQuestion
    ? `field="${snapshot.pendingQuestion.field}", question="${snapshot.pendingQuestion.questionText.slice(0, 80)}", options=[${snapshot.pendingQuestion.options.slice(0, 5).map(o => o.label).join(", ")}]`
    : "none"

  const pendingA = snapshot.pendingAction
    ? `type="${snapshot.pendingAction.type}", label="${snapshot.pendingAction.label}"`
    : "none"

  // Conversation history
  const recentTurnsStr = snapshot.recentTurns.length > 0
    ? snapshot.recentTurns.map(t => `${t.role}: ${t.text.slice(0, 120)}`).join("\n")
    : "none"

  // Displayed products summary
  const hasResults = snapshot.displayedProducts.length > 0
  const productSummary = hasResults
    ? snapshot.displayedProducts.slice(0, 5).map(p =>
        `${p.displayCode} (${p.seriesName ?? "?"}, score=${p.score.toFixed(2)})`
      ).join("; ")
    : "none"

  // Revision history for context
  const revisionStr = snapshot.revisionSummary || "none"

  return `User: "${snapshot.userMessage}"

[Session]
Phase: ${snapshot.journeyPhase}
Constraints: ${constraintStr}
PendingQuestion: ${pendingQ}
PendingAction: ${pendingA}
SideThread: ${snapshot.sideThreadActive}
RecentRevisions: ${revisionStr}

[Products]
Displayed: ${hasResults ? `${snapshot.displayedProducts.length} products` : "none"}
TopProducts: ${productSummary}

[ConversationHistory]
${recentTurnsStr}

Generate a complete turn plan as JSON. The "answerDraft" MUST be the final user-facing answer in natural Korean — complete sentences, not placeholders. If asking a question, include the question in answerDraft. Generate "suggestedChips" with 2-5 contextual options the user can click next.

{"phaseInterpretation":{"currentPhase":"intake|narrowing|results_displayed|post_result_exploration|comparison|revision","confidence":0.0-1.0},"actionInterpretation":{"type":"continue_narrowing|replace_slot|show_recommendation|go_back|compare_products|answer_general|redirect_off_topic|reset_session|skip_field|ask_clarification|refine_current_results","rationale":"...","confidence":0.0-1.0},"answerIntent":{"topic":"...","needsGroundedFact":false,"shouldUseCurrentResultContext":false,"shouldResumePendingQuestion":false},"uiPlan":{"optionMode":"question_options|result_followups|none|comparison_options|no_options"},"nextQuestion":{"field":"...","suggestedOptions":[{"label":"...","value":"..."}],"allowSkip":true},"suggestedChips":[{"label":"...","type":"option|action|filter|navigation"}],"answerDraft":"..."}`
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
      700,
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
      // Parse nextQuestion if LLM provided it
      ...(p.nextQuestion?.field ? {
        nextQuestion: {
          field: p.nextQuestion.field,
          suggestedOptions: Array.isArray(p.nextQuestion.suggestedOptions)
            ? p.nextQuestion.suggestedOptions.map((o: { label?: string; value?: string }) => ({
                label: o.label ?? "",
                value: o.value ?? o.label ?? "",
              }))
            : [],
          allowSkip: p.nextQuestion.allowSkip ?? true,
        },
      } : {}),
      // Parse suggestedChips for chip generation without extra LLM calls
      ...(Array.isArray(p.suggestedChips) && p.suggestedChips.length > 0 ? {
        suggestedChips: p.suggestedChips.map((c: { label?: string; type?: string }) => ({
          label: c.label ?? "",
          type: (c.type as "option" | "action" | "filter" | "navigation") ?? "action",
        })),
      } : {}),
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

    case "refine_current_results": {
      // Narrow within current candidates — no constraint change, no re-search.
      // The actual filtering happens in the search step via refineResults.
      const action: ResolvedAction = {
        type: "apply_refinement",
        field: null,
        oldValue: null,
        newValue: null,
      }
      next = createRevisionNode(next, action)
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
): Promise<{ resultContext: ResultContext; evidenceMap: Map<string, unknown>; refined?: boolean } | null> {
  // Refine within current results instead of full search
  if (decision.actionInterpretation.type === "refine_current_results" && state.resultContext) {
    const field = decision.nextQuestion?.field ?? "flute"
    const value = decision.nextQuestion?.suggestedOptions?.[0]?.value
    console.log(`[orchestrator-v2] Refining current results: field=${field}, value=${value ?? "show options"}`)

    const refined = refineResults(state.resultContext, field, value)
    console.log(`[orchestrator-v2] Refinement complete: ${state.resultContext.candidates.length} → ${refined.candidates.length} candidates`)

    return { resultContext: refined, evidenceMap: new Map(), refined: true }
  }

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
  // Side question answered — build resume surface with pending question chips
  if (_state.sideThreadActive && _state.pendingQuestion) {
    const sideAnswer = decision.answerDraft
    const resumePrompt = `\n\n다시 제품 추천으로 돌아갈게요. ${_state.pendingQuestion.questionText}`
    const answer = sideAnswer + resumePrompt

    const displayedOptions = _state.pendingQuestion.options ?? []
    const chips = displayedOptions.map(opt => opt.label)

    return { answer, displayedOptions, chips }
  }

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
    // When refining, show refinement options as chips
    if (decision.actionInterpretation.type === "refine_current_results" && _state.resultContext) {
      const field = decision.nextQuestion?.field ?? "flute"
      const options = buildRefinementOptions(_state.resultContext, field)
      displayedOptions = options.map((opt, i) => ({
        index: i + 1,
        label: opt.label,
        field,
        value: opt.value,
        count: opt.count,
      }))
    } else {
      displayedOptions = [
        { index: 1, label: "왜 이 제품을 추천했나요?", field: "_action", value: "explain", count: 0 },
        { index: 2, label: "절삭조건 알려줘", field: "_action", value: "cutting_conditions", count: 0 },
        { index: 3, label: "대체 후보 비교하기", field: "_action", value: "compare", count: 0 },
      ]
    }
  }
  // "none" and other modes: displayedOptions stays empty

  // ── LLM suggestedChips integration ──
  // If LLM provided suggestedChips and displayedOptions is still empty,
  // convert suggestedChips to displayedOptions.
  if (displayedOptions.length === 0 && decision.suggestedChips && decision.suggestedChips.length > 0) {
    displayedOptions = decision.suggestedChips.slice(0, 8).map((chip, i) => ({
      index: i + 1,
      label: chip.label,
      field: chip.type === "option" ? (decision.nextQuestion?.field ?? "_action")
           : chip.type === "filter" ? "_filter"
           : chip.type === "navigation" ? "_control"
           : "_action",
      value: chip.label,
      count: 0,
    }))
  }

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
  provider: LLMProvider,
  recentTurns?: Array<{ role: "user" | "assistant"; text: string }>
): Promise<TurnResult> {
  console.log(`[orchestrator-v2] Starting turn ${currentState.turnCount + 1}`)

  // Step 1: Build snapshot (with conversation history for single-call quality)
  const snapshot = buildTurnSnapshot(userMessage, currentState, recentTurns)

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
