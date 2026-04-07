#!/usr/bin/env node
/**
 * Demo E2E Runner — product 탭 핵심 시나리오를 deployed Vercel API로 호출
 * 입력 → before/after filters → top card → invariant 검증 → results.tsv + results.json
 *
 * 실행: node test-results/demo-e2e-runner.js
 *      API_URL=... node test-results/demo-e2e-runner.js
 */
const fs = require("fs")
const path = require("path")
const https = require("https")
const http = require("http")

const API_URL = process.env.API_URL || "https://yg1-ai-assistant.vercel.app/api/recommend"
const TEST_CASES = require("./test-cases.json")
const OUT_DIR = path.join(__dirname)
const OUT_TSV = path.join(OUT_DIR, "demo-e2e-results.tsv")
const OUT_JSON = path.join(OUT_DIR, "demo-e2e-results.json")

function callAPI(body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const u = new URL(API_URL)
    const lib = u.protocol === "https:" ? https : http
    const data = JSON.stringify(body)
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: timeoutMs,
    }, (res) => {
      let buf = ""
      res.on("data", c => buf += c)
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }) }
        catch (e) { resolve({ status: res.statusCode, body: { error: "parse_failed", raw: buf.slice(0, 500) } }) }
      })
    })
    req.on("error", reject)
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")) })
    req.write(data); req.end()
  })
}

function buildBody(scenario, prevState, prevMessages, userText) {
  return {
    engine: "serve",
    intakeForm: scenario.intakeForm || prevState?.lastIntakeForm || {},
    messages: [...prevMessages, { role: "user", text: userText }],
    sessionState: prevState || null,
  }
}

function summarizeFilters(filters) {
  if (!filters || !filters.length) return "(none)"
  return filters.map(f => `${f.field}${f.op === "eq" ? "=" : f.op === "neq" ? "!=" : ":" + f.op + ":"}${f.rawValue ?? f.value}`).join("|")
}

function topCard(state) {
  const c = state?.displayedCandidates?.[0] || state?.candidateHighlights?.[0]
  if (!c) return null
  return {
    code: c.productCode || c.displayCode,
    brand: c.brand,
    series: c.seriesName || c.series,
    diameterMm: c.diameterMm,
    fluteCount: c.fluteCount,
  }
}

function checkInvariants(scenario, beforeState, afterState, response) {
  const inv = scenario.expected?.invariants || []
  const filters = afterState?.appliedFilters || []
  const candidates = afterState?.displayedCandidates || response?.candidates || []
  const count = afterState?.candidateCount ?? candidates.length
  const top = topCard(afterState)
  const issues = []

  for (const i of inv) {
    if (i.includes("candidateCount > 0") && !(count > 0)) issues.push(`FAIL: candidateCount=${count}`)
    if (i.includes("candidateCount < 200") && !(count < 200)) issues.push(`WARN: over-broad candidateCount=${count}`)
    if (i.includes("displayedChips.length > 0")) {
      const chips = afterState?.displayedChips || []
      if (chips.length === 0) issues.push("FAIL: no chips offered")
    }
    if (i.includes("brand == 'CRX S'")) {
      // 'no candidate with brand == CRX S'
      const violators = candidates.filter(c => c.brand && String(c.brand).toUpperCase().replace(/[\s-]/g, "") === "CRXS")
      if (violators.length > 0) issues.push(`FAIL: ${violators.length} candidates still brand=CRX S`)
      if (top && top.brand && String(top.brand).toUpperCase().replace(/[\s-]/g, "") === "CRXS") issues.push("FAIL: top1 is CRX S")
    }
    if (i.includes("appliedFilters has fluteCount=4")) {
      if (!filters.some(f => f.field === "fluteCount" && Number(f.rawValue ?? f.value) === 4)) issues.push("FAIL: fluteCount=4 missing")
    }
    if (i.includes("does NOT have fluteCount=2")) {
      if (filters.some(f => f.field === "fluteCount" && Number(f.rawValue ?? f.value) === 2 && f.op === "eq")) issues.push("FAIL: fluteCount=2 still applied")
    }
    if (i.includes("no brand filter")) {
      if (filters.some(f => f.field === "brand")) issues.push("FAIL: brand filter remains after clear")
    }
    if (i.includes("country=KOREA")) {
      if (!filters.some(f => f.field === "country")) issues.push("FAIL: country filter not applied")
    }
    if (i.includes("country in ['KOREA'")) {
      const bad = candidates.filter(c => c.country && c.country !== "KOREA")
      if (bad.length > 0) issues.push(`WARN: ${bad.length} non-KOREA candidates shown`)
    }
    if (i.includes("mentions both SGED31 and SGED30")) {
      const text = response?.text || response?.message || ""
      if (!text.includes("SGED31") || !text.includes("SGED30")) issues.push("FAIL: comparison missing one side")
    }
  }
  return issues
}

