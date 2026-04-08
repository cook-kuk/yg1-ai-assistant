/**
 * SQL Agent — LLM이 DB schema를 보고 자연어에서 WHERE절 필터를 생성.
 * filter-field-registry.ts의 수동 매핑을 보완하는 추가 레이어.
 * Haiku 1회 호출로 동작.
 */

import { getDbSchemaSync, type DbSchema } from "./sql-agent-schema-cache"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { resolveModel } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter } from "@/lib/types/exploration"

// ── Types ────────────────────────────────────────────────────

export interface AgentFilter {
  field: string
  op: "eq" | "neq" | "like" | "skip" | "reset" | "back" | "gte" | "lte" | "between"
  value: string
  /** Upper bound for between op (range queries). */
  value2?: string
  display?: string
}

export interface SqlAgentResult {
  filters: AgentFilter[]
  raw: string
  /** 한국어 추론 과정 — UI 의 "추론 과정 보기" 접이식에 표시. */
  reasoning?: string
}

// ── Column → filter-field-registry field mapping ─────────────

export const DB_COL_TO_FILTER_FIELD: Record<string, string> = {
  search_subtype: "toolSubtype",
  search_coating: "coating",
  search_diameter_mm: "diameterMm",
  search_flute_count: "fluteCount",
  option_numberofflute: "fluteCount",
  option_z: "fluteCount",
  edp_brand_name: "brand",
  edp_series_name: "seriesName",
  edp_root_category: "toolType",
  milling_tool_material: "toolMaterial",
  holemaking_tool_material: "toolMaterial",
  threading_tool_material: "toolMaterial",
  shank_type: "shankType",
  // 길이/생크 계열 — registry 필드와 정렬
  option_loc: "lengthOfCutMm",
  option_overall_length: "overallLengthMm",
  option_oal: "overallLengthMm",
  option_shank_diameter: "shankDiameterMm",
  milling_length_of_cut: "lengthOfCutMm",
  milling_overall_length: "overallLengthMm",
  milling_shank_dia: "shankDiameterMm",
  holemaking_overall_length: "overallLengthMm",
  holemaking_shank_dia: "shankDiameterMm",
  threading_overall_length: "overallLengthMm",
  threading_shank_dia: "shankDiameterMm",
  // 각도 계열
  option_taperangle: "taperAngleDeg",
  milling_taper_angle: "taperAngleDeg",
  milling_helix_angle: "helixAngleDeg",
  holemaking_helix_angle: "helixAngleDeg",
  // 반경 계열 (코너R/볼R 모두 ballRadiusMm 통합 — registry 단일 필드)
  option_re: "ballRadiusMm",
  option_r: "ballRadiusMm",
  milling_ball_radius: "ballRadiusMm",
  // 쿨런트홀
  option_coolanthole: "coolantHole",
  milling_coolant_hole: "coolantHole",
  holemaking_coolant_hole: "coolantHole",
  threading_coolant_hole: "coolantHole",
  // 외경 계열 (커터 직경/드릴 직경/Dc/D1/D 모두 diameterMm로 통합)
  option_dc: "diameterMm",
  option_d: "diameterMm",
  option_d1: "diameterMm",
  option_drill_diameter: "diameterMm",
  milling_outside_dia: "diameterMm",
  holemaking_outside_dia: "diameterMm",
  threading_outside_dia: "diameterMm",
  // 포인트 각도 / 쓰레드 피치 (이전에 빠져 있어 LLM이 milling_point_angle 같은 가짜 컬럼을 emit했음)
  holemaking_point_angle: "pointAngleDeg",
  // Defensive aliases for hallucinated variants
  milling_point_angle: "pointAngleDeg",
  point_angle: "pointAngleDeg",
  threading_pitch: "threadPitchMm",
  thread_pitch: "threadPitchMm",
  threading_tpi: "threadPitchMm",
  // workpiece is handled specially via _workPieceName
  _workPieceName: "workPieceName",
  // Country codes are stored as text[] (unnested by schema cache for indexing).
  country_codes: "country",
}

