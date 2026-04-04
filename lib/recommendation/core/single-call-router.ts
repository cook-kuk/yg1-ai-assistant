/**
 * Single-Call Router — routes user intent via ONE Haiku call
 * instead of multiple parallel Haiku calls.
 *
 * Feature-flagged behind USE_SINGLE_CALL_ROUTER.
 */

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"
import { buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"
import { LLM_FREE_INTERPRETATION } from "@/lib/feature-flags"
import { buildDomainKnowledgeSnippet } from "@/lib/recommendation/shared/patterns"

// ── Types ─────────────────────────────────────────────────────

export interface SingleCallAction {
  type:
    | "apply_filter"
    | "remove_filter"
    | "replace_filter"
    | "show_recommendation"
    | "compare"
    | "answer"
    | "skip"
    | "reset"
    | "go_back"
  field?: string
  value?: string | number
  from?: string
  to?: string
  op?: "eq" | "neq" | "in" | "range"
  targets?: string[]
  message?: string
  /** Set when canonicalization failed — runtime should fall back to legacy */
  _canonFailed?: boolean
}

export interface SingleCallResult {
  actions: SingleCallAction[]
  answer: string
  reasoning: string
}

// ── Validation ────────────────────────────────────────────────

const VALID_ACTION_TYPES = new Set([
  "apply_filter",
  "remove_filter",
  "replace_filter",
  "show_recommendation",
  "compare",
  "answer",
  "skip",
  "reset",
  "go_back",
])

const VALID_OPS = new Set(["eq", "neq", "in", "range"])

export function validateAction(action: unknown): action is SingleCallAction {
  if (!action || typeof action !== "object") return false
  const a = action as Record<string, unknown>
  if (!a.type || typeof a.type !== "string") return false
  if (!VALID_ACTION_TYPES.has(a.type)) return false
  if (a.op !== undefined && !VALID_OPS.has(a.op as string)) return false
  return true
}

export function validateAndCleanResult(raw: unknown): SingleCallResult {
  const empty: SingleCallResult = { actions: [], answer: "", reasoning: "" }
  if (!raw || typeof raw !== "object") return empty

  const r = raw as Record<string, unknown>
  const answer = typeof r.answer === "string" ? r.answer : ""
  const reasoning = typeof r.reasoning === "string" ? r.reasoning : ""

  if (!Array.isArray(r.actions)) return { actions: [], answer, reasoning }

  const validActions = r.actions.filter(validateAction) as SingleCallAction[]
  return { actions: validActions, answer, reasoning }
}

// ── JSON extraction ───────────────────────────────────────────

export function extractJsonFromResponse(text: string): unknown | null {
  // Try direct parse first
  try {
    return JSON.parse(text)
  } catch {
    // noop
  }

  // Try extracting from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim())
    } catch {
      // noop
    }
  }

  // Try finding first { ... } block
  const braceStart = text.indexOf("{")
  const braceEnd = text.lastIndexOf("}")
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1))
    } catch {
      // noop
    }
  }

  return null
}

// ── Prompt builder ────────────────────────────────────────────

function buildSessionSummary(state: ExplorationSessionState | null): string {
  if (!state) return "No session state (first turn)."

  const parts: string[] = []
  const filters = state.appliedFilters ?? []
  if (filters.length > 0) {
    parts.push(`Applied filters: ${filters.map(f => `${f.field}=${f.value}(${f.op})`).join(", ")}`)
  } else {
    parts.push("No filters applied yet.")
  }
  parts.push(`Candidate count: ${state.candidateCount ?? 0}`)
  if (state.lastAskedField) parts.push(`Last asked field: ${state.lastAskedField}`)
  if (state.currentMode) parts.push(`Mode: ${state.currentMode}`)
  if (state.displayedChips?.length) parts.push(`Displayed chips: ${state.displayedChips.join(", ")}`)
  if (state.resolutionStatus) parts.push(`Resolution: ${state.resolutionStatus}`)

  return parts.join("\n")
}

