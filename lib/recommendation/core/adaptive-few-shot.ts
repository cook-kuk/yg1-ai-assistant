/**
 * Adaptive Few-Shot — golden set 케이스에서 유저 메시지에 가장 비슷한 예시 자동 선택.
 * auto-synonym.ts의 tokenize + jaccardSimilarity 사용 → 하드코딩 0.
 *
 * sql-agent system prompt에 4개 정도 동적 주입. 정적 examples 블록 대체.
 */
import { tokenize, jaccardSimilarity } from "./auto-synonym"

export interface FewShotExample {
  input: string
  output: string   // filters JSON string
  tokens: Set<string>
}

let _pool: FewShotExample[] = []
let _loaded = false

export function loadFewShotPool(): void {
  if (_loaded) return
  _loaded = true
  try {
    // dynamic require — Node runtime only. Edge runtime은 build time에 _pool=[] 그대로.
    const fs = require("fs")
    const path = require("path")
    const fp = path.join(process.cwd(), "test-results", "golden-set-v1.json")
    if (!fs.existsSync(fp)) { console.warn("[adaptive-few-shot] golden-set-v1.json missing"); return }
    const golden = JSON.parse(fs.readFileSync(fp, "utf8"))
    const cases: any[] = Array.isArray(golden.cases) ? golden.cases : []
    _pool = cases
      .filter(c => typeof c.input === "string" && Array.isArray(c.expected?.filtersAdded) && c.expected.filtersAdded.length > 0)
      .map(c => ({
        input: c.input as string,
        output: JSON.stringify(c.expected.filtersAdded.map((f: any) => ({
          field: f.field,
          op: f.op ?? "eq",
          value: String(f.rawValue ?? f.value ?? ""),
        }))),
        tokens: tokenize(c.input as string),
      }))
    console.log(`[adaptive-few-shot] loaded ${_pool.length} examples`)
  } catch (e) {
    console.warn("[adaptive-few-shot] load failed:", (e as Error).message)
  }
}

export function selectFewShots(userMessage: string, maxCount = 4): FewShotExample[] {
  if (!_loaded) loadFewShotPool()
  if (_pool.length === 0) return []
  const qt = tokenize(userMessage)
  if (qt.size === 0) return []

  const scored = _pool
    .map(ex => ({ ex, sim: jaccardSimilarity(qt, ex.tokens) }))
    .filter(s => s.sim >= 0.15)
    .sort((a, b) => b.sim - a.sim)

  const selected: FewShotExample[] = []
  const patternsSeen = new Set<string>()
  for (const { ex } of scored) {
    if (selected.length >= maxCount) break
    let pat = ""
    try {
      const parsed = JSON.parse(ex.output)
      pat = Array.isArray(parsed) ? parsed.map((f: any) => f.field).sort().join("+") : ""
    } catch { /* ignore */ }
    if (pat && patternsSeen.has(pat) && selected.length >= 2) continue
    if (pat) patternsSeen.add(pat)
    selected.push(ex)
  }
  return selected
}

export function buildFewShotText(examples: FewShotExample[]): string {
  if (examples.length === 0) return ""
  return examples.map(ex => `User: "${ex.input}"\n→ ${ex.output}`).join("\n\n")
}

/**
 * Adapter: emit examples in single-call-router's wrapper format
 * ({"actions":[{"type":"apply_filter",...}], "answer":"", "reasoning":"..."}).
 * ex.output is a bare filter array — wrap each filter as an apply_filter action.
 */
export function buildFewShotTextScr(examples: FewShotExample[]): string {
  if (examples.length === 0) return ""
  const blocks: string[] = []
  for (const ex of examples) {
    let filters: Array<{ field: string; op?: string; value: unknown }> = []
    try {
      const parsed = JSON.parse(ex.output)
      if (Array.isArray(parsed)) filters = parsed
    } catch { /* ignore */ }
    if (filters.length === 0) continue
    const actions = filters.map(f => {
      const rawVal = f.value
      // numeric-looking values → number; otherwise string
      const num = typeof rawVal === "string" && rawVal !== "" && !isNaN(Number(rawVal)) ? Number(rawVal) : null
      const value = num !== null ? num : rawVal
      return { type: "apply_filter", field: f.field, value, op: f.op ?? "eq" }
    })
    const wrapper = { actions, answer: "", reasoning: `${actions.length} filter(s) from message` }
    blocks.push(`User: "${ex.input}"\n→ ${JSON.stringify(wrapper)}`)
  }
  return blocks.join("\n\n")
}

export function _resetFewShotPoolForTest(): void {
  _pool = []
  _loaded = false
}
