/**
 * SQL Agent — LLM이 DB schema를 보고 자연어에서 WHERE절 필터를 생성.
 * filter-field-registry.ts의 수동 매핑을 보완하는 추가 레이어.
 * Haiku 1회 호출로 동작.
 */

import { getDbSchemaSync, type DbSchema } from "./sql-agent-schema-cache"
import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import { resolveModel } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter } from "@/lib/types/exploration"
import { selectFewShots, buildFewShotText } from "./adaptive-few-shot"
import { validateAndResolveFilters } from "./value-resolver"

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
  milling_number_of_flute: "fluteCount",
  milling_numberofflute: "fluteCount",
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
const NAV_FIELDS = new Set(["_skip", "_reset", "_back"])

// ── System Prompt Builder ────────────────────────────────────
// NO hardcoded column descriptions. The LLM reads column names + sample values
// directly from the DB schema and matches user intent itself. Adding a new
// column to the MV requires zero code changes — it shows up automatically.

export type SqlAgentMode = "fast" | "cot"

function buildSystemPrompt(schema: DbSchema, existingFilters: AppliedFilter[], userMessage?: string, mode: SqlAgentMode = "fast"): string {
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
(브랜드는 한국어 음역으로 들어올 수 있습니다 — 예: "엑스파워" ≈ X-POWER, "알루파워" ≈ ALU-POWER. 발음 유사도로 위 리스트의 정확한 값을 골라 emit 하세요. 리스트에 없으면 emit 금지.)

## Auxiliary Tables (read-only reference — not directly filtered, but informs which questions need a tool-forge join)
${auxList || "  (none loaded)"}

If the user asks about cutting conditions / RPM / feed rate / 절삭조건 / 회전수 / 이송속도 / 절입깊이, those numbers live in raw_catalog.cutting_condition_table — return [] here so the upstream tool-forge handles the join. Do NOT invent product-MV columns for those.

===DYNAMIC===

## Currently Applied Filters
${filterList}

## Instructions
Extract filter conditions and a short Korean reasoning trail from the user message as a JSON object:
{"reasoning":"한국어 사고 과정 (실제 deliberation, 5-10문장)","filters":[{"field":"column_name","op":"eq|neq|like|gte|lte|between","value":"...","value2":"upper_bound_for_between","display":"한국어 설명"}]}

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
- 가공 형상: 측면가공 → series_application_shape like "side" · 포켓 → like "pocket" · 곡면 → like "contour"
- 생크: 플레인/스트레이트 → shank_type like "Plain" · 웰던 → like "Weldon" · HA → like "HA"
- 국가 (text[]): 국내/한국 → eq "KOR" · 미국/인치 → eq "USA" · 유럽 → eq "ENG" · 일본 → eq "JPN"
- 모호한 표현(좋은 거/추천해줘/괜찮은 거/범용/다양한) → []

## Examples (dynamically selected — most similar to current query from golden set)
${userMessage ? (buildFewShotText(selectFewShots(userMessage, 4)) || "(no matching examples found — fall back to schema-driven reasoning)") : "(no user message context — generic mode)"}

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
): Promise<SqlAgentResult> {
  const systemPrompt = buildSystemPrompt(schema, existingFilters, userMessage, mode)
  const raw = await provider.complete(
    systemPrompt,
    [{ role: "user", content: userMessage }],
    mode === "cot" ? 8192 : 2048,
    SQL_AGENT_MODEL,
  )

  const { filters, reasoning } = parseAgentResponse(raw)
  console.log("\n[sql-agent:CoT] ────────────────────────────────")
  console.log(`[sql-agent:CoT] user: ${userMessage}`)
  console.log(`[sql-agent:CoT] existing filters: ${existingFilters.map(f => `${f.field}=${f.value}`).join(", ") || "(none)"}`)
  console.log(`[sql-agent:CoT] reasoning:\n${reasoning ?? "(none)"}`)
  console.log(`[sql-agent:CoT] filters: ${JSON.stringify(filters)}`)
  console.log(`[sql-agent:CoT] raw(${raw.length}b): ${raw.slice(0, 800)}${raw.length > 800 ? "…" : ""}`)
  console.log("[sql-agent:CoT] ────────────────────────────────\n")
  const resolved = validateAndResolveFilters(filters)
  if (resolved.messages.length > 0) {
    const note = resolved.messages.join(". ")
    console.log(`[sql-agent:value-resolver] ${note}`)
    return { filters: resolved.resolvedFilters, raw, reasoning: (reasoning ?? "") + "\n\n🔧 값 교정: " + note }
  }
  return { filters: resolved.resolvedFilters, raw, reasoning }
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
): Promise<SqlAgentResult> {
  if (!provider.stream) {
    return naturalLanguageToFilters(userMessage, schema, existingFilters, provider, mode)
  }
  const systemPrompt = buildSystemPrompt(schema, existingFilters, userMessage, mode)
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
    return naturalLanguageToFilters(userMessage, schema, existingFilters, provider, mode)
  }
  const { filters, reasoning } = parseAgentResponse(raw)
  console.log("\n[sql-agent:CoT:stream] ────────────────────────")
  console.log(`[sql-agent:CoT:stream] user: ${userMessage}`)
  console.log(`[sql-agent:CoT:stream] existing filters: ${existingFilters.map(f => `${f.field}=${f.value}`).join(", ") || "(none)"}`)
  console.log(`[sql-agent:CoT:stream] reasoning:\n${reasoning ?? "(none)"}`)
  console.log(`[sql-agent:CoT:stream] filters: ${JSON.stringify(filters)}`)
  console.log(`[sql-agent:CoT:stream] raw(${raw.length}b): ${raw.slice(0, 800)}${raw.length > 800 ? "…" : ""}`)
  console.log("[sql-agent:CoT:stream] ────────────────────────\n")
  const resolved = validateAndResolveFilters(filters)
  if (resolved.messages.length > 0) {
    const note = resolved.messages.join(". ")
    console.log(`[sql-agent:value-resolver:stream] ${note}`)
    return { filters: resolved.resolvedFilters, raw, reasoning: (reasoning ?? "") + "\n\n🔧 값 교정: " + note }
  }
  return { filters: resolved.resolvedFilters, raw, reasoning }
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
