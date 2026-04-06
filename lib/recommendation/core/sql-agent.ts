/**
 * SQL Agent — LLM이 DB schema를 보고 자연어에서 WHERE절 필터를 생성.
 * filter-field-registry.ts의 수동 매핑을 보완하는 추가 레이어.
 * Haiku 1회 호출로 동작.
 */

import type { DbSchema } from "./sql-agent-schema-cache"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { resolveModel } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter } from "@/lib/types/exploration"

// ── Types ────────────────────────────────────────────────────

export interface AgentFilter {
  field: string
  op: "eq" | "neq" | "like" | "gte" | "lte" | "between" | "skip" | "reset" | "back"
  value: string
  display?: string
}

export interface SqlAgentResult {
  filters: AgentFilter[]
  raw: string
}

// ── Column → filter-field-registry field mapping ─────────────

const DB_COL_TO_FILTER_FIELD: Record<string, string> = {
  search_subtype: "toolSubtype",
  search_coating: "coating",
  search_diameter_mm: "diameterMm",
  search_flute_count: "fluteCount",
  option_numberofflute: "fluteCount",
  option_z: "fluteCount",
  edp_brand_name: "brand",
  edp_series_name: "seriesName",
  edp_root_category: "toolFamily",
  milling_tool_material: "toolMaterial",
  holemaking_tool_material: "toolMaterial",
  threading_tool_material: "toolMaterial",
  // workpiece is handled specially via _workPieceName
  _workPieceName: "workPieceName",
}

// Navigation pseudo-fields
const NAV_FIELDS = new Set(["_skip", "_reset", "_back"])

// ── System Prompt Builder ────────────────────────────────────

function buildSystemPrompt(schema: DbSchema, existingFilters: AppliedFilter[]): string {
  const colList = schema.columns
    .map(c => `  ${c.column_name} (${c.data_type})`)
    .join("\n")

  const sampleList = Object.entries(schema.sampleValues)
    .map(([col, vals]) => `  ${col}: ${vals.slice(0, 20).join(", ")}`)
    .join("\n")

  const wpList = schema.workpieces
    .map(w => `  ${w.tag_name} → ${w.normalized_work_piece_name}`)
    .join("\n")

  const brandList = schema.brands.join(", ")

  const filterList = existingFilters.length > 0
    ? existingFilters.map(f => `  ${f.field} ${f.op} ${f.value}`).join("\n")
    : "  (none)"

  return `You are a SQL filter expert for YG-1 cutting tool catalog.

## DB Schema (catalog_app.product_recommendation_mv)
${colList}

## Sample Values per Column
${sampleList}

## Workpiece Materials (from series_profile_mv)
${wpList}

## Brand Names
${brandList}

## Currently Applied Filters
${filterList}

## Instructions
Extract filter conditions from user message as JSON array:
[{"field":"column_name","op":"eq|neq|like|gte|lte|between","value":"...","display":"한국어 설명"}]

Rules:
- field MUST be actual column_name from schema or "_workPieceName" for workpiece or "_skip"/"_reset"/"_back" for navigation
- 구리/copper/동 → {"field":"_workPieceName","op":"eq","value":"Copper","display":"피삭재: 구리"}
- 스퀘어/square → search_subtype LIKE '%Square%'
- 직경 10 → search_diameter_mm = 10
- 4날/4 flute → search_flute_count = 4 or option_z = '4'
- TiAlN/코팅 → search_coating LIKE '%TiAlN%'
- 빼고/말고/제외/아닌것 → op="neq"
- 상관없음/패스/넘어가 → [{"field":"_skip","op":"skip","value":"skip"}]
- 처음부터/초기화 → [{"field":"_reset","op":"reset","value":"reset"}]
- 이전/돌아가 → [{"field":"_back","op":"back","value":"back"}]
- 질문(뭐야?/차이/알려줘) → [] (empty = no filter change)
- Brand search: "CRX-S" → edp_brand_name LIKE '%CRX%'
- ALWAYS respond with valid JSON array only. No explanation.`
}

// ── Core: Natural Language → Filters ─────────────────────────

const SQL_AGENT_MODEL = resolveModel("haiku")

export async function naturalLanguageToFilters(
  userMessage: string,
  schema: DbSchema,
  existingFilters: AppliedFilter[],
  provider: LLMProvider,
): Promise<SqlAgentResult> {
  const systemPrompt = buildSystemPrompt(schema, existingFilters)
  const raw = await provider.complete(
    systemPrompt,
    [{ role: "user", content: userMessage }],
    512,
    SQL_AGENT_MODEL,
  )

  const filters = parseAgentResponse(raw)
  return { filters, raw }
}

// ── Response Parser ──────────────────────────────────────────

function parseAgentResponse(raw: string): AgentFilter[] {
  const trimmed = raw.trim()

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return validateFilters(parsed)
  } catch { /* fall through */ }

  // Try extracting [...] from response
  const match = trimmed.match(/\[[\s\S]*\]/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed)) return validateFilters(parsed)
    } catch { /* fall through */ }
  }

  // Graceful fallback: empty array
  console.warn("[sql-agent] failed to parse LLM response, returning empty filters:", trimmed.slice(0, 200))
  return []
}

function validateFilters(arr: unknown[]): AgentFilter[] {
  return arr.filter((item): item is AgentFilter => {
    if (typeof item !== "object" || item === null) return false
    const obj = item as Record<string, unknown>
    return typeof obj.field === "string" && typeof obj.op === "string" && typeof obj.value !== "undefined"
  }).map(f => ({
    field: f.field,
    op: f.op,
    value: String(f.value),
    display: f.display ? String(f.display) : undefined,
  }))
}

// ── AgentFilter → AppliedFilter conversion ───────────────────

export function buildAppliedFilterFromAgentFilter(
  agentFilter: AgentFilter,
  turnCount: number,
): AppliedFilter | null {
  // Navigation pseudo-fields
  if (NAV_FIELDS.has(agentFilter.field)) {
    return {
      field: agentFilter.field.replace(/^_/, ""),
      op: agentFilter.op as AppliedFilter["op"],
      value: agentFilter.value,
      rawValue: agentFilter.value,
      appliedAt: turnCount,
    }
  }

  // Map DB column to filter-field-registry field name
  const registryField = DB_COL_TO_FILTER_FIELD[agentFilter.field] ?? null

  // Convert op for compatibility
  const op = agentFilter.op === "like" ? "includes" as const
    : agentFilter.op === "neq" ? "neq" as const
    : "eq" as const

  if (registryField) {
    // Known field → standard AppliedFilter
    return {
      field: registryField,
      op,
      value: agentFilter.display ?? agentFilter.value,
      rawValue: coerceRawValue(registryField, agentFilter.value),
      appliedAt: turnCount,
    }
  }

  // Unknown DB column → store as rawSql for direct WHERE injection
  return {
    field: agentFilter.field,
    op,
    value: agentFilter.display ?? agentFilter.value,
    rawValue: agentFilter.value,
    appliedAt: turnCount,
    rawSqlField: agentFilter.field,
  } as AppliedFilter & { rawSqlField: string }
}

// ── Helpers ──────────────────────────────────────────────────

function coerceRawValue(field: string, value: string): string | number {
  if (field === "diameterMm" || field === "fluteCount") {
    const n = parseFloat(value)
    return isNaN(n) ? value : n
  }
  return value
}
