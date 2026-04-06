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

// ── Column Descriptions (derived from DB spec) ─────────────
// MV column → Korean description for LLM context

const COL_DESCRIPTIONS: Record<string, string> = {
  // EDP 기본
  edp_idx: "EDP 고유 인덱스",
  edp_no: "EDP 제품 번호",
  edp_brand_name: "브랜드명 (YG-1, CRX-S, etc.)",
  edp_series_name: "시리즈명",
  edp_series_idx: "시리즈 인덱스",
  edp_root_category: "최상위 카테고리 (Milling, Holemaking, Threading, Tooling, Turning)",
  edp_unit: "단위 (Metric/Inch)",
  // 검색 인덱스 (통합)
  search_diameter_mm: "직경 (mm, 숫자)",
  search_coating: "코팅 (TiAlN, AlCrN, DLC, Diamond, Uncoated 등)",
  search_subtype: "공구 형상 (Square, Ball, Radius, Roughing, Taper, Chamfer, High-Feed 등)",
  search_flute_count: "날수 (숫자)",
  // 공통 옵션
  option_z: "날수 (Z)",
  option_numberofflute: "날수",
  option_drill_diameter: "드릴 직경",
  option_d1: "직경 D1",
  option_dc: "절삭 직경 Dc",
  option_d: "직경 D",
  option_shank_diameter: "생크 직경",
  option_dcon: "연결부 직경",
  option_flute_length: "홈 길이",
  option_loc: "절삭 길이 (LOC)",
  option_overall_length: "전체 길이 (OAL)",
  option_oal: "전체 길이",
  option_r: "반경 R",
  option_re: "코너 반경 RE",
  option_taperangle: "테이퍼 각도",
  option_coolanthole: "쿨런트홀 유무",
  // Milling 전용
  milling_outside_dia: "밀링 외경",
  milling_number_of_flute: "밀링 날수",
  milling_coating: "밀링 코팅",
  milling_tool_material: "밀링 공구 소재 (Carbide, HSS, CBN 등)",
  milling_shank_dia: "밀링 생크 직경",
  milling_length_of_cut: "밀링 절삭 길이",
  milling_overall_length: "밀링 전체 길이",
  milling_helix_angle: "밀링 헬릭스 각도",
  milling_ball_radius: "밀링 볼 반경",
  milling_taper_angle: "밀링 테이퍼 각도",
  milling_coolant_hole: "밀링 쿨런트홀",
  milling_cutting_edge_shape: "밀링 절삭 모서리 형상",
  milling_cutter_shape: "밀링 커터 형상",
  // Holemaking 전용
  holemaking_outside_dia: "홀메이킹 외경",
  holemaking_number_of_flute: "홀메이킹 날수",
  holemaking_coating: "홀메이킹 코팅",
  holemaking_tool_material: "홀메이킹 공구 소재",
  holemaking_shank_dia: "홀메이킹 생크 직경",
  holemaking_flute_length: "홀메이킹 홈 길이",
  holemaking_overall_length: "홀메이킹 전체 길이",
  holemaking_helix_angle: "홀메이킹 헬릭스 각도",
  holemaking_coolant_hole: "홀메이킹 쿨런트홀",
  // Threading 전용
  threading_outside_dia: "쓰레딩 외경",
  threading_number_of_flute: "쓰레딩 날수",
  threading_coating: "쓰레딩 코팅",
  threading_tool_material: "쓰레딩 공구 소재",
  threading_shank_dia: "쓰레딩 생크 직경",
  threading_thread_length: "쓰레딩 나사 길이",
  threading_overall_length: "쓰레딩 전체 길이",
  threading_coolant_hole: "쓰레딩 쿨런트홀",
  threading_flute_type: "쓰레딩 홈 타입",
  threading_thread_shape: "쓰레딩 나사 형상",
  // Series 정보
  series_brand_name: "시리즈 브랜드명",
  series_description: "시리즈 설명",
  series_feature: "시리즈 특징",
  series_tool_type: "시리즈 툴타입",
  series_product_type: "시리즈 제품타입",
  series_application_shape: "시리즈 적용공법",
  series_cutting_edge_shape: "시리즈 모서리 절삭모양",
}

// ── System Prompt Builder ────────────────────────────────────

function buildSystemPrompt(schema: DbSchema, existingFilters: AppliedFilter[]): string {
  const colList = schema.columns
    .map(c => {
      const desc = COL_DESCRIPTIONS[c.column_name]
      return desc
        ? `  ${c.column_name} (${c.data_type}) — ${desc}`
        : `  ${c.column_name} (${c.data_type})`
    })
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
- field MUST be actual column_name from schema, or "_workPieceName" for workpiece materials, or "_skip"/"_reset"/"_back" for navigation
- Use column descriptions and sample values to determine the correct column for the user's intent
- For exclusion/negation (빼고/말고/제외/아닌것 etc.) → op="neq"
- For navigation: skip(상관없음/패스) → _skip, reset(처음부터/초기화) → _reset, back(이전/돌아가) → _back
- For questions or non-filter messages → [] (empty array)
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

  // Unknown DB column → store as rawSqlField for direct WHERE injection
  return {
    field: agentFilter.field,
    op,
    value: agentFilter.display ?? agentFilter.value,
    rawValue: agentFilter.value,
    appliedAt: turnCount,
    rawSqlField: agentFilter.field,
    rawSqlOp: agentFilter.op,
  }
}

// ── Helpers ──────────────────────────────────────────────────

function coerceRawValue(field: string, value: string): string | number {
  if (field === "diameterMm" || field === "fluteCount") {
    const n = parseFloat(value)
    return isNaN(n) ? value : n
  }
  return value
}
