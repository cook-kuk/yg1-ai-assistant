/**
 * Context Interpreter — Deterministic interpretation of conversation state.
 *
 * Reads session state, intake form, user message, and memory to produce
 * a structured ContextInterpretation before chip/option generation.
 *
 * No LLM calls. Purely deterministic pattern matching + state analysis.
 */

import type {
  ContextInterpretation,
  ContextMode,
  IntentShift,
  ActiveConstraint,
  DetectedConflict,
} from "./context-types"
import type { ConversationMemory, MemoryItem } from "../memory/conversation-memory"
import type {
  AppliedFilter,
  ExplorationSessionState,
  RecommendationInput,
  CandidateSnapshot,
} from "@/lib/recommendation/domain/types"
import type { ProductIntakeForm } from "@/lib/types/intake"

// ── Material compatibility map ───────────────────────────────
const MATERIAL_COATING_COMPAT: Record<string, string[]> = {
  aluminum: ["DLC", "Diamond", "Bright Finish", "무코팅", "Uncoated"],
  stainless: ["TiAlN", "AlCrN", "AlTiN", "Y-Coating"],
  carbon_steel: ["TiAlN", "AlTiN", "TiCN", "Y-Coating"],
  cast_iron: ["TiAlN", "AlCrN", "AlTiN"],
  titanium: ["AlCrN", "TiAlN", "AlTiN"],
  hardened_steel: ["AlCrN", "AlTiN", "TiAlN"],
}

// ── Material keyword → canonical mapping ─────────────────────
const MATERIAL_KEYWORDS: Record<string, string> = {
  "알루미늄": "aluminum", "알루": "aluminum", "비철": "aluminum",
  "스테인리스": "stainless", "스테인": "stainless", "sus": "stainless",
  "탄소강": "carbon_steel", "일반강": "carbon_steel",
  "주철": "cast_iron",
  "티타늄": "titanium", "내열합금": "titanium",
  "고경도강": "hardened_steel", "고경도": "hardened_steel",
}

// ── Intent detection patterns ────────────────────────────────
const EXPLAIN_PATTERNS = [/왜.*이/, /이유/, /설명/, /어째서/, /뭐야/, /그게.*뭐/, /왜.*추천/]
const COMPARE_PATTERNS = [/비교/, /차이/, /뭐가.*다/, /(\d+)번.*(\d+)번/]
const BRANCH_PATTERNS = [/어때/, /는.*어떻/, /로.*바꾸/, /다른.*소재/, /다른.*코팅/, /다른.*직경/]
const REPLACE_PATTERNS = [/바꿔/, /변경/, /대신/, /로.*하고/]
const PRESERVE_PATTERNS = [/유지/, /그대로/, /나머지.*유지/, /조건.*유지/, /만.*바꾸/]
const RESET_PATTERNS = [/처음부터/, /다시.*시작/, /리셋/, /초기화/]

export interface ContextInterpreterInput {
  form: ProductIntakeForm
  sessionState: ExplorationSessionState | null
  resolvedInput: RecommendationInput
  userMessage: string | null
  memory: ConversationMemory
}

/**
 * Interpret the current conversation context.
 * Produces a structured interpretation for downstream option generation.
 */
export function interpretContext(input: ContextInterpreterInput): ContextInterpretation {
  const { form, sessionState, resolvedInput, userMessage, memory } = input

  // 1. Determine mode
  const mode = inferMode(sessionState)

  // 2. Extract active constraints from memory + session
  const activeConstraints = buildActiveConstraints(form, sessionState, memory)

  // 3. Separate resolved facts vs temporary filters
  const resolvedFacts = activeConstraints
    .filter(c => c.durable)
    .map(c => ({ field: c.field, value: c.value }))
  const temporaryFilters = activeConstraints
    .filter(c => !c.durable)
    .map(c => ({ field: c.field, value: c.value }))

  // 4. Detect intent shift from user message
  const intentShift = userMessage ? detectIntentShift(userMessage, mode, sessionState) : "none"

  // 5. Detect conflicts
  const detectedConflicts = userMessage
    ? detectConflicts(userMessage, activeConstraints, resolvedInput)
    : []
  const hasConflict = detectedConflicts.length > 0

  // 6. Infer referenced products and field
  const referencedProducts = inferReferencedProducts(userMessage, sessionState)
  const referencedField = inferReferencedField(userMessage)

  // 7. Determine context preservation
  const preserveContext = inferPreserveContext(userMessage, intentShift)

  // 8. Determine what to do next
  const shouldGenerateRepairOptions = hasConflict && intentShift !== "restart"
  const shouldAskFollowup = mode === "narrowing" && !hasConflict && intentShift === "none"
  const suggestedNextAction = inferNextAction(mode, intentShift, hasConflict, sessionState)

  // 9. Collect answered fields (avoid re-asking)
  const answeredFields = collectAnsweredFields(memory, sessionState)

  return {
    mode,
    intentShift,
    activeConstraints,
    resolvedFacts,
    temporaryFilters,
    referencedProducts,
    referencedField,
    preserveContext,
    hasConflict,
    detectedConflicts,
    shouldAskFollowup,
    shouldGenerateRepairOptions,
    suggestedNextAction,
    answeredFields,
    conversationDepth: sessionState?.turnCount ?? 0,
  }
}

