/**
 * SQL Agent — LLM이 DB schema를 보고 자연어에서 WHERE절 필터를 생성.
 * filter-field-registry.ts의 수동 매핑을 보완하는 추가 레이어.
 * Haiku 1회 호출로 동작.
 */

import { formatNumericStatsLine, getDbSchemaSync, type DbSchema } from "./sql-agent-schema-cache"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { resolveModel } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter } from "@/lib/types/exploration"
import { selectFewShots, buildFewShotText } from "./adaptive-few-shot"
import { validateAndResolveFilters } from "./value-resolver"
import { getFilterFieldLabel, getFilterFieldDefinition } from "@/lib/recommendation/shared/filter-field-registry"
import { isSkipToken } from "@/lib/recommendation/shared/patterns"
import { SQL_AGENT_CONFIG } from "@/lib/recommendation/infrastructure/config/runtime-config"
import { BRAND_MISFIRE_SHAPE_MAP } from "@/lib/recommendation/shared/canonical-values"

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
  /** SQL Agent 자체 판단 확신도. high=바로 적용, medium=적용+확인, low=질문. */
  confidence?: "high" | "medium" | "low"
  /** 확신이 낮을 때 사용자에게 물어볼 한국어 확인 질문. */
  clarification?: string | null
}

// ── Tool-shape safety net ────────────────────────────────────
//
// LLM은 가끔 "square랑 Roughing만 아니면 돼" 같은 공구형상 제외 표현을
// brand 필드로 잘못 emit 한다 (brand 제외는 긴 텍스트를 허용하는 자유 슬롯
// 이라 LLM 이 fallback 으로 붙음). prompt 에 명시 규칙이 있어도 가끔 누락
// 되므로 validateAndResolveFilters 뒤에 post-validation 으로 강제 교정.
// value 에 공구형상 키워드가 포함되면 brand → toolSubtype 으로 재배정한다.
// SSOT: alias ↔ canonical 매핑은 shared/canonical-values.ts 의 TOOL_SUBTYPE_ALIAS_MAP.

function reassignShapeBrandFilters(filters: AgentFilter[]): { filters: AgentFilter[]; messages: string[] } {
  const messages: string[] = []
  const out: AgentFilter[] = []
  for (const f of filters) {
    if (f.field !== "brand" || !f.value) { out.push(f); continue }
    const lower = f.value.toLowerCase()
    const hits: string[] = []
    for (const [kw, canon] of Object.entries(BRAND_MISFIRE_SHAPE_MAP)) {
      if (lower.includes(kw)) hits.push(canon)
    }
    const uniqHits = Array.from(new Set(hits))
    if (uniqHits.length === 0) { out.push(f); continue }
    // brand 필터를 각 공구형상별 toolSubtype 필터로 교체
    for (const canon of uniqHits) {
      out.push({ ...f, field: "toolSubtype", value: canon })
    }
    messages.push(`brand="${f.value}" → toolSubtype ${uniqHits.map(v => `${f.op === "neq" ? "≠" : "="}${v}`).join(", ")} 로 재배정 (공구형상은 brand 가 아님)`)
  }
  return { filters: out, messages }
}

// ── Column → filter-field-registry field mapping ─────────────

export const DB_COL_TO_FILTER_FIELD: Record<string, string> = {
  search_subtype: "toolSubtype",
  search_coating: "coating",
  search_diameter_mm: "diameterMm",
  search_flute_count: "fluteCount",
  option_numberofflute: "fluteCount",
  option_z: "fluteCount",
  milling_number_of_flute: "fluteCount",
  milling_numberofflute: "fluteCount",
  holemaking_number_of_flute: "fluteCount",
  holemaking_numberofflute: "fluteCount",
  threading_number_of_flute: "fluteCount",
  threading_numberofflute: "fluteCount",
  number_of_flute: "fluteCount",
  numberofflute: "fluteCount",
  edp_brand_name: "brand",
  edp_series_name: "seriesName",
  edp_root_category: "machiningCategory",
  series_tool_type: "toolType",
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
  // 반경 계열 — LLM이 cornerRadiusMm/ballRadiusMm 중 하나를 직접 emit 하는 것을 권장.
  // DB 컬럼 직접 emit 시 기본은 ballRadiusMm 로 떨어뜨리고, 사용자 표현이 "코너R/인선R"
  // 계열이면 상위에서 cornerRadiusMm 으로 재배정한다.
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
  // Single/double end milling cutter — map to toolSubtype slot so golden FIELD_ALIAS resolves.
  option_milling_singledoubleend: "toolSubtype",
  milling_single_double_end: "toolSubtype",
  single_double_end: "toolSubtype",
  // workpiece is handled specially via _workPieceName
  _workPieceName: "workPieceName",
  // Country codes are stored as text[] (unnested by schema cache for indexing).
  country_codes: "country",
}

// Navigation pseudo-fields
const NAV_FIELDS = new Set(["_skip", "_reset", "_back", "_qa"])

// ── System Prompt Builder ────────────────────────────────────
// NO hardcoded column descriptions. The LLM reads column names + sample values
// directly from the DB schema and matches user intent itself. Adding a new
// column to the MV requires zero code changes — it shows up automatically.

export type SqlAgentMode = "fast" | "cot"

function uniquePromptValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = String(value ?? "").trim()
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return out
}

function buildAllowedOutputFieldBlock(): string {
  return [
    ...Object.entries(DB_COL_TO_FILTER_FIELD)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([column, field]) => `  ${column} -> ${field}`),
    "  stockStatus -> stockStatus (재고 상태: instock/limited/outofstock — EXISTS join inventory_summary_mv)",
    "  totalStock -> totalStock (재고 수량 numeric threshold — EXISTS join inventory_summary_mv)",
    "  _skip -> release a pending field restriction",
    "  _reset -> reset the session",
    "  _back -> go back one step",
    "  _qa -> answer/explain without adding a DB filter",
  ].join("\n")
}

function buildSqlDomainDictionary(schema: DbSchema): string {
  const textLimit = SQL_AGENT_CONFIG.textSampleLimit
  const toolSubtypeValues = uniquePromptValues([
    ...(schema.sampleValues.search_subtype ?? []),
    ...(schema.sampleValues.tool_subtype ?? []),
  ]).slice(0, textLimit)
  const coatingValues = uniquePromptValues([
    ...(schema.sampleValues.search_coating ?? []),
    ...(schema.sampleValues.coating ?? []),
  ]).slice(0, textLimit)
  const workPieceValues = uniquePromptValues(
    (schema.workpieces ?? []).map(entry => entry.normalized_work_piece_name),
  ).slice(0, textLimit)
  const brandValues = uniquePromptValues(schema.brands ?? []).slice(0, textLimit)

  return [
    `  toolSubtype canonical values/examples: ${toolSubtypeValues.join(", ") || "Square, Ball, Radius, Roughing, Taper, Chamfer"}`,
    `  coating canonical values/examples: ${coatingValues.join(", ") || "TiAlN, AlCrN, DLC, Bright Finish"}`,
    `  workPieceName examples: ${workPieceValues.join(", ") || "Stainless Steels, Aluminum, Carbon Steels, Copper, Titanium"}`,
    `  brand examples: ${brandValues.join(", ") || "none"}`,
    "  stockStatus is only for qualitative availability states such as instock / outofstock / limited.",
    "  totalStock is only for numeric stock thresholds.",
    "  skip/remove/back/reset are control actions, not product attributes.",
  ].join("\n")
}

