/**
 * pattern-mining 로그 품질 검증 + candidate-miner 실행 테스트
 */
const { logPatternMiningEntry, readAllLogs } = require("../lib/recommendation/core/pattern-mining/logger")
const { runMining } = require("../lib/recommendation/core/pattern-mining/candidate-miner")
const { readQueue, addCandidate } = require("../lib/recommendation/core/pattern-mining/review-queue")

const samples = [
  { text: "스퀘어 엔드밀 10mm", prod: { source:"kg", constraints:[{field:"toolSubtype",op:"includes",value:"Square"},{field:"diameterMm",op:"eq",value:10}], handled:true }, planner: { constraints:[{field:"toolSubtype",op:"eq",value:"Square"},{field:"diameterMm",op:"eq",value:10}], navigation:"none", intent:"filter", confidence:0.85 }, decision: { winner:"production", plannerScore:0.85, productionScore:0.92, margin:0.07, reason:"kg handled", applied:false } },
  { text: "구리 2날 Ball", prod: { source:"kg", constraints:[{field:"workPieceName",op:"eq",value:"Copper"},{field:"fluteCount",op:"eq",value:2},{field:"toolSubtype",op:"includes",value:"Ball"}], handled:true }, planner: { constraints:[{field:"workPieceName",op:"eq",value:"Copper"},{field:"fluteCount",op:"eq",value:2},{field:"toolSubtype",op:"eq",value:"Ball"}], navigation:"none", intent:"filter", confidence:0.88 }, decision: { winner:"production", plannerScore:0.88, productionScore:0.91, margin:0.03, reason:"kg multi", applied:false } },
  { text: "TiAlN 빼고", prod: { source:"kg", constraints:[{field:"coating",op:"neq",value:"TiAlN"}], handled:true }, planner: { constraints:[{field:"coating",op:"neq",value:"TiAlN"}], navigation:"none", intent:"filter", confidence:0.90 }, decision: { winner:"production", plannerScore:0.90, productionScore:0.95, margin:0.05, reason:"kg exclude", applied:false } },
  { text: "생크 타입 플레인", prod: { source:"kg", constraints:[{field:"shankType",op:"eq",value:"Plain"}], handled:true }, planner: { constraints:[{field:"shankType",op:"eq",value:"Plain"}], navigation:"none", intent:"filter", confidence:0.87 }, decision: { winner:"production", plannerScore:0.87, productionScore:0.90, margin:0.03, reason:"kg entity", applied:false } },
  { text: "CRX-S 추천해줘", prod: { source:"kg", constraints:[{field:"brand",op:"eq",value:"CRX S"}], handled:true }, planner: { constraints:[{field:"brand",op:"eq",value:"CRX-S"}], navigation:"none", intent:"show_recommendation", confidence:0.82 }, decision: { winner:"production", plannerScore:0.82, productionScore:0.90, margin:0.08, reason:"kg brand", applied:false } },
  // planner-only: production miss
  { text: "직경 10 이상", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"diameterMm",op:"gte",value:10}], navigation:"none", intent:"filter", confidence:0.88 }, decision: { winner:"planner", plannerScore:0.88, productionScore:0.0, margin:0.88, reason:"production missed", applied:true } },
  { text: "직경 12 이상으로", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"diameterMm",op:"gte",value:12}], navigation:"none", intent:"filter", confidence:0.87 }, decision: { winner:"planner", plannerScore:0.87, productionScore:0.0, margin:0.87, reason:"production missed", applied:true } },
  { text: "지름 8mm 이상", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"diameterMm",op:"gte",value:8}], navigation:"none", intent:"filter", confidence:0.89 }, decision: { winner:"planner", plannerScore:0.89, productionScore:0.0, margin:0.89, reason:"production missed", applied:true } },
  { text: "4날 이상", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"fluteCount",op:"gte",value:4}], navigation:"none", intent:"filter", confidence:0.90 }, decision: { winner:"planner", plannerScore:0.90, productionScore:0.0, margin:0.90, reason:"production missed", applied:true } },
  // planner-only: shankType variants
  { text: "싱크타입 웰던", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"shankType",op:"eq",value:"Weldon"}], navigation:"none", intent:"filter", confidence:0.85 }, decision: { winner:"planner", plannerScore:0.85, productionScore:0.0, margin:0.85, reason:"production missed", applied:true } },
  { text: "shank type weldon", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"shankType",op:"eq",value:"Weldon"}], navigation:"none", intent:"filter", confidence:0.86 }, decision: { winner:"planner", plannerScore:0.86, productionScore:0.0, margin:0.86, reason:"production missed", applied:true } },
  { text: "생크 타입 웰던", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"shankType",op:"eq",value:"Weldon"}], navigation:"none", intent:"filter", confidence:0.87 }, decision: { winner:"planner", plannerScore:0.87, productionScore:0.0, margin:0.87, reason:"production missed", applied:true } },
  // navigation/question
  { text: "황삭 정삭 차이", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[], navigation:"none", intent:"question", confidence:0.90 }, decision: { winner:"none", plannerScore:0.90, productionScore:0.0, margin:0.90, reason:"question", applied:false } },
  { text: "처음부터 다시", prod: { source:"kg", constraints:[], handled:true }, planner: { constraints:[], navigation:"reset", intent:"navigation", confidence:0.95 }, decision: { winner:"production", plannerScore:0.95, productionScore:0.95, margin:0.0, reason:"both reset", applied:false } },
  { text: "알아서", prod: { source:"kg", constraints:[], handled:true }, planner: { constraints:[], navigation:"skip", intent:"navigation", confidence:0.90 }, decision: { winner:"production", plannerScore:0.90, productionScore:0.90, margin:0.0, reason:"both skip", applied:false } },
  // more production hits
  { text: "인코넬용 Ball 6mm 쿨런트홀", prod: { source:"kg", constraints:[{field:"toolSubtype",op:"includes",value:"Ball"},{field:"workPieceName",op:"eq",value:"Inconel"},{field:"coolantHole",op:"eq",value:true},{field:"diameterMm",op:"eq",value:6}], handled:true }, planner: { constraints:[{field:"toolSubtype",op:"eq",value:"Ball"},{field:"workPieceName",op:"eq",value:"Inconel"},{field:"coolantHole",op:"eq",value:true},{field:"diameterMm",op:"eq",value:6}], navigation:"none", intent:"filter", confidence:0.89 }, decision: { winner:"production", plannerScore:0.89, productionScore:0.92, margin:0.03, reason:"kg multi", applied:false } },
  { text: "copper square 2flute 10mm", prod: { source:"kg", constraints:[{field:"toolSubtype",op:"includes",value:"Square"},{field:"workPieceName",op:"eq",value:"Copper"},{field:"diameterMm",op:"eq",value:10},{field:"fluteCount",op:"eq",value:2}], handled:true }, planner: { constraints:[{field:"toolSubtype",op:"eq",value:"Square"},{field:"workPieceName",op:"eq",value:"Copper"},{field:"diameterMm",op:"eq",value:10},{field:"fluteCount",op:"eq",value:2}], navigation:"none", intent:"filter", confidence:0.90 }, decision: { winner:"production", plannerScore:0.90, productionScore:0.92, margin:0.02, reason:"kg multi", applied:false } },
  { text: "DLC코팅 12mm", prod: { source:"kg", constraints:[{field:"coating",op:"includes",value:"DLC"},{field:"diameterMm",op:"eq",value:12}], handled:true }, planner: { constraints:[{field:"coating",op:"eq",value:"DLC"},{field:"diameterMm",op:"eq",value:12}], navigation:"none", intent:"filter", confidence:0.87 }, decision: { winner:"production", plannerScore:0.87, productionScore:0.90, margin:0.03, reason:"kg entity", applied:false } },
  { text: "TANK-POWER 빼고", prod: { source:"kg", constraints:[{field:"brand",op:"neq",value:"TANK-POWER"}], handled:true }, planner: { constraints:[{field:"brand",op:"neq",value:"TANK-POWER"}], navigation:"none", intent:"filter", confidence:0.88 }, decision: { winner:"production", plannerScore:0.88, productionScore:0.95, margin:0.07, reason:"kg brand neq", applied:false } },
  { text: "주철 4날", prod: { source:"kg", constraints:[{field:"workPieceName",op:"eq",value:"Cast Iron"},{field:"fluteCount",op:"eq",value:4}], handled:true }, planner: { constraints:[{field:"workPieceName",op:"eq",value:"Cast Iron"},{field:"fluteCount",op:"eq",value:4}], navigation:"none", intent:"filter", confidence:0.89 }, decision: { winner:"production", plannerScore:0.89, productionScore:0.92, margin:0.03, reason:"kg multi", applied:false } },
]

