/**
 * Unified LLM Router — 단일 GPT-5.4 호출로 전체 판단.
 *
 * 역할:
 *   - intent 분류 + 필터 추출 + 응답 텍스트 + narrowing 칩 + purpose 를
 *     한 번의 LLM 호출로 결정한다.
 *   - 외부 regex 게이트, unified-judgment, deterministic-scr(추출) 에 의존하지 않는다.
 *   - 이 파일은 "두뇌". 실행(DB/카드)은 unified-decision-handler 가 담당.
 *
 * 검증:
 *   - 환각 필드/값은 handler 쪽에서 filter-field-registry + DbSchema 로 검증.
 *   - 여기서는 순수하게 LLM 호출 + JSON 파싱 + 스키마 주입만 담당.
 */

import { executeLlm } from "@/lib/llm/llm-executor"
import type { DbSchema, NumericStat } from "@/lib/recommendation/core/sql-agent-schema-cache"
import { formatNumericStatsLine } from "@/lib/recommendation/core/sql-agent-schema-cache"
import type { AppliedFilter, ChatMessage } from "@/lib/recommendation/domain/types"
import { getFilterFieldDefinition, getRegisteredFilterFields } from "@/lib/recommendation/shared/filter-field-registry"

// ── Types ────────────────────────────────────────────────────

export type UnifiedIntent =
  | "recommend"
  | "refine"
  | "question"
  | "explore"
  | "compare"
  | "explain"
  | "reset"

export interface UnifiedFilter {
  field: string
  op: "eq" | "neq" | "gte" | "lte" | "between" | "like"
  value: string | number | boolean
  value2?: string | number
  display?: string
}

export interface UnifiedDecision {
  intent: UnifiedIntent
  cot: string
  filters: UnifiedFilter[]
  response: string
  /** null 이면 narrowing 아님 → 카드 바로 렌더. 배열이면 질문만 표시. */
  chips: string[] | null
  purpose: "recommendation" | "question"
  confidence: "high" | "medium" | "low"
}

export interface UnifiedRouterInput {
  message: string
  appliedFilters: AppliedFilter[]
  candidateCount: number | null
  conversationHistory: ChatMessage[]
  schema: DbSchema | null
}

// ── Schema prompt builder ────────────────────────────────────

const PROMPT_SAMPLE_LIMIT = 6
const PROMPT_MAX_TEXT_COLUMNS = 40
const PROMPT_MAX_AUX_TABLES = 4

function formatTextSampleLine(col: string, samples: string[], description?: string): string {
  const preview = samples.slice(0, PROMPT_SAMPLE_LIMIT).map(v => JSON.stringify(v)).join(", ")
  const desc = description ? ` — ${description}` : ""
  return `  ${col}${desc} | 샘플: [${preview}]${samples.length > PROMPT_SAMPLE_LIMIT ? " …" : ""}`
}

function formatNumericBlock(col: string, stat: NumericStat, description?: string): string {
  const base = formatNumericStatsLine(col, stat)
  return description ? `${base} | ${description}` : base
}

/**
 * DbSchema → prompt-ready text block.
 *  - 메인 MV 컬럼 + 한글 설명 + 분포(숫자) or 샘플값(텍스트)
 *  - 보조 테이블(컷팅조건, 재고 등)은 압축 요약
 *  - 하드코딩 매핑 없음. 컬럼/분포/샘플 자체가 매핑의 근거.
 */
/**
 * Build the "canonical filter fields" section — this is what the LLM must emit
 * as `field` in its output. Derived from filter-field-registry so we stay 100%
 * data-driven (no hardcoded mapping tables).
 */
