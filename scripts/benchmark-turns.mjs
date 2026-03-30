#!/usr/bin/env node
/**
 * YG-1 Recommendation Multi-Turn Benchmark
 *
 * Simulates a 30-turn user conversation against /api/recommend
 * and records latency, state, quality, and LLM token/cost metrics.
 *
 * Requirements:
 *   Server must have BENCHMARK_TRACE=true in its environment for token tracking.
 *
 * Usage:
 *   node scripts/benchmark-turns.mjs                          # localhost:3000
 *   BASE_URL=https://example.com node scripts/benchmark-turns.mjs
 *   TURNS=10 node scripts/benchmark-turns.mjs                 # fewer turns
 */

import { writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, "..", "benchmark-results")
mkdirSync(OUT_DIR, { recursive: true })

// ── Config ───────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const TOTAL_TURNS = parseInt(process.env.TURNS || "30", 10)
const CHECKPOINTS = [5, 10, 15, 20, 30].filter(n => n <= TOTAL_TURNS)
const API_PATH = "/api/recommend"
const LANGUAGE = "ko"

// ── Pricing (USD per 1M tokens) ──────────────────────────────
// Update as pricing changes. Model ID substring match (case-insensitive).
const MODEL_PRICING = [
  { match: "opus",   input: 15.00, output: 75.00, cacheRead: 1.50,  cacheWrite: 18.75 },
  { match: "sonnet", input:  3.00, output: 15.00, cacheRead: 0.30,  cacheWrite:  3.75 },
  { match: "haiku",  input:  0.80, output:  4.00, cacheRead: 0.08,  cacheWrite:  1.00 },
]

function getPricing(model) {
  if (!model) return MODEL_PRICING[1] // default sonnet
  const lower = model.toLowerCase()
  return MODEL_PRICING.find(p => lower.includes(p.match)) || MODEL_PRICING[1]
}

function calcCallCost(call) {
  const p = getPricing(call.model)
  return (
    (call.inputTokens * p.input / 1_000_000) +
    (call.outputTokens * p.output / 1_000_000) +
    (call.cacheReadTokens * p.cacheRead / 1_000_000) +
    (call.cacheWriteTokens * p.cacheWrite / 1_000_000)
  )
}

function calcTurnCost(llmCalls) {
  if (!llmCalls || llmCalls.length === 0) return 0
  return llmCalls.reduce((sum, c) => sum + calcCallCost(c), 0)
}

// ── Intake form (initial condition set) ──────────────────────
const INTAKE_FORM = {
  inquiryPurpose: { status: "known", value: "new" },
  material: { status: "known", value: "P" },
  operationType: { status: "known", value: "Side_Milling" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  diameterInfo: { status: "known", value: "10mm" },
}

// ── Turn scenario: 30 user messages simulating a real session ─
const TURN_MESSAGES = [
  "10mm 엔드밀 추천해주세요",
  "4날이면 좋겠어요",
  "코팅은 뭐가 좋을까요?",
  "AlCrN 코팅 제품으로 보여주세요",
  "재고 있는 것만 보여줘",
  "1번이랑 3번 비교해주세요",
  "절삭조건도 알려주세요",
  "이 중에 수명이 긴 건 뭐야?",
  "가격대가 어떻게 돼?",
  "다른 브랜드도 있어?",
  "직경을 8mm로 바꿔볼게",
  "3날은 없어?",
  "슬로팅용은 뭐가 좋아?",
  "긴 날장 제품 있어?",
  "LOC 25mm 이상으로",
  "1번 제품 상세 스펙 알려줘",
  "이 시리즈 다른 사이즈도 보여줘",
  "SUS304에도 쓸 수 있어?",
  "황삭용으로는 어떤 게 좋아?",
  "이송속도 기준 추천해줘",
  "초경 소재만 보여줘",
  "전체 후보 몇 개야?",
  "점수 높은 순으로 정렬해줘",
  "2번 제품 EDP 번호 알려줘",
  "비슷한 제품 더 있어?",
  "처음 추천해준 제품 다시 보여줘",
  "12mm는 없어?",
  "결론적으로 뭘 추천해?",
  "고마워, 정리해줘",
  "끝",
]

// ── Helpers ───────────────────────────────────────────────────
function byteLength(str) {
  return new TextEncoder().encode(str).length
}

function safeGet(obj, path, fallback = null) {
  if (!obj) return fallback
  const keys = path.split(".")
  let cur = obj
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return fallback
    cur = cur[k]
  }
  return cur ?? fallback
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
}

