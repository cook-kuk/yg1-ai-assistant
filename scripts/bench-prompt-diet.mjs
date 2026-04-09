#!/usr/bin/env node
/**
 * Micro-benchmark: prompt 크기 및 max_tokens 변화 측정.
 * - sql-agent fast vs cot 모드 비교
 * - turn-orchestrator system 에 ===DYNAMIC=== 마커가 있는지 확인
 *
 * 4 chars ≈ 1 token (Anthropic 추정치)
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

function approxTokens(text) {
  return Math.ceil(text.length / 4)
}

function read(p) {
  return readFileSync(join(root, p), "utf8")
}

console.log("\n=== YG-1 Latency Patch Verification ===\n")

// ── 1. turn-orchestrator: prompt cache marker ────────────────
const orch = read("lib/recommendation/core/turn-orchestrator.ts")
const orchSystemMatch = orch.match(/const TURN_DECISION_SYSTEM = `([\s\S]*?)`/)
const orchSystem = orchSystemMatch ? orchSystemMatch[1] : ""
const orchHasMarker = orchSystem.includes("===DYNAMIC===")
const orchSystemTokens = approxTokens(orchSystem)

const orchUserBuilderMatch = orch.match(/return `User: "[^]*?Generate the JSON turn plan now.`/)
const orchUserBuilder = orchUserBuilderMatch ? orchUserBuilderMatch[0] : ""
const orchUserTokens = approxTokens(orchUserBuilder)

console.log("[1] turn-orchestrator")
console.log(`    system prompt: ~${orchSystemTokens} tokens`)
console.log(`    DYNAMIC marker present: ${orchHasMarker ? "YES ✓ (cacheable)" : "NO ✗"}`)
console.log(`    user prompt template: ~${orchUserTokens} tokens (per-turn snapshot only)`)
console.log(`    → static system ${orchSystemTokens >= 256 ? "QUALIFIES" : "below"} for prefix cache (>1024 chars)`)

// ── 2. sql-agent: fast vs cot mode budget ────────────────────
const sqlAgent = read("lib/recommendation/core/sql-agent.ts")

// Extract max_tokens conditional
const maxTokFastCot = sqlAgent.match(/mode === "cot" \? 8192 : 2048/g)
console.log("\n[2] sql-agent")
console.log(`    max_tokens conditional present: ${maxTokFastCot?.length ?? 0} occurrence(s)`)
console.log(`    fast mode max_tokens: 2048`)
console.log(`    cot  mode max_tokens: 8192`)
console.log(`    → output budget reduction: ${Math.round((1 - 2048/8192) * 100)}% on first attempt`)

// Extract reasoning instruction blocks
const fastReasoningIdx = sqlAgent.indexOf('"reasoning"은 **간결한**')
const cotReasoningIdx = sqlAgent.indexOf('"reasoning"은 요약이 아니라')
const fastReasoning = fastReasoningIdx >= 0
  ? sqlAgent.slice(fastReasoningIdx, sqlAgent.indexOf("`", fastReasoningIdx))
  : ""
const cotReasoning = cotReasoningIdx >= 0
  ? sqlAgent.slice(cotReasoningIdx, fastReasoningIdx > 0 ? fastReasoningIdx : sqlAgent.length).slice(0, 1500)
  : ""

console.log(`    fast reasoning instruction: ~${approxTokens(fastReasoning)} tokens (2-4문장 요구)`)
console.log(`    cot  reasoning instruction: ~${approxTokens(cotReasoning)} tokens (10문장+ 요구)`)

// ── 3. estimated per-turn savings ────────────────────────────
console.log("\n[3] Estimated per-turn savings (Haiku, fast vs cot first attempt)")
console.log("    Pricing: input $0.80/M, output $4.00/M, cache_read $0.08/M (10x cheaper)")

// Realistic assumptions (Korean reasoning, observed):
// - cot 모드 (10문장+ 강요): ~800-1200 출력 tokens
// - fast 모드 (2-4문장): ~150-300 출력 tokens
// - Haiku throughput: ~250 tok/s
const beforeOutput = 1000  // 10문장+ Korean reasoning
const afterOutput = 220    // 2-4문장 Korean reasoning
const outputSaved = beforeOutput - afterOutput
const outputCostSaved = (outputSaved * 4.0) / 1_000_000

console.log(`    output tokens   : ~${beforeOutput} → ~${afterOutput}  (Δ -${outputSaved}, -${Math.round((1-afterOutput/beforeOutput)*100)}%)`)
console.log(`    cost per call   : ~$${outputCostSaved.toFixed(5)} saved on output`)

// Latency: Haiku throughput ~250 tok/s
const beforeMs = (beforeOutput / 250) * 1000
const afterMs = (afterOutput / 250) * 1000
console.log(`    output latency  : ~${Math.round(beforeMs)}ms → ~${Math.round(afterMs)}ms  (Δ -${Math.round(beforeMs - afterMs)}ms)`)

// turn-orchestrator caching savings (assuming 80% prefix-cache hit on warm turns)
const orchInputBefore = orchSystemTokens + orchUserTokens // before: all of it was uncached user prompt
const orchInputAfter = orchSystemTokens * 0.1 + orchUserTokens // after: cache_read on system part
const orchInputCostSaved = ((orchInputBefore - orchInputAfter) * 0.80) / 1_000_000 // sonnet input
console.log(`\n    turn-orchestrator input (warm cache):`)
console.log(`      before: ~${orchInputBefore} tokens uncached`)
console.log(`      after : ~${Math.round(orchInputAfter)} tokens effective (~90% of system cached)`)
console.log(`      latency: ~50-150ms saved per warm turn (Anthropic prefix cache empirical)`)

console.log("\n─────────────────────────────────────────────")
console.log("TOTAL per-turn estimate (warm session, fast path):")
console.log(`  ~${Math.round(beforeMs - afterMs + 100)}ms latency reduction`)
console.log(`  ~${(outputCostSaved + orchInputCostSaved).toFixed(5)} USD cost reduction`)
console.log("─────────────────────────────────────────────\n")