// ════════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ════════════════════════════════════════════════════════════════

function inferMode(sessionState: ExplorationSessionState | null): ContextMode {
  if (!sessionState) return "intake"

  const status = sessionState.resolutionStatus
  const lastAction = sessionState.lastAction

  if (lastAction === "compare_products") return "compare"
  if (status?.startsWith("resolved")) return "recommended"
  if (sessionState.turnCount === 0) return "intake"
  return "narrowing"
}

function detectIntentShift(
  message: string,
  currentMode: ContextMode,
  sessionState: ExplorationSessionState | null
): IntentShift {
  const clean = message.trim().toLowerCase()

  // Reset
  if (RESET_PATTERNS.some(p => p.test(clean))) {
    if (clean.length > 25 || /\?|아니야|맞아/.test(clean)) return "none" // meta-question
    return "restart"
  }

  // Explain
  if (EXPLAIN_PATTERNS.some(p => p.test(clean))) return "explain_recommendation"

  // Compare
  if (COMPARE_PATTERNS.some(p => p.test(clean))) return "compare_products"

  // Explicit preserve + change pattern: "유지하고 코팅만 바꾸고 싶어"
  if (PRESERVE_PATTERNS.some(p => p.test(clean)) && REPLACE_PATTERNS.some(p => p.test(clean))) {
    return "refine_existing"
  }

  // Replace single constraint: "코팅 바꿔", "소재 변경"
  if (REPLACE_PATTERNS.some(p => p.test(clean))) return "replace_constraint"

  // Branch exploration: "스테인리스는 어때?", "다른 소재는?"
  if (BRANCH_PATTERNS.some(p => p.test(clean))) return "branch_exploration"

  // After recommendation, anything that's not a simple chip selection is likely a refinement
  if (currentMode === "recommended" && sessionState) {
    // Check if it's a displayed chip match
    const isChipMatch = sessionState.displayedChips?.some(
      chip => clean.includes(chip.toLowerCase().replace(/\s*\(\d+개\)\s*$/, "").trim())
    )
    if (!isChipMatch) return "refine_existing"
  }

  return "none"
}

function buildActiveConstraints(
  form: ProductIntakeForm,
  sessionState: ExplorationSessionState | null,
  memory: ConversationMemory
): ActiveConstraint[] {
  const constraints: ActiveConstraint[] = []
  const seen = new Set<string>()

  // From intake form (durable facts)
  const formFields: Array<{ field: string; state: { status: string; value?: unknown } }> = [
    { field: "material", state: form.material as { status: string; value?: unknown } },
    { field: "operationType", state: form.operationType as { status: string; value?: unknown } },
    { field: "diameterMm", state: form.diameterInfo as { status: string; value?: unknown } },
    { field: "toolType", state: form.toolTypeOrCurrentProduct as { status: string; value?: unknown } },
  ]

  for (const { field, state } of formFields) {
    if (state.status === "known" && state.value != null) {
      constraints.push({
        field,
        value: String(state.value),
        source: "intake",
        durable: true,
      })
      seen.add(field)
    }
  }

  // From memory (resolved items take priority)
  for (const item of memory.items) {
    if (item.status === "stale" || item.status === "replaced") continue
    if (seen.has(item.field)) continue

    constraints.push({
      field: item.field,
      value: item.value,
      source: item.source as ActiveConstraint["source"],
      durable: item.status === "resolved",
    })
    seen.add(item.field)
  }

  // From session applied filters (temporary)
  if (sessionState?.appliedFilters) {
    for (const filter of sessionState.appliedFilters) {
      if (filter.op === "skip") continue
      if (seen.has(filter.field)) continue

      constraints.push({
        field: filter.field,
        value: filter.value,
        source: "narrowing",
        durable: false,
      })
      seen.add(filter.field)
    }
  }

  return constraints
}

