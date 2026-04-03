#!/usr/bin/env node
/**
 * E2E API 테스트 — 배포된 서버에 실제 멀티턴 대화 실행
 *
 * 실행: node scripts/e2e-api-test.js
 * 대상: https://yg1-ai-assistant.vercel.app/api/recommend
 *
 * DB + LLM + 전체 파이프라인을 관통하는 통합 테스트
 */

const API_URL = "https://yg1-ai-assistant.vercel.app/api/recommend"
const TIMEOUT = 60000

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

async function callRecommend(form, messages, prevState = null) {
  const body = { form, messages, prevState }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    clearTimeout(timer)
    throw err
  }
}

function makeForm(overrides = {}) {
  return {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "unanswered" },
    operationType: { status: "unanswered" },
    machiningIntent: { status: "unanswered" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "known", value: "10mm" },
    country: { status: "unanswered" },
    ...overrides,
  }
}

function addMessage(messages, role, text) {
  return [...messages, { role, text, timestamp: new Date().toISOString() }]
}

// ═══════════════════════════════════════════════════════════════
// Test scenarios
// ═══════════════════════════════════════════════════════════════

const scenarios = [
  {
    name: "기본 추천 흐름: Milling 10mm → 형상 → 날수 → 추천",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true, noError: true } },
      { user: "Square", expect: { hasChips: true, noError: true } },
      { user: "4날", expect: { hasChips: true, noError: true } },
      { user: "상관없음", expect: { noError: true } },
    ],
  },
  {
    name: "칩 클릭 → revision → 결과",
    form: makeForm({ material: { status: "known", value: "알루미늄" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true } },
      { user: "Ball", expect: { hasChips: true } },
      { user: "Ball 말고 Square로", expect: { noError: true } },
    ],
  },
  {
    name: "side question → 필터 보존",
    form: makeForm({ material: { status: "known", value: "스테인리스강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true } },
      { user: "Square", expect: { hasChips: true } },
      { user: "코팅이 뭐야?", expect: { noError: true } },
      { user: "TiAlN", expect: { noError: true } },
    ],
  },
  {
    name: "위임 표현: 알아서 추천",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true } },
      { user: "아무거나", expect: { noError: true } },
      { user: "추천해줘", expect: { noError: true } },
    ],
  },
  {
    name: "블루코팅 필터링",
    form: makeForm(),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true } },
      { user: "상관없음", expect: { hasChips: true } },
      { user: "블루코팅으로 필터링", expect: { noError: true } },
    ],
  },
  {
    name: "한국어 형상: 코너레디우스",
    form: makeForm({ material: { status: "known", value: "고경도강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true } },
      { user: "코너레디우스", expect: { noError: true } },
    ],
  },
  {
    name: "직경 변경: 10mm → 8mm",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true } },
      { user: "Square", expect: { hasChips: true } },
      { user: "4날", expect: { hasChips: true } },
      { user: "직경 8mm로 바꿔줘", expect: { noError: true } },
    ],
  },
  {
    name: "소재 변경: 알루미늄 → 주철",
    form: makeForm({ material: { status: "known", value: "알루미늄" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true } },
      { user: "Square", expect: { hasChips: true } },
      { user: "소재를 주철로 변경해줘", expect: { noError: true } },
    ],
  },
]

// ═══════════════════════════════════════════════════════════════
// Runner
// ═══════════════════════════════════════════════════════════════

async function runScenario(scenario) {
  const results = []
  let messages = []
  let prevState = null
  let passed = 0
  let failed = 0

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i]
    messages = addMessage(messages, "user", turn.user)

    const startTime = Date.now()
    try {
      const response = await callRecommend(scenario.form, messages, prevState)
      const elapsed = Date.now() - startTime

      // Update state for next turn
      prevState = response.sessionState || response.session?.engineState || prevState
      if (response.text) {
        messages = addMessage(messages, "ai", response.text)
      }

      // Check expectations
      const checks = []
      if (turn.expect.hasChips) {
        const hasChips = response.chips && response.chips.length > 0
        checks.push({ name: "hasChips", pass: hasChips, actual: response.chips?.length ?? 0 })
      }
      if (turn.expect.noError) {
        const noError = !response.error
        checks.push({ name: "noError", pass: noError, actual: response.error ?? "none" })
      }
      if (turn.expect.hasCandidates) {
        const count = response.sessionState?.candidateCount ?? response.candidateSnapshot?.length ?? 0
        checks.push({ name: "hasCandidates", pass: count > 0, actual: count })
      }

      const allPass = checks.every(c => c.pass)
      if (allPass) passed++; else failed++

      results.push({
        turn: i + 1,
        user: turn.user.slice(0, 50),
        elapsed: elapsed + "ms",
        response: (response.text || "").slice(0, 80),
        chips: (response.chips || []).length,
        candidateCount: response.sessionState?.candidateCount ?? "?",
        checks,
        status: allPass ? "✅" : "❌",
      })
    } catch (err) {
      failed++
      results.push({
        turn: i + 1,
        user: turn.user.slice(0, 50),
        elapsed: (Date.now() - startTime) + "ms",
        error: err.message,
        status: "💥",
      })
    }
  }

  return { scenario: scenario.name, results, passed, failed }
}

async function main() {
  console.log("\n🔬 E2E API 테스트 시작\n")
  console.log(`대상: ${API_URL}`)
  console.log(`시나리오: ${scenarios.length}개`)
  console.log(`총 턴: ${scenarios.reduce((a, s) => a + s.turns.length, 0)}개\n`)

  let totalPassed = 0
  let totalFailed = 0

  // Run scenarios in parallel (2 at a time to avoid overload)
  const BATCH = 2
  for (let i = 0; i < scenarios.length; i += BATCH) {
    const batch = scenarios.slice(i, i + BATCH)
    const batchResults = await Promise.all(batch.map(s => runScenario(s)))

    for (const result of batchResults) {
      totalPassed += result.passed
      totalFailed += result.failed

      console.log(`\n📋 ${result.scenario}`)
      for (const r of result.results) {
        const checksStr = (r.checks || []).map(c => c.pass ? `${c.name}✅` : `${c.name}❌(${c.actual})`).join(" ")
        console.log(`  Turn ${r.turn} ${r.status} [${r.elapsed}] "${r.user}" → chips:${r.chips ?? "?"} candidates:${r.candidateCount ?? "?"} ${checksStr}`)
        if (r.error) console.log(`    💥 ${r.error}`)
      }
    }
  }

  console.log(`\n${"═".repeat(60)}`)
  console.log(`✅ Passed: ${totalPassed}`)
  console.log(`❌ Failed: ${totalFailed}`)
  console.log(`📊 Score: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`)
  console.log(`${"═".repeat(60)}\n`)

  process.exit(totalFailed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error("💥 Fatal:", err.message)
  process.exit(1)
})
