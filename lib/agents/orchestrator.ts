/**
 * Orchestrator Agent — Sonnet
 *
 * Controls the overall turn flow for the recommendation state machine.
 * Decides which agents to invoke and in what order.
 *
 * Flow per turn:
 *   1. Intent Classifier (Haiku)
 *   2. Parameter Extractor (Haiku) — if needed
 *   3. Ambiguity Resolver (Opus) — only if confidence < threshold or vague references
 *   4. Route decision based on classified intent
 *   5. Execute action (filter, undo, compare, etc.)
 *   6. Response Composer (Sonnet) — generate final response
 */

import type { LLMProvider } from "@/lib/llm/provider"
import type { ScoredProduct, RecommendationInput } from "@/lib/types/canonical"
import type { ExplorationSessionState, CandidateSnapshot, AppliedFilter } from "@/lib/types/exploration"
import type { ProductIntakeForm } from "@/lib/types/intake"
import type { EvidenceSummary } from "@/lib/types/evidence"
import type {
  TurnContext,
  OrchestratorResult,
  OrchestratorAction,
  NarrowingIntent,
  IntentClassification,
  ExtractedParameters,
} from "./types"

import { classifyIntent } from "./intent-classifier"
import { extractParameters } from "./parameter-extractor"
import { needsOpusResolution, resolveAmbiguity } from "./ambiguity-resolver"
import { resolveProductReferences } from "./comparison-agent"
import { parseAnswerToFilter } from "@/lib/domain/question-engine"

// ════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ════════════════════════════════════════════════════════════════

export async function orchestrateTurn(
  ctx: TurnContext,
  provider: LLMProvider
): Promise<OrchestratorResult> {
  const agents: OrchestratorResult["agentsInvoked"] = []
  const startMs = Date.now()

  // ═══ Step 1: Intent Classification (Haiku) ═══
  const intentStart = Date.now()
  const intentResult = await classifyIntent(ctx.userMessage, ctx.sessionState, provider)
  agents.push({ agent: "intent-classifier", model: "haiku", durationMs: Date.now() - intentStart })

  console.log(`[orchestrator] Intent: ${intentResult.intent} (${intentResult.confidence.toFixed(2)}) model=${intentResult.modelUsed}${intentResult.extractedValue ? ` value="${intentResult.extractedValue}"` : ""}`)

  // ═══ Step 2: Ambiguity Check → Opus Escalation ═══
  let finalIntent = intentResult.intent
  let finalValue = intentResult.extractedValue
  let escalatedToOpus = false
  let escalationReason: string | undefined

  if (needsOpusResolution(ctx.userMessage, intentResult.confidence, ctx.sessionState) && ctx.sessionState) {
    escalatedToOpus = true
    escalationReason = intentResult.confidence < 0.5
      ? `low_confidence (${intentResult.confidence.toFixed(2)})`
      : "vague_reference_pattern"

    console.log(`[orchestrator] Escalating to Opus: ${escalationReason}`)

    const opusStart = Date.now()
    const opusResult = await resolveAmbiguity(
      ctx.userMessage,
      ctx.sessionState,
      ctx.displayedProducts,
      provider
    )
    agents.push({ agent: "ambiguity-resolver", model: "opus", durationMs: Date.now() - opusStart })

    if (opusResult.confidence > intentResult.confidence) {
      finalIntent = opusResult.resolvedIntent
      finalValue = opusResult.resolvedValue
      console.log(`[orchestrator] Opus override: ${finalIntent} (${opusResult.confidence.toFixed(2)}) — ${opusResult.explanation}`)
    }
  }

  // ═══ Step 3: Parameter Extraction (Haiku) — for SET_PARAMETER/SELECT_OPTION ═══
  let extractedParams: ExtractedParameters | null = null
  if (finalIntent === "SET_PARAMETER" || finalIntent === "SELECT_OPTION") {
    const paramStart = Date.now()
    extractedParams = await extractParameters(ctx.userMessage, ctx.sessionState, provider)
    agents.push({ agent: "parameter-extractor", model: "haiku", durationMs: Date.now() - paramStart })

    console.log(`[orchestrator] Extracted: ${JSON.stringify(extractedParams)}`)
  }

  // ═══ Step 4: Route to Action ═══
  const action = routeToAction(finalIntent, finalValue, extractedParams, ctx)

  const result: OrchestratorResult = {
    action,
    reasoning: `${finalIntent} → ${action.type}`,
    agentsInvoked: agents,
    escalatedToOpus,
    escalationReason,
  }

  // Debug summary
  const totalMs = Date.now() - startMs
  console.log(`[orchestrator] ═══ Turn Summary ═══`)
  console.log(`[orchestrator] Action: ${action.type}`)
  console.log(`[orchestrator] Agents: ${agents.map(a => `${a.agent}(${a.model}:${a.durationMs}ms)`).join(", ")}`)
  console.log(`[orchestrator] Opus: ${escalatedToOpus ? `YES (${escalationReason})` : "no"}`)
  console.log(`[orchestrator] Total: ${totalMs}ms`)
  console.log(`[orchestrator] ═══════════════════`)

  return result
}

