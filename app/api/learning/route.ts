import { NextResponse } from "next/server"
import {
  getLearningStats,
  getPatterns,
  verifyPattern,
  runPatternMining,
  flushLearningData,
  logInteraction,
  tryLearnFromLLMFallback,
  getLearnedEntityIndex,
  type InteractionLog,
} from "@/lib/recommendation/core/self-learning"
import { getKGStats, resolveEntity, extractEntities } from "@/lib/recommendation/core/knowledge-graph"

export async function GET() {
  try {
    const stats = getLearningStats()
    const kgStats = getKGStats()
    const patterns = getPatterns()

    return NextResponse.json({
      stats,
      kgStats,
      patterns,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json({ error: "Failed to load learning data" }, { status: 500 })
  }
}

// ── Dynamic scenario generation ────────────────────────────────

const MATERIALS = ["스테인리스", "알루미늄", "탄소강", "주철", "티타늄", "인코넬", "합금강"]
const SUBTYPES = ["스퀘어", "볼", "라디우스", "황삭", "테이퍼", "챔퍼", "하이피드"]
const COATINGS = ["TiAlN", "AlTiN", "DLC", "AlCrN", "무코팅"]
const DIAMETERS = [2, 3, 4, 6, 8, 10, 12, 16, 20]
const FLUTES = [2, 3, 4, 6]
const OPERATIONS = ["황삭", "정삭", "슬롯", "측면가공", "포켓가공"]

// Templates for generating diverse user messages
const LLM_TEMPLATES = [
  // Material + operation patterns
  (m: string, op: string) => `${m} ${op} 조건 알려줘`,
  (m: string, op: string) => `${m} 가공할 때 ${op} 어떻게 해?`,
  (m: string) => `${m} 전용 공구 추천`,
  (m: string) => `${m} 가공에 좋은 엔드밀 뭐야`,
  // Subtype + spec patterns
  (_: string, __: string, s: string) => `${s} 엔드밀 추천해줘`,
  (_: string, __: string, s: string) => `${s} 타입으로 바꿔줘`,
  (_: string, __: string, s: string, d: number) => `${s} ${d}mm 있어?`,
  // Coating patterns
  (_: string, __: string, ___: string, ____: number, c: string) => `${c} 코팅 제품 보여줘`,
  (_: string, __: string, ___: string, ____: number, c: string) => `${c} 말고 다른 코팅`,
  // Dimension patterns
  (_: string, __: string, ___: string, d: number) => `직경 ${d}mm 제품 찾아줘`,
  (_: string, __: string, ___: string, d: number, __2: string, f: number) => `${d}mm ${f}날 엔드밀`,
  // Complex patterns
  (m: string, op: string, s: string, d: number, c: string, f: number) => `${m} ${op}용 ${d}mm ${f}날 ${s} ${c} 엔드밀`,
  (m: string, _: string, s: string) => `${m} 가공에 ${s} 형상이 좋을까?`,
  // Intent patterns
  () => "재고 있는 것만",
  () => "납기 빠른 거",
  () => "가격 비교해줘",
  () => "시리즈 차이점이 뭐야",
  () => "이 공구 수명 얼마나 돼?",
  () => "채터 발생하는데 어떡해",
  () => "표면 조도가 안 나와",
]

interface GeneratedScenario {
  userMessage: string
  decisionSource: "kg" | "llm"
  actionType: string
  actionDetail: string
  kgSource?: string
  kgReason?: string
  kgConfidence?: number
}

function generateScenario(index: number): GeneratedScenario {
  const mat = MATERIALS[index % MATERIALS.length]
  const sub = SUBTYPES[(index * 3) % SUBTYPES.length]
  const coat = COATINGS[(index * 7) % COATINGS.length]
  const diam = DIAMETERS[(index * 11) % DIAMETERS.length]
  const flute = FLUTES[(index * 5) % FLUTES.length]
  const op = OPERATIONS[(index * 13) % OPERATIONS.length]

  const templateIdx = index % LLM_TEMPLATES.length
  const template = LLM_TEMPLATES[templateIdx]
  const userMessage = template(mat, op, sub, diam, coat, flute)

  // Simulate real-world distribution: ~40% KG hit, ~60% LLM fallback
  // This ensures continuous learning even when KG grows
  const forceKG = index % 5 < 2 // 40% forced KG

  if (forceKG) {
    // Simple KG-resolvable pattern
    const entities = extractEntities(userMessage)
    if (entities.length > 0) {
      const primary = entities[0]
      return {
        userMessage,
        decisionSource: "kg" as const,
        actionType: "continue_narrowing",
        actionDetail: `${primary.field}=${primary.canonical}`,
        kgSource: "kg-entity",
        kgReason: `entity ${primary.canonical}`,
        kgConfidence: 0.90,
      }
    }
  }

  // LLM fallback — NEW pattern to learn
  // Determine what the "correct" action would be
  let actionDetail = `toolSubtype=${sub}`
  let actionType = "continue_narrowing"

  if (templateIdx <= 3) actionDetail = `workPieceName=${mat}`
  else if (templateIdx >= 7 && templateIdx <= 8) actionDetail = `coating=${coat}`
  else if (templateIdx >= 9 && templateIdx <= 10) actionDetail = `diameterMm=${diam}`
  else if (templateIdx >= 13) actionType = "answer_general"

  return {
    userMessage,
    decisionSource: "llm",
    actionType,
    actionDetail: actionType === "answer_general" ? "answer_general" : actionDetail,
  }
}

function runTrainingBatch(count: number): { kgHits: number; llmFallbacks: number; patternsLearned: number } {
  let kgHits = 0
  let llmFallbacks = 0
  const patternsLearnedBefore = getPatterns().length

  const now = new Date()
  // Use a random offset so each training run generates different scenarios
  const randomOffset = Math.floor(Math.random() * 1000)

  for (let i = 0; i < count; i++) {
    const scenario = generateScenario(randomOffset + i)
    const timestamp = new Date(now.getTime() - (count - i) * 60000).toISOString()

    const log: InteractionLog = {
      id: `il-${Date.now()}-${i}`,
      timestamp,
      sessionId: `ses-${now.getTime()}-${Math.floor(i / 5)}`,
      turnNumber: i % 5,
      userMessage: scenario.userMessage,
      pendingField: null,
      appliedFilters: [],
      candidateCount: Math.floor(Math.random() * 400) + 10,
      decisionSource: scenario.decisionSource,
      kgSource: scenario.kgSource,
      kgReason: scenario.kgReason,
      kgConfidence: scenario.kgConfidence,
      actionType: scenario.actionType,
      actionDetail: scenario.actionDetail,
      outcome: Math.random() > 0.15 ? "continued" : "back",
    }

    logInteraction(log)

    if (scenario.decisionSource === "kg") {
      kgHits++
    } else {
      llmFallbacks++
      if (scenario.actionType !== "answer_general") {
        tryLearnFromLLMFallback(
          scenario.userMessage,
          scenario.actionType,
          scenario.actionDetail,
          0.70 + Math.random() * 0.25
        )
      }
    }
  }

  // Auto-mine after training
  runPatternMining()
  flushLearningData()

  return {
    kgHits,
    llmFallbacks,
    patternsLearned: getPatterns().length - patternsLearnedBefore,
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()

    if (body.action === "mine") {
      const result = runPatternMining()
      flushLearningData()
      return NextResponse.json({ ok: true, ...result })
    }

    if (body.action === "verify" && body.patternId) {
      verifyPattern(body.patternId, body.verified ?? true)
      return NextResponse.json({ ok: true })
    }

    if (body.action === "flush") {
      flushLearningData()
      return NextResponse.json({ ok: true })
    }

    if (body.action === "train") {
      const count = Math.min(body.count ?? 20, 500)
      const result = runTrainingBatch(count)
      return NextResponse.json({ ok: true, trained: count, ...result })
    }

    if (body.action === "reset") {
      // Clear all learning data for fresh start
      const fs = await import("fs")
      const path = await import("path")
      const dir = path.join(process.cwd(), "data", "learning")
      try {
        for (const file of fs.readdirSync(dir)) {
          fs.unlinkSync(path.join(dir, file))
        }
      } catch { /* dir might not exist */ }
      return NextResponse.json({ ok: true, message: "Learning data cleared. Restart server to take effect." })
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: "Failed to process" }, { status: 500 })
  }
}