function buildSystemPrompt(schema: DbSchema, existingFilters: AppliedFilter[], userMessage?: string, mode: SqlAgentMode = "fast", kgHint?: string): string {
  const colList = schema.columns
    .map(c => {
      const desc = schema.columnDescriptions?.[c.column_name]
      return desc
        ? `  ${c.column_name} (${c.data_type}) — ${desc}`
        : `  ${c.column_name} (${c.data_type})`
    })
    .join("\n")

  const columnDescLimit = SQL_AGENT_CONFIG.columnDescLimit
  const sampleList = Object.entries(schema.sampleValues)
    .filter(([, vals]) => vals.length > 0)
    .map(([col, vals]) => `  ${col}: ${vals.slice(0, columnDescLimit).join(", ")}`)
    .join("\n")

  const numericList = Object.entries(schema.numericStats)
    .map(([col, s]) => formatNumericStatsLine(col, s))
    .join("\n")

  const wpList = schema.workpieces
    .map(w => `  ${w.tag_name} → ${w.normalized_work_piece_name}`)
    .join("\n")

  const brandList = schema.brands.join(", ")

  const auxSampleLimit = SQL_AGENT_CONFIG.numericSampleLimit
  const auxList = Object.entries(schema.auxTables ?? {})
    .map(([table, cols]) => {
      const samples = schema.auxSampleValues?.[table] ?? {}
      const nstats = schema.auxNumericStats?.[table] ?? {}
      const colLines = cols.map(c => {
        const sv = samples[c.column_name]
        const ns = nstats[c.column_name]
        if (sv && sv.length > 0) return `  ${c.column_name} (${c.data_type}) e.g. ${sv.slice(0, auxSampleLimit).join(", ")}`
        if (ns) return `${formatNumericStatsLine(c.column_name, ns).trimStart()} (${c.data_type})`
        return `  ${c.column_name} (${c.data_type})`
      }).join("\n")
      return `### ${table}\n${colLines}`
    })
    .join("\n\n")

  const filterList = existingFilters.length > 0
    ? existingFilters.map(f => `  ${f.field} ${f.op} ${f.value}`).join("\n")
    : "  (none)"
  const allowedOutputFields = buildAllowedOutputFieldBlock()
  const sqlDomainDictionary = buildSqlDomainDictionary(schema)

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
(브랜드 음역(예: "엑스파워" ↔ X-POWER, "알루파워" ↔ ALU-POWER)이 의심되면 후보를 제시하되, 확신이 없으면 emit 하지 말고 clarification 으로 돌릴 것. 발음 유사도만으로 강제 매핑하지 말 것. 리스트에 없으면 emit 금지.)

## Auxiliary Tables (read-only reference — joinable, not directly filterable from this agent)
${auxList || "  (none loaded)"}

## Allowed Output Fields (DB columns + pseudo-fields)
${allowedOutputFields}

## Allowed Operators
  eq, neq, like, gte, lte, between, skip, reset, back

## Domain Dictionary
${sqlDomainDictionary}

Hard constraints:
- Emit only the allowed output fields listed above.
- Emit only the allowed operators listed above.
- If the concept is outside the allowed fields, emit [] or _qa instead of inventing a new column.
- Reason strictly inside the schema samples, numeric ranges, and domain dictionary.

🚨 ABSOLUTE OPERATOR RULES (위반 = miss, 다른 모든 규칙보다 우선):
- 숫자 + "이하/미만/까지/under/below" → 반드시 op="lte". eq 절대 금지.
- 숫자 + "이상/초과/넘는/부터/over/above" → 반드시 op="gte". eq 절대 금지. (gt도 gte로 emit)
- 숫자 + "정도/쯤/약/근처/대략/around/approximately" → 반드시 op="between" 으로 (값 ±10~15%). eq 절대 금지.
  · "40 정도" → between value=35 value2=45
  · "10mm 정도" → between value=9 value2=11
- "A에서 B 사이/A부터 B까지/A~B" → 반드시 op="between" value=A value2=B.
- "정확히/딱/exactly" 가 명시되어야만 op="eq".

🚨 ABSOLUTE FIELD RULES:
- 사용자가 피삭재 하나를 말하면 workPieceName 단일값으로 emit. 복수 소재를 비교하거나 탐색하는 톤이면 배열 또는 ask_clarification 도 허용. workPieceName 은 material/toolMaterial 과 의미가 겹치므로 동시 emit 하지 말 것.
- workPieceName 값은 반드시 영문 canonical: "Aluminum"/"Stainless Steels"/"Carbon Steels"/"Cast Iron"/"Titanium"/"Heat Resistant Alloys"/"Copper". 한글값("알루미늄","티타늄") emit 금지.
- "코너R/코너레디우스/corner R/R값" → cornerRadiusMm. ballRadiusMm 절대 emit 금지.
- "볼 R/ball R" 만 ballRadiusMm.

When the user asks about inventory / 재고 / stock / 수량 — 재고는 catalog_app.product_inventory_summary_mv 에 있고 WHERE-builder 가 EXISTS(inv.edp = edp_no) subquery 로 자동 join 합니다. 이 agent 가 재고 필터를 **직접 emit** 하세요 — upstream 에 미루지 말 것.
  · "재고 있는 거/재고만/납기 빠른 것/instock" → {field:"stockStatus", op:"eq", value:"instock"}
  · "재고 N개 이상/stock >= N/최소 N개" → {field:"totalStock", op:"gte", value:"N"} (숫자 임계값).
  · "재고 없는" 같은 부정 표현은 emit 금지 (upstream 이 처리).
  · 제품 조건(소재/직경/형상 등) 과 재고가 같이 나오면 제품-MV 필터 + 재고 필터를 **모두** 같은 filters 배열에 emit. "재고 컬럼이 없다/다른 테이블이다" 고 reasoning 에 쓰지 말 것.

When the user asks about cutting conditions / RPM / feed rate / 절삭조건 / 회전수 / 이송속도 / 절입깊이 — 이 숫자들은 raw_catalog.cutting_condition_table 에 있고 WHERE-builder 가 EXISTS(c.series_name = edp_series_name) subquery 로 자동 join 합니다. 이 agent 가 절삭조건 필터를 **직접 emit** 하세요 — upstream 에 미루지 말 것. (registry 가 rpm/feedRate/cuttingSpeed/depthOfCut 필드로 등록되어 있고 buildDbClause 가 EXISTS 를 생성합니다.)
  · "RPM N 이상/회전수 N 초과" → {field:"rpm", op:"gte", value:N}
  · "RPM N 이하/회전수 N 미만" → {field:"rpm", op:"lte", value:N}
  · "이송 N/feed N" → {field:"feedRate", op:<이상/이하/between>, value:N}
  · "절삭속도 N/Vc N" → {field:"cuttingSpeed", op:<...>, value:N}
  · "절입 N/ap N" → {field:"depthOfCut", op:<...>, value:N}
  · "X 절삭조건 있는거만/있는 것만/정보 있는/데이터 있는" → 해당 field op="gte", value=0 (필드 존재 여부 필터)
    - "없는/빼고/제외" 같은 부정 표현은 X 에 대해만 op="neq" 사용
    - "있는거만" 을 절대 neq/제외로 emit 하지 말 것
  · 이미 rpm/feed 등이 Currently Applied Filters 에 있는데 사용자가 새 값/범위를 말하면 **같은 field 로 재-emit** 하면 runtime 이 기존 값을 교체합니다. 교체 의도가 맞으면 반드시 emit (생략하면 이전 필터가 남음).
  · 제품 조건(소재/직경/형상 등) 과 절삭조건이 같이 나오면 제품-MV 필터 + 절삭조건 필터를 **모두** 같은 filters 배열에 emit. "절삭조건 컬럼이 없다/다른 테이블이다" 고 reasoning 에 쓰지 말 것 — registry 가 처리합니다. 단 절삭조건 외 개념에 대해서는 제품-MV 컬럼을 발명하지 말 것.

===DYNAMIC===

## Currently Applied Filters
${filterList}
${kgHint ? `
## 사전 분석 힌트 (KG 엔티티 추출 — 참고용)
다음은 사용자 메시지에서 knowledge graph 가 추출한 엔티티/필드 후보입니다:
${kgHint}
**사용 규칙**: 힌트는 "강력한 후보"일 뿐 최종 판단이 아닙니다. 사용자 메시지와 모순되거나 문맥상 어색하면 무시하세요. 힌트와 일치하는 필드를 emit 할 때는 registry 필드명(예: cornerRadiusMm, taperAngleDeg, shankType, helixAngleDeg)을 그대로 써도 되고 DB 컬럼명을 써도 됩니다 — 둘 다 런타임이 해석합니다.
` : ""}
## Chip Generation Rules (clarification 후보 제안 시 — 분포 기반)
clarification 이 필요할 때 (confidence=low, 또는 숫자만 있고 컬럼 모호), 후보 필드를 **chips 배열**로 제안하세요. 위 "Numeric Column Stats" 의 분포(p10/p25/p50/p75/p90)를 직접 참고해 아래 규칙을 따르세요:
- **후보 필터링**: 사용자가 언급한 숫자가 해당 컬럼의 [min, max] 밖이면 그 컬럼은 **후보에서 제외**. (예: 100mm인데 max=31 → 그 컬럼 제외.)
- **분포 태그** (사용자 값 vs 분포):
  - p10 ≤ 값 ≤ p90 → "(표준)" 또는 "(일반적)" — 대부분 제품이 이 범위.
  - p90 < 값 ≤ max → "(대형)" 또는 "(상위)" — 드물지만 존재.
  - min ≤ 값 < p10 → "(소형)" 또는 "(하위)" — 드물지만 존재.
- **정렬**: p50(중앙값)과의 거리가 가까운 컬럼부터.
- **개수**: 최대 3개. 마지막에 "직접 입력" 은 런타임이 자동 추가하므로 chips 에 넣지 말 것.
- **라벨 형식**: "\${한국어 필드명} (\${값}\${단위}) \${분포 태그}" — 예: "전장 (100mm) (표준)", "생크 직경 (100mm) (대형)".
- **하드코딩 금지**: 후보 선택과 태깅은 반드시 위 분포 수치에서 실시간 산출. 컬럼 이름으로 휴리스틱 고르지 말 것.
- **JSON 위치**: clarification 객체 안에 \`"chips": [...]\` 로 넣으세요. clarification={"question":"...", "chips":["전장 (100mm) (표준)","생크 직경 (100mm) (대형)"]}.
- **단위 경고 컬럼**: Numeric Column Stats 에 "⚠️ 단위 혼재 의심" 이 붙은 컬럼은 그 컬럼을 chip 후보에 넣을 때 해당 경고도 question 에 요약해 언급 (예: "해당 컬럼은 인치/mm 혼재 가능성이 있습니다").

## Instructions
Extract filter conditions and a short Korean reasoning trail from the user message as a JSON object:
{"reasoning":"한국어 사고 과정 (실제 deliberation, 5-10문장)","filters":[{"field":"column_name","op":"eq|neq|like|gte|lte|between","value":"...","value2":"upper_bound_for_between","display":"한국어 설명"}],"confidence":"high|medium|low","clarification":null}

## Confidence & Clarification (매우 중요 — CoT 기반 행동 결정)
"confidence" 필드를 반드시 포함:
- "high": 사용자 의도가 명확하고 컬럼/값 매칭 확실 → 바로 필터 적용 (clarification=null).
- "medium": 의도는 파악했으나 컬럼/값이 약간 애매 → 필터 적용하되 clarification으로 확인 질문 병행.
- "low": 어떤 컬럼/값에 매핑할지 확신 없음 → filters=[] 로 비우고 clarification으로 질문만.

판단 기준:
- 숫자가 해당 컬럼의 numericStats 범위를 크게 벗어나면 → medium 이하. 예: 직경 100mm인데 max=50.
- "이상/이하" 같은 범위 표현인데 어떤 컬럼에 적용할지 모호하면 → medium 이하.
- 사용자가 필드명을 명시 안 했고 숫자만 말했으면 → medium.
- 한국어 표현이 여러 해석 가능하면 → low. 예: "떨림 적은 거", "큰 거", "좋은 거".
- 경쟁사 제품명·전문 용어가 DB에 매칭 안 되면 → low.
- 명확한 필드+값 조합이면 → high. 예: "스퀘어 4날 10mm TiAlN".

예시:
- "100mm 이상만" (직경 max=50) → filters:[], confidence:"low", clarification:"100mm 이상이 직경(ø)인지 전장(OAL)인지 확인 부탁드립니다. 엔드밀 직경은 보통 50mm 이하이고, 전장 100mm 이상은 많이 있습니다."
- "스테인리스 4날 10mm" → 3개 필터, confidence:"high", clarification:null
- "떨림 적은 거" → filters:[], confidence:"low", clarification:"떨림을 줄이는 방법은 1) 부등분할 엔드밀 2) 날수 증가(4→6날) 3) 넥 타입 — 어떤 방식을 원하시나요?"
- "구리 비슷한 소재" → _workPieceName=구리, confidence:"medium", clarification:"구리(순동) 계열로 검색했습니다. 혹시 황동/청동이시면 말씀해주세요."

## Self-Check (reasoning ↔ filters 일치 검증 — 매우 중요)
filters를 최종 출력하기 전에 자신의 reasoning을 다시 읽고 아래를 점검하세요:
1. reasoning에 "확인 필요", "모호", "불확실", "아닐 수도", "잘 모르겠" 가 있으면 → confidence="low", filters=[], clarification 작성. 의심한 걸 확신있게 emit 금지. 단, 필드 라벨이 명확한 경우(예: "직경 10mm")는 confidence="medium" 허용.
2. reasoning에 "범위 밖", "max가 X인데 Y 요청", "DB 범위 초과" 가 있으면 → 해당 필터 제거, clarification으로 되물어라. (예: "직경 100mm는 엔드밀 범위(max 50mm)를 벗어납니다. 전장을 말씀하신 건가요?")
3. reasoning에 "부적합", "비추", "위험", "문제 있" 가 있으면 → 필터는 유지하되 clarification에 경고/대안 포함.
4. reasoning이 "이상/이하/초과/미만/사이" 같은 범위어를 언급했는데 filters.op가 eq 이면 틀린 것 → 반드시 gte/lte/between 으로 교정.
5. reasoning에서 "두 가지 해석 가능", "A일 수도 B일 수도" 라고 썼으면 → confidence="low", 두 해석 모두 clarification에 제시.
6. reasoning을 여러 번 번복했으면 ("처음엔 X, 아니 Y, 다시 X") → confidence는 medium 이하.
핵심: reasoning에서 의심한 것은 filters에서도 그만큼 망설여라. 의심했으면 물어보고, 확신할 때만 emit하라.

단, **순수 질문/설명 요청** ("~가 뭐야?", "~란?", "~알려줘", "~설명해줘", "차이가 뭐야?", "왜 ~?", "어떻게 ~?")은 self-check 예외. 이 경우 filters=[]이 정상이며 confidence="high", clarification=null로 설정하라. 필터가 필요 없는 것이지 불확실한 게 아니다. 응답 레이어가 자연어로 설명할 것이다.

${mode === "cot" ? `"reasoning"은 요약이 아니라 **머릿속 사고 과정 전체**입니다. 길이 제한 없음, 길수록 좋음. 검열·정리·요약 금지. 다음을 모두 포함하세요:
1. 사용자 메시지를 글자 그대로 다시 읽고 풀이 ("음, 사용자가 '~'라고 했는데 이건...")
2. 가능한 해석을 여러 개 떠올려 각각 검토
3. 후보 컬럼/값을 여러 개 비교 ("milling_outside_dia 일까 option_dc 일까... A는 ~이지만 B는 ~")
4. sample value / numeric range를 직접 들춰보면서 검증
5. 한 번 결론 → 의심 → 번복 → 재확정 ("처음엔 X로 가려 했는데, 잠깐 다시 보니 Y가 더 맞겠다, 어... 아니 X가 맞나?")
6. 현재 적용된 필터와의 충돌/중복/일관성 점검
7. 도메인 지식(공구 재료/코팅/소재 적합도) 동원
8. 최종 결정 + 근거 + 남은 불확실성

"음", "잠깐", "근데", "어... 아니다", "다시 생각해보면", "솔직히", "~가 더 맞을 것 같다" 같은 자연스러운 사고 마커를 자주 쓰세요. 최소 10문장 이상.` : `"reasoning"은 **간결한** 한국어 사고 과정 (2-4문장). 사용자 의도를 한 줄로 요약하고, 매핑한 컬럼/값과 핵심 근거만 적으세요. 자기 의심·번복·반복 금지. 모호하면 reasoning에 후보를 명시하고 filters: [] 로 응답.`}

"filters" 배열은 항상 존재해야 합니다 (없으면 []).

Rules:
- field MUST be one of the actual column_names listed above (product_recommendation_mv only), or "_workPieceName" for workpiece materials, or "_skip"/"_reset"/"_back" for navigation. NEVER invent a column name.
- Match user intent to columns by reading the column name AND its sample values. The column name is in English; map Korean/Japanese/etc. terms to it semantically. If multiple columns plausibly match (e.g. milling_* vs holemaking_*), prefer the one whose sample values or numeric range fits the user's number.
- For exclusion/negation (빼고/제외/아닌것/"~만 빼고") → op="neq". BUT: "X 말고 Y / X 대신 Y / X 말고 Y로 / Y로 바꿔" 는 **교체**이므로 새 값 Y만 eq 로 emit (기존 필터는 런타임이 같은 field 새 값으로 자동 교체). 오래된 X 에 대한 neq 는 emit 금지.
- **잘못 적용된 필터에 대한 사용자 항의** ("X는 bug", "X 요청한 적 없어요", "X 잘못 들어갔어요", "X 아닌데요"): Currently Applied Filters 중 해당 값을 가진 항목을 사용자가 거부한 것입니다. 그 field에 대해 어떤 필터도 emit 하지 마세요 (neq도 아님). reasoning 에 "사용자가 기존 X 필터를 거부했으므로 재emit하지 않음"이라고 적고, 새로 emit 할 필터가 없으면 filters: [] 로 응답. 런타임이 거부된 필터를 자동으로 제거합니다.
- "이전으로 돌아가서 X 제외" / "되돌리고 X 빼고" 같은 복합 문장은 **X 에 대한 neq 만** emit (되돌리기는 런타임이 처리).
- For navigation: skip(상관없음/패스) → _skip, reset(처음부터/초기화) → _reset, back(이전/돌아가) → _back
- **_qa (직접 답변)**: 사용자가 필터 조건이 아니라 질문/상담/비교/트러블슈팅을 하면 "{\"field\":\"_qa\",\"op\":\"eq\",\"value\":\"<10년차 영업엔지니어 톤의 구체적 답변>\"}" 를 emit. value에는 도메인 지식(소재/코팅/절삭조건/형상)을 총동원해 숫자·범위까지 포함한 실용 답변을 직접 작성하라. confidence="high", clarification=null.
  - 트리거: 용어 질문("~가 뭐야?", "~란?", "~알려줘"), 비교("A vs B", "뭐가 나아", "차이"), 트러블슈팅(수명/떨림/파손/마모/채터/버), 도메인 상담("~에 뭐가 좋아?", "어떻게 하면 ~?")
  - 복합(필터+질문): 필터 filter들 + _qa 답변을 **동시에** emit. 필터는 그대로 적용되고, 답변은 응답에 함께 녹아든다.
  - 예시:
    - "헬릭스가 뭐야?" → [{\"field\":\"_qa\",\"op\":\"eq\",\"value\":\"헬릭스는 엔드밀 날의 비틀림 각도입니다. 30°는 범용(칩 배출 균형), 45°~50°는 고속 마감(부하↓)이고, 스테인리스처럼 질긴 소재는 38°~45°가 무난합니다. YG-1은 30°·38°·45°·50° 라인이 있습니다.\"}]
    - "공구 수명이 너무 짧아" → [{\"field\":\"_qa\",\"op\":\"eq\",\"value\":\"수명이 짧은 3대 원인: ① 절삭속도 과대(스테인리스 Vc 80~120 m/min 적정, 그 이상이면 코팅부터 벗겨집니다) ② 코팅 부적합(SUS엔 AlCrN/Y-Coating, 알루미늄엔 DLC/무코팅) ③ 업밀링으로 인한 가공경화. 소재/직경/현재 조건 알려주시면 구체 진단 드리겠습니다.\"}]
    - "AlCrN vs TiAlN 뭐가 나아? 스테인리스인데" → [{\"field\":\"_workPieceName\",\"op\":\"eq\",\"value\":\"스테인리스\"},{\"field\":\"_qa\",\"op\":\"eq\",\"value\":\"스테인리스엔 AlCrN(Y-Coating)이 우세합니다. AlCrN 내산화 ~1100°C vs TiAlN ~900°C — 스테인리스 절삭열 600~800°C에서 AlCrN이 산화 마모를 훨씬 버팁니다. 수명 차이 1.5~2배 나는 경우가 흔합니다.\"}]
    - "스테인리스 DLC 코팅으로" → [{\"field\":\"_workPieceName\",\"op\":\"eq\",\"value\":\"스테인리스\"},{\"field\":\"coating\",\"op\":\"eq\",\"value\":\"DLC\"},{\"field\":\"_qa\",\"op\":\"eq\",\"value\":\"⚠️ DLC는 내열 한계가 약 400°C라 스테인리스 절삭열(600~800°C)에 부적합합니다. 같은 조건에서 코팅이 빠르게 박리됩니다. 대신 AlCrN(Y-Coating)을 권장드립니다.\"}]
    - "스테인리스 추천해줘 그리고 알루파워가 뭐야?" → [{\"field\":\"_workPieceName\",\"op\":\"eq\",\"value\":\"스테인리스\"},{\"field\":\"_qa\",\"op\":\"eq\",\"value\":\"ALU-POWER는 알루미늄 전용 3날 고성능 엔드밀 라인입니다(37° 헬릭스, DLC/무코팅). 지금 검색하신 스테인리스 용도에는 맞지 않아 별도 시리즈로 잡아드렸습니다.\"}]
- For pure questions or non-filter messages → [] (empty array)

## Range/Comparison Operators (numeric columns)
NEVER use eq when the user expressed a range:
- "이상/넘는/초과/최소" → gte
- "이하/미만/최대/넘지 않는" → lte
- "A~B / A에서 B 사이 / A부터 B까지" → between with value=A, value2=B
- "정도/근처/대략/around" → between ±10% of the number
- Pick the column whose name matches the user's label (직경→diameter, 전장/OAL→overall_length, 날장/LOC→length_of_cut, 샹크→shank, 헬릭스→helix, 날수→flute, etc.) AND whose min/max range contains the user's number. Do not emit duplicate eq filters for the same number on different columns.

## Korean → English semantic hints (use op:like when the chemical/internal name may differ)
- **전역 규칙**: 위 sampleList / brandList / wpList / numericStats 에 실제로 등장한 값이 한국어 음역·유사어·약칭·오타·축약형으로 들어와도 발음/의미 유사도로 그 값에 매핑하세요. 절대 리스트에 없는 값을 emit 하지 말 것. (아래 컬럼별 힌트는 자주 보는 예시 모음일 뿐 — 새로운 컬럼/값에도 같은 원리로 동작.)
- **불확실 처리**: 사용자 표현이 어느 후보에 매핑될지 확신이 없으면 reasoning에 "가장 가까운 후보 2-3개"를 명시하고 filters는 [] 로 emit. 추측 emit 금지 — 모호하면 빈 배열이 정답.
- 공구 소재: 초경/카바이드/솔리드/Carbide/cemented → like "Carbide" · 하이스/HSS/고속도강/high speed steel → like "HSS" · 코발트하이스/HSS-Co/HSS-CO/분말 하이스/PM HSS → like "HSS-Co" · 서멧/Cermet → like "Cermet" · PCD/diamond → like "PCD" · CBN → like "CBN" · 다이아몬드 → like "Diamond"
- 코팅: TiAlN/X코팅 → like "TiAlN" or "X-Coating" · AlCrN/Y코팅 → like "AlCrN" or "Y-Coating" · DLC → like "DLC" · 무코팅/비코팅/uncoated/bright → like "Uncoated" or "Bright" · nACo → like "nACo" · CrN → like "CrN" · TiN → like "TiN" · TiCN → like "TiCN" · ZrN → like "ZrN" · "코팅된 거"/"코팅 있는 거"/"코팅 엔드밀" → search_coating neq "Bright" (코팅 존재 여부 필터)
- 영어 형상 변형: flat/flat endmill → "Square" · bull nose/bullnose → "Radius" or "Corner Radius" · ball nose/ballnose → "Ball" · 4 teeth/4 flute/4-flute → search_flute_count eq 4
- 길이 상대 표현 (숫자 없음): "긴/롱/long" → overall_length (milling_overall_length 또는 option_overall_length) op:gte with value = numericStats의 median (samples의 중앙값을 직접 계산해 사용) · "짧은/숏/short/스터비/stubby" → 동일 컬럼 op:lte with value = median
- 날수 상대 표현: "다날/멀티플루트/many flute/multi-flute" → search_flute_count op:gte value=5 · "소수날/few flute" → search_flute_count op:lte value=3
- 더블/싱글 엔드: "더블엔드/양끝날/양날엔드밀/double end/double-ended" → **반드시 option_milling_singledoubleend eq "Double"** (series_description 같은 자유 텍스트 컬럼 사용 금지 — 구조화 컬럼이 있을 땐 그것을 쓸 것) · "싱글엔드/single end" → option_milling_singledoubleend eq "Single"
- 피삭재 (use _workPieceName eq): 스테인리스/스텐/SUS → "스테인리스" · 티타늄/Ti → "티타늄" · 알루미늄/AL → "알루미늄" · 주철/FC/FCD → "주철" · 탄소강/SM45C → "탄소강" · 고경도강/SKD11 → "고경도강" · 인코넬/내열합금 → "인코넬" · 구리/동/황동 → "구리" · 합금강/SCM440 → "합금강" · 복합재/CFRP → "복합재" · 흑연 → "흑연"
- 공구 형상: 스퀘어/평날 → search_subtype eq "Square" · 볼/볼엔드밀 → "Ball" · 라디우스/코너R → like "Radius" · 러핑/황삭 → "Roughing" · 테이퍼 → "Taper" · 챔퍼/모따기 → "Chamfer" · 하이피드/고이송 → like "High-Feed"
- **형상 제외 표현**: "Square/Roughing/Ball/Radius/Taper/Chamfer 제외", "X만 아니면", "X 빼고", "X 말고" → 반드시 search_subtype neq "X" 로 emit. **brand neq 로 넣지 말 것** (공구형상은 brand 가 아님). 두 개 이상 제외 시 각각을 별도 filter 로 분리.
- 가공 형상: 측면가공 → series_application_shape like "side" · 포켓 → like "pocket" · 곡면 → like "contour"
- 생크: 플레인/스트레이트 → shank_type like "Plain" · 웰던 → like "Weldon" · HA → like "HA"
- 국가 (text[]): 국내/한국 → eq "KOR" · 미국/인치 → eq "USA" · 유럽 → eq "ENG" · 일본 → eq "JPN"
- 모호한 표현(좋은 거/추천해줘/괜찮은 거/범용/다양한) → []

## Critical Field Disambiguation (오추론 빈발 케이스 — 반드시 준수)

**1. 근사 표현 → between (eq 절대 금지)**
"정도", "쯤", "약", "대략", "근처", "around", "approximately" 가 숫자 뒤에 붙으면 op는 반드시 between (값 ±10~15%):
- "날장이 40 정도" → between 35~45 (eq 40 금지)
- "약 10mm" → between 9~11
- "직경 8mm 정도" → between 7~9
정확한 값을 원할 때만 사용자가 "정확히", "딱", "exactly" 같은 단어를 씁니다 — 그때만 eq.

**2. workPieceName ↔ material (둘 다 emit 금지)**
workPieceName(피삭재)과 material/toolMaterial(공구재질)은 다른 개념이지만, 사용자가 피삭재만 말했을 때 toolMaterial까지 추측해 emit 하지 마세요.
- "피삭재는 티타늄" → workPieceName="Titanium" 만. (toolMaterial 추측 금지)
- "티타늄 가공용" → workPieceName="Titanium" 만.
- 사용자가 명시적으로 "카바이드/HSS 공구" 라고 해야만 toolMaterial emit.

**3. cornerRadiusMm ↔ ballRadiusMm (혼동 금지)**
- "코너R", "코너 레디우스", "코너 R", "corner R", "R값", "라디우스" → cornerRadiusMm
- "볼 반경", "볼 R", "ball radius" → ballRadiusMm
cornerR = 엔드밀(Square/Radius) 모서리의 라운드 반경
ballR = 볼노즈(Ball) 엔드밀의 구 반경 (≈ diameterMm/2)
사용자가 "코너" 라고 명시했으면 절대 ballRadiusMm 로 가지 마세요.

**4. workPieceName 값 정규화 (DB canonical 영문)**
한글/약칭을 그대로 emit 하지 말고 DB workpieces 리스트의 정확한 표기로 매핑:
- 알루미늄/알미늄/알루/aluminum/Al → "Aluminum"
- 스테인리스/스텐/SUS/stainless → "Stainless Steels"
- 탄소강/SM45C/일반강/carbon steel → "Carbon Steels"
- 주철/FC/FCD/cast iron → "Cast Iron"
- 티타늄/Ti/titanium → "Titanium"
- 인코넬/내열합금/inconel/HRSA → "Heat Resistant Alloys"
위 wpList(Workpiece Materials) 섹션의 실제 normalized_work_piece_name 값을 우선 참고하세요. 한글값(예: "알루미늄") 그대로 emit 하면 DB 매칭 실패.

## Examples (dynamically selected — most similar to current query from golden set)
${userMessage ? (buildFewShotText(selectFewShots(userMessage, 4)) || "(no matching examples found — fall back to schema-driven reasoning)") : "(no user message context — generic mode)"}

━━ self-check (사고 과정 ↔ 출력 정합성) ━━
filters 를 emit 하기 직전에 위 사고 과정을 다시 읽고, 아래 한 가지 질문에 답하세요:
"내 사고 과정의 결론과 내가 emit 하려는 filters/intent 가 같은 말을 하고 있는가?"

불일치 예시 (모두 사고 과정이 우선):
· 사고 과정이 "설명/질문/상담"으로 끝났는데 filters 가 비어 있지 않다
· 사고 과정이 "존재 여부 확인"인데 op 가 neq/제외 이다
· 사고 과정이 특정 브랜드를 전용으로 언급했는데 filters 에 brand 가 없다
· 사고 과정의 연산자(이상/이하/존재)와 filters 의 op 가 다르다

불일치 발견 시: 사고 과정 결론 기준으로 filters 를 교정한 뒤 emit.
일치하면: 그대로 emit.

이 점검은 예시 목록 매칭이 아니라 의미 판단입니다.
위 예시에 없는 새로운 모순도 스스로 감지하세요.

ALWAYS respond with a single valid JSON object {"reasoning":"...","filters":[...]} — no markdown fences, no prose outside JSON.`
}