// Navigation pseudo-fields
const NAV_FIELDS = new Set(["_skip", "_reset", "_back"])

// ── System Prompt Builder ────────────────────────────────────
// NO hardcoded column descriptions. The LLM reads column names + sample values
// directly from the DB schema and matches user intent itself. Adding a new
// column to the MV requires zero code changes — it shows up automatically.

function buildSystemPrompt(schema: DbSchema, existingFilters: AppliedFilter[]): string {
  const colList = schema.columns
    .map(c => `  ${c.column_name} (${c.data_type})`)
    .join("\n")

  const sampleList = Object.entries(schema.sampleValues)
    .filter(([, vals]) => vals.length > 0)
    .map(([col, vals]) => `  ${col}: ${vals.slice(0, 30).join(", ")}`)
    .join("\n")

  const numericList = Object.entries(schema.numericStats)
    .map(([col, s]) => `  ${col}: min=${s.min} max=${s.max} examples=[${s.samples.slice(0, 8).join(", ")}]`)
    .join("\n")

  const wpList = schema.workpieces
    .map(w => `  ${w.tag_name} → ${w.normalized_work_piece_name}`)
    .join("\n")

  const brandList = schema.brands.join(", ")

  const auxList = Object.entries(schema.auxTables ?? {})
    .map(([table, cols]) => `### ${table}\n${cols.map(c => `  ${c.column_name} (${c.data_type})`).join("\n")}`)
    .join("\n\n")

  const filterList = existingFilters.length > 0
    ? existingFilters.map(f => `  ${f.field} ${f.op} ${f.value}`).join("\n")
    : "  (none)"

  return `You are a SQL filter expert for YG-1 cutting tool catalog.

## DB Schema (catalog_app.product_recommendation_mv)
${colList}

## Text Column Sample Values
${sampleList}

## Numeric Column Stats (min/max/examples)
${numericList}

## Workpiece Materials (from series_profile_mv)
${wpList}

## Brand Names
${brandList}

## Auxiliary Tables (read-only reference — not directly filtered, but informs which questions need a tool-forge join)
${auxList || "  (none loaded)"}

If the user asks about cutting conditions / RPM / feed rate / 절삭조건 / 회전수 / 이송속도 / 절입깊이, those numbers live in raw_catalog.cutting_condition_table — return [] here so the upstream tool-forge handles the join. Do NOT invent product-MV columns for those.

===DYNAMIC===

## Currently Applied Filters
${filterList}

## Instructions
Extract filter conditions and a short Korean reasoning trail from the user message as a JSON object:
{"reasoning":"한국어 추론 과정 (2-4문장, 사용자 의도 → 컬럼 선택 이유 → 값 매핑 순서)","filters":[{"field":"column_name","op":"eq|neq|like|gte|lte|between","value":"...","value2":"upper_bound_for_between","display":"한국어 설명"}]}

The "filters" array must always be present (use [] when there is nothing to extract). The "reasoning" string is shown to the end user as a "추론 과정 보기" — write it like a senior engineer explaining their thought process, not like a JSON dump. Use phrases like "~로 판단됩니다", "~가 적합합니다". 2-4 sentences max. If the message is purely a question or trivial, set reasoning to a one-line explanation of why no filters were emitted.

Rules:
- field MUST be one of the actual column_names listed above (product_recommendation_mv only), or "_workPieceName" for workpiece materials, or "_skip"/"_reset"/"_back" for navigation. NEVER invent a column name.
- Match user intent to columns by reading the column name AND its sample values. The column name is in English; map Korean/Japanese/etc. terms to it semantically. If multiple columns plausibly match (e.g. milling_* vs holemaking_*), prefer the one whose sample values or numeric range fits the user's number.
- For exclusion/negation (빼고/말고/제외/아닌것 등) → op="neq"
- For navigation: skip(상관없음/패스) → _skip, reset(처음부터/초기화) → _reset, back(이전/돌아가) → _back
- For pure questions or non-filter messages → [] (empty array)

## Range/Comparison Operators (numeric columns)
NEVER use eq when the user expressed a range:
- "이상/넘는/초과/최소" → gte
- "이하/미만/최대/넘지 않는" → lte
- "A~B / A에서 B 사이 / A부터 B까지" → between with value=A, value2=B
- "정도/근처/대략/around" → between ±10% of the number
- Pick the column whose name matches the user's label (직경→diameter, 전장/OAL→overall_length, 날장/LOC→length_of_cut, 샹크→shank, 헬릭스→helix, 날수→flute, etc.) AND whose min/max range contains the user's number. Do not emit duplicate eq filters for the same number on different columns.

## Korean → English semantic hints (use op:like when the chemical/internal name may differ)
- 공구 소재: 초경/카바이드/솔리드/Carbide/cemented → like "Carbide" · 하이스/HSS/고속도강/high speed steel → like "HSS" · 코발트하이스/HSS-Co/HSS-CO/분말 하이스/PM HSS → like "HSS-Co" · 서멧/Cermet → like "Cermet" · PCD/diamond → like "PCD" · CBN → like "CBN" · 다이아몬드 → like "Diamond"
- 코팅: TiAlN/X코팅 → like "TiAlN" or "X-Coating" · AlCrN/Y코팅 → like "AlCrN" or "Y-Coating" · DLC → like "DLC" · 무코팅/비코팅/uncoated/bright → like "Uncoated" or "Bright" · nACo → like "nACo" · CrN → like "CrN" · TiN → like "TiN" · TiCN → like "TiCN" · ZrN → like "ZrN" · "코팅된 거"/"코팅 있는 거"/"코팅 엔드밀" → search_coating neq "Bright" (코팅 존재 여부 필터)
- 영어 형상 변형: flat/flat endmill → "Square" · bull nose/bullnose → "Radius" or "Corner Radius" · ball nose/ballnose → "Ball" · 4 teeth/4 flute/4-flute → search_flute_count eq 4
- 피삭재 (use _workPieceName eq): 스테인리스/스텐/SUS → "스테인리스" · 티타늄/Ti → "티타늄" · 알루미늄/AL → "알루미늄" · 주철/FC/FCD → "주철" · 탄소강/SM45C → "탄소강" · 고경도강/SKD11 → "고경도강" · 인코넬/내열합금 → "인코넬" · 구리/동/황동 → "구리" · 합금강/SCM440 → "합금강" · 복합재/CFRP → "복합재" · 흑연 → "흑연"
- 공구 형상: 스퀘어/평날 → search_subtype eq "Square" · 볼/볼엔드밀 → "Ball" · 라디우스/코너R → like "Radius" · 러핑/황삭 → "Roughing" · 테이퍼 → "Taper" · 챔퍼/모따기 → "Chamfer" · 하이피드/고이송 → like "High-Feed"
- 가공 형상: 측면가공 → series_application_shape like "side" · 포켓 → like "pocket" · 곡면 → like "contour"
- 생크: 플레인/스트레이트 → shank_type like "Plain" · 웰던 → like "Weldon" · HA → like "HA"
- 국가 (text[]): 국내/한국 → eq "KOR" · 미국/인치 → eq "USA" · 유럽 → eq "ENG" · 일본 → eq "JPN"
- 모호한 표현(좋은 거/추천해줘/괜찮은 거/범용/다양한) → []

## Examples
User: "스테인리스 가공할건데 4날 스퀘어 10mm"
→ {"reasoning":"스테인리스(ISO M군) 가공용 4날 스퀘어 엔드밀 직경 10mm 조건으로 검색합니다. 스테인리스에는 내열성 높은 AlCrN(Y-Coating) 계열이 적합합니다.","filters":[{"field":"_workPieceName","op":"eq","value":"스테인리스","display":"피삭재: 스테인리스"},{"field":"search_subtype","op":"eq","value":"Square","display":"형상: 스퀘어"},{"field":"search_flute_count","op":"eq","value":"4","display":"날수: 4날"},{"field":"search_diameter_mm","op":"eq","value":"10","display":"직경: 10mm"}]}

User: "구리 비슷한 소재 가공할건데 떨림 적은 거"
→ {"reasoning":"구리와 유사한 비철금속(ISO N군)으로 판단됩니다. 떨림을 줄이려면 부등분할 4날 스퀘어 엔드밀이 안정적이며, 비철금속에는 DLC 코팅이 칩 부착을 방지합니다.","filters":[{"field":"_workPieceName","op":"eq","value":"구리","display":"피삭재: 구리(비철금속)"},{"field":"search_flute_count","op":"eq","value":"4","display":"날수: 4날(떨림 방지)"},{"field":"search_subtype","op":"eq","value":"Square","display":"형상: 스퀘어"}]}

User: "초경 카바이드 소재로만"
→ [{"field":"milling_tool_material","op":"like","value":"Carbide","display":"공구소재: 초경(Carbide)"}]

User: "Y 코팅으로 추천해줘"
→ [{"field":"search_coating","op":"like","value":"Y-Coating","display":"코팅: Y-Coating(AlCrN)"}]

User: "10mm 근처 직경"
→ [{"field":"search_diameter_mm","op":"between","value":"9","value2":"11","display":"직경: ~10mm(9~11)"}]

User: "DLC 빼고 코팅 있는 거"
→ [{"field":"search_coating","op":"neq","value":"DLC","display":"DLC 제외"}]

User: "적용공법이 side milling인"
→ [{"field":"series_application_shape","op":"like","value":"side","display":"적용공법: side milling"}]

User: "인치 제품"
→ [{"field":"edp_unit","op":"eq","value":"Inch","display":"단위: 인치"}]

User: "상관없음"
→ [{"field":"_skip","op":"skip","value":"skip"}]

User: "X-POWER 시리즈의 SUS304 절삭조건 알려줘"
→ []   (cutting conditions live in an aux table — let tool-forge handle it)

ALWAYS respond with a single valid JSON object {"reasoning":"...","filters":[...]} — no markdown fences, no prose outside JSON.`
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

  const { filters, reasoning } = parseAgentResponse(raw)
  return { filters, raw, reasoning }
}

