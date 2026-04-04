#!/usr/bin/env node
/**
 * E2E API 테스트 — 배포된 서버에 실제 멀티턴 대화 실행
 *
 * 실행: node scripts/e2e-api-test.js
 * 대상: https://yg1-ai-assistant.vercel.app/api/recommend
 *
 * DB + LLM + 전체 파이프라인을 관통하는 통합 테스트
 */

const API_URL = process.env.API_URL || "http://localhost:3000/api/recommend"
const TIMEOUT = 60000

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

async function callRecommend(form, messages, prevSession = null) {
  const body = { intakeForm: form, messages, sessionState: prevSession, displayedProducts: null, language: "ko" }
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
  {
    name: "🏆 Golden: 구리 SQUARE 2날 직경 10 → CRX-S 추천",
    form: makeForm({ material: { status: "known", value: "N" } }),
    turns: [
      { user: "피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘", expect: { noError: true } },
    ],
  },
  {
    name: "🏆 Golden: 구리 조건 순차 입력 → CRX-S",
    form: makeForm({ material: { status: "known", value: "N" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true } },
      { user: "Square", expect: { hasChips: true } },
      { user: "2날", expect: { hasChips: true } },
      { user: "상관없음", expect: { noError: true } },
    ],
  },
  // ── 오늘 발견 버그 검증 시나리오 ──
  {
    name: "🐛 Cross-field revision: coating 질문 중 Ball로 바꿔주세요",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true, noError: true } },
      { user: "Square", expect: { hasChips: true, noError: true } },
      { user: "4날", expect: { hasChips: true, noError: true } },
      { user: "Ball로 바꿔주세요", expect: { noError: true, noCharChips: true } },
    ],
  },
  {
    name: "🐛 Cross-field revision: 날수 질문 중 Radius로 변경해줘",
    form: makeForm({ material: { status: "known", value: "알루미늄" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true, noError: true } },
      { user: "Ball", expect: { hasChips: true, noError: true } },
      { user: "Radius로 변경해줘", expect: { noError: true, noCharChips: true } },
    ],
  },
  {
    name: "🐛 한 글자 칩 방지: pending 중 다른 필드 값 입력",
    form: makeForm({ material: { status: "known", value: "스테인리스강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true, noError: true } },
      { user: "Square", expect: { hasChips: true, noError: true } },
      { user: "4날 대신 2날로", expect: { noError: true, noCharChips: true } },
    ],
  },
  // ── 대명사 해소 시나리오 ──
  {
    name: "대명사: 그거 뭐야 / 이거 추천해줘",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true, noError: true } },
      { user: "Square", expect: { hasChips: true, noError: true } },
      { user: "4날", expect: { hasChips: true, noError: true } },
      { user: "상관없음", expect: { noError: true } },
      { user: "1번이랑 2번 비교해줘", expect: { noError: true } },
    ],
  },
  {
    name: "대명사: 아까 그거로 해줘",
    form: makeForm({ material: { status: "known", value: "알루미늄" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true, noError: true } },
      { user: "Ball", expect: { hasChips: true, noError: true } },
      { user: "3날", expect: { hasChips: true, noError: true } },
      { user: "상관없음", expect: { noError: true } },
      { user: "아까 그거 절삭조건 알려줘", expect: { noError: true } },
    ],
  },
  // ── 스트레스: 긴 멀티턴 ──
  {
    name: "🔥 Stress: 7턴 풀 플로우 (추천→비교→revision→재추천)",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true, noError: true } },
      { user: "Square", expect: { hasChips: true, noError: true } },
      { user: "4날", expect: { hasChips: true, noError: true } },
      { user: "상관없음", expect: { noError: true } },
      { user: "1번이랑 2번 비교해줘", expect: { noError: true } },
      { user: "Ball로 바꿔줘", expect: { noError: true, noCharChips: true } },
      { user: "추천해줘", expect: { noError: true } },
    ],
  },
  {
    name: "🔥 Stress: skip 연속 → 빠른 추천",
    form: makeForm({ material: { status: "known", value: "스테인리스강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true, noError: true } },
      { user: "상관없음", expect: { hasChips: true, noError: true } },
      { user: "상관없음", expect: { noError: true } },
      { user: "상관없음", expect: { noError: true } },
    ],
  },
  // ── Hallucination guard ──
  {
    name: "🛡️ Hallucination: 가격/납기 질문",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요.", expect: { hasChips: true, noError: true } },
      { user: "Square", expect: { hasChips: true, noError: true } },
      { user: "가격 얼마야?", expect: { noError: true, noHallucination: true } },
      { user: "납기일 알려줘", expect: { noError: true, noHallucination: true } },
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
      prevState = response.sessionState || prevState
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
      // 한 글자 칩 방지: 모든 칩이 2글자 이상이어야 함
      if (turn.expect.noCharChips) {
        const chips = response.chips || []
        const charChips = chips.filter(c => c.length <= 1)
        checks.push({ name: "noCharChips", pass: charChips.length === 0, actual: charChips.length > 0 ? `${charChips.length}개 한글자 칩: ${charChips.slice(0, 5).join(",")}` : "OK" })
      }
      // Hallucination 가드: 가격/납기 관련 금지어
      if (turn.expect.noHallucination) {
        const text = response.text || ""
        const forbidden = ["원", "달러", "USD", "KRW", "만원", "영업일", "일 소요", "주 소요", "배송"]
        const found = forbidden.filter(w => text.includes(w))
        checks.push({ name: "noHallucination", pass: found.length === 0, actual: found.length > 0 ? `금지어 발견: ${found.join(",")}` : "OK" })
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

  // Run scenarios in parallel (4 at a time for speed)
  const BATCH = 4
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