// ── Core: Natural Language → Filters ─────────────────────────

const SQL_AGENT_MODEL = resolveModel("haiku")

export async function naturalLanguageToFilters(
  userMessage: string,
  schema: DbSchema,
  existingFilters: AppliedFilter[],
  provider: LLMProvider,
  mode: SqlAgentMode = "fast",
  kgHint?: string,
): Promise<SqlAgentResult> {
  const systemPrompt = buildSystemPrompt(schema, existingFilters, userMessage, mode, kgHint)
  const raw = await provider.complete(
    systemPrompt,
    [{ role: "user", content: userMessage }],
    mode === "cot" ? SQL_AGENT_CONFIG.cotMaxTokens : SQL_AGENT_CONFIG.defaultMaxTokens,
    SQL_AGENT_MODEL,
  )

  const parsed = parseAgentResponse(raw)
  const { filters, reasoning } = parsed
  console.log("\n[sql-agent:CoT] ────────────────────────────────")
  console.log(`[sql-agent:CoT] user: ${userMessage}`)
  console.log(`[sql-agent:CoT] existing filters: ${existingFilters.map(f => `${f.field}=${f.value}`).join(", ") || "(none)"}`)
  console.log(`[sql-agent:CoT] reasoning:\n${reasoning ?? "(none)"}`)
  console.log(`[sql-agent:CoT] filters: ${JSON.stringify(filters)}`)
  console.log(`[sql-agent:CoT] confidence=${parsed.confidence ?? "(n/a)"} clarification=${parsed.clarification ?? "(none)"}`)
  console.log(`[sql-agent:CoT] raw(${raw.length}b): ${raw.slice(0, 800)}${raw.length > 800 ? "…" : ""}`)
  console.log("[sql-agent:CoT] ────────────────────────────────\n")
  const resolved = validateAndResolveFilters(filters)
  const reassigned = reassignShapeBrandFilters(resolved.resolvedFilters)
  const allMessages = [...resolved.messages, ...reassigned.messages]
  const base: SqlAgentResult = {
    filters: reassigned.filters,
    raw,
    reasoning: allMessages.length > 0 ? (reasoning ?? "") + "\n\n🔧 값 교정: " + allMessages.join(". ") : reasoning,
    confidence: parsed.confidence ?? "medium",
    clarification: parsed.clarification ?? null,
  }
  if (allMessages.length > 0) console.log(`[sql-agent:value-resolver] ${allMessages.join(". ")}`)
  return applyRangeGuard(base, schema)
}