const SYSTEM_PROMPT_FULL = `You are a routing engine for a cutting tool recommendation chatbot (YG-1).
Given the user's Korean message and the current session state, determine what actions to take.

## Session State
{{SESSION_STATE}}

## Available Actions (return as JSON array)
- apply_filter: Add a new filter. Requires field, value, op (eq|neq|in|range).
- remove_filter: Remove an existing filter. Requires field.
- replace_filter: Change an existing filter value. Requires field, from, to.
- show_recommendation: User wants to see results now.
- compare: User wants to compare specific products. Requires targets (product name array).
- answer: User asked a general question (no filter change). Set message with the question.
- skip: User wants to skip the current question ("상관없음", "아무거나", "패스"). Optionally set field.
- reset: User wants to start over.
- go_back: User wants to undo the last step.

## IMPORTANT: Filter deduplication
If a filter already exists in Applied filters, do NOT re-apply the same value.
If user restates an already-applied condition, just skip that filter action.

## Korean Intent Patterns
- "빼고/제외/아닌것/없는거" → If the field already has a filter, use remove_filter. If no existing filter, use apply_filter with op:"neq"
  CRITICAL: "X 빼고" means REMOVE X, NOT add X. "Square 빼고" = remove Square filter.
- "바꿔/변경/대신/말고" -> replace_filter
- "상관없음/아무거나/패스/넘어가/알아서" -> skip
- Question ending with ? -> answer (no filter change)
- "추천해줘/보여줘/제품 보기/지금 바로" -> show_recommendation
- Multiple conditions in one message -> multiple actions

## CRITICAL: Field value rules
- toolSubtype values MUST be English only: Square, Ball, Radius, Roughing, Taper, Chamfer, High-Feed
  NEVER return Korean (스퀘어, 볼, 라디우스, 황삭). Always use English canonical names.
- fluteCount values MUST be numbers only: 2, 3, 4, 5, 6
  NEVER return "2날" or "4날". Just the number.
- coating values: TiAlN, AlCrN, DLC, TiCN, Bright Finish, Blue-Coating, X-Coating, Y-Coating, Uncoated
- diameterMm values: numbers only (e.g., 10, 8, 6.35)

## Available filter fields
- toolSubtype: tool shape (Square, Ball, Radius, Roughing, Taper, Chamfer, High-Feed)
- fluteCount: number of flutes (2, 3, 4, 5, 6)
- coating: coating type (TiAlN, AlCrN, DLC, TiCN, Bright Finish, Blue-Coating, X-Coating, Y-Coating, Uncoated)
- diameterMm: tool diameter in mm (number)
- lengthOfCutMm: length of cut / flute length in mm (number). "긴 가공" implies larger value.
- overallLengthMm: overall tool length in mm (number)
- workPieceName: specific workpiece material (구리/Copper, 알루미늄/Aluminum, 스테인리스/Stainless, 탄소강/Carbon Steel, 주철/Cast Iron, 티타늄/Titanium, 인코넬/Inconel, 고경도강/Hardened Steel). Use this when user mentions a SPECIFIC material name.
- material: material group code (P, M, K, N, S, H). Use this when user mentions an ISO code.

## Examples
User: "4날 TiAlN Square 추천해줘"
→ {"actions":[{"type":"apply_filter","field":"fluteCount","value":4,"op":"eq"},{"type":"apply_filter","field":"coating","value":"TiAlN","op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"}],"answer":"","reasoning":"3 filters from single message"}

User: "Square 빼고" (when toolSubtype=Square filter exists)
→ {"actions":[{"type":"remove_filter","field":"toolSubtype"}],"answer":"","reasoning":"user wants to remove Square filter"}

User: "Square 빼고 나머지로" (when toolSubtype=Square filter exists)
→ {"actions":[{"type":"remove_filter","field":"toolSubtype"}],"answer":"","reasoning":"remove existing Square filter to show all other subtypes"}

User: "TiAlN 제외하고" (when coating=TiAlN filter exists)
→ {"actions":[{"type":"remove_filter","field":"coating"}],"answer":"","reasoning":"remove TiAlN coating filter"}

User: "Ball 아닌 것들" (no existing toolSubtype filter)
→ {"actions":[{"type":"apply_filter","field":"toolSubtype","value":"Ball","op":"neq"}],"answer":"","reasoning":"exclude Ball subtype"}

User: "4날로 바꿔줘" (when fluteCount=6 filter exists)
→ {"actions":[{"type":"replace_filter","field":"fluteCount","from":"6","to":4}],"answer":"","reasoning":"replace 6 flute with 4 flute"}

User: "Ball로 변경해주세요" (when toolSubtype=Square filter exists)
→ {"actions":[{"type":"replace_filter","field":"toolSubtype","from":"Square","to":"Ball"}],"answer":"","reasoning":"replace Square with Ball"}

User: "TiAlN이 뭐야?"
→ {"actions":[],"answer":"TiAlN은 내열성 코팅입니다.","reasoning":"question, no filter change"}

User: "피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"구리","op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"},{"type":"apply_filter","field":"fluteCount","value":2,"op":"eq"},{"type":"apply_filter","field":"diameterMm","value":10,"op":"eq"}],"answer":"","reasoning":"4 filters: copper workpiece, square subtype, 2 flutes, 10mm diameter"}

User: "구리 스퀘어 2날 10mm"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"구리","op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"},{"type":"apply_filter","field":"fluteCount","value":2,"op":"eq"},{"type":"apply_filter","field":"diameterMm","value":10,"op":"eq"}],"answer":"","reasoning":"4 filters from natural Korean"}

User: "알루미늄 고속가공용 추천해줘"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"알루미늄","op":"eq"}],"answer":"","reasoning":"aluminum workpiece, high-speed implies finishing intent"}

User: "스퀘어를 쓰고싶고, 구리를 가공하고 싶어."
→ {"actions":[{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"},{"type":"apply_filter","field":"workPieceName","value":"구리","op":"eq"}],"answer":"","reasoning":"2 filters: square + copper workpiece"}

User: "3날 무코팅에 스퀘어" (feedback: user wanted 3-flute uncoated square)
→ {"actions":[{"type":"apply_filter","field":"fluteCount","value":3,"op":"eq"},{"type":"apply_filter","field":"coating","value":"Uncoated","op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"}],"answer":"","reasoning":"3 filters: 3 flutes, uncoated, square"}

User: "고경도강 밀링에 좋은 Solid end mill은 뭐가 있어?" (no filters yet)
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"고경도강","op":"eq"}],"answer":"","reasoning":"hardened steel workpiece, asking for recommendation"}

User: "SUS304 황삭할 건데 뭐가 좋아?"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"스테인리스","op":"eq"}],"answer":"","reasoning":"SUS304=stainless, roughing intent noted"}

User: "동 가공용 10미리 두날"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"구리","op":"eq"},{"type":"apply_filter","field":"diameterMm","value":10,"op":"eq"},{"type":"apply_filter","field":"fluteCount","value":2,"op":"eq"}],"answer":"","reasoning":"동=copper, 10미리=10mm, 두날=2 flutes"}

User: "비철 구리 Square 2날 Ø10"
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"구리","op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"},{"type":"apply_filter","field":"fluteCount","value":2,"op":"eq"},{"type":"apply_filter","field":"diameterMm","value":10,"op":"eq"}],"answer":"","reasoning":"비철 구리=copper, Ø10=diameter 10mm"}

User: "10mm 4날 Square TiAlN 탄소강"
→ {"actions":[{"type":"apply_filter","field":"diameterMm","value":10,"op":"eq"},{"type":"apply_filter","field":"fluteCount","value":4,"op":"eq"},{"type":"apply_filter","field":"toolSubtype","value":"Square","op":"eq"},{"type":"apply_filter","field":"coating","value":"TiAlN","op":"eq"},{"type":"apply_filter","field":"workPieceName","value":"탄소강","op":"eq"}],"answer":"","reasoning":"5 filters from single message"}

User: "알루파워라는 브랜드는 왜 추천해주지 않나요?" (question about missing brand)
→ {"actions":[],"answer":"알루파워(ALU-POWER) 시리즈가 후보에 포함되어 있는지 확인하겠습니다.","reasoning":"question about brand, no filter change"}

User: "T-Coating 설명해줘"
→ {"actions":[],"answer":"","reasoning":"question about coating type, no filter change"}

User: "SUS304 가공인데" (specific steel grade = workPieceName)
→ {"actions":[{"type":"apply_filter","field":"workPieceName","value":"SUS304","op":"eq"}],"answer":"","reasoning":"SUS304=stainless steel, set as workPieceName"}

User: "추천 제품 보기" / "지금 바로 제품 보기"
→ {"actions":[{"type":"show_recommendation"}],"answer":"","reasoning":"user wants to see results"}

User: "상관없음" / "아무거나 괜찮아" / "알아서 추천해줘"
→ {"actions":[{"type":"skip"}],"answer":"","reasoning":"user skips current question"}

## Response Format (strict JSON only, no markdown, no code blocks)
{
  "actions": [ { "type": "...", ... } ],
  "answer": "",
  "reasoning": "brief explanation"
}`

