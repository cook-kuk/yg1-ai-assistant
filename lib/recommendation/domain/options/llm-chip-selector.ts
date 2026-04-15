/**
 * State-aware chip selector.
 *
 * Candidate options are deterministic hints. The selector chooses which
 * options to surface right now from the current state, filters, candidate
 * buffer, UI context, and recent conversation.
 */

import { resolveModel, type LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { SmartOption } from "./types"
import type { DisplayedOption } from "@/lib/recommendation/domain/types"
import { smartOptionsToChips, smartOptionsToDisplayedOptions } from "./option-bridge"

const LLM_CHIP_SELECTOR_MODEL = resolveModel("haiku")
const MAX_SELECTION = 6
const MAX_LLM_CANDIDATES = 12

const GENERIC_REQUEST_PATTERNS = [
  /좁혀/u,
  /더\s*골라/u,
  /추천/u,
  /뭐가/u,
  /잘\s*모르/u,
  /모르겠/u,
  /아무거나/u,
  /괜찮은\s*거/u,
]

export interface ConversationTurnSlim {
  role: "user" | "assistant"
  text: string
}

export interface CandidateBufferFieldSummary {
  field: string
  values: Array<{ value: string; count: number }>
}

export interface ChipSelectionContext {
  userMessage: string
  assistantText: string
  mode: string | null
  pendingField: string | null
  candidateCount: number
  appliedFilters: Array<{ field: string; value: string }>
  resolutionStatus: string | null
  displayedProducts: string[]
  userState: string | null
  confusedAbout: string | null
  intentShift: string | null
  referencedField?: string | null
  referencedUIBlock: string | null
  frameRelation: string | null
  answeredFields: string[]
  conversationDepth: number
  suggestedNextAction: string | null
  hasConflict: boolean
  correctionSignal?: boolean
  candidateBufferSummary?: CandidateBufferFieldSummary[]
  recentTurns: ConversationTurnSlim[]
}

export interface ChipSelectionResult {
  chips: string[]
  displayedOptions: DisplayedOption[]
  selectedOptions: SmartOption[]
  selectedByLLM: boolean
}

export async function selectChipsWithLLM(
  candidateOptions: SmartOption[],
  context: ChipSelectionContext,
  provider: LLMProvider
): Promise<ChipSelectionResult> {
  console.log(`[chip-selector] entered candidateOptions=${candidateOptions.length} candidateCount=${context.candidateCount} mode=${context.mode} pendingField=${context.pendingField} resolutionStatus=${context.resolutionStatus}`)
  const preparedOptions = prepareCandidateOptions(candidateOptions, context)

  if (preparedOptions.length === 0) {
    console.log(`[chip-selector] EXIT preparedOptions=0 — no chips produced`)
    return createResult([], false)
  }

  if (preparedOptions.length === 1) {
    return createResult(preparedOptions, false)
  }

  if (!provider.available()) {
    return fallback(preparedOptions)
  }

  try {
    const optionList = preparedOptions.map((option, index) => {
      const entry: Record<string, unknown> = {
        i: index,
        label: option.label,
        family: option.family,
        plan: option.plan.type,
        score: Number((option.priorityScore ?? 0).toFixed(3)),
      }

      if (option.field) entry.field = option.field
      if (option.value) entry.value = option.value
      if (option.reason) entry.reason = option.reason
      if (option.subtitle) entry.subtitle = option.subtitle
      if (option.projectedCount != null) entry.projected = option.projectedCount
      if (option.projectedDelta != null) entry.delta = option.projectedDelta
      if (option.preservesContext) entry.preserves = true
      if (option.recommended) entry.recommended = true

      return entry
    })

    const correctionSignal = context.correctionSignal ?? defaultCorrectionSignal(context)
    const genericRequest = isGenericRequest(context)
    const conversationSection = buildConversationSection(context.recentTurns)
    const candidateBufferSection = buildCandidateBufferSection(context.candidateBufferSummary)

    const situation = [
      `latest_user="${context.userMessage}"`,
      `assistant_preview="${context.assistantText.slice(0, 180)}"`,
      `mode=${context.mode ?? "unknown"}`,
      context.pendingField ? `pending_field=${context.pendingField}` : null,
      `candidate_count=${context.candidateCount}`,
      context.appliedFilters.length > 0
        ? `applied_filters=${context.appliedFilters.map(filter => `${filter.field}=${filter.value}`).join(", ")}`
        : "applied_filters=none",
      context.userState ? `user_state=${context.userState}${context.confusedAbout ? ` (${context.confusedAbout})` : ""}` : null,
      context.intentShift ? `intent_shift=${context.intentShift}` : null,
      context.referencedField ? `referenced_field=${context.referencedField}` : null,
      context.frameRelation ? `frame_relation=${context.frameRelation}` : null,
      context.referencedUIBlock ? `ui_block=${context.referencedUIBlock}` : null,
      context.suggestedNextAction ? `suggested_next_action=${context.suggestedNextAction}` : null,
      context.answeredFields.length > 0 ? `answered_fields=${context.answeredFields.join(", ")}` : null,
      context.displayedProducts.length > 0 ? `displayed_products=${context.displayedProducts.slice(0, 4).join(", ")}` : null,
      correctionSignal ? "correction_signal=true" : null,
      genericRequest ? "generic_request=true" : null,
    ].filter(Boolean).join("\n")

    const prompt = [
      "Select follow-up UI chips for the YG-1 industrial recommendation flow.",
      "Candidate options are only hints. Choose the best chips for the current session state.",
      conversationSection,
      "## Current situation",
      situation,
      candidateBufferSection,
      "## Candidate options",
      JSON.stringify(optionList),
      "## Selection rules",
      "- Never choose a chip that conflicts with the current state or repeats an already-applied condition.",
      "- Prefer chips that preserve context while reducing the current candidate set well.",
      "- Match the latest intent first: refine, repair, compare, explain, or new exploration.",
      "- If there is a correction/conflict signal, prioritize repair-oriented chips.",
      "- If the user request is generic, do not force a single specific value; prefer safe narrowing chips.",
      "- Keep the set actionable and diverse, usually 2 to 6 chips.",
      "- Reset/destructive choices should only appear if genuinely necessary.",
      'Return JSON only: {"selected":[0,2,1]}',
    ].filter(Boolean).join("\n\n")

    const raw = await provider.complete(
      "Return JSON only.",
      [{ role: "user", content: prompt }],
      1500,
      LLM_CHIP_SELECTOR_MODEL
    )

    const parsed = safeParseJSON(raw)
    if (parsed?.selected && Array.isArray(parsed.selected)) {
      const indices = (parsed.selected as unknown[])
        .filter((value): value is number => typeof value === "number" && Number.isInteger(value))
        .filter(index => index >= 0 && index < preparedOptions.length)

      const selected = dedupeByLabel(indices.map(index => preparedOptions[index])).slice(0, MAX_SELECTION)
      if (selected.length > 0) {
        console.log(`[llm-chip-selector] Selected ${selected.length}/${preparedOptions.length}: ${selected.map(option => option.label).join(", ")}`)
        return createResult(selected, true)
      }
    }
  } catch (error) {
    console.warn("[llm-chip-selector] LLM failed:", error)
  }

  return fallback(preparedOptions)
}

function prepareCandidateOptions(
  candidateOptions: SmartOption[],
  context: ChipSelectionContext,
): SmartOption[] {
  const activeFilters = buildAppliedFilterMap(context.appliedFilters)
  const correctionSignal = context.correctionSignal ?? defaultCorrectionSignal(context)
  const genericRequest = isGenericRequest(context)
  const focusedField = context.referencedField ?? context.pendingField ?? null
  const answeredFields = new Set(context.answeredFields)

  const prepared = dedupeByLabel(candidateOptions)
    .filter(option => !isMeaninglessOption(option))
    .filter(option => !isRepeatOfCurrentState(option, activeFilters))
    .map(option => {
      let score = option.priorityScore ?? 0

      if (focusedField && option.field === focusedField) score += 120
      if (context.pendingField && option.field === context.pendingField) score += 160
      if (option.preservesContext) score += 18
      if (option.recommended) score += 16
      if (/유지/u.test(option.label)) score += 22

      if (context.candidateCount > 1 && option.projectedCount != null && option.projectedCount > 0) {
        const ratio = option.projectedCount / context.candidateCount
        score += Math.max(0, (1 - ratio) * 60)
      }

      if (genericRequest) {
        if (isSafeNarrowingOption(option)) score += 75
        if (isSpecificValueOption(option, context.pendingField)) score -= 45
      }

      if (correctionSignal) {
        if (option.family === "repair" || option.plan.type === "replace_filter" || option.plan.type === "relax_filters") {
          score += 140
        } else if (/유지/u.test(option.label)) {
          score += 105
        } else if (option.family === "compare" || option.family === "explore") {
          score -= 25
        }
      }

      if (context.intentShift === "refine_existing" || context.intentShift === "replace_constraint" || context.intentShift === "revise_prior_input") {
        if (option.plan.type === "replace_filter" || option.plan.type === "relax_filters") score += 70
      }

      if (context.intentShift === "branch_exploration" && option.plan.type === "branch_session") {
        score += 65
      }

      if (answeredFields.has(option.field ?? "") && option.field !== focusedField && isSpecificValueOption(option, context.pendingField)) {
        score -= 20
      }

      if (option.family === "reset" || option.destructive) {
        score -= 400
      }

      return {
        ...option,
        priorityScore: score,
      }
    })
    .sort((left, right) => (right.priorityScore ?? 0) - (left.priorityScore ?? 0))

  const withoutReset = prepared.filter(option => option.family !== "reset")
  const finalCandidates = (withoutReset.length > 0 ? withoutReset : prepared).slice(0, MAX_LLM_CANDIDATES)

  return finalCandidates
}

function buildAppliedFilterMap(appliedFilters: ChipSelectionContext["appliedFilters"]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()

  for (const filter of appliedFilters) {
    const normalizedValue = normalizeToken(filter.value)
    if (!filter.field || !normalizedValue) continue

    if (!result.has(filter.field)) {
      result.set(filter.field, new Set())
    }
    result.get(filter.field)!.add(normalizedValue)
  }

  return result
}

function isRepeatOfCurrentState(
  option: SmartOption,
  activeFilters: Map<string, Set<string>>,
): boolean {
  if (option.plan.type !== "apply_filter") return false
  if (!option.field || option.field.startsWith("_")) return false
  if (option.value == null || option.value === "skip") return false

  const fieldValues = activeFilters.get(option.field)
  if (!fieldValues) return false

  return fieldValues.has(normalizeToken(option.value))
}

function isMeaninglessOption(option: SmartOption): boolean {
  const normalized = normalizeToken(option.label)
  return normalized.length < 2
}

function isSafeNarrowingOption(option: SmartOption): boolean {
  if (option.plan.type === "replace_filter" || option.plan.type === "relax_filters" || option.plan.type === "branch_session") {
    return true
  }

  if (typeof option.value === "string" && option.value.startsWith("narrow_")) {
    return true
  }

  return /(좁히기|다른|변경|비교|설명|이전|유지)/u.test(option.label)
}

function isSpecificValueOption(option: SmartOption, pendingField: string | null): boolean {
  if (option.plan.type !== "apply_filter") return false
  if (!option.field || option.field.startsWith("_")) return false
  if (option.field === pendingField) return false
  if (!option.value || option.value === "skip") return false
  if (typeof option.value === "string" && option.value.startsWith("narrow_")) return false
  return !isSafeNarrowingOption(option)
}

function buildCandidateBufferSection(summary?: CandidateBufferFieldSummary[]): string {
  if (!summary || summary.length === 0) return ""

  const lines = ["## Candidate buffer"]
  for (const field of summary.slice(0, 5)) {
    const values = field.values
      .slice(0, 4)
      .map(value => `${value.value}(${value.count})`)
      .join(", ")
    if (!values) continue
    lines.push(`${field.field}: ${values}`)
  }

  return lines.join("\n")
}

function buildConversationSection(turns: ConversationTurnSlim[]): string {
  if (turns.length === 0) return ""

  const lines: string[] = ["## Recent conversation"]
  const recentTurns = turns.slice(-6)

  for (const turn of recentTurns) {
    const role = turn.role === "user" ? "user" : "assistant"
    const text = turn.text.replace(/\s+/g, " ").trim()
    lines.push(`${role}: ${text.slice(0, 140)}${text.length > 140 ? "..." : ""}`)
  }

  return lines.join("\n")
}

function fallback(options: SmartOption[]): ChipSelectionResult {
  return createResult(options.slice(0, MAX_SELECTION), false)
}

function createResult(selectedOptions: SmartOption[], selectedByLLM: boolean): ChipSelectionResult {
  const deduped = dedupeByLabel(selectedOptions).slice(0, MAX_SELECTION)
  return {
    chips: smartOptionsToChips(deduped),
    displayedOptions: smartOptionsToDisplayedOptions(deduped),
    selectedOptions: deduped,
    selectedByLLM,
  }
}

function dedupeByLabel(options: SmartOption[]): SmartOption[] {
  const seen = new Set<string>()
  const deduped: SmartOption[] = []

  for (const option of options) {
    const key = normalizeToken(option.label)
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(option)
  }

  return deduped
}

function isGenericRequest(context: ChipSelectionContext): boolean {
  if (!context.userMessage) return false
  if (context.pendingField) return false
  if (context.referencedField) return false

  return GENERIC_REQUEST_PATTERNS.some(pattern => pattern.test(context.userMessage))
}

function defaultCorrectionSignal(context: ChipSelectionContext): boolean {
  return (
    context.hasConflict ||
    context.frameRelation === "challenge" ||
    context.frameRelation === "revise" ||
    context.intentShift === "replace_constraint" ||
    context.intentShift === "refine_existing" ||
    context.intentShift === "revise_prior_input"
  )
}

function normalizeToken(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
}

function safeParseJSON(raw: string): Record<string, unknown> | null {
  try {
    const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim()
    return JSON.parse(cleaned)
  } catch {
    return null
  }
}
