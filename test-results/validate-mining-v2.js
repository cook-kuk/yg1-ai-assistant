const { logPatternMiningEntry, readAllLogs } = require("../lib/recommendation/core/pattern-mining/logger")
const { runMining } = require("../lib/recommendation/core/pattern-mining/candidate-miner")
const { readQueue } = require("../lib/recommendation/core/pattern-mining/review-queue")
const fs = require("fs")
const path = require("path")

// Clean previous logs and queue
const logFile = path.join(process.cwd(), "data", "pattern-mining-logs.jsonl")
const queueFile = path.join(process.cwd(), "data", "pattern-review-queue.json")
if (fs.existsSync(logFile)) fs.unlinkSync(logFile)
fs.writeFileSync(queueFile, JSON.stringify({ pending: [], approved: [], rejected: [], lastUpdated: new Date().toISOString() }, null, 2))

const samples = [
  // Production hits (KG handled)
  { text: "스퀘어 엔드밀 10mm", prod: { source:"kg", constraints:[{field:"toolSubtype",op:"includes",value:"Square"},{field:"diameterMm",op:"eq",value:10}], handled:true }, planner: { constraints:[{field:"toolSubtype",op:"eq",value:"Square"},{field:"diameterMm",op:"eq",value:10}], navigation:"none", intent:"filter", confidence:0.85 }, decision: { winner:"production", plannerScore:0.85, productionScore:0.92, margin:0.07, reason:"kg", applied:false } },
  { text: "구리 2날 Ball", prod: { source:"kg", constraints:[{field:"workPieceName",op:"eq",value:"Copper"},{field:"fluteCount",op:"eq",value:2},{field:"toolSubtype",op:"includes",value:"Ball"}], handled:true }, planner: { constraints:[{field:"workPieceName",op:"eq",value:"Copper"},{field:"fluteCount",op:"eq",value:2},{field:"toolSubtype",op:"eq",value:"Ball"}], navigation:"none", intent:"filter", confidence:0.88 }, decision: { winner:"production", plannerScore:0.88, productionScore:0.91, margin:0.03, reason:"kg", applied:false } },
  { text: "TiAlN 빼고", prod: { source:"kg", constraints:[{field:"coating",op:"neq",value:"TiAlN"}], handled:true }, planner: { constraints:[{field:"coating",op:"neq",value:"TiAlN"}], navigation:"none", intent:"filter", confidence:0.90 }, decision: { winner:"production", plannerScore:0.90, productionScore:0.95, margin:0.05, reason:"kg", applied:false } },
  { text: "CRX-S 추천해줘", prod: { source:"kg", constraints:[{field:"brand",op:"eq",value:"CRX S"}], handled:true }, planner: { constraints:[{field:"brand",op:"eq",value:"CRX-S"}], navigation:"none", intent:"show_recommendation", confidence:0.82 }, decision: { winner:"production", plannerScore:0.82, productionScore:0.90, margin:0.08, reason:"kg", applied:false } },
  { text: "인코넬용 Ball 6mm 쿨런트홀", prod: { source:"kg", constraints:[{field:"toolSubtype",op:"includes",value:"Ball"},{field:"workPieceName",op:"eq",value:"Inconel"},{field:"diameterMm",op:"eq",value:6}], handled:true }, planner: { constraints:[{field:"toolSubtype",op:"eq",value:"Ball"},{field:"workPieceName",op:"eq",value:"Inconel"},{field:"diameterMm",op:"eq",value:6}], navigation:"none", intent:"filter", confidence:0.89 }, decision: { winner:"production", plannerScore:0.89, productionScore:0.92, margin:0.03, reason:"kg", applied:false } },
  { text: "TANK-POWER 빼고", prod: { source:"kg", constraints:[{field:"brand",op:"neq",value:"TANK-POWER"}], handled:true }, planner: { constraints:[{field:"brand",op:"neq",value:"TANK-POWER"}], navigation:"none", intent:"filter", confidence:0.88 }, decision: { winner:"production", plannerScore:0.88, productionScore:0.95, margin:0.07, reason:"kg", applied:false } },

  // Planner-only: shankType variants (3+ for support threshold)
  { text: "싱크타입 웰던", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"shankType",op:"eq",value:"Weldon"}], navigation:"none", intent:"filter", confidence:0.85 }, decision: { winner:"planner", plannerScore:0.85, productionScore:0.0, margin:0.85, reason:"miss", applied:true } },
  { text: "shank type weldon", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"shankType",op:"eq",value:"Weldon"}], navigation:"none", intent:"filter", confidence:0.86 }, decision: { winner:"planner", plannerScore:0.86, productionScore:0.0, margin:0.86, reason:"miss", applied:true } },
  { text: "생크 타입 웰던", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"shankType",op:"eq",value:"Weldon"}], navigation:"none", intent:"filter", confidence:0.87 }, decision: { winner:"planner", plannerScore:0.87, productionScore:0.0, margin:0.87, reason:"miss", applied:true } },
  { text: "웰던 생크", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"shankType",op:"eq",value:"Weldon"}], navigation:"none", intent:"filter", confidence:0.84 }, decision: { winner:"planner", plannerScore:0.84, productionScore:0.0, margin:0.84, reason:"miss", applied:true } },

  // Planner-only: gte (range — should be do-not-promote, now grouped)
  { text: "직경 10 이상", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"diameterMm",op:"gte",value:10}], navigation:"none", intent:"filter", confidence:0.88 }, decision: { winner:"planner", plannerScore:0.88, productionScore:0.0, margin:0.88, reason:"miss", applied:true } },
  { text: "직경 12 이상으로", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"diameterMm",op:"gte",value:12}], navigation:"none", intent:"filter", confidence:0.87 }, decision: { winner:"planner", plannerScore:0.87, productionScore:0.0, margin:0.87, reason:"miss", applied:true } },
  { text: "지름 8mm 이상", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"diameterMm",op:"gte",value:8}], navigation:"none", intent:"filter", confidence:0.89 }, decision: { winner:"planner", plannerScore:0.89, productionScore:0.0, margin:0.89, reason:"miss", applied:true } },
  { text: "20mm 이상 짜리", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"diameterMm",op:"gte",value:20}], navigation:"none", intent:"filter", confidence:0.86 }, decision: { winner:"planner", plannerScore:0.86, productionScore:0.0, margin:0.86, reason:"miss", applied:true } },

  // Planner-only: fluteCount gte
  { text: "4날 이상", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"fluteCount",op:"gte",value:4}], navigation:"none", intent:"filter", confidence:0.90 }, decision: { winner:"planner", plannerScore:0.90, productionScore:0.0, margin:0.90, reason:"miss", applied:true } },
  { text: "날수 6개 이상", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"fluteCount",op:"gte",value:6}], navigation:"none", intent:"filter", confidence:0.88 }, decision: { winner:"planner", plannerScore:0.88, productionScore:0.0, margin:0.88, reason:"miss", applied:true } },
  { text: "3날 이상으로", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"fluteCount",op:"gte",value:3}], navigation:"none", intent:"filter", confidence:0.87 }, decision: { winner:"planner", plannerScore:0.87, productionScore:0.0, margin:0.87, reason:"miss", applied:true } },

  // Planner-only: brand alias variants (CRX-S / CRX S / CRXS)
  { text: "CRXS 시리즈", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"brand",op:"eq",value:"CRX-S"}], navigation:"none", intent:"filter", confidence:0.83 }, decision: { winner:"planner", plannerScore:0.83, productionScore:0.0, margin:0.83, reason:"miss", applied:true } },
  { text: "CRX S 제품", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"brand",op:"eq",value:"CRX-S"}], navigation:"none", intent:"filter", confidence:0.84 }, decision: { winner:"planner", plannerScore:0.84, productionScore:0.0, margin:0.84, reason:"miss", applied:true } },
  { text: "crx-s 보여줘", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"brand",op:"eq",value:"CRX-S"}], navigation:"none", intent:"filter", confidence:0.85 }, decision: { winner:"planner", plannerScore:0.85, productionScore:0.0, margin:0.85, reason:"miss", applied:true } },

  // Navigation / question (no constraints)
  { text: "황삭 정삭 차이", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[], navigation:"none", intent:"question", confidence:0.90 }, decision: { winner:"none", plannerScore:0.90, productionScore:0.0, margin:0.90, reason:"question", applied:false } },
  { text: "처음부터 다시", prod: { source:"kg", constraints:[], handled:true }, planner: { constraints:[], navigation:"reset", intent:"navigation", confidence:0.95 }, decision: { winner:"production", plannerScore:0.95, productionScore:0.95, margin:0.0, reason:"both reset", applied:false } },
  { text: "알아서", prod: { source:"kg", constraints:[], handled:true }, planner: { constraints:[], navigation:"skip", intent:"navigation", confidence:0.90 }, decision: { winner:"production", plannerScore:0.90, productionScore:0.90, margin:0.0, reason:"both skip", applied:false } },

  // Between (should also be do-not-promote)
  { text: "직경 8에서 12 사이", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"diameterMm",op:"between",value:"8~12"}], navigation:"none", intent:"filter", confidence:0.85 }, decision: { winner:"planner", plannerScore:0.85, productionScore:0.0, margin:0.85, reason:"miss", applied:true } },
  { text: "10에서 20mm 사이 직경", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"diameterMm",op:"between",value:"10~20"}], navigation:"none", intent:"filter", confidence:0.84 }, decision: { winner:"planner", plannerScore:0.84, productionScore:0.0, margin:0.84, reason:"miss", applied:true } },
  { text: "diameter between 6 and 10", prod: { source:"none", constraints:[], handled:false }, planner: { constraints:[{field:"diameterMm",op:"between",value:"6~10"}], navigation:"none", intent:"filter", confidence:0.83 }, decision: { winner:"planner", plannerScore:0.83, productionScore:0.0, margin:0.83, reason:"miss", applied:true } },
]