const SYSTEM_PROMPT_FREE = `You are a routing engine for a cutting tool recommendation chatbot (YG-1).
The user speaks Korean. Analyze the message and session state to determine actions.

## Session State
{{SESSION_STATE}}

## Available Actions (JSON array)
- apply_filter: {type, field, value, op} — field: toolSubtype(Square/Ball/Radius/Roughing/Taper/Chamfer/High-Feed), fluteCount(number), coating(TiAlN/AlCrN/DLC/TiCN/Bright Finish/Blue-Coating/Uncoated), diameterMm(number), workPieceName(구리/알루미늄/스테인리스/탄소강/주철/티타늄/인코넬/고경도강), material(P/M/K/N/S/H)
- remove_filter: {type, field} — "빼고/제외" + existing filter → remove
- replace_filter: {type, field, from, to} — "바꿔/변경" → replace value
- show_recommendation: {type} — "추천해줘/보여줘/제품 보기"
- compare: {type, targets} — product comparison
- answer: {type, message} — general question, NO filter change
- skip: {type, field?} — "상관없음/아무거나/패스/알아서"
- reset/go_back: {type}

## CRITICAL Rules
- toolSubtype values MUST be English: Square, Ball, Radius, Roughing, Taper, Chamfer, High-Feed
- fluteCount/diameterMm MUST be numbers only (not "2날", just 2)
- "X 빼고" when filter exists = remove_filter(field). NOT add X.
- Questions (ending with ?) = answer action, NO filter changes
- If filter already applied in session, do NOT re-apply

## Key Examples
"피삭재는 구리 SQUARE 2날 직경 10" → [apply workPieceName=구리, toolSubtype=Square, fluteCount=2, diameterMm=10]
"3날 무코팅에 스퀘어" → [apply fluteCount=3, coating=Uncoated, toolSubtype=Square]
"Square 빼고" (existing filter) → [remove toolSubtype]
"Ball로 바꿔" (toolSubtype=Square exists) → [replace toolSubtype from=Square to=Ball]
"TiAlN이 뭐야?" → answer, no filter
"상관없음" → skip

${buildDomainKnowledgeSnippet()}

Response: strict JSON {"actions": [...], "answer": "", "reasoning": "brief"}`

