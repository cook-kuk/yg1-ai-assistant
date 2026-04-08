/**
 * Tool Forge — 새 쿼리 패턴을 LLM으로 자동 생성하고 실행한다.
 *
 * 흐름:
 *   1. (호출자가) registry에서 매칭 tool 먼저 검색. hit → 즉시 실행 반환.
 *   2. miss → 이 모듈의 forgeAndExecute() 진입.
 *   3. LLM에 (user query, full schema, existing filters) 주고 SQL template 생성
 *   4. EXPLAIN dry-run (문법 검증) — 실패 시 에러 메시지 주고 재생성 (최대 3회)
 *   5. 실행 → 0건이면 relax loop (최대 5단계)
 *   6. 검증 LLM: 결과 샘플 3건이 사용자 의도와 맞는지 YES/NO
 *   7. verified=true 면 registry 저장 → 다음부터 step 1에서 hit
 *
 * 안전장치:
 *   - SELECT만 허용 (INSERT/UPDATE/DELETE/DROP 차단)
 *   - parameterized query 강제 ($1, $2, ...)
 *   - 허용 schema: catalog_app.*, raw_catalog.*
 *   - LIMIT 최대 50 강제 (없으면 자동 주입)
 *   - 단일 statement (세미콜론 1개 이하)
 */

import type { Pool } from "pg"
import type { LLMProvider } from "@/lib/llm/provider"
import type { AppliedFilter } from "@/lib/recommendation/domain/types"
import type { DbSchema } from "./sql-agent-schema-cache"
import { addTool, incrementUseCount, type ToolEntry } from "./tool-registry"
import { resolveModel } from "@/lib/llm/model-resolver"

// ── Types ────────────────────────────────────────────────────

export interface ForgeAttempt {
  step: number
  sqlTemplate: string
  params: unknown[]
  rowCount: number
  relaxation?: string
  error?: string
}

export interface ForgeResult {
  success: boolean
  rows: Record<string, unknown>[]
  tool: ToolEntry | null
  attempts: ForgeAttempt[]
  totalDurationMs: number
}

interface ParsedForgeResponse {
  sql: string
  params: unknown[]
  description: string
  triggerPatterns: string[]
}

// ── Constants ────────────────────────────────────────────────

const FORGE_MODEL = resolveModel("sonnet")
const RELAX_MODEL = resolveModel("haiku")
const VERIFY_MODEL = resolveModel("haiku")

const MAX_FORGE_RETRIES = 3
const MAX_RELAX_STEPS = 5
const MAX_LIMIT = 50

const ALLOWED_SCHEMAS = ["catalog_app", "raw_catalog"]
const FORBIDDEN_KEYWORDS = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|reindex)\b/i

// ── Public API ───────────────────────────────────────────────

