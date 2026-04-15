/**
 * CoT → Filter Fallback (Fix 2)
 *
 * 3-stage fallback used when the primary SQL Agent returns 0 filters:
 *  - Stage 1: take the SQL-agent CoT reasoning and ask a tiny LLM (haiku/mini)
 *    to extract {field, op, value} if the reasoning discusses a concrete
 *    filter candidate. Returns kind:"filter" with a usable AgentFilter.
 *  - Stage 2: if no filter comes out but the user message has numeric+unit
 *    tokens, ask the LLM to pick 2-3 plausible DB column candidates from the
 *    live schema and surface them as smart chips. Returns kind:"clarification".
 *  - Stage 3: kind:"none" → caller falls back to its existing default
 *    clarification path.
 *
 * Hard rules (CLAUDE.md):
 *  - NO hardcoded field cue mappings. Column candidates come from LLM + DB schema.
 *  - Uses llm-executor.ts wrapper (tier: mini, reasoning: light).
 */

import { executeLlm } from "@/lib/llm/llm-executor"
import { getFilterFieldLabel } from "@/lib/recommendation/shared/filter-field-registry"
import { formatNumericStatsCompact, type DbSchema } from "./sql-agent-schema-cache"

export type FallbackFilter = {
  field: string
  op: "eq" | "neq" | "gte" | "lte" | "between" | "includes"
  value: string | number
  value2?: string | number | null
  display?: string | null
}

export type FallbackClarification = {
  question: string
  chips: string[]
}

export type CotFilterFallbackResult =
  | { kind: "filter"; filter: FallbackFilter }
  | { kind: "clarification"; clarification: FallbackClarification }
  | { kind: "none"; reason: string }

export interface CotFilterFallbackArgs {
  userMessage: string
  cotReasoning: string
  schema: DbSchema
}

const VALID_OPS = new Set<FallbackFilter["op"]>(["eq", "neq", "gte", "lte", "between", "includes"])

export async function tryCotToFilterFallback(args: CotFilterFallbackArgs): Promise<CotFilterFallbackResult> {
  const msg = (args.userMessage ?? "").trim()
  const cot = (args.cotReasoning ?? "").trim()

  // ── Stage 1: CoT → filter extraction ──
  if (cot.length > 0) {
    const stage1 = await extractFilterFromCot(msg, cot, args.schema)
    if (stage1) return { kind: "filter", filter: stage1 }
  }

  // ── Stage 2: numeric token → smart chips ──
  const numericTokens = extractNumericTokens(msg)
  if (numericTokens.length > 0) {
    const chips = await pickColumnsForNumericToken(numericTokens[0], msg, args.schema)
    if (chips && chips.length > 0) {
      return {
        kind: "clarification",
        clarification: {
          question: `"${numericTokens[0].raw}"는 어느 필드 값으로 적용할까요?`,
          chips: [...chips, "직접 입력"],
        },
      }
    }
  }

  return { kind: "none", reason: cot ? "cot_no_filter_and_no_numeric" : "no_cot_no_numeric" }
}

// ── Stage 1 helper ─────────────────────────────────────────────