// ── Response Parser ──────────────────────────────────────────

function parseAgentResponse(raw: string): { filters: AgentFilter[]; reasoning?: string } {
  const trimmed = raw.trim()

  // New format: {"reasoning":"...","filters":[...]}
  // Old format: [...]
  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as { filters?: unknown }).filters)) {
      const obj = parsed as { reasoning?: unknown; filters: unknown[] }
      return {
        filters: validateFilters(obj.filters),
        reasoning: typeof obj.reasoning === "string" && obj.reasoning.trim() ? obj.reasoning.trim() : undefined,
      }
    }
    if (Array.isArray(parsed)) return { filters: validateFilters(parsed) }
  } catch { /* fall through */ }

  // Try extracting {...filters...} object
  const objMatch = trimmed.match(/\{[\s\S]*"filters"[\s\S]*\}/)
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0])
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.filters)) {
        return {
          filters: validateFilters(parsed.filters),
          reasoning: typeof parsed.reasoning === "string" && parsed.reasoning.trim() ? parsed.reasoning.trim() : undefined,
        }
      }
    } catch { /* fall through */ }
  }

  // Try extracting [...] from response (legacy)
  const arrMatch = trimmed.match(/\[[\s\S]*\]/)
  if (arrMatch) {
    try {
      const parsed = JSON.parse(arrMatch[0])
      if (Array.isArray(parsed)) return { filters: validateFilters(parsed) }
    } catch { /* fall through */ }
  }

  // Graceful fallback: empty array
  console.warn("[sql-agent] failed to parse LLM response, returning empty filters:", trimmed.slice(0, 200))
  return { filters: [] }
}