export async function forgeAndExecute(
  userMessage: string,
  schema: DbSchema,
  existingFilters: AppliedFilter[],
  provider: LLMProvider,
  pool: Pool,
): Promise<ForgeResult> {
  const t0 = Date.now()
  const attempts: ForgeAttempt[] = []

  // Step 1-3: forge with retry on syntax error
  let parsed: ParsedForgeResponse | null = null
  let lastError: string | null = null
  for (let retry = 0; retry < MAX_FORGE_RETRIES; retry++) {
    try {
      const prompt = retry === 0
        ? buildForgePrompt(userMessage, schema, existingFilters)
        : buildRetryPrompt(userMessage, schema, existingFilters, lastError ?? "unknown error")
      const raw = await provider.complete(
        prompt,
        [{ role: "user", content: userMessage }],
        1500,
        FORGE_MODEL,
      )
      parsed = parseForgeResponse(raw)
      if (!parsed) { lastError = "JSON parse failed"; continue }

      const safetyError = validateSql(parsed.sql)
      if (safetyError) { lastError = safetyError; parsed = null; continue }

      // EXPLAIN dry-run
      try {
        await pool.query(`EXPLAIN ${parsed.sql}`, parsed.params)
        break // valid
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
        attempts.push({ step: retry + 1, sqlTemplate: parsed.sql, params: parsed.params, rowCount: 0, error: `EXPLAIN: ${lastError}` })
        parsed = null
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
    }
  }

  if (!parsed) {
    return { success: false, rows: [], tool: null, attempts, totalDurationMs: Date.now() - t0 }
  }

  // Step 4: execute
  let rows: Record<string, unknown>[] = []
  try {
    const result = await pool.query(parsed.sql, parsed.params)
    rows = result.rows as Record<string, unknown>[]
    attempts.push({ step: attempts.length + 1, sqlTemplate: parsed.sql, params: parsed.params, rowCount: rows.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    attempts.push({ step: attempts.length + 1, sqlTemplate: parsed.sql, params: parsed.params, rowCount: 0, error: msg })
    return { success: false, rows: [], tool: null, attempts, totalDurationMs: Date.now() - t0 }
  }

  // Step 5: relax loop
  if (rows.length === 0) {
    const relaxed = await relaxLoop(parsed, schema, provider, pool, attempts)
    if (relaxed) { rows = relaxed.rows; parsed = relaxed.parsed }
  }

  if (rows.length === 0) {
    return { success: false, rows: [], tool: null, attempts, totalDurationMs: Date.now() - t0 }
  }

  // Step 6: verify
  const verified = await verifyResults(userMessage, rows.slice(0, 3), provider)

  // Step 7: register
  let tool: ToolEntry | null = null
  if (verified) {
    tool = await addTool({
      name: deriveToolName(parsed.description),
      description: parsed.description,
      triggerPatterns: parsed.triggerPatterns,
      sqlTemplate: parsed.sql,
      params: parsed.params.map((_, i) => ({ name: `p${i + 1}`, type: typeof parsed!.params[i] === "number" ? "number" : "string", description: "" })),
      sourceTable: extractFromTable(parsed.sql),
      verified: true,
    })
  }

  return { success: true, rows, tool, attempts, totalDurationMs: Date.now() - t0 }
}

export async function executeRegistryTool(
  tool: ToolEntry,
  userMessage: string,
  pool: Pool,
  provider: LLMProvider,
): Promise<{ rows: Record<string, unknown>[] }> {
  // Re-extract params from the new user message via a small LLM call.
  const params = await extractParamsForTool(tool, userMessage, provider)
  try {
    const result = await pool.query(tool.sqlTemplate, params)
    void incrementUseCount(tool.id)
    return { rows: result.rows as Record<string, unknown>[] }
  } catch {
    return { rows: [] }
  }
}

// ── Validation ───────────────────────────────────────────────

function validateSql(sql: string): string | null {
  const trimmed = sql.trim()
  if (!/^\s*select\b/i.test(trimmed)) return "must start with SELECT"
  if (FORBIDDEN_KEYWORDS.test(trimmed)) return "forbidden keyword"
  // Single statement only
  const semis = trimmed.split(";").filter(s => s.trim().length > 0)
  if (semis.length > 1) return "multiple statements not allowed"
  // Schema check — every FROM/JOIN must reference an allowed schema
  const refs = [...trimmed.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi)]
  for (const m of refs) {
    if (!ALLOWED_SCHEMAS.includes(m[1].toLowerCase())) return `schema not allowed: ${m[1]}`
  }
  // LIMIT injection if missing
  if (!/\blimit\s+\d+/i.test(trimmed)) return "missing LIMIT clause"
  // Cap LIMIT
  const limitMatch = trimmed.match(/\blimit\s+(\d+)/i)
  if (limitMatch && parseInt(limitMatch[1], 10) > MAX_LIMIT) return `LIMIT exceeds ${MAX_LIMIT}`
  return null
}

// ── Relax loop ───────────────────────────────────────────────

async function relaxLoop(
  original: ParsedForgeResponse,
  schema: DbSchema,
  provider: LLMProvider,
  pool: Pool,
  attempts: ForgeAttempt[],
): Promise<{ parsed: ParsedForgeResponse; rows: Record<string, unknown>[] } | null> {
  let current = original
  for (let step = 0; step < MAX_RELAX_STEPS; step++) {
    const prompt = buildRelaxPrompt(current, schema)
    let raw: string
    try {
      raw = await provider.complete(prompt, [{ role: "user", content: "relax" }], 1000, RELAX_MODEL)
    } catch { continue }

    const next = parseForgeResponse(raw)
    if (!next) continue
    if (validateSql(next.sql)) continue

    try {
      const result = await pool.query(next.sql, next.params)
      const rows = result.rows as Record<string, unknown>[]
      attempts.push({ step: attempts.length + 1, sqlTemplate: next.sql, params: next.params, rowCount: rows.length, relaxation: `relax-${step + 1}` })
      if (rows.length > 0) return { parsed: next, rows }
      current = next
    } catch (e) {
      attempts.push({ step: attempts.length + 1, sqlTemplate: next.sql, params: next.params, rowCount: 0, relaxation: `relax-${step + 1}`, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return null
}

// ── Verification ─────────────────────────────────────────────

async function verifyResults(userMessage: string, sampleRows: Record<string, unknown>[], provider: LLMProvider): Promise<boolean> {
  if (sampleRows.length === 0) return false
  const prompt = `User question: "${userMessage}"

Result sample (${sampleRows.length} rows):
${JSON.stringify(sampleRows, null, 2).slice(0, 2000)}

Does this result match the user's intent? Reply with exactly YES or NO.`
  try {
    const raw = await provider.complete(prompt, [{ role: "user", content: "verify" }], 10, VERIFY_MODEL)
    return raw.trim().toUpperCase().startsWith("YES")
  } catch {
    return false
  }
}

// ── Param re-extraction for registry hits ────────────────────

async function extractParamsForTool(tool: ToolEntry, userMessage: string, provider: LLMProvider): Promise<unknown[]> {
  if (tool.params.length === 0) return []
  const prompt = `Tool: ${tool.description}
SQL template: ${tool.sqlTemplate}
Param spec: ${JSON.stringify(tool.params)}

Extract parameter values from this user message and return them as a JSON array in order. Numbers as numbers, strings as strings.

User: "${userMessage}"
JSON array only:`
  try {
    const raw = await provider.complete(prompt, [{ role: "user", content: userMessage }], 200, VERIFY_MODEL)
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return []
    const arr = JSON.parse(match[0])
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// ── Prompt builders ──────────────────────────────────────────

function buildForgePrompt(userMessage: string, schema: DbSchema, existingFilters: AppliedFilter[]): string {
  const colList = schema.columns.map(c => `  ${c.column_name} (${c.data_type})`).join("\n")
  const sampleSnippet = Object.entries(schema.sampleValues)
    .filter(([, v]) => v.length > 0)
    .map(([col, vals]) => `  ${col}: ${vals.slice(0, 15).join(", ")}`)
    .join("\n")
  const numericSnippet = Object.entries(schema.numericStats)
    .map(([col, s]) => `  ${col}: min=${s.min} max=${s.max}`)
    .join("\n")
  const auxSnippet = Object.entries(schema.auxTables ?? {})
    .map(([t, cols]) => `### ${t}\n${cols.map(c => `  ${c.column_name} (${c.data_type})`).join("\n")}`)
    .join("\n\n")
  const filterList = existingFilters.length > 0
    ? existingFilters.map(f => `  ${f.field} ${f.op} ${f.value}`).join("\n")
    : "  (none)"

  return `You are a SQL expert for the YG-1 cutting tool catalog. Generate a SAFE parameterized SELECT query that answers the user's question.

## Main table: catalog_app.product_recommendation_mv
${colList}

### Sample values
${sampleSnippet}

### Numeric ranges
${numericSnippet}

## Auxiliary tables
${auxSnippet || "(none)"}

## Currently applied filters
${filterList}

## Hard rules
- SELECT only. NEVER write INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE.
- Use \$1, \$2, ... for every literal value (parameterized query). Never inline strings/numbers.
- Only reference tables in schemas: catalog_app, raw_catalog.
- JOINs allowed via series_name, edp_no, series_idx.
- ALWAYS include LIMIT (max ${MAX_LIMIT}).
- Single statement, no trailing semicolons.
- For text matching prefer ILIKE with % wildcards.
- For approximate numbers ("정도", "근처", "around") use BETWEEN with ±10%.

## Response format (strict JSON, no markdown)
{
  "sql": "SELECT ... FROM ... WHERE ... LIMIT ${MAX_LIMIT}",
  "params": [...],
  "description": "한국어로 이 쿼리가 하는 일을 1문장",
  "triggerPatterns": ["이", "쿼리를", "트리거하는", "한국어", "키워드들"]
}`
}

function buildRetryPrompt(userMessage: string, schema: DbSchema, existingFilters: AppliedFilter[], lastError: string): string {
  return `${buildForgePrompt(userMessage, schema, existingFilters)}

## Previous attempt failed
Error: ${lastError}

Fix the SQL and return JSON only.`
}

function buildRelaxPrompt(current: ParsedForgeResponse, _schema: DbSchema): string {
  return `This SQL returned 0 rows:
${current.sql}
params: ${JSON.stringify(current.params)}

Relax it so it returns at least one result. Try one of:
1. Double the BETWEEN tolerance
2. Replace = with ILIKE '%...%'
3. Drop the least essential filter
4. Swap to a related column

Return JSON only:
{"sql": "...", "params": [...], "description": "${current.description}", "triggerPatterns": ${JSON.stringify(current.triggerPatterns)}}`
}

// ── Response parsing ─────────────────────────────────────────

function parseForgeResponse(raw: string): ParsedForgeResponse | null {
  const trimmed = raw.trim()
  // Strip markdown fence if present
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")
  try {
    const obj = JSON.parse(stripped)
    if (typeof obj.sql !== "string" || !Array.isArray(obj.params)) return null
    return {
      sql: obj.sql,
      params: obj.params,
      description: typeof obj.description === "string" ? obj.description : "",
      triggerPatterns: Array.isArray(obj.triggerPatterns) ? obj.triggerPatterns.map(String) : [],
    }
  } catch {
    return null
  }
}

// ── Helpers ──────────────────────────────────────────────────

function deriveToolName(description: string): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, "")
    .split(/\s+/)
    .slice(0, 4)
    .join("_")
  return slug || `tool_${Date.now()}`
}

function extractFromTable(sql: string): string {
  const m = sql.match(/\bfrom\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/i)
  return m ? `${m[1]}.${m[2]}` : "unknown"
}