async function extractFilterFromCot(
  userMessage: string,
  cotReasoning: string,
  schema: DbSchema,
): Promise<FallbackFilter | null> {
  try {
    const columns = schema.columns.slice(0, 60).map(c => c.column_name).join(", ")
    const systemPrompt = `당신은 YG-1 절삭공구 DB의 필터 추출기입니다.
아래 SQL Agent의 사고 과정(CoT)에 "어떤 컬럼에 어떤 값을 적용해야 한다"는 판단이 보이면, 그 필터를 JSON 하나로만 출력하세요.
사고 과정에 구체적 필터 의도가 없으면 null 을 출력하세요.

DB 컬럼(일부): ${columns}

출력 형식 (반드시 이 중 하나만):
{"field":"<컬럼명>","op":"eq|neq|gte|lte|between|includes","value":"<값>","value2":"<선택>"}
또는
null

설명/코드펜스 금지. JSON 또는 null 만.`
    const userInput = `사용자 메시지: "${userMessage}"\n\nSQL Agent CoT:\n${cotReasoning.slice(0, 1200)}`
    const res = await executeLlm({
      agentName: "parameter-extractor",
      modelTier: "mini",
      reasoningTier: "light",
      systemPrompt,
      userInput,
      maxTokens: 200,
    })
    const text = (res.text ?? "").trim()
    if (!text || /^null$/i.test(text)) return null
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    let parsed: unknown
    try { parsed = JSON.parse(jsonMatch[0]) } catch { return null }
    if (!parsed || typeof parsed !== "object") return null
    const obj = parsed as Record<string, unknown>
    const field = typeof obj.field === "string" ? obj.field.trim() : ""
    const op = typeof obj.op === "string" ? obj.op.trim() as FallbackFilter["op"] : "eq"
    const value = obj.value
    if (!field || value == null) return null
    if (!VALID_OPS.has(op)) return null
    // Validate field exists in schema — no column hallucination.
    const colExists = schema.columns.some(c => c.column_name === field)
    if (!colExists) return null
    // Substring sanity: reject if LLM value doesn't appear in user message OR CoT.
    const vStr = String(value).trim()
    if (!vStr) return null
    const haystack = `${userMessage} ${cotReasoning}`.toLowerCase()
    if (!haystack.includes(vStr.toLowerCase())) return null
    return {
      field,
      op,
      value: typeof value === "number" ? value : String(value),
      value2: obj.value2 == null ? null : (typeof obj.value2 === "number" ? obj.value2 : String(obj.value2)),
      display: null,
    }
  } catch {
    return null
  }
}

// ── Stage 2 helpers ────────────────────────────────────────────

interface NumericToken { raw: string; num: number; unit: string | null }

function extractNumericTokens(message: string): NumericToken[] {
  const out: NumericToken[] = []
  if (!message) return out
  const re = /(\d+(?:\.\d+)?)\s*(mm|㎜|도|°|deg|hrc|rpm|분|시간|개|날|플루트|f|φ)?/giu
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) {
    const num = Number(m[1])
    if (!Number.isFinite(num)) continue
    const unit = (m[2] ?? "").trim().toLowerCase() || null
    out.push({ raw: m[0].trim(), num, unit })
  }
  return out
}

async function pickColumnsForNumericToken(
  token: NumericToken,
  message: string,
  schema: DbSchema,
): Promise<string[] | null> {
  const numericCols = Object.entries(schema.numericStats).slice(0, 40)
  if (numericCols.length === 0) return null
  const schemaSnippet = numericCols
    .map(([col, s]) => formatNumericStatsCompact(col, s))
    .join("\n")
  const systemPrompt = `당신은 YG-1 절삭공구 DB의 숫자 컬럼 매퍼입니다.
사용자가 언급한 숫자(+단위)가 어느 DB 숫자 컬럼에 적용될지 2~3개만 골라 JSON 배열로 출력하세요.
["컬럼1","컬럼2","컬럼3"]
컬럼명은 스키마 원본(영문). 설명·코드펜스 금지.

DB 숫자 컬럼:
${schemaSnippet}`
  const userInput = `사용자 메시지: "${message}"\n숫자 토큰: ${token.raw} (num=${token.num}, unit=${token.unit ?? "없음"})`
  try {
    const res = await executeLlm({
      agentName: "parameter-extractor",
      modelTier: "mini",
      reasoningTier: "light",
      systemPrompt,
      userInput,
      maxTokens: 120,
    })
    const text = (res.text ?? "").trim()
    if (!text) return null
    const jsonMatch = text.match(/\[[\s\S]*?\]/)
    if (!jsonMatch) return null
    let parsed: unknown
    try { parsed = JSON.parse(jsonMatch[0]) } catch { return null }
    if (!Array.isArray(parsed)) return null
    const cols = parsed.map(x => String(x ?? "").trim()).filter(Boolean).slice(0, 3)
    if (cols.length === 0) return null
    // Translate to Korean label when registered; otherwise keep column name.
    return cols.map(col => {
      const label = getFilterFieldLabel(col)
      return label && label !== col ? `${label} (${token.raw})` : `${col} (${token.raw})`
    })
  } catch {
    return null
  }
}