function fmt$(n) { return `$${n.toFixed(4)}` }

// ── Main benchmark loop ──────────────────────────────────────
async function run() {
  console.log(`\n=== YG-1 Recommendation Benchmark ===`)
  console.log(`Target : ${BASE_URL}${API_PATH}`)
  console.log(`Turns  : ${TOTAL_TURNS}`)
  console.log(`Checks : ${CHECKPOINTS.join(", ")}`)
  console.log(`Note   : Server needs BENCHMARK_TRACE=true for token tracking\n`)

  // Verify endpoint is reachable
  try {
    const ping = await fetch(`${BASE_URL}${API_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", text: "ping" }], language: LANGUAGE }),
    })
    if (!ping.ok && ping.status >= 500) {
      console.error(`[FATAL] Endpoint returned ${ping.status}. Aborting.`)
      process.exit(1)
    }
  } catch (err) {
    console.error(`[FATAL] Cannot reach ${BASE_URL}${API_PATH}: ${err.message}`)
    process.exit(1)
  }

  const results = []
  let session = null
  const messages = []
  let cumulativeCost = 0

  for (let turn = 1; turn <= TOTAL_TURNS; turn++) {
    const userText = TURN_MESSAGES[(turn - 1) % TURN_MESSAGES.length]
    messages.push({ role: "user", text: userText })

    const reqBody = {
      engine: "serve",
      language: LANGUAGE,
      messages: [...messages],
      session,
      ...(turn === 1 ? { intakeForm: INTAKE_FORM } : {}),
    }
    const reqJson = JSON.stringify(reqBody)
    const reqBytes = byteLength(reqJson)

    const t0 = performance.now()
    let httpStatus = 0
    let resJson = ""
    let resObj = null
    let error = null

    try {
      const res = await fetch(`${BASE_URL}${API_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: reqJson,
      })
      httpStatus = res.status
      resJson = await res.text()
      try {
        resObj = JSON.parse(resJson)
      } catch {
        error = `JSON parse error: ${resJson.slice(0, 200)}`
      }
    } catch (err) {
      error = err.message
    }

    const latencyMs = Math.round(performance.now() - t0)
    const resBytes = byteLength(resJson)

    // Extract metrics from response
    const pub = safeGet(resObj, "session.publicState")
    const aiText = safeGet(resObj, "text", "")

    // Append AI response to conversation
    if (aiText) {
      messages.push({ role: "ai", text: aiText })
    }

    // Carry session forward
    if (resObj?.session) {
      session = resObj.session
    }

    // ── LLM token/cost metrics ──────────────────────────────
    const benchUsage = safeGet(resObj, "meta.benchmarkLlmUsage")
    const llmCalls = benchUsage?.llmCalls ?? []
    const llmCallCount = benchUsage?.llmCallCount ?? 0
    const turnInputTokens = benchUsage?.totalInputTokens ?? 0
    const turnOutputTokens = benchUsage?.totalOutputTokens ?? 0
    const turnCacheReadTokens = benchUsage?.totalCacheReadTokens ?? 0
    const turnCacheWriteTokens = benchUsage?.totalCacheWriteTokens ?? 0
    const turnEstimatedCost = calcTurnCost(llmCalls)
    cumulativeCost += turnEstimatedCost

    const turnResult = {
      turn,
      userMessage: userText,
      latencyMs,
      httpStatus,
      purpose: safeGet(resObj, "purpose"),
      candidateCount: safeGet(pub, "candidateCount", 0),
      filterCount: Array.isArray(safeGet(pub, "appliedFilters")) ? pub.appliedFilters.length : 0,
      turnCount: safeGet(pub, "turnCount", turn),
      sessionId: safeGet(pub, "sessionId"),
      currentMode: safeGet(pub, "currentMode"),
      lastAskedField: safeGet(pub, "lastAskedField"),
      resolutionStatus: safeGet(pub, "resolutionStatus"),
      displayedChipCount: Array.isArray(safeGet(pub, "displayedChips")) ? pub.displayedChips.length : 0,
      displayedOptionCount: Array.isArray(safeGet(pub, "displayedOptions")) ? pub.displayedOptions.length : 0,
      displayedCandidateCount: Array.isArray(safeGet(resObj, "candidates")) ? resObj.candidates.length : 0,
      hasRecommendation: resObj?.recommendation != null,
      hasComparison: safeGet(resObj, "purpose") === "comparison",
      routeAction: safeGet(pub, "lastAction"),
      debugTrace: safeGet(resObj, "meta.debugTrace") != null,
      // Token & cost metrics
      llmCallCount,
      turnInputTokens,
      turnOutputTokens,
      turnCacheReadTokens,
      turnCacheWriteTokens,
      turnEstimatedCost: Math.round(turnEstimatedCost * 10000) / 10000,
      cumulativeEstimatedCost: Math.round(cumulativeCost * 10000) / 10000,
      llmCallDetails: llmCalls.length > 0 ? llmCalls : undefined,
      // Size
      requestBytes: reqBytes,
      responseBytes: resBytes,
      error,
    }

    results.push(turnResult)

    // Console progress
    const statusIcon = httpStatus === 200 ? "✓" : "✗"
    const purposeTag = (turnResult.purpose || "?").padEnd(15)
    const tokenInfo = llmCallCount > 0
      ? `| LLM×${llmCallCount} in=${turnInputTokens} out=${turnOutputTokens} ${fmt$(turnEstimatedCost)}`
      : "| (no token data)"
    console.log(
      `  ${statusIcon} Turn ${String(turn).padStart(2)} | ${latencyMs.toString().padStart(5)}ms | ${purposeTag} | cand=${turnResult.displayedCandidateCount} ${tokenInfo}`
    )

    // Short pause between turns
    if (turn < TOTAL_TURNS) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  // ── Build summary ────────────────────────────────────────────
  const totalInputTokens = results.reduce((s, r) => s + r.turnInputTokens, 0)
  const totalOutputTokens = results.reduce((s, r) => s + r.turnOutputTokens, 0)
  const totalCacheReadTokens = results.reduce((s, r) => s + r.turnCacheReadTokens, 0)
  const totalCacheWriteTokens = results.reduce((s, r) => s + r.turnCacheWriteTokens, 0)
  const totalLlmCalls = results.reduce((s, r) => s + r.llmCallCount, 0)

  const summary = {
    meta: {
      baseUrl: BASE_URL,
      totalTurns: TOTAL_TURNS,
      startedAt: new Date().toISOString(),
      intakeForm: INTAKE_FORM,
      pricing: MODEL_PRICING,
    },
    aggregate: {
      avgLatencyMs: Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length),
      maxLatencyMs: Math.max(...results.map(r => r.latencyMs)),
      minLatencyMs: Math.min(...results.map(r => r.latencyMs)),
      p95LatencyMs: (() => {
        const sorted = [...results.map(r => r.latencyMs)].sort((a, b) => a - b)
        return sorted[Math.floor(sorted.length * 0.95)] || 0
      })(),
      errorCount: results.filter(r => r.httpStatus !== 200).length,
      purposeDistribution: results.reduce((acc, r) => {
        acc[r.purpose || "unknown"] = (acc[r.purpose || "unknown"] || 0) + 1
        return acc
      }, {}),
      totalRequestBytes: results.reduce((s, r) => s + r.requestBytes, 0),
      totalResponseBytes: results.reduce((s, r) => s + r.responseBytes, 0),
      // Token & cost totals
      totalLlmCalls,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheWriteTokens,
      totalEstimatedCost: Math.round(cumulativeCost * 10000) / 10000,
      avgCostPerTurn: Math.round((cumulativeCost / TOTAL_TURNS) * 10000) / 10000,
      avgLlmCallsPerTurn: Math.round((totalLlmCalls / TOTAL_TURNS) * 100) / 100,
    },
    checkpoints: CHECKPOINTS.map(cp => {
      const r = results[cp - 1]
      if (!r) return { turn: cp, status: "not_reached" }
      const slice = results.slice(0, cp)
      return {
        turn: cp,
        latencyMs: r.latencyMs,
        purpose: r.purpose,
        candidateCount: r.candidateCount,
        filterCount: r.filterCount,
        resolutionStatus: r.resolutionStatus,
        displayedCandidateCount: r.displayedCandidateCount,
        sessionId: r.sessionId,
        currentMode: r.currentMode,
        cumulativeAvgLatencyMs: Math.round(slice.reduce((s, x) => s + x.latencyMs, 0) / cp),
        // Per-turn token/cost
        turnLlmCalls: r.llmCallCount,
        turnInputTokens: r.turnInputTokens,
        turnOutputTokens: r.turnOutputTokens,
        turnCacheReadTokens: r.turnCacheReadTokens,
        turnCacheWriteTokens: r.turnCacheWriteTokens,
        turnEstimatedCost: r.turnEstimatedCost,
        // Cumulative token/cost up to this checkpoint
        cumulativeInputTokens: slice.reduce((s, x) => s + x.turnInputTokens, 0),
        cumulativeOutputTokens: slice.reduce((s, x) => s + x.turnOutputTokens, 0),
        cumulativeLlmCalls: slice.reduce((s, x) => s + x.llmCallCount, 0),
        cumulativeEstimatedCost: r.cumulativeEstimatedCost,
      }
    }),
  }

  // ── Write output files ───────────────────────────────────────
  const ts = timestamp()

  const jsonPath = join(OUT_DIR, `benchmark-${ts}.json`)
  writeFileSync(jsonPath, JSON.stringify(results, null, 2))
  console.log(`\n  → ${jsonPath}`)

  const summaryPath = join(OUT_DIR, `benchmark-${ts}-summary.json`)
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2))
  console.log(`  → ${summaryPath}`)

  // CSV (flatten, exclude llmCallDetails)
  const csvKeys = Object.keys(results[0] || {}).filter(k => k !== "llmCallDetails")
  const csvRows = results.map(r =>
    csvKeys.map(h => {
      const v = r[h]
      if (v == null) return ""
      const s = String(v)
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s
    }).join(",")
  )
  const csvPath = join(OUT_DIR, `benchmark-${ts}.csv`)
  writeFileSync(csvPath, [csvKeys.join(","), ...csvRows].join("\n"))
  console.log(`  → ${csvPath}`)

  // ── Print summary ────────────────────────────────────────────
  console.log(`\n=== Summary ===`)
  console.log(`  Avg latency     : ${summary.aggregate.avgLatencyMs}ms`)
  console.log(`  P95 latency     : ${summary.aggregate.p95LatencyMs}ms`)
  console.log(`  Max latency     : ${summary.aggregate.maxLatencyMs}ms`)
  console.log(`  Errors          : ${summary.aggregate.errorCount} / ${TOTAL_TURNS}`)
  console.log(`  Purposes        : ${JSON.stringify(summary.aggregate.purposeDistribution)}`)
  console.log(`  ── Token & Cost ──`)
  console.log(`  Total LLM calls : ${totalLlmCalls} (avg ${summary.aggregate.avgLlmCallsPerTurn}/turn)`)
  console.log(`  Input tokens    : ${totalInputTokens.toLocaleString()}`)
  console.log(`  Output tokens   : ${totalOutputTokens.toLocaleString()}`)
  console.log(`  Cache read      : ${totalCacheReadTokens.toLocaleString()}`)
  console.log(`  Cache write     : ${totalCacheWriteTokens.toLocaleString()}`)
  console.log(`  Total cost      : ${fmt$(cumulativeCost)}`)
  console.log(`  Avg cost/turn   : ${fmt$(cumulativeCost / TOTAL_TURNS)}`)

  console.log(`\n  Checkpoints:`)
  for (const cp of summary.checkpoints) {
    if (cp.status === "not_reached") {
      console.log(`    Turn ${cp.turn}: not reached`)
    } else {
      console.log(
        `    Turn ${String(cp.turn).padStart(2)}: ${cp.latencyMs}ms | ${cp.purpose} | cand=${cp.displayedCandidateCount} | LLM×${cp.turnLlmCalls} in=${cp.turnInputTokens} out=${cp.turnOutputTokens} | turn=${fmt$(cp.turnEstimatedCost)} cumul=${fmt$(cp.cumulativeEstimatedCost)}`
      )
    }
  }
  console.log()
}

run().catch(err => {
  console.error("[FATAL]", err)
  process.exit(1)
})
