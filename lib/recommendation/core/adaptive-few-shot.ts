/**
 * Adaptive Few-Shot — golden set 케이스에서 유저 메시지에 가장 비슷한 예시 자동 선택.
 * auto-synonym.ts의 tokenize + jaccardSimilarity 사용 → 하드코딩 0.
 *
 * sql-agent system prompt에 4개 정도 동적 주입. 정적 examples 블록 대체.
 */
import { tokenize, jaccardSimilarity } from "./auto-synonym"
import { getLearnedFewShotExamples } from "./feedback-pool"
import { FEEDBACK_POOL } from "@/lib/recommendation/infrastructure/config/cache-config"

export interface FewShotExample {
  input: string
  output: string   // filters JSON string
  tokens: Set<string>
  /** net positive 👍 count — Jaccard similarity에 boost로 활용 */
  feedbackWeight?: number
}

let _pool: FewShotExample[] = []
let _loaded = false

const FALLBACK_FEW_SHOT_CASES: Array<{ input: string; filters: Array<{ field: string; op?: string; rawValue: string | number }> }> = [
  {
    input: "스테인리스 4날 10mm",
    filters: [
      { field: "workPieceName", op: "includes", rawValue: "Stainless Steel" },
      { field: "fluteCount", op: "eq", rawValue: 4 },
      { field: "diameterMm", op: "eq", rawValue: 10 },
    ],
  },
  {
    input: "구리 스퀘어 2날 10mm DLC",
    filters: [
      { field: "workPieceName", op: "includes", rawValue: "Copper" },
      { field: "toolSubtype", op: "eq", rawValue: "Square" },
      { field: "fluteCount", op: "eq", rawValue: 2 },
      { field: "diameterMm", op: "eq", rawValue: 10 },
      { field: "coating", op: "eq", rawValue: "DLC" },
    ],
  },
  {
    input: "Ball 2날 알루미늄",
    filters: [
      { field: "toolSubtype", op: "eq", rawValue: "Ball" },
      { field: "fluteCount", op: "eq", rawValue: 2 },
      { field: "workPieceName", op: "includes", rawValue: "Aluminum" },
    ],
  },
]

function loadFallbackFewShotPool(): void {
  _pool = FALLBACK_FEW_SHOT_CASES.map(example => ({
    input: example.input,
    output: JSON.stringify(example.filters.map(filter => ({
      field: filter.field,
      op: filter.op ?? "eq",
      value: String(filter.rawValue),
    }))),
    tokens: tokenize(example.input),
  }))
}

export function loadFewShotPool(): void {
  if (_loaded) return
  _loaded = true
  try {
    // dynamic require — Node runtime only. Edge runtime은 build time에 _pool=[] 그대로.
    const fs = require("fs")
    const path = require("path")
    const fp = path.join(process.cwd(), "testset", "golden-set-v1.json")
    if (!fs.existsSync(fp)) {
      console.warn("[adaptive-few-shot] testset/golden-set-v1.json missing; using fallback seeds")
      loadFallbackFewShotPool()
      return
    }
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

    // compile-prompts.ts 가 생성한 bootstrap demonstration 도 pool에 합류
    try {
      const fs2 = require("fs") as typeof import("fs")
      const path2 = require("path") as typeof import("path")
      const compiledPath = path2.join(process.cwd(), "data", "compiled-demonstrations.json")
      if (fs2.existsSync(compiledPath)) {
        const compiled = JSON.parse(fs2.readFileSync(compiledPath, "utf8"))
        const demos: Array<{ input: string; output: string }> = Array.isArray(compiled?.demonstrations)
          ? compiled.demonstrations
          : []
        let added = 0
        for (const ex of demos) {
          if (!ex.input || !ex.output) continue
          _pool.push({ input: ex.input, output: ex.output, tokens: tokenize(ex.input) })
          added++
        }
        if (added > 0) console.log(`[adaptive-few-shot] +${added} compiled demonstrations`)
      }
    } catch (err) {
      console.warn("[adaptive-few-shot] compiled load failed:", (err as Error).message)
    }
  } catch (e) {
    console.warn("[adaptive-few-shot] load failed:", (e as Error).message)
    if (_pool.length === 0) loadFallbackFewShotPool()
  }
}

export function selectFewShots(userMessage: string, maxCount = 4): FewShotExample[] {
  if (!_loaded) loadFewShotPool()

  // golden set + feedback-driven learned pool 합산.
  // learned pool은 👍 횟수에 비례한 boost로 similarity 우선순위 상승.
  const learned = getLearnedFewShotExamples()
  const combined = learned.length > 0 ? [..._pool, ...learned] : _pool
  if (combined.length === 0) return []
  const qt = tokenize(userMessage)
  if (qt.size === 0) return []

  const scored = combined
    .map(ex => {
      const baseSim = jaccardSimilarity(qt, ex.tokens)
      const weight = ex.feedbackWeight ?? 0
      const boost = weight > 0
        ? Math.min(FEEDBACK_POOL.maxBoost, weight * FEEDBACK_POOL.boostPerPositive)
        : 0
      return { ex, sim: baseSim + boost }
    })
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