async function runScenario(scenario) {
  const log = { id: scenario.id, severity: scenario.severity, category: scenario.category, turns: [] }
  let state = null
  let messages = []
  // Pre-turns (no invariant check)
  for (const t of (scenario.preTurns || [])) {
    try {
      const body = buildBody(scenario, state, messages, t.user)
      const r = await callAPI(body)
      state = r.body.sessionState || null
      messages.push({ role: "user", text: t.user })
      if (r.body.text) messages.push({ role: "ai", text: r.body.text })
    } catch (e) {
      log.preTurnError = e.message
      return { ...log, verdict: "ERROR", issues: [`pre-turn fail: ${e.message}`] }
    }
  }
  // Main turns
  let lastResponse = null
  let beforeState = state
  for (const t of scenario.turns) {
    try {
      const body = buildBody(scenario, state, messages, t.user)
      const r = await callAPI(body)
      lastResponse = r.body
      state = r.body.sessionState || null
      messages.push({ role: "user", text: t.user })
      if (r.body.text) messages.push({ role: "ai", text: r.body.text })
      log.turns.push({
        user: t.user,
        beforeFilters: summarizeFilters(beforeState?.appliedFilters),
        afterFilters: summarizeFilters(state?.appliedFilters),
        candidateBefore: beforeState?.candidateCount ?? null,
        candidateAfter: state?.candidateCount ?? null,
        topCard: topCard(state),
      })
      beforeState = state
    } catch (e) {
      return { ...log, verdict: "ERROR", issues: [`turn fail: ${e.message}`] }
    }
  }
  const issues = checkInvariants(scenario, null, state, lastResponse)
  const verdict = issues.some(i => i.startsWith("FAIL")) ? "FAIL" : (issues.length > 0 ? "WARN" : "PASS")
  return { ...log, verdict, issues }
}

async function main() {
  console.log(`\n[Demo E2E] API: ${API_URL}\n`)
  console.log(`scenarios: ${TEST_CASES.scenarios.length}\n`)
  const results = []
  for (const s of TEST_CASES.scenarios) {
    process.stdout.write(`  ${s.id} ... `)
    const t0 = Date.now()
    const r = await runScenario(s)
    r.durationMs = Date.now() - t0
    results.push(r)
    console.log(`${r.verdict} (${r.durationMs}ms) ${r.issues.length ? "— " + r.issues.join("; ") : ""}`)
  }
  // TSV
  const tsv = ["id\tseverity\tcategory\tverdict\tdurationMs\tcandidateAfter\ttopBrand\tissues"]
  for (const r of results) {
    const last = r.turns[r.turns.length - 1] || {}
    tsv.push([
      r.id, r.severity, r.category, r.verdict, r.durationMs,
      last.candidateAfter ?? "", last.topCard?.brand ?? "",
      r.issues.join(" | ")
    ].join("\t"))
  }
  fs.writeFileSync(OUT_TSV, tsv.join("\n"))
  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2))
  // Summary
  const passed = results.filter(r => r.verdict === "PASS").length
  const failed = results.filter(r => r.verdict === "FAIL").length
  const warned = results.filter(r => r.verdict === "WARN").length
  const errored = results.filter(r => r.verdict === "ERROR").length
  console.log(`\n=== SUMMARY ===\nPASS=${passed} FAIL=${failed} WARN=${warned} ERROR=${errored} / total=${results.length}`)
  console.log(`tsv: ${OUT_TSV}\njson: ${OUT_JSON}`)
  if (failed > 0) process.exitCode = 1
}

main().catch(e => { console.error("FATAL:", e); process.exit(2) })