function buildCanonicalFieldsSection(schema: DbSchema): string {
  const lines: string[] = []
  lines.push("== 필터 가능 필드 (output 에서 field 로 emit 할 이름) ==")
  for (const name of getRegisteredFilterFields()) {
    const def = getFilterFieldDefinition(name)
    if (!def) continue
    const unit = def.unit ? ` ${def.unit}` : ""
    const label = def.label ? ` — ${def.label}` : ""
    const kind = def.kind
    // 샘플 값은 DB schema 에서 이름이 일치하는 컬럼을 먼저 찾아본다
    const samples = schema.sampleValues[name]
    const stat = schema.numericStats[name]
    let extras = ""
    if (kind === "number" && stat) {
      extras = ` | 분포 p10..p90=[${stat.p10}/${stat.p25}/${stat.p50}/${stat.p75}/${stat.p90}] 고유${stat.distinctCount}`
    } else if (kind === "string" && samples && samples.length > 0) {
      extras = ` | 샘플=${samples.slice(0, 6).map(v => JSON.stringify(v)).join(",")}`
    }
    lines.push(`- ${def.field} [${kind}${unit}]${label}${extras}`)
  }
  return lines.join("\n")
}

export function buildSchemaPrompt(schema: DbSchema): string {
  const lines: string[] = []

  lines.push(buildCanonicalFieldsSection(schema))
  lines.push("")
  lines.push("== MV 메인 컬럼 (product_recommendation_mv) — 참고용 ==")
  const columnDesc = schema.columnDescriptions ?? {}
  let textCount = 0
  for (const { column_name, data_type } of schema.columns) {
    const desc = columnDesc[column_name]
    const stat = schema.numericStats[column_name]
    if (stat) {
      lines.push(formatNumericBlock(column_name, stat, desc))
      continue
    }
    const samples = schema.sampleValues[column_name]
    if (samples && samples.length > 0) {
      if (textCount >= PROMPT_MAX_TEXT_COLUMNS) continue
      textCount += 1
      lines.push(formatTextSampleLine(column_name, samples, desc))
      continue
    }
    if (desc) lines.push(`  ${column_name} (${data_type}) — ${desc}`)
  }

  if (schema.workpieces.length > 0) {
    const names = schema.workpieces
      .map(w => w.normalized_work_piece_name)
      .filter((v, i, a) => v && a.indexOf(v) === i)
      .slice(0, 20)
    lines.push("")
    lines.push(`== workPieceName 정규화값 샘플 ==\n  ${names.join(", ")}`)
  }
  if (schema.brands.length > 0) {
    lines.push("")
    lines.push(`== brand 샘플 ==\n  ${schema.brands.slice(0, 30).join(", ")}`)
  }
  if (schema.countries.length > 0) {
    lines.push("")
    lines.push(`== country 샘플 ==\n  ${schema.countries.slice(0, 20).join(", ")}`)
  }

  // 보조 테이블은 테이블명 + 핵심 컬럼만 나열
  const auxEntries = Object.entries(schema.auxTables).slice(0, PROMPT_MAX_AUX_TABLES)
  if (auxEntries.length > 0) {
    lines.push("")
    lines.push("== 보조 테이블 ==")
    for (const [tableName, cols] of auxEntries) {
      const colList = cols.slice(0, 12).map(c => c.column_name).join(", ")
      lines.push(`  ${tableName}: ${colList}${cols.length > 12 ? " …" : ""}`)
    }
  }

  return lines.join("\n")
}

function formatAppliedFilters(filters: AppliedFilter[]): string {
  if (!filters || filters.length === 0) return "(없음)"
  return filters
    .map(f => `${f.field} ${f.op} ${JSON.stringify(f.rawValue)}${f.rawValue2 !== undefined ? "~" + JSON.stringify(f.rawValue2) : ""}`)
    .join(", ")
}

function formatHistory(history: ChatMessage[]): string {
  const tail = history.slice(-6)
  if (tail.length === 0) return "(없음)"
  return tail
    .map(m => `${m.role === "ai" ? "AI" : "USER"}: ${String(m.text ?? "").slice(0, 300)}`)
    .join("\n")
}

// ── System prompt ────────────────────────────────────────────

const UNIFIED_SYSTEM_PROMPT_HEADER =
  "당신은 YG-1 절삭공구 AI 어시스턴트입니다. 10년차 영업 엔지니어처럼 대화합니다."