// ── Range guard: DB numericStats 범위 밖 값이 있으면 confidence 하향 + 자동 clarification ──
function applyRangeGuard(result: SqlAgentResult, schema: DbSchema): SqlAgentResult {
  let updated = result
  for (const f of result.filters) {
    const stats = schema.numericStats?.[f.field]
    if (!stats) continue
    const val = Number(f.value)
    if (!Number.isFinite(val)) continue
    const outOfRange = val > stats.max * 2 || (val < stats.min * 0.5 && val > 0)
    if (!outOfRange) continue
    console.warn(`[sql-agent:range] ${f.field}=${f.value} OUT OF RANGE (DB: ${stats.min}~${stats.max})`)
    const lowered: "high" | "medium" | "low" =
      updated.confidence === "high" ? "medium" : (updated.confidence ?? "medium")
    updated = {
      ...updated,
      confidence: lowered,
      clarification: updated.clarification
        ?? `${f.field} 값 ${f.value}이(가) DB 범위(${stats.min}~${stats.max})를 벗어납니다. 다른 필드를 말씀하신 건 아닌지 확인 부탁드립니다.`,
    }
  }
  return updated
}

// ── Streaming variant ────────────────────────────────────────
//
// Uses provider.stream() and incrementally extracts the JSON `"reasoning"`
// field as it arrives, firing onReasoningDelta(decodedChunk) so the UI can
// type the reasoning out token-by-token (Claude/GPT-5.4 web style).
//
// The extractor is a small state machine that scans for `"reasoning"` followed
// by `: "..."`, then emits decoded characters until the closing quote — handling
// JSON escapes (\n, \", \\, \uXXXX) so the UI never sees raw escape sequences.
// When provider.stream is unavailable (deterministic fallback / unimplemented
// providers), we transparently fall back to the non-streaming path.