function buildSystemPrompt(state: ExplorationSessionState | null): string {
  const template = LLM_FREE_INTERPRETATION ? SYSTEM_PROMPT_FREE : SYSTEM_PROMPT_FULL
  return template.replace("{{SESSION_STATE}}", buildSessionSummary(state))
}

// ── Main function ─────────────────────────────────────────────

const SINGLE_CALL_ROUTER_MODEL = "haiku" as const

export async function routeSingleCall(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<SingleCallResult> {
  const systemPrompt = buildSystemPrompt(sessionState)

  try {
    console.log(`[SCR] calling LLM, msg: "${userMessage}", hasState: ${!!sessionState}, candidateCount: ${sessionState?.candidateCount ?? "null"}`)

    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: userMessage }],
      2000,
      SINGLE_CALL_ROUTER_MODEL,
      "single-call-router"
    )

    console.log(`[SCR] raw response (first 500): ${raw?.substring(0, 500)}`)

    const parsed = extractJsonFromResponse(raw)
    if (!parsed) {
      console.warn("[SCR] Failed to parse JSON from LLM response, raw:", raw?.substring(0, 200))
      return { actions: [], answer: "", reasoning: "parse_failure" }
    }

    console.log(`[SCR] parsed raw: ${JSON.stringify(parsed).substring(0, 300)}`)

    const result = validateAndCleanResult(parsed)
    console.log(`[SCR] validated actions (pre-canonicalize): ${result.actions.map(a => `${a.type}(${a.field}=${a.value ?? a.to ?? ""})`).join(", ") || "EMPTY"}`)

    // Canonicalize ALL action values through filter-field-registry
    // This ensures Korean values from LLM (스퀘어→Square, 4날→4) are normalized
    const canonicalizedActions: SingleCallAction[] = []
    for (const action of result.actions) {
      if (action.type === "apply_filter" && action.field && action.value != null) {
        const filter = buildAppliedFilterFromValue(action.field, action.value)
        if (filter) {
          canonicalizedActions.push({ ...action, field: filter.field, value: filter.rawValue as string | number })
        } else {
          console.warn(`[single-call-router] canonicalize failed: field=${action.field} value=${action.value}, passing through with _canonFailed`)
          canonicalizedActions.push({ ...action, _canonFailed: true })
        }
      } else if (action.type === "replace_filter" && action.field && action.to != null) {
        const filter = buildAppliedFilterFromValue(action.field, action.to)
        if (filter) {
          canonicalizedActions.push({ ...action, field: filter.field, to: String(filter.rawValue) })
        } else {
          console.warn(`[single-call-router] canonicalize replace failed: field=${action.field} to=${action.to}, passing through with _canonFailed`)
          canonicalizedActions.push({ ...action, _canonFailed: true })
        }
      } else {
        // skip, reset, go_back, compare, answer, remove_filter, show_recommendation — pass through
        canonicalizedActions.push(action)
      }
    }

    console.log(`[single-call-router] ${canonicalizedActions.length} actions: ${canonicalizedActions.map(a => `${a.type}(${a.field ?? ""}=${a.value ?? a.to ?? ""})`).join(", ")}`)

    return { actions: canonicalizedActions, answer: result.answer, reasoning: result.reasoning }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[SCR] ERROR: ${errMsg}`)
    return { actions: [], answer: "", reasoning: `llm_error:${errMsg.slice(0, 100)}` }
  }
}