function buildSystemPrompt(schemaPrompt: string, appliedFiltersText: string, candidateCount: number | null, historyText: string): string {
  const candText = candidateCount === null ? "(아직 조회 전)" : String(candidateCount)
  return [
    UNIFIED_SYSTEM_PROMPT_HEADER,
    "",
    "━━ DB 스키마 ━━",
    schemaPrompt,
    "",
    "━━ 현재 세션 ━━",
    `적용된 필터: ${appliedFiltersText}`,
    `현재 후보 수: ${candText}`,
    "",
    "━━ 최근 대화 ━━",
    historyText,
    "",
    "━━ 출력 형식 ━━",
    "반드시 아래 JSON 으로만 응답. 다른 설명/마크다운/코드블록 금지.",
    "{",
    '  "cot": "자유로운 한국어 사고 과정. 이 생각이 곧 결론",',
    '  "intent": "recommend | refine | question | explore | compare | explain | reset",',
    '  "filters": [{"field": "DB컬럼명", "op": "eq|neq|gte|lte|between|like", "value": "값", "value2": "between 상한", "display": "한글 설명"}],',
    '  "response": "사용자에게 보여줄 응답 텍스트",',
    '  "chips": ["선택지1", "선택지2", "📋 이대로 보여줘 (N개)", "직접 입력"] 또는 null,',
    '  "purpose": "recommendation | question",',
    '  "confidence": "high | medium | low"',
    "}",
    "",
    "━━ cot (Chain of Thought) ━━",
    "자유롭게 생각하세요. 형식 없습니다.",
    "cot 와 나머지 필드가 모순되면 안 됩니다.",
    "cot 가 진실입니다. 나머지는 cot 의 결론입니다.",
    "",
    "━━ 판단 원칙 (3개만) ━━",
    "",
    "1. 스키마를 읽어라.",
    "   위 컬럼명/한글 설명/샘플값/분포를 보고 사용자의 자연어를 올바른 컬럼+값에 매핑.",
    "   매핑 테이블은 없다. 스키마가 유일한 진실.",
    "   workPieceName 과 material 은 같은 개념 — workPieceName 만 사용.",
    "",
    "2. 사용자가 결정한다.",
    "   필터 적용 후 미결정 필드가 있으면 chips 로 제안.",
    "   당신이 '충분하다'고 판단해서 결과를 바로 보여주지 말라.",
    "   chips 에는 항상 '📋 이대로 보여줘 (N개)' 와 '직접 입력' 을 포함.",
    "   chips 후보는 해당 컬럼의 샘플값/분포에서.",
    "   더 좁힐 의미가 없으면 chips = null 로 반환 → 카드 렌더.",
    "",
    "3. 사용자가 언급한 모든 조건을 빠짐없이 filters 에 포함.",
    "   '정도/쯤/약/대략' → between (±10~15%).",
    "   '말고/빼고/제외' → neq.",
    "   '이상/넘는' → gte, '이하/미만' → lte, '사이/~' → between.",
    "",
    "━━ intent 가이드 ━━",
    "- recommend: 새 추천/검색 요청 (필터 적용)",
    "- refine: 기존 조건 수정 (직경 바꿔줘 / TiAlN 말고 등)",
    "- question: 특정 제품/필드 스펙 질의 (카드 없이 텍스트로 답)",
    "- explore: 어떤 옵션이 있는지 탐색 (필터 아님, 텍스트로 옵션 나열)",
    "- compare: 제품/시리즈 비교",
    "- explain: 도메인 지식 설명 (헬릭스각이 뭐야 등)",
    "- reset: 초기화 (처음부터 다시)",
    "",
    "━━ 응답 톤 ━━",
    "10년차 영업 엔지니어. 간결, 전문적, 실용적. 이모지/불필요 서두 금지.",
  ].join("\n")
}

// ── JSON extraction ──────────────────────────────────────────

function extractJsonObject(raw: string): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  // 1) 코드펜스 제거
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const body = fenceMatch ? fenceMatch[1].trim() : trimmed
  // 2) 첫 { 부터 마지막 } 까지
  const first = body.indexOf("{")
  const last = body.lastIndexOf("}")
  if (first < 0 || last <= first) return null
  return body.slice(first, last + 1)
}

