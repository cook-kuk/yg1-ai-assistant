/**
 * Query Planner — 자연어 → QuerySpec
 *
 * 기존 sql-agent.ts를 대체/병행하는 semantic planner.
 * raw DB column 대신 semantic field manifest를 사용하여 LLM에 필드를 안내.
 *
 * 입력: userMessage, semanticManifest, currentQuerySpec, provider
 * 출력: QuerySpec
 */

import type { QuerySpec, QueryConstraint, QueryField, QueryOp, QueryIntent, NavigationAction, QuerySpecBuildResult } from "./query-spec"
import { buildManifestPromptSection } from "./query-spec-manifest"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { resolveModel } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

// ── System Prompt ───────────────────────────────────────────

function buildPlannerPrompt(currentConstraints: QueryConstraint[]): string {
  const manifest = buildManifestPromptSection()
  const currentList = currentConstraints.length > 0
    ? currentConstraints.map(c => `  ${c.field} ${c.op} ${c.value}`).join("\n")
    : "  (none)"

  return `You extract search constraints from user messages about cutting tools.

## Available Fields
${manifest}

## Current Constraints
${currentList}

## Output Format
Respond ONLY with a JSON object:
{
  "intent": "narrow" | "show_recommendation" | "question" | "comparison" | "general_chat",
  "navigation": "none" | "skip" | "back" | "reset",
  "constraints": [{"field":"<field>","op":"<op>","value":"<value>","display":"한국어 설명"}],
  "questionText": "only if intent=question",
  "reasoning": "brief reason"
}

## Rules
- field must be one of the listed fields above (semantic, not DB column)
- For exclusion (빼고/말고/제외) → op="neq"
- For navigation: 상관없음/패스 → skip, 처음부터/초기화 → reset, 이전/돌아가 → back
- For side questions (뭐야/무엇/설명) with no filter intent → intent="question", constraints=[]
- For "추천해줘/보여줘" with constraints → intent="show_recommendation"
- Value should be in the canonical form from examples when possible
- "싱크 타입", "생크 타입" → shankType (NOT brand, NOT toolSubtype)
- "스퀘어 타입", "볼 타입" → toolSubtype
- P/M/K/N/S/H 단일 알파벳 → materialGroup, 구체적 소재명(구리/스테인리스) → workpiece
- JSON only, no explanation outside the object`
}

// ── Core ────────────────────────────────────────────────────

const PLANNER_MODEL = resolveModel("haiku")

const VALID_FIELDS = new Set<string>([
  "materialGroup", "workpiece", "workPieceName", "toolFamily", "toolSubtype", "diameterMm",
  "fluteCount", "coating", "brand", "seriesName", "operationType",
  "operationShape", "shankType", "country",
  // Numeric range-capable fields (must match QUERY_FIELD_MANIFEST entries)
  "overallLengthMm", "lengthOfCutMm", "shankDiameterMm", "helixAngleDeg", "coolantHole",
  "pointAngleDeg", "threadPitchMm",
])

// Numeric fields that should coerce eq/neq/gte/lte values to Number.
const NUMERIC_FIELDS = new Set<string>([
  "diameterMm", "fluteCount", "overallLengthMm", "lengthOfCutMm",
  "shankDiameterMm", "helixAngleDeg", "pointAngleDeg", "threadPitchMm",
])

const VALID_OPS = new Set<string>([
  "eq", "neq", "in", "not_in", "contains", "gte", "lte", "between",
])

const VALID_INTENTS = new Set<string>([
  "narrow", "show_recommendation", "question", "comparison", "general_chat",
])

const VALID_NAVIGATIONS = new Set<string>([
  "none", "skip", "back", "reset",
])

export async function naturalLanguageToQuerySpec(
  userMessage: string,
  currentConstraints: QueryConstraint[],
  provider: LLMProvider,
): Promise<QuerySpecBuildResult> {
  const startMs = Date.now()
  const systemPrompt = buildPlannerPrompt(currentConstraints)

  const raw = await provider.complete(
    systemPrompt,
    [{ role: "user", content: userMessage }],
    512,
    PLANNER_MODEL,
  )

  const spec = parsePlannerResponse(raw)
  return {
    spec,
    raw,
    latencyMs: Date.now() - startMs,
  }
}

// ── Response Parser ─────────────────────────────────────────

function parsePlannerResponse(raw: string): QuerySpec {
  const fallback: QuerySpec = {
    intent: "narrow",
    navigation: "none",
    constraints: [],
    reasoning: "parse_failed",
  }

  const trimmed = raw.trim()

  // Try direct JSON parse
  let parsed: unknown = null
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // Try extracting {...} from response
    const match = trimmed.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) } catch { /* fall through */ }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    console.warn("[query-planner] failed to parse LLM response:", trimmed.slice(0, 200))
    return fallback
  }

  const obj = parsed as Record<string, unknown>
  return validateQuerySpec(obj)
}

function validateQuerySpec(obj: Record<string, unknown>): QuerySpec {
  const intent = VALID_INTENTS.has(String(obj.intent ?? ""))
    ? String(obj.intent) as QueryIntent
    : "narrow"

  const navigation = VALID_NAVIGATIONS.has(String(obj.navigation ?? ""))
    ? String(obj.navigation) as NavigationAction
    : "none"

  const rawConstraints = Array.isArray(obj.constraints) ? obj.constraints : []
  const constraints = rawConstraints
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map(c => validateConstraint(c))
    .filter((c): c is QueryConstraint => c !== null)

  return {
    intent,
    navigation,
    constraints,
    questionText: typeof obj.questionText === "string" ? obj.questionText : undefined,
    reasoning: typeof obj.reasoning === "string" ? obj.reasoning : undefined,
  }
}

function validateConstraint(obj: Record<string, unknown>): QueryConstraint | null {
  const field = String(obj.field ?? "")
  const op = String(obj.op ?? "")

  if (!VALID_FIELDS.has(field)) {
    console.warn(`[query-planner] invalid field "${field}", dropping constraint`)
    return null
  }
  if (!VALID_OPS.has(op)) {
    console.warn(`[query-planner] invalid op "${op}" for field "${field}", dropping`)
    return null
  }

  // Coerce value
  let value: string | number | [number, number]
  if (op === "between" && Array.isArray(obj.value) && obj.value.length === 2) {
    value = [Number(obj.value[0]), Number(obj.value[1])]
  } else if (["eq", "neq", "gte", "lte"].includes(op) && NUMERIC_FIELDS.has(field)) {
    const n = Number(obj.value)
    value = isNaN(n) ? String(obj.value ?? "") : n
  } else {
    value = String(obj.value ?? "")
  }

  return {
    field: field as QueryField,
    op: op as QueryOp,
    value,
    display: typeof obj.display === "string" ? obj.display : undefined,
  }
}