class ReasoningExtractor {
  private state: "seek" | "in_value" | "done" = "seek"
  private buf = ""
  private cursor = 0
  private escape = false

  feed(chunk: string): string {
    this.buf += chunk
    let out = ""
    while (this.cursor < this.buf.length && this.state !== "done") {
      if (this.state === "seek") {
        const keyIdx = this.buf.indexOf('"reasoning"', this.cursor)
        if (keyIdx < 0) {
          // Keep enough tail to recognise a key that straddles a chunk boundary.
          this.cursor = Math.max(this.cursor, this.buf.length - 12)
          return out
        }
        let i = keyIdx + '"reasoning"'.length
        while (i < this.buf.length && /\s/.test(this.buf[i]!)) i++
        if (i >= this.buf.length) { this.cursor = keyIdx; return out }
        if (this.buf[i] !== ":") { this.cursor = keyIdx + 1; continue }
        i++
        while (i < this.buf.length && /\s/.test(this.buf[i]!)) i++
        if (i >= this.buf.length) { this.cursor = keyIdx; return out }
        if (this.buf[i] !== '"') { this.cursor = keyIdx + 1; continue }
        i++
        this.cursor = i
        this.state = "in_value"
        continue
      }
      // in_value
      const c = this.buf[this.cursor]!
      if (this.escape) {
        let decoded = c
        if (c === "n") decoded = "\n"
        else if (c === "t") decoded = "\t"
        else if (c === "r") decoded = "\r"
        else if (c === '"') decoded = '"'
        else if (c === "\\") decoded = "\\"
        else if (c === "/") decoded = "/"
        else if (c === "u") {
          if (this.cursor + 4 >= this.buf.length) return out // wait for more bytes
          const hex = this.buf.slice(this.cursor + 1, this.cursor + 5)
          decoded = String.fromCharCode(parseInt(hex, 16))
          this.cursor += 4
        }
        out += decoded
        this.escape = false
        this.cursor++
        continue
      }
      if (c === "\\") { this.escape = true; this.cursor++; continue }
      if (c === '"') { this.state = "done"; this.cursor++; return out }
      out += c
      this.cursor++
    }
    return out
  }
}

