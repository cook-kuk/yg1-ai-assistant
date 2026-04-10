#!/usr/bin/env node
/**
 * E2E Feedback-Driven Stress Test
 *
 * 실제 피드백에서 추출한 시나리오 + 스트레스 케이스
 * 멀티에이전트 병렬 실행 (6 concurrent)
 *
 * Usage: node scripts/e2e-feedback-stress.js
 */

const API_URL = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"
const TIMEOUT = 300_000
const BATCH_SIZE = 6

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

async function callRecommend(form, messages, prevSession = null, language = "ko") {
  const body = { intakeForm: form, messages, session: prevSession, language }
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

function addMsg(msgs, role, text) {
  return [...msgs, { role, text, timestamp: new Date().toISOString() }]
}

// ═══════════════════════════════════════════════════════════════
// Validation helpers
// ═══════════════════════════════════════════════════════════════

function validateChips(chips) {
  if (!chips || !Array.isArray(chips)) return { ok: false, issue: "chips is not array" }
  if (chips.length === 0) return { ok: false, issue: "empty chips" }
  const charChips = chips.filter(c => typeof c === "string" && c.length <= 1)
  if (charChips.length > 0) return { ok: false, issue: `${charChips.length} single-char chips: ${charChips.slice(0,5).join(",")}` }
  const dupes = chips.filter((c, i) => chips.indexOf(c) !== i)
  if (dupes.length > 0) return { ok: false, issue: `duplicate chips: ${[...new Set(dupes)].join(",")}` }
  return { ok: true }
}

function validateFlow(response, prevMode) {
  const mode = response.session?.publicState?.currentMode ?? "unknown"
  const candidateCount = response.session?.publicState?.candidateCount ?? response.session?.engineState?.candidateCount ?? 0
  const chips = response.chips ?? []
  const text = response.text ?? ""

  const issues = []

  // 칩 검증
  const chipCheck = validateChips(chips)
  if (!chipCheck.ok) issues.push(`CHIP: ${chipCheck.issue}`)

  // 응답 텍스트 검증
  if (!text || text.length < 10) issues.push("TEXT: response too short")
  if (text.includes("오류가 발생") || text.includes("Error")) issues.push("TEXT: contains error message")
  if (text.includes("인식하지 못했습니다")) issues.push("TEXT: unrecognized input message shown")

  // 후보 수 검증 — intake/question 첫 턴은 검색 전이므로 0이 정상
  if (candidateCount === 0 && mode === "narrowing") issues.push("FLOW: 0 candidates during narrowing")

  // Hallucination 검증
  const hallucWords = ["만원", "원/개", "USD", "KRW", "영업일", "배송"]
  const found = hallucWords.filter(w => text.includes(w))
  if (found.length > 0) issues.push(`HALLUC: ${found.join(",")}`)

  return { mode, candidateCount, chipCount: chips.length, issues }
}

// ═══════════════════════════════════════════════════════════════
// Scenarios (피드백 기반 + 스트레스)
// ═══════════════════════════════════════════════════════════════

const scenarios = [
  // ── 피드백 #17: 스테인리스 SUS-CUT/TITANOX 미노출 ──
  {
    name: "FB-17: 스테인리스 추천 → SUS-CUT/TITANOX 상위 확인",
    form: makeForm({ material: { status: "known", value: "스테인리스강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Square" },
      { user: "4날" },
      { user: "상관없음" },
    ],
    postCheck: (responses) => {
      const last = responses[responses.length - 1]
      const text = (last?.text ?? "").toUpperCase()
      // 스테인리스 관련 시리즈: TITANOX, SUS-CUT, INOX, V7, 또는 M소재 언급
      const hasStainlessSeries = ["TITANOX", "SUS", "INOX", "V7", "SEME", "4G", "스테인리스", "M소재"].some(k => text.includes(k))
      if (!hasStainlessSeries) {
        return "스테인리스 관련 시리즈/소재 언급 없음"
      }
      return null
    },
  },
  // ── 피드백 #61: M 소재인데 다른 소재 섞임 ──
  {
    name: "FB-61: M소재 필터 → 다른 소재 혼입 여부",
    form: makeForm({ material: { status: "known", value: "M" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Square" },
      { user: "4날" },
      { user: "상관없음" },
    ],
  },
  // ── 피드백 #102: 인치 변환 오류 ──
  {
    name: "FB-102: 인치 직경 3/8 → 시스템 오류 없어야 함",
    form: makeForm({
      material: { status: "known", value: "탄소강" },
      diameterInfo: { status: "known", value: "3/8 inch" },
    }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
    ],
  },
  // ── 피드백 #36: 0개 결과 ──
  {
    name: "FB-36: 극한 조건 → 0개 시 안내 메시지",
    form: makeForm({
      material: { status: "known", value: "티타늄" },
      diameterInfo: { status: "known", value: "0.5mm" },
    }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Taper" },
      { user: "6날" },
    ],
  },
  // ── 피드백 #2: 영어 입력 → 영어 응답 ──
  {
    name: "FB-02: English input → English response",
    form: makeForm({ material: { status: "known", value: "Carbon Steel" } }),
    language: "en",
    turns: [
      { user: "Please recommend a YG-1 product for the above conditions." },
      { user: "Square" },
      { user: "4 flute" },
    ],
  },
  // ── 피드백 #50: 인서트 질문 ──
  {
    name: "FB-50: 인서트 제품 질문 → 구체적 응답",
    form: makeForm({
      toolTypeOrCurrentProduct: { status: "known", value: "Turning" },
      material: { status: "known", value: "탄소강" },
    }),
    turns: [
      { user: "인서트는 어떤 제품이 있어?" },
    ],
  },
  // ── 피드백: Turning 2mm 검색 실패 ──
  {
    name: "FB: 탄소강 Turning 2mm → 결과 있어야 함",
    form: makeForm({
      toolTypeOrCurrentProduct: { status: "known", value: "Turning" },
      material: { status: "known", value: "탄소강" },
      diameterInfo: { status: "known", value: "2mm" },
    }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
    ],
  },
  // ── Cross-field revision (오늘 수정한 버그) ──
  {
    name: "BUG-FIX: coating 질문 중 Ball로 변경",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Square" },
      { user: "4날" },
      { user: "Ball로 바꿔주세요" },
    ],
  },
  {
    name: "BUG-FIX: 날수 질문 중 직경 변경",
    form: makeForm({ material: { status: "known", value: "알루미늄" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Ball" },
      { user: "직경 8mm로 바꿔줘" },
    ],
  },
  // ── 대명사/비정형 입력 ──
  {
    name: "PRONOUN: 1번 2번 비교 + 그거 절삭조건",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Square" },
      { user: "4날" },
      { user: "상관없음" },
      { user: "1번이랑 2번 비교해줘" },
      { user: "그거 절삭조건 알려줘" },
    ],
  },
  {
    name: "INFORMAL: ㅇㅇ / 아무거나 / 그냥 추천해",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "ㅇㅇ" },
      { user: "아무거나" },
      { user: "그냥 추천해" },
    ],
  },
  // ── Skip 연속 → 빠른 추천 ──
  {
    name: "SKIP-CHAIN: 상관없음 4번 → 추천 도달",
    form: makeForm({ material: { status: "known", value: "주철" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "상관없음" },
      { user: "상관없음" },
      { user: "상관없음" },
      { user: "상관없음" },
    ],
  },
  // ── 리비전 체인 ──
  {
    name: "REVISION-CHAIN: Square→Ball→Radius 연속 변경",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Square" },
      { user: "Ball로 바꿔" },
      { user: "아니 Radius로" },
    ],
  },
  // ── 7턴 풀 플로우 (추천→비교→변경→재추천→절삭조건) ──
  {
    name: "STRESS-7T: 추천→비교→형상변경→재추천→절삭조건",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Square" },
      { user: "4날" },
      { user: "상관없음" },
      { user: "1번이랑 2번 비교" },
      { user: "Ball로 바꿔줘" },
      { user: "절삭조건 알려줘" },
    ],
  },
  // ── 10턴 스트레스 ──
  {
    name: "STRESS-10T: 추천→사이드질문→변경→스킵→추천→비교→절삭",
    form: makeForm({ material: { status: "known", value: "스테인리스강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Square" },
      { user: "TiAlN이 뭐야?" },
      { user: "4날" },
      { user: "상관없음" },
      { user: "2번 제품 설명해줘" },
      { user: "직경 8mm로 바꿔줘" },
      { user: "상관없음" },
      { user: "1번이랑 3번 비교" },
      { user: "절삭조건 알려줘" },
    ],
  },
  // ── Hallucination 가드 ──
  {
    name: "HALLUC: 가격/납기/무게/MOQ/전화번호",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Square" },
      { user: "가격 얼마야?" },
      { user: "납기일 알려줘" },
      { user: "이 제품 무게가 몇 g이야?" },
      { user: "최소 주문수량 알려줘" },
    ],
  },
  // ── 알루미늄 3날 DLC ──
  {
    name: "GOLDEN: 알루미늄 3날 DLC → ALU-POWER 시리즈",
    form: makeForm({ material: { status: "known", value: "알루미늄" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Square" },
      { user: "3날" },
      { user: "DLC" },
    ],
    postCheck: (responses) => {
      const last = responses[responses.length - 1]
      const text = (last?.text ?? "").toUpperCase()
      // JAH23/JAH22도 알루미늄 전용 시리즈
      if (!text.includes("ALU") && !text.includes("JAH") && !text.includes("알루미늄")) {
        return "알루미늄 DLC 3날 → ALU/JAH 시리즈 미노출"
      }
      return null
    },
  },
  // ── 고경도강 HRC55 ──
  {
    name: "GOLDEN: 고경도강 HRC55 → X5070/4G 시리즈",
    form: makeForm({ material: { status: "known", value: "고경도강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Square" },
      { user: "4날" },
      { user: "상관없음" },
    ],
  },
  // ── 리셋 후 새 검색 ──
  {
    name: "RESET: 추천 후 처음부터 다시 → 새 소재",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "위 조건에 맞는 YG-1 제품을 추천해 주세요." },
      { user: "Square" },
      { user: "4날" },
      { user: "상관없음" },
      { user: "처음부터 다시" },
    ],
  },
  // ── 경쟁사 대체 ──
  {
    name: "COMPETITOR: 경쟁사 제품 대체 요청",
    form: makeForm({ material: { status: "known", value: "탄소강" } }),
    turns: [
      { user: "MITSUBISHI MS2MSD 대체할 수 있는 YG-1 제품 있어?" },
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
  let allResponses = []
  const issues = []

  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i]
    messages = addMsg(messages, "user", turn.user)
    const start = Date.now()

    try {
      const response = await callRecommend(scenario.form, messages, prevState, scenario.language ?? "ko")
      const elapsed = Date.now() - start

      // session envelope = { publicState, engineState } — 다음 턴에 그대로 전달
      const nextSession = (response.session?.publicState || response.session?.engineState)
        ? response.session
        : prevState
      prevState = nextSession
      if (response.text) messages = addMsg(messages, "ai", response.text)
      allResponses.push(response)

      const prevMode = results.length > 0 ? results[results.length - 1].mode : "initial"
      const validation = validateFlow(response, prevMode)

      results.push({
        turn: i + 1,
        user: turn.user.slice(0, 50),
        elapsed,
        responsePreview: (response.text || "").slice(0, 80),
        ...validation,
      })

      if (validation.issues.length > 0) {
        issues.push(...validation.issues.map(iss => `T${i+1}: ${iss}`))
      }
    } catch (err) {
      results.push({
        turn: i + 1,
        user: turn.user.slice(0, 50),
        elapsed: Date.now() - start,
        mode: "ERROR",
        issues: [`CRASH: ${err.message}`],
      })
      issues.push(`T${i+1}: CRASH: ${err.message}`)
      break // stop scenario on crash
    }
  }

  // Post-check
  if (scenario.postCheck) {
    const postIssue = scenario.postCheck(allResponses)
    if (postIssue) issues.push(`POST: ${postIssue}`)
  }

  return { name: scenario.name, results, issues, turnCount: scenario.turns.length }
}

async function main() {
  console.log("\n🔬 피드백 기반 E2E 스트레스 테스트\n")
  console.log(`서버: ${API_URL}`)
  console.log(`시나리오: ${scenarios.length}개 | 병렬: ${BATCH_SIZE}개`)
  console.log(`총 턴: ${scenarios.reduce((a, s) => a + s.turns.length, 0)}개\n`)
  console.log("═".repeat(70))

  const allResults = []
  const startTime = Date.now()

  // 병렬 배치 실행
  for (let i = 0; i < scenarios.length; i += BATCH_SIZE) {
    const batch = scenarios.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    console.log(`\n🚀 Batch ${batchNum} (${batch.map(s => s.name.split(":")[0]).join(", ")})`)

    const batchResults = await Promise.all(batch.map(s => runScenario(s)))
    allResults.push(...batchResults)

    for (const r of batchResults) {
      const status = r.issues.length === 0 ? "✅" : "⚠️"
      const latencies = r.results.map(t => t.elapsed).filter(Boolean)
      const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a,b) => a+b, 0) / latencies.length) : 0

      console.log(`\n  ${status} ${r.name} (${r.turnCount}턴, avg ${avgLatency}ms)`)
      for (const t of r.results) {
        const issueStr = (t.issues?.length ?? 0) > 0 ? ` ⚠️ ${t.issues.join("; ")}` : ""
        console.log(`    T${t.turn} [${t.elapsed}ms] mode=${t.mode} chips=${t.chipCount} cand=${t.candidateCount} "${t.user}"${issueStr}`)
      }
      if (r.issues.length > 0) {
        console.log(`    🔴 Issues: ${r.issues.join(" | ")}`)
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════
  const totalTime = Date.now() - startTime
  const totalTurns = allResults.reduce((a, r) => a + r.turnCount, 0)
  const passedScenarios = allResults.filter(r => r.issues.length === 0)
  const failedScenarios = allResults.filter(r => r.issues.length > 0)
  const allIssues = allResults.flatMap(r => r.issues.map(i => `[${r.name.split(":")[0]}] ${i}`))

  console.log("\n" + "═".repeat(70))
  console.log("📊 FINAL REPORT")
  console.log("═".repeat(70))
  console.log(`\n시나리오: ${allResults.length}개`)
  console.log(`총 턴: ${totalTurns}개`)
  console.log(`소요 시간: ${(totalTime / 1000).toFixed(1)}s`)
  console.log(`\n✅ Passed: ${passedScenarios.length}/${allResults.length}`)
  console.log(`⚠️  Issues: ${failedScenarios.length}/${allResults.length}`)
  console.log(`📊 Score: ${((passedScenarios.length / allResults.length) * 100).toFixed(1)}%`)

  if (allIssues.length > 0) {
    console.log(`\n🔴 ALL ISSUES (${allIssues.length}):`)
    for (const issue of allIssues) {
      console.log(`  - ${issue}`)
    }
  }

  console.log("\n" + "═".repeat(70))
  process.exit(failedScenarios.length > 0 ? 1 : 0)
}

main().catch(err => { console.error("Fatal:", err); process.exit(2) })