function detectConflicts(
  message: string,
  activeConstraints: ActiveConstraint[],
  resolvedInput: RecommendationInput
): DetectedConflict[] {
  const clean = message.trim().toLowerCase()
  const conflicts: DetectedConflict[] = []

  // Detect material mentions that differ from current
  const currentMaterial = resolvedInput.material?.toLowerCase() ?? ""
  for (const [keyword, canonical] of Object.entries(MATERIAL_KEYWORDS)) {
    if (!clean.includes(keyword)) continue
    if (canonical === currentMaterial) continue
    if (!currentMaterial) continue

    // New material mentioned while different material is active
    const conflicting = activeConstraints.filter(c => {
      if (c.field === "material") return true
      // Check coating compatibility
      if (c.field === "coating") {
        const compatCoatings = MATERIAL_COATING_COMPAT[canonical] ?? []
        return !compatCoatings.some(cc => c.value.toLowerCase().includes(cc.toLowerCase()))
      }
      return false
    })

    if (conflicting.length > 0) {
      conflicts.push({
        newField: "material",
        newValue: keyword,
        conflictingConstraints: conflicting.map(c => ({ field: c.field, value: c.value })),
        severity: "hard",
      })
    }
  }

  // Detect coating changes that may conflict with material
  const coatingKeywords = ["altin", "tialn", "dlc", "무코팅", "diamond", "alcrn", "ticn", "y-코팅"]
  for (const keyword of coatingKeywords) {
    if (!clean.includes(keyword)) continue
    const existingCoating = activeConstraints.find(c => c.field === "coating")
    if (existingCoating && existingCoating.value.toLowerCase() !== keyword) {
      conflicts.push({
        newField: "coating",
        newValue: keyword,
        conflictingConstraints: [{ field: existingCoating.field, value: existingCoating.value }],
        severity: "soft",
      })
    }
  }

  return conflicts
}

function inferReferencedProducts(
  message: string | null,
  sessionState: ExplorationSessionState | null
): string[] {
  if (!message || !sessionState) return []

  const products: string[] = []
  const clean = message.trim().toLowerCase()

  // Match product code patterns
  const codeMatch = clean.match(/(ce\d+[a-z]*\d*|gnx\d+|sem[a-z]*\d+)/gi)
  if (codeMatch) products.push(...codeMatch.map(m => m.toUpperCase()))

  // Match rank references ("1번", "2번")
  const rankMatches = clean.matchAll(/(\d+)\s*번/g)
  for (const m of Array.from(rankMatches)) {
    const rank = parseInt(m[1])
    const candidate = sessionState.displayedCandidates?.find(c => c.rank === rank)
    if (candidate) products.push(candidate.displayCode)
  }

  return products
}

function inferReferencedField(message: string | null): string | null {
  if (!message) return null
  const clean = message.trim().toLowerCase()

  if (/소재|재질|피삭재|material|알루|스테인|주철|티타늄|고경도/.test(clean)) return "material"
  if (/코팅|coating|tialn|altin|dlc|alcrn/.test(clean)) return "coating"
  if (/직경|지름|diameter|\d+\s*mm/.test(clean)) return "diameterMm"
  if (/날수|날\s*수|flute|\d+\s*날/.test(clean)) return "fluteCount"
  if (/형상|shape|square|ball|radius/.test(clean)) return "toolSubtype"
  if (/시리즈|series/.test(clean)) return "seriesName"

  return null
}

function inferPreserveContext(message: string | null, intentShift: IntentShift): boolean {
  if (!message) return true
  if (intentShift === "restart") return false
  if (intentShift === "replace_constraint") return true // replace ONE thing, keep rest

  const clean = message.trim().toLowerCase()
  if (PRESERVE_PATTERNS.some(p => p.test(clean))) return true
  if (RESET_PATTERNS.some(p => p.test(clean))) return false

  // Default: preserve context in most intent shifts
  return true
}

function inferNextAction(
  mode: ContextMode,
  intentShift: IntentShift,
  hasConflict: boolean,
  sessionState: ExplorationSessionState | null
): ContextInterpretation["suggestedNextAction"] {
  if (intentShift === "restart") return "reset"
  if (hasConflict) return "repair"
  if (intentShift === "compare_products") return "compare"
  if (intentShift === "explain_recommendation") return "explain"

  switch (mode) {
    case "intake":
    case "narrowing":
      return "narrow"
    case "recommended":
      if (intentShift === "refine_existing" || intentShift === "replace_constraint" || intentShift === "branch_exploration") {
        return "repair"
      }
      return "recommend"
    case "compare":
      return "compare"
    default:
      return "narrow"
  }
}

function collectAnsweredFields(
  memory: ConversationMemory,
  sessionState: ExplorationSessionState | null
): string[] {
  const fields = new Set<string>()

  // From memory
  for (const item of memory.items) {
    if (item.status === "resolved" || item.status === "tentative") {
      fields.add(item.field)
    }
  }

  // From session filters
  if (sessionState?.appliedFilters) {
    for (const f of sessionState.appliedFilters) {
      fields.add(f.field)
    }
  }

  // From narrowing history
  if (sessionState?.narrowingHistory) {
    for (const turn of sessionState.narrowingHistory) {
      for (const filter of turn.extractedFilters) {
        fields.add(filter.field)
      }
    }
  }

  return Array.from(fields)
}