function normalizeIntent(raw: unknown, chips: string[] | null): UnifiedIntent {
  const s = String(raw ?? "").trim().toLowerCase()
  const valid: UnifiedIntent[] = ["recommend", "refine", "question", "explore", "compare", "explain", "reset"]
  if ((valid as string[]).includes(s)) return s as UnifiedIntent
  // 보수적 기본값: chips 있으면 refine 흐름으로, 없으면 recommend
  return chips && chips.length > 0 ? "refine" : "recommend"
}

function normalizeFilter(raw: unknown): UnifiedFilter | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const field = typeof r.field === "string" ? r.field.trim() : ""
  if (!field) return null
  const opRaw = typeof r.op === "string" ? r.op.trim().toLowerCase() : "eq"
  const validOps = new Set(["eq", "neq", "gte", "lte", "between", "like"])
  const op = validOps.has(opRaw) ? (opRaw as UnifiedFilter["op"]) : "eq"
  const value = r.value as UnifiedFilter["value"]
  if (value === undefined || value === null || value === "") return null
  const out: UnifiedFilter = { field, op, value }
  if (r.value2 !== undefined && r.value2 !== null && r.value2 !== "") {
    out.value2 = r.value2 as string | number
  }
  if (typeof r.display === "string") out.display = r.display
  return out
}

function parseUnifiedDecision(rawText: string): UnifiedDecision | null {
  const json = extractJsonObject(rawText)
  if (!json) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const p = parsed as Record<string, unknown>

  const cot = typeof p.cot === "string" ? p.cot : ""
  const response = typeof p.response === "string" ? p.response : ""
  const purposeRaw = typeof p.purpose === "string" ? p.purpose.trim().toLowerCase() : ""
  const purpose: "recommendation" | "question" =
    purposeRaw === "recommendation" ? "recommendation" : "question"

  let chips: string[] | null = null
  if (Array.isArray(p.chips)) {
    const cleaned = p.chips
      .map(c => (typeof c === "string" ? c.trim() : ""))
      .filter(c => c.length > 0)
    chips = cleaned.length > 0 ? cleaned : null
  } else if (p.chips === null) {
    chips = null
  }

  const filtersRaw = Array.isArray(p.filters) ? p.filters : []
  const filters: UnifiedFilter[] = []
  for (const item of filtersRaw) {
    const norm = normalizeFilter(item)
    if (norm) filters.push(norm)
  }

  const intent = normalizeIntent(p.intent, chips)
  const confRaw = typeof p.confidence === "string" ? p.confidence.trim().toLowerCase() : ""
  const confidence: "high" | "medium" | "low" =
    confRaw === "high" || confRaw === "medium" || confRaw === "low"
      ? (confRaw as "high" | "medium" | "low")
      : "medium"

  return { intent, cot, filters, response, chips, purpose, confidence }
}

// ── Public entry ─────────────────────────────────────────────

export async function unifiedLLMRouter(input: UnifiedRouterInput): Promise<UnifiedDecision | null> {
  if (!input.schema) return null
  const schemaPrompt = buildSchemaPrompt(input.schema)
  const appliedText = formatAppliedFilters(input.appliedFilters)
  const historyText = formatHistory(input.conversationHistory)
  const systemPrompt = buildSystemPrompt(schemaPrompt, appliedText, input.candidateCount, historyText)

  const started = Date.now()
  const result = await executeLlm({
    agentName: "unified-router",
    reasoningTier: "normal",
    modelTier: "full",
    systemPrompt,
    userInput: input.message,
    maxTokens: 2000,
  })
  const elapsed = Date.now() - started

  const decision = parseUnifiedDecision(result.text ?? "")
  if (!decision) {
    try {
      console.warn(`[unified-router] JSON parse failed (${elapsed}ms). raw head=${(result.text ?? "").slice(0, 240)}`)
    } catch { /* no-op */ }
    return null
  }

  try {
    console.log(
      `[unified-router] intent=${decision.intent} filters=${decision.filters.length}` +
      ` chips=${decision.chips ? decision.chips.length : 0} purpose=${decision.purpose}` +
      ` conf=${decision.confidence} elapsed=${elapsed}ms`,
    )
  } catch { /* no-op */ }

  return decision
}