// ════════════════════════════════════════════════════════════════
// ACTION ROUTING
// ════════════════════════════════════════════════════════════════

function routeToAction(
  intent: NarrowingIntent,
  value: string | undefined,
  params: ExtractedParameters | null,
  ctx: TurnContext
): OrchestratorAction {
  switch (intent) {
    case "RESET_SESSION":
      return { type: "reset_session" }

    case "GO_BACK_ONE_STEP":
      return { type: "go_back_one_step" }

    case "GO_BACK_TO_SPECIFIC_STAGE":
      return {
        type: "go_back_to_filter",
        filterValue: value ?? "",
        filterField: findFilterField(value, ctx.sessionState),
      }

    case "ASK_RECOMMENDATION":
      return { type: "show_recommendation" }

    case "ASK_COMPARISON": {
      const targets = value?.split(",") ?? []
      return { type: "compare_products", targets }
    }

    case "ASK_EXPLANATION":
    case "ASK_REASON":
      return { type: "explain_product", target: value }

    case "SELECT_OPTION":
    case "SET_PARAMETER": {
      // Try to build a filter from extracted params
      const filter = buildFilterFromParams(params, value, ctx)
      if (filter) {
        // Check if it's a skip
        if (filter.op === "skip") {
          return { type: "skip_field" }
        }
        return { type: "continue_narrowing", filter }
      }
      // Can't build filter — treat as general answer
      return { type: "answer_general", message: ctx.userMessage }
    }

    case "START_NEW_TOPIC":
      return { type: "answer_general", message: ctx.userMessage }

    case "OUT_OF_SCOPE":
      return { type: "redirect_off_topic" }

    default:
      return { type: "answer_general", message: ctx.userMessage }
  }
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function findFilterField(
  value: string | undefined,
  sessionState: ExplorationSessionState | null
): string | undefined {
  if (!value || !sessionState) return undefined
  const lower = value.toLowerCase()
  for (const f of sessionState.appliedFilters) {
    if (f.value.toLowerCase().includes(lower) || f.rawValue.toString().toLowerCase().includes(lower)) {
      return f.field
    }
  }
  return undefined
}

function buildFilterFromParams(
  params: ExtractedParameters | null,
  rawValue: string | undefined,
  ctx: TurnContext
): AppliedFilter | null {
  if (!params && !rawValue) return null

  // Check for skip signals
  const clean = (rawValue ?? params?.rawValue ?? "").toLowerCase().trim()
  if (["상관없음", "모름", "패스", "스킵", "상관 없음", "아무거나"].includes(clean)) {
    return {
      field: ctx.sessionState?.lastAskedField ?? "unknown",
      op: "skip",
      value: "상관없음",
      rawValue: "skip",
      appliedAt: ctx.sessionState?.turnCount ?? 0,
    }
  }

  const lastField = ctx.sessionState?.lastAskedField

  // Try building filter from extracted params
  if (params) {
    if (params.fluteCount != null) {
      return {
        field: "fluteCount", op: "eq",
        value: `${params.fluteCount}날`,
        rawValue: params.fluteCount,
        appliedAt: ctx.sessionState?.turnCount ?? 0,
      }
    }
    if (params.coating) {
      return {
        field: "coating", op: "includes",
        value: params.coating,
        rawValue: params.coating,
        appliedAt: ctx.sessionState?.turnCount ?? 0,
      }
    }
    if (params.toolSubtype) {
      return {
        field: "toolSubtype", op: "includes",
        value: params.toolSubtype,
        rawValue: params.toolSubtype,
        appliedAt: ctx.sessionState?.turnCount ?? 0,
      }
    }
    if (params.seriesName) {
      return {
        field: "seriesName", op: "includes",
        value: params.seriesName,
        rawValue: params.seriesName,
        appliedAt: ctx.sessionState?.turnCount ?? 0,
      }
    }
    if (params.diameterMm != null) {
      return {
        field: "diameterMm", op: "eq",
        value: `${params.diameterMm}mm`,
        rawValue: params.diameterMm,
        appliedAt: ctx.sessionState?.turnCount ?? 0,
      }
    }
  }

  // Fall back to parseAnswerToFilter with the last asked field
  if (lastField && rawValue) {
    const chipClean = rawValue.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()
    return parseAnswerToFilter(lastField, chipClean)
  }

  return null
}