async function run() {
  console.log("=== Writing", samples.length, "logs ===\n")
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

  const logs = await readAllLogs()
  console.log("Total logs:", logs.length)

  // Show groupKey distribution
  const groupCounts = {}
  for (const l of logs) { groupCounts[l.groupKey] = (groupCounts[l.groupKey] || 0) + 1 }
  console.log("\n=== GroupKey Distribution ===")
  for (const [k, v] of Object.entries(groupCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v}x ${k}`)
  }

  console.log("\n=== Running Miner ===\n")
  const result = await runMining()

  console.log("--- regex-pattern ---")
  for (const p of result.patterns.filter(p => p.candidateType === "regex-pattern")) {
    console.log(`  ${p.targetField}=${p.targetValueExamples[0]} support=${p.supportCount} conf=${p.confidence.toFixed(2)} risk=${p.risk}`)
    console.log(`    examples: ${p.exampleInputs.slice(0,3).join(" | ")}`)
  }

  console.log("\n--- do-not-promote ---")
  for (const p of result.patterns.filter(p => p.candidateType === "do-not-promote")) {
    console.log(`  ${p.targetField} op=${p.targetValueExamples[0]} support=${p.supportCount} conf=${p.confidence.toFixed(2)}`)
    console.log(`    examples: ${p.exampleInputs.slice(0,3).join(" | ")}`)
  }

  console.log("\n--- alias ---")
  for (const a of result.aliases) {
    console.log(`  ${a.canonical} -> [${a.aliases.join(", ")}] (${a.targetField}) support=${a.supportCount}`)
  }

  console.log("\n--- Queue Results ---")
  for (const r of result.queueResults) {
    console.log(`  ${r.id}: ${r.added ? "ADDED" : r.reason}`)
  }

  const queue = await readQueue()
  console.log(`\nQueue: ${queue.pending.length} pending, ${queue.approved.length} approved, ${queue.rejected.length} rejected`)
}

run().catch(e => { console.error(e); process.exit(1) })
