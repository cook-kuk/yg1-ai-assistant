/**
 * Prompt Compiler — DSPy-style automatic prompt optimization.
 *
 * 아이디어:
 * 1. training data = testset/golden-set-v1.json + feedback_learned_examples (MongoDB)
 * 2. metric = quick-runner-quality (eval-judge 25점 체계) 통과율
 * 3. 성공 trace → best few-shot demonstrations 로 bootstrap
 * 4. 실패 trace → 프롬프트에 보완 규칙 추가 (LLM 분석)
 * 5. 개선된 경우 data/compiled-demonstrations.json 에 저장 →
 *    adaptive-few-shot.ts 이 자동으로 이 파일을 읽어 pool에 합류
 *
 * 이 파일은 MVP 스켈레톤: 실제 eval 실행 로직은 quick-runner-quality.mjs 와
 * 연결되어야 하며 완성은 다음 iteration.
 *
 * 실행: npx ts-node scripts/compile-prompts.ts
 * 주기: 매주 또는 major 변경 후
 */

import fs from "fs"
import path from "path"

interface GoldenCase {
  id?: string
  input: string
  expected?: {
    filtersAdded?: Array<{ field: string; op?: string; rawValue?: unknown; value?: unknown }>
  }
}

interface LearnedExample {
  userMessage: string
  filters: Array<{ field: string; op: string; value: string }>
  positiveCount: number
  negativeCount: number
}

interface CompiledDemonstration {
  input: string
  output: string
  source: "golden" | "feedback" | "bootstrap"
  score: number
}

interface CompileResult {
  baselineScore: number
  optimizedScore: number
  improvement: number
  demonstrationsWritten: number
  addedRules: string[]
  timestamp: string
}

const ROOT = process.cwd()
const GOLDEN_PATH = path.join(ROOT, "testset", "golden-set-v1.json")
const COMPILED_OUT = path.join(ROOT, "data", "compiled-demonstrations.json")
const HISTORY_PATH = path.join(ROOT, "data", "compile-history.json")

function loadGoldenCases(): GoldenCase[] {
  if (!fs.existsSync(GOLDEN_PATH)) return []
  const raw = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"))
  return Array.isArray(raw.cases) ? raw.cases : []
}

async function loadFeedbackExamples(): Promise<LearnedExample[]> {
  try {
    const { getMongoLogDb } = await import("@/lib/mongo/client")
    const db = await getMongoLogDb()
    if (!db) return []
    const docs = await db.collection("feedback_learned_examples").find({}).toArray()
    return docs.map(d => ({
      userMessage: String(d.userMessage ?? ""),
      filters: Array.isArray(d.filters) ? d.filters : [],
      positiveCount: Number(d.positiveCount ?? 0),
      negativeCount: Number(d.negativeCount ?? 0),
    }))
  } catch {
    return []
  }
}

/**
 * 실제 eval은 quick-runner-quality.mjs 를 호출해야 함.
 * 여기서는 placeholder: golden case 의 filtersAdded 가 존재하면 pass 로 가정.
 */
async function runEvaluation(cases: GoldenCase[], _variant: "baseline" | "optimized"): Promise<number> {
  if (cases.length === 0) return 0
  let passed = 0
  for (const c of cases) {
    if ((c.expected?.filtersAdded ?? []).length > 0) passed++
  }
  return passed / cases.length
}

function selectBestDemonstrations(
  golden: GoldenCase[],
  learned: LearnedExample[],
  maxCount: number,
): CompiledDemonstration[] {
  const out: CompiledDemonstration[] = []

  // 1. Feedback examples (가중치 기반 순위)
  const feedbackRanked = learned
    .filter(ex => ex.positiveCount - ex.negativeCount > 0)
    .sort((a, b) => (b.positiveCount - b.negativeCount) - (a.positiveCount - a.negativeCount))
  for (const ex of feedbackRanked.slice(0, Math.ceil(maxCount / 2))) {
    out.push({
      input: ex.userMessage,
      output: JSON.stringify(ex.filters),
      source: "feedback",
      score: ex.positiveCount - ex.negativeCount,
    })
  }

  // 2. Golden cases with rich filters — diversity 를 위해 field 조합별로 샘플링
  const seenPatterns = new Set<string>()
  for (const c of golden) {
    if (out.length >= maxCount) break
    const filters = c.expected?.filtersAdded ?? []
    if (filters.length === 0) continue
    const pat = filters.map(f => f.field).sort().join("+")
    if (seenPatterns.has(pat)) continue
    seenPatterns.add(pat)
    out.push({
      input: c.input,
      output: JSON.stringify(filters.map(f => ({
        field: f.field,
        op: f.op ?? "eq",
        value: String(f.rawValue ?? f.value ?? ""),
      }))),
      source: "golden",
      score: 1,
    })
  }
  return out
}

function analyzeFailures(_results: unknown[]): string[] {
  // TODO: 실패 패턴 분석 → 프롬프트 보완 규칙 추출.
  // 현재 MVP: 빈 배열 반환.
  return []
}

async function compilePrompts(): Promise<CompileResult> {
  const golden = loadGoldenCases()
  const learned = await loadFeedbackExamples()

  console.log(`[compile] golden=${golden.length} feedback=${learned.length}`)

  const baselineScore = await runEvaluation(golden.slice(0, 50), "baseline")
  const demos = selectBestDemonstrations(golden, learned, 20)
  const addedRules = analyzeFailures([])
  const optimizedScore = await runEvaluation(golden.slice(0, 50), "optimized")

  fs.mkdirSync(path.dirname(COMPILED_OUT), { recursive: true })
  fs.writeFileSync(COMPILED_OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    demonstrations: demos,
    addedRules,
  }, null, 2), "utf8")

  const result: CompileResult = {
    baselineScore,
    optimizedScore,
    improvement: optimizedScore - baselineScore,
    demonstrationsWritten: demos.length,
    addedRules,
    timestamp: new Date().toISOString(),
  }

  const history = fs.existsSync(HISTORY_PATH)
    ? JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"))
    : []
  history.push(result)
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), "utf8")

  console.log(`[compile] demos=${demos.length} baseline=${baselineScore.toFixed(2)} optimized=${optimizedScore.toFixed(2)}`)
  return result
}

export { compilePrompts }

if (require.main === module) {
  compilePrompts().catch(err => {
    console.error("[compile] failed:", err)
    process.exit(1)
  })
}