export async function naturalLanguageToFiltersStreaming(
  userMessage: string,
  schema: DbSchema,
  existingFilters: AppliedFilter[],
  provider: LLMProvider,
  onReasoningDelta?: (delta: string) => void,
  mode: SqlAgentMode = "fast",
  kgHint?: string,
): Promise<SqlAgentResult> {
  if (!provider.stream) {
    return naturalLanguageToFilters(userMessage, schema, existingFilters, provider, mode, kgHint)
  }
  const systemPrompt = buildSystemPrompt(schema, existingFilters, userMessage, mode, kgHint)
  const extractor = new ReasoningExtractor()
  let raw = ""
  try {
    for await (const chunk of provider.stream(
      systemPrompt,
      [{ role: "user", content: userMessage }],
      mode === "cot" ? 8192 : 2048,
      SQL_AGENT_MODEL,
    )) {
      raw += chunk
      if (onReasoningDelta) {
        const delta = extractor.feed(chunk)
        if (delta) {
          try { onReasoningDelta(delta) } catch { /* never block runtime */ }
        }
      }
    }
  } catch (err) {
    // If streaming fails mid-flight, fall back to non-streaming so we still
    // produce a result for the rest of the pipeline.
    console.warn("[sql-agent:stream] failed, falling back to complete():", (err as Error).message)
    return naturalLanguageToFilters(userMessage, schema, existingFilters, provider, mode, kgHint)
  }
  const parsed = parseAgentResponse(raw)
  const { filters, reasoning } = parsed
  console.log("\n[sql-agent:CoT:stream] ────────────────────────")
  console.log(`[sql-agent:CoT:stream] user: ${userMessage}`)
  console.log(`[sql-agent:CoT:stream] existing filters: ${existingFilters.map(f => `${f.field}=${f.value}`).join(", ") || "(none)"}`)
  console.log(`[sql-agent:CoT:stream] reasoning:\n${reasoning ?? "(none)"}`)
  console.log(`[sql-agent:CoT:stream] filters: ${JSON.stringify(filters)}`)
  console.log(`[sql-agent:CoT:stream] confidence=${parsed.confidence ?? "(n/a)"} clarification=${parsed.clarification ?? "(none)"}`)
  console.log(`[sql-agent:CoT:stream] raw(${raw.length}b): ${raw.slice(0, 800)}${raw.length > 800 ? "…" : ""}`)
  console.log("[sql-agent:CoT:stream] ────────────────────────\n")
  const resolved = validateAndResolveFilters(filters)
  const reassigned = reassignShapeBrandFilters(resolved.resolvedFilters)
  const allMessages = [...resolved.messages, ...reassigned.messages]
  if (allMessages.length > 0) console.log(`[sql-agent:value-resolver:stream] ${allMessages.join(". ")}`)
  const base: SqlAgentResult = {
    filters: reassigned.filters,
    raw,
    reasoning: allMessages.length > 0 ? (reasoning ?? "") + "\n\n🔧 값 교정: " + allMessages.join(". ") : reasoning,
    confidence: parsed.confidence ?? "medium",
    clarification: parsed.clarification ?? null,
  }
  return applyRangeGuard(base, schema)
}