const VALID_AGENT_OPS = new Set(["eq", "neq", "like", "skip", "reset", "back", "gte", "lte", "between"])

function validateFilters(arr: unknown[]): AgentFilter[] {
  return arr.filter((item): item is AgentFilter => {
    if (typeof item !== "object" || item === null) return false
    const obj = item as Record<string, unknown>
    return typeof obj.field === "string"
      && typeof obj.op === "string"
      && VALID_AGENT_OPS.has(obj.op)
      && typeof obj.value !== "undefined"
  }).map(f => ({
    field: f.field,
    op: f.op,
    value: String(f.value),
    value2: f.value2 != null ? String(f.value2) : undefined,
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

  // Convert op for compatibility — preserve range ops directly.
  const op: AppliedFilter["op"] = agentFilter.op === "like" ? "includes"
    : agentFilter.op === "neq" ? "neq"
    : agentFilter.op === "gte" ? "gte"
    : agentFilter.op === "lte" ? "lte"
    : agentFilter.op === "between" ? "between"
    : "eq"

  if (registryField) {
    // For between, store both bounds in rawValue / rawValue2.
    const isBetween = op === "between" && agentFilter.value2 != null
    const rawValue = coerceRawValue(registryField, agentFilter.value)
    const filter: AppliedFilter = {
      field: registryField,
      op,
      value: agentFilter.display ?? (isBetween ? `${agentFilter.value}~${agentFilter.value2}` : agentFilter.value),
      rawValue,
      appliedAt: turnCount,
    }
    if (isBetween) {
      ;(filter as AppliedFilter & { rawValue2?: number | string }).rawValue2 = coerceRawValue(registryField, agentFilter.value2 as string)
    }
    return filter
  }

  // Not in the DB_COL_TO_FILTER_FIELD whitelist — but the LLM may still have
  // picked a real MV column. Validate against the live schema. If the column
  // exists, build a rawSqlField filter that bypasses the registry but is still
  // safe (schema-checked + parameterized in WHERE-builder).
  const schema = getDbSchemaSync()
  const colMeta = schema?.columns.find(c => c.column_name === agentFilter.field)
  if (!colMeta) {
    console.warn(`[sql-agent] dropping filter on unknown column: ${agentFilter.field}`)
    return null
  }

  const isNumericColumn = /int|numeric|real|double|float|decimal/i.test(colMeta.data_type)
  const rawValue = isNumericColumn ? coerceNumeric(agentFilter.value) : agentFilter.value
  const isBetween = op === "between" && agentFilter.value2 != null

  console.log(`[sql-agent:schema-pass] ${agentFilter.field} (${colMeta.data_type}) → rawSqlField`)

  const filter: AppliedFilter & { rawSqlField?: string; rawSqlOp?: string; rawValue2?: string | number } = {
    field: agentFilter.field,
    op,
    value: agentFilter.display ?? (isBetween ? `${agentFilter.value}~${agentFilter.value2}` : agentFilter.value),
    rawValue,
    appliedAt: turnCount,
    rawSqlField: agentFilter.field,
    rawSqlOp: agentFilter.op,
  }
  if (isBetween) {
    filter.rawValue2 = isNumericColumn ? coerceNumeric(agentFilter.value2 as string) : (agentFilter.value2 as string)
  }
  return filter
}

function coerceNumeric(value: string): number | string {
  const n = parseFloat(value)
  return isNaN(n) ? value : n
}

// ── Helpers ──────────────────────────────────────────────────

const NUMERIC_REGISTRY_FIELDS = new Set([
  "diameterMm", "fluteCount", "shankDiameterMm", "lengthOfCutMm",
  "overallLengthMm", "helixAngleDeg", "ballRadiusMm", "taperAngleDeg",
])

function coerceRawValue(field: string, value: string): string | number {
  if (NUMERIC_REGISTRY_FIELDS.has(field)) {
    const n = parseFloat(value)
    return isNaN(n) ? value : n
  }
  return value
}