async function run() {
  // 1. Write logs
  console.log("=== Step 1: Writing 20 sample logs ===\n")
  for (const s of samples) {
    logPatternMiningEntry({
      userText: s.text,
      production: s.prod,
      planner: s.planner,
      decision: s.decision,
      finalFilters: s.prod.handled ? s.prod.constraints : s.planner.constraints,
    })
  }
  await new Promise(r => setTimeout(r, 1500))

  // 2. Read and inspect
  console.log("=== Step 2: Log Quality Inspection (10 samples) ===\n")
  const logs = await readAllLogs()
  console.log("Total logs:", logs.length, "\n")

  for (let i = 0; i < Math.min(10, logs.length); i++) {
    const l = logs[i]
    const pc = l.planner.constraints.map(c => `${c.field}:${c.op}:${c.value}`).join(", ")
    const prc = l.production.constraints.map(c => `${c.field}:${c.op}:${c.value}`).join(", ")
    console.log(`#${i+1} "${l.userText}"`)
    console.log(`  normalized: "${l.normalizedText}"`)
    console.log(`  prod: ${l.production.source} ${l.production.handled?"OK":"MISS"} | ${prc||"(none)"}`)
    console.log(`  planner: ${pc||"(none)"} | nav:${l.planner.navigation} conf:${l.planner.confidence}`)
    console.log(`  decision: ${l.decision.winner} margin:${l.decision.margin}`)
    console.log(`  groupKey: ${l.groupKey}`)
    console.log()
  }

  // 3. Run miner
  console.log("=== Step 3: Running Candidate Miner ===\n")
  const result = await runMining()
  console.log(`Pattern candidates: ${result.patterns.length}`)
  console.log(`Alias candidates: ${result.aliases.length}`)
  console.log(`Queue updates: ${result.queueResults.length}\n`)

  console.log("--- Pattern Candidates ---")
  for (const p of result.patterns) {
    console.log(`  [${p.candidateType}] ${p.targetField}=${p.targetValueExamples[0]} support=${p.supportCount} conf=${p.confidence.toFixed(2)} risk=${p.risk}`)
    console.log(`    examples: ${p.exampleInputs.slice(0,3).join(" | ")}`)
  }

  console.log("\n--- Alias Candidates ---")
  for (const a of result.aliases) {
    console.log(`  ${a.canonical} -> [${a.aliases.join(", ")}] (${a.targetField}) support=${a.supportCount}`)
  }

  // 4. Dedupe test
  console.log("\n=== Step 4: Dedupe Test ===\n")
  const testCandidate = {
    id: "pat_shankType_test123",
    candidateType: "regex-pattern",
    targetField: "shankType",
    targetValueExamples: ["Weldon"],
    supportCount: 3,
    confidence: 0.86,
    risk: "low",
    exampleInputs: ["생크 타입 웰던"],
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  }
  const r1 = await addCandidate(testCandidate)
  console.log("First add:", r1)
  const r2 = await addCandidate({ ...testCandidate, supportCount: 5 })
  console.log("Second add (same id, higher support):", r2)

  const queue = await readQueue()
  console.log("Queue pending:", queue.pending.length)
  console.log("Queue approved:", queue.approved.length)
  console.log("Queue rejected:", queue.rejected.length)

  // Show final queue state
  console.log("\n--- Pending items ---")
  for (const p of queue.pending) {
    console.log(`  ${p.id} [${p.candidateType}] ${p.targetField} support=${p.supportCount} conf=${p.confidence.toFixed(2)}`)
  }
}

run().catch(e => { console.error("Error:", e); process.exit(1) })