// ── Response Parser ──────────────────────────────────────────

type ParsedAgent = { filters: AgentFilter[]; reasoning?: string; confidence?: "high" | "medium" | "low"; clarification?: string | null }

function extractConfidence(v: unknown): "high" | "medium" | "low" | undefined {
  if (v === "high" || v === "medium" || v === "low") return v
  return undefined
}
function extractClarification(v: unknown): string | null | undefined {
  if (typeof v === "string" && v.trim()) return v.trim()
  if (v === null) return null
  return undefined
}

function parseAgentResponse(raw: string): ParsedAgent {
  const trimmed = raw.trim()

  // New format: {"reasoning":"...","filters":[...]}
  // Old format: [...]
  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Array.isArray((parsed as { filters?: unknown }).filters)) {
      const obj = parsed as { reasoning?: unknown; filters: unknown[]; confidence?: unknown; clarification?: unknown }
      return {
        filters: validateFilters(obj.filters),
        reasoning: typeof obj.reasoning === "string" && obj.reasoning.trim() ? obj.reasoning.trim() : undefined,
        confidence: extractConfidence(obj.confidence),
        clarification: extractClarification(obj.clarification) ?? null,
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
          confidence: extractConfidence(parsed.confidence),
          clarification: extractClarification(parsed.clarification) ?? null,
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

export interface AppliedFilterBuildResult {
  filter: AppliedFilter | null
  droppedReason?: "skip_token" | "qa_pseudo_field" | "unknown_column"
}

export function buildAppliedFilterFromAgentFilterWithTrace(
  agentFilter: AgentFilter,
  turnCount: number,
): AppliedFilterBuildResult {
  // Skip-token guard: LLM 이 "상관없음/모름/아무거나" 같은 skip 신호를 값으로 emit 한 경우,
  // 이를 실제 필터로 적용하면 후보가 0 으로 떨어짐 (시리즈명 "상관없음" 버그). 드랍.
  if (typeof agentFilter.value === "string" && isSkipToken(agentFilter.value)) {
    return { filter: null, droppedReason: "skip_token" }
  }

  // _qa is a carrier for direct answer text — never applied as a real filter.
  // serve-engine extracts the text before calling this and drops _qa.
  if (agentFilter.field === "_qa") {
    return { filter: null, droppedReason: "qa_pseudo_field" }
  }

  // Navigation pseudo-fields
  if (NAV_FIELDS.has(agentFilter.field)) {
    return {
      filter: {
        field: agentFilter.field.replace(/^_/, ""),
        op: agentFilter.op as AppliedFilter["op"],
        value: agentFilter.value,
        rawValue: agentFilter.value,
        appliedAt: turnCount,
      },
    }
  }

  // Map DB column to filter-field-registry field name.
  // Also accept registry field name directly (LLM may emit cornerRadiusMm, shankType,
  // helixAngleDeg, etc. — these are registry fields, not DB columns).
  let registryField: string | null = DB_COL_TO_FILTER_FIELD[agentFilter.field] ?? null
  if (!registryField && getFilterFieldDefinition(agentFilter.field)) {
    registryField = agentFilter.field
  }

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
    // BUG1: LLM may emit `display: "피삭재: 인코넬(내열합금)"` baking the field label into
    // the display string, which then duplicates ("피삭재: 피삭재: ...") in 0-result messages.
    // Strip the leading "<label>:" if it matches this field, and trim any "(extra)" suffix.
    const fieldLabel = getFilterFieldLabel(registryField)
    let displayValue = agentFilter.display ?? (isBetween ? `${agentFilter.value}~${agentFilter.value2}` : agentFilter.value)
    if (fieldLabel && displayValue) {
      const labelPrefixRe = new RegExp(`^\\s*${fieldLabel.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*[:：]\\s*`, "i")
      displayValue = displayValue.replace(labelPrefixRe, "")
    }
    const filter: AppliedFilter = {
      field: registryField,
      op,
      value: displayValue,
      rawValue,
      appliedAt: turnCount,
    }
    if (isBetween) {
      ;(filter as AppliedFilter & { rawValue2?: number | string }).rawValue2 = coerceRawValue(registryField, agentFilter.value2 as string)
    }
    return { filter }
  }

  // Not in the DB_COL_TO_FILTER_FIELD whitelist — but the LLM may still have
  // picked a real MV column. Validate against the live schema. If the column
  // exists, build a rawSqlField filter that bypasses the registry but is still
  // safe (schema-checked + parameterized in WHERE-builder).
  const schema = getDbSchemaSync()
  const colMeta = schema?.columns.find(c => c.column_name === agentFilter.field)
  if (!colMeta) {
    console.warn(`[sql-agent] dropping filter on unknown column: ${agentFilter.field}`)
    return { filter: null, droppedReason: "unknown_column" }
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
  return { filter }
}

export function buildAppliedFilterFromAgentFilter(
  agentFilter: AgentFilter,
  turnCount: number,
): AppliedFilter | null {
  return buildAppliedFilterFromAgentFilterWithTrace(agentFilter, turnCount).filter
}

function coerceNumeric(value: string): number | string {
  const n = parseFloat(value)
  return isNaN(n) ? value : n
}

// ── Helpers ──────────────────────────────────────────────────

const NUMERIC_REGISTRY_FIELDS = new Set([
  "diameterMm", "fluteCount", "shankDiameterMm", "lengthOfCutMm",
  "overallLengthMm", "helixAngleDeg", "ballRadiusMm", "taperAngleDeg",
  "cornerRadiusMm",
])

function coerceRawValue(field: string, value: string): string | number {
  if (NUMERIC_REGISTRY_FIELDS.has(field)) {
    const n = parseFloat(value)
    return isNaN(n) ? value : n
  }
  return value
}
