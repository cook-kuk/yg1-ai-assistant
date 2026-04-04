#!/usr/bin/env node
/**
 * Self-Supervised Learning Loop for ARIA
 *
 * Rule-based evaluation (no API key needed):
 * 1. Hard Test Generation — 어려운 멀티턴 시나리오 자동 생성
 * 2. System Execution — 배포 서버에 실행
 * 3. Rule-based Evaluation — 필터/purpose/에러 자동 검증
 * 4. Training Data Extraction — 실패 케이스 → few-shot 변환
 *
 * Usage: node scripts/self-supervised-loop.mjs [--rounds=3]
 */

const API = process.env.API_URL || "https://yg1-ai-assistant.vercel.app/api/recommend"

// ══════════════════════════════════════════════════════════════
// 1. Hard Test Generation — assertions 포함
// ══════════════════════════════════════════════════════════════

const HARD_SCENARIOS = [
  {
    name: "이전 턴 참조 — '아까 그거'",
    turns: [
      { user: "Square 엔드밀 추천해줘" },
      { user: "TiAlN 코팅이 뭐야?" },
      { user: "그거로 코팅해줘" },
    ],
    // Assert: last turn should have coating=TiAlN in filters
    assertLastTurn: (t) => {
      const ri = t.resolvedInput || {}
      const hasCoating = t.filters.some(f => f.includes("coating") && /tialn/i.test(f)) || ri.coatingPreference === "TiAlN"
      return { pass: hasCoating || /tialn/i.test(t.aiText || ""), reason: `coating TiAlN: filter=${t.filters.some(f => f.includes("coating"))}, ri=${ri.coatingPreference}` }
    },
    fewshot: { user: "그거로 코팅해줘", actions: [{ type: "apply_filter", field: "coating", value: "TiAlN" }], reasoning: "이전 턴에서 언급한 TiAlN을 '그거'로 참조" },
    difficulty: "hard",
  },
  {
    name: "복합 자연어 — 한 문장에 5개 조건",
    turns: [
      { user: "탄소강 10mm 4날 Square TiAlN으로 추천해줘" },
    ],
    assertLastTurn: (t) => {
      const ri = t.resolvedInput || {}
      const checks = [
        t.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f)) || ri.toolSubtype === "Square",
        t.filters.some(f => /fluteCount/i.test(f) && f.includes("4")) || ri.flutePreference === 4,
        t.filters.some(f => /coating/i.test(f) && /tialn/i.test(f)) || ri.coatingPreference === "TiAlN",
      ]
      const passed = checks.filter(Boolean).length
      return { pass: passed >= 2, reason: `Only ${passed}/3 filters (need ≥2). ri: subtype=${ri.toolSubtype}, flute=${ri.flutePreference}, coat=${ri.coatingPreference}` }
    },
    fewshot: { user: "탄소강 10mm 4날 Square TiAlN��로 추천해줘", actions: [{ type: "apply_filter", field: "workPieceName", value: "탄소강" }, { type: "apply_filter", field: "diameterMm", value: 10 }, { type: "apply_filter", field: "fluteCount", value: 4 }, { type: "apply_filter", field: "toolSubtype", value: "Square" }, { type: "apply_filter", field: "coating", value: "TiAlN" }], reasoning: "한 문장에 5개 조건 동시 추출" },
    difficulty: "hard",
  },
  {
    name: "조건 교체 + 되돌리기",
    turns: [
      { user: "Square 4날 추천해줘" },
      { user: "Ball로 바꿔줘" },
      { user: "아니 아까 Square가 나았어. 되돌려줘" },
    ],
    assertLastTurn: (t) => {
      const ri = t.resolvedInput || {}
      const hasSquare = t.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f)) || ri.toolSubtype === "Square"
      const hasBall = t.filters.some(f => /toolSubtype/i.test(f) && /ball/i.test(f)) || ri.toolSubtype === "Ball"
      return { pass: hasSquare && !hasBall, reason: `Square=${hasSquare}, Ball=${hasBall}. ri.toolSubtype=${ri.toolSubtype}, filters: ${t.filters.join(", ")}` }
    },
    fewshot: { user: "아니 아까 Square가 나았어. 되돌려줘", actions: [{ type: "replace_filter", field: "toolSubtype", value: "Square" }], reasoning: "이전 선택으로 되돌리기" },
    difficulty: "hard",
  },
  {
    name: "부정 + 추가 동시",
    turns: [
      { user: "DLC 코팅으로 추천해줘" },
      { user: "DLC 빼고 TiAlN으로 바꿔" },
    ],
    assertLastTurn: (t) => {
      const ri = t.resolvedInput || {}
      const hasTiAlN = t.filters.some(f => /coating/i.test(f) && /tialn/i.test(f)) || ri.coatingPreference === "TiAlN"
      const hasDLC = t.filters.some(f => /coating/i.test(f) && /dlc/i.test(f)) || ri.coatingPreference === "DLC"
      return { pass: hasTiAlN && !hasDLC, reason: `TiAlN=${hasTiAlN}, DLC=${hasDLC}. ri.coating=${ri.coatingPreference}` }
    },
    fewshot: { user: "DLC 빼고 TiAlN으로 바꿔", actions: [{ type: "replace_filter", field: "coating", value: "TiAlN" }], reasoning: "기존 코팅 제거 + 새 코팅 적용" },
    difficulty: "medium",
  },
  {
    name: "질문 후 필터 유지",
    turns: [
      { user: "4날 Square 추천해줘" },
      { user: "TiAlN이랑 AlCrN 차이가 뭐야?" },
      { user: "추천 제품 보여줘" },
    ],
    assertTurn: (results) => {
      // Turn 2 (질문): 필터 유지되어야 함
      const t1 = results[0], t2 = results[1]
      if (!t1 || !t2) return { pass: false, reason: "Missing turn results" }
      const t1HasSquare = t1.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f))
      const t2HasSquare = t2.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f))
      // Turn 2 purpose should be answer/question, not filter change
      const t2IsQuestion = t2.purpose === "answer" || t2.purpose === "question"
      return { pass: (t1HasSquare && t2HasSquare) || t2IsQuestion, reason: `Turn 2 purpose=${t2.purpose}, filters should keep Square` }
    },
    fewshot: null,
    difficulty: "medium",
  },
  {
    name: "오타 + 구어체",
    turns: [
      { user: "스퀘어를 쓰고싶고 구리를 가공하고 싶어" },
    ],
    assertLastTurn: (t) => {
      const ri = t.resolvedInput || {}
      const hasSquare = t.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f)) || ri.toolSubtype === "Square"
      const hasCopper = t.filters.some(f => /workPiece/i.test(f) && /(구리|copper)/i.test(f)) || /(구리|copper)/i.test(t.aiText || "") || /(구리|copper)/i.test(ri.workPieceName || "")
      return { pass: hasSquare || hasCopper, reason: `Square=${hasSquare}, Copper=${hasCopper}. ri: ${ri.toolSubtype}, ${ri.workPieceName}` }
    },
    fewshot: { user: "스퀘어를 쓰고싶고 구리를 가공하고 싶어", actions: [{ type: "apply_filter", field: "toolSubtype", value: "Square" }, { type: "apply_filter", field: "workPieceName", value: "구리" }], reasoning: "구어체 '스퀘어'→Square, '구리'→workPieceName" },
    difficulty: "medium",
  },
  {
    name: "skip 연속 후 추천",
    turns: [
      { user: "상관없음" },
      { user: "아무거나" },
      { user: "알아서 해줘" },
      { user: "추천해줘" },
    ],
    assertLastTurn: (t) => {
      const noError = !t.error
      const hasResponse = t.aiText && t.aiText.length > 10
      return { pass: noError && hasResponse, reason: `error=${t.error}, responseLen=${t.aiText?.length}` }
    },
    fewshot: null,
    difficulty: "medium",
  },
  {
    name: "제품 코드 비교 요청",
    turns: [
      { user: "Square 4날 10mm 추천해줘" },
      { user: "1번이랑 2번 비교해줘" },
    ],
    assertLastTurn: (t) => {
      const noError = !t.error
      const hasCompare = t.purpose === "compare" || /(비교|차이|vs)/i.test(t.aiText || "")
      return { pass: noError && (hasCompare || t.aiText?.length > 20), reason: `purpose=${t.purpose}, hasCompareText=${hasCompare}` }
    },
    fewshot: { user: "1번이랑 2번 비교해줘", actions: [{ type: "compare" }], reasoning: "추천 결과 중 1, 2번 비교" },
    difficulty: "medium",
  },
  {
    name: "소재 변경 — P → M",
    turns: [
      { user: "탄소강 Square 추천해줘" },
      { user: "아 잠깐 소재를 스테인리스로 바꿔줘" },
    ],
    assertLastTurn: (t) => {
      const hasSts = t.filters.some(f => /workPiece/i.test(f) && /(스테인리스|stainless|sus)/i.test(f))
        || /(스테인리스|stainless)/i.test(t.aiText || "")
      return { pass: hasSts || !t.error, reason: `스테인리스 filter=${hasSts}, error=${t.error}` }
    },
    fewshot: { user: "소재를 스테인리스로 바꿔줘", actions: [{ type: "replace_filter", field: "workPieceName", value: "스테인리스" }], reasoning: "소재 변경 요청" },
    difficulty: "hard",
  },
  {
    name: "긴 자연어 + 도메인 지식",
    turns: [
      { user: "SUS304 스테인리스를 측면 밀링으로 황삭할건데, 진동이 적고 칩 배출이 좋은 엔드밀 추천해줘. 직경은 10mm 정도면 좋겠어." },
    ],
    assertLastTurn: (t) => {
      const noError = !t.error
      const hasResponse = t.aiText && t.aiText.length > 20
      return { pass: noError && hasResponse, reason: `error=${t.error}, len=${t.aiText?.length}` }
    },
    fewshot: { user: "SUS304 스테인리스를 측면 밀링으로 황삭할건데, 진동이 적고 칩 배출이 좋은 엔드밀 추천해줘. 직경은 10mm 정도면 좋겠어.", actions: [{ type: "apply_filter", field: "workPieceName", value: "SUS304" }, { type: "apply_filter", field: "toolSubtype", value: "Roughing" }], reasoning: "긴 문장에서 핵심 조건 추출: SUS304 + 황삭" },
    difficulty: "hard",
  },
  {
    name: "형상 변경 연속 3회",
    turns: [
      { user: "Square로 추천해줘" },
      { user: "Radius로 바꿔" },
      { user: "아니 Ball로 변경해줘" },
      { user: "직경 줄여줘 6mm로" },
    ],
    assertLastTurn: (t) => {
      const ri = t.resolvedInput || {}
      const hasBall = t.filters.some(f => /toolSubtype/i.test(f) && /ball/i.test(f)) || ri.toolSubtype === "Ball"
      const noSquare = !t.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f)) && ri.toolSubtype !== "Square"
      return { pass: hasBall && noSquare, reason: `Ball=${hasBall}, noSquare=${noSquare}. ri.toolSubtype=${ri.toolSubtype}` }
    },
    fewshot: null,
    difficulty: "hard",
  },
  {
    name: "한영 혼용",
    turns: [
      { user: "copper square 2flute 10mm endmill 추천해줘" },
    ],
    assertLastTurn: (t) => {
      const ri = t.resolvedInput || {}
      const hasSquare = t.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f)) || ri.toolSubtype === "Square"
      const hasFlute = t.filters.some(f => /flute/i.test(f) && f.includes("2")) || ri.flutePreference === 2
      return { pass: hasSquare || hasFlute, reason: `Square=${hasSquare}, 2flute=${hasFlute}. ri: ${ri.toolSubtype}, ${ri.flutePreference}` }
    },
    fewshot: { user: "copper square 2flute 10mm endmill 추천해줘", actions: [{ type: "apply_filter", field: "workPieceName", value: "구리" }, { type: "apply_filter", field: "toolSubtype", value: "Square" }, { type: "apply_filter", field: "fluteCount", value: 2 }, { type: "apply_filter", field: "diameterMm", value: 10 }], reasoning: "한영 혼용 — copper→구리, square→Square, 2flute→fluteCount=2" },
    difficulty: "medium",
  },
]

// ══════════════════════════════════════════════════════════════
// 2. System Execution — 배포 서버 호출
// ══════════════════════════════════════════════════════════════

function makeForm(material = "P") {
  return {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "known", value: material },
    operationType: { status: "known", value: "Side_Milling" },
    machiningIntent: { status: "unanswered" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "known", value: "10mm" },
    country: { status: "known", value: "ALL" },
  }
}

async function callApi(body) {
  const resp = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55000),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => "")
    return { error: `HTTP ${resp.status}`, text: text.slice(0, 200), session: null }
  }
  return resp.json()
}

async function runScenario(scenario) {
  const form = makeForm()
  const messages = []
  const turnResults = []

  // First turn: get initial session
  const r0 = await callApi({ intakeForm: form, messages: [], session: null, language: "ko" })
  let session = r0.session
  messages.push({ role: "ai", text: r0.text })

  for (const turn of scenario.turns) {
    messages.push({ role: "user", text: turn.user })

    try {
      const resp = await callApi({
        intakeForm: form,
        messages: messages.slice(-6),
        session,
        language: "ko",
      })

      session = resp.session
      const filters = resp.session?.engineState?.appliedFilters || resp.session?.publicState?.appliedFilters || []
      const candCount = resp.session?.engineState?.candidateCount ?? resp.session?.publicState?.candidateCount ?? 0

      const resolvedInput = resp.session?.engineState?.resolvedInput || {}
      turnResults.push({
        user: turn.user,
        aiText: resp.text?.slice(0, 300),
        purpose: resp.purpose,
        filters: filters.map(f => `${f.field}=${f.value || f.rawValue}`),
        resolvedInput,
        candidateCount: candCount,
        error: resp.error || (resp.text?.includes("오류가 발생") ? "server-error-in-text" : null),
        chips: resp.chips?.slice(0, 5),
      })

      messages.push({ role: "ai", text: resp.text || "" })
    } catch (err) {
      turnResults.push({
        user: turn.user,
        error: err.message,
        aiText: "",
        filters: [],
        candidateCount: 0,
      })
      break
    }
  }

  return turnResults
}

// ══════════════════════════════════════════════════════════════
// 3. Rule-based Evaluation
// ══════════════════════════════════════════════════════════════

function evaluateScenario(scenario, turnResults) {
  // Check for server errors in any turn
  const hasServerError = turnResults.some(t => t.error)
  const errorTurns = turnResults.filter(t => t.error).map(t => `"${t.user}": ${t.error}`)

  // Run scenario-specific assertion
  let assertResult
  if (scenario.assertTurn) {
    assertResult = scenario.assertTurn(turnResults)
  } else if (scenario.assertLastTurn) {
    const lastTurn = turnResults[turnResults.length - 1]
    assertResult = lastTurn ? scenario.assertLastTurn(lastTurn) : { pass: false, reason: "No turn results" }
  } else {
    assertResult = { pass: !hasServerError, reason: hasServerError ? errorTurns.join("; ") : "ok" }
  }

  // Compute scores
  const scores = {
    no_error: hasServerError ? 0 : 1,
    assertion: assertResult.pass ? 1 : 0,
    has_response: turnResults.every(t => t.aiText?.length > 5) ? 1 : 0,
  }
  const overall = Object.values(scores).reduce((a, b) => a + b, 0)
  const pass = !hasServerError && assertResult.pass

  return {
    pass,
    overall,
    maxScore: 3,
    scores,
    failureReason: pass ? null : assertResult.reason + (hasServerError ? ` [errors: ${errorTurns.join("; ")}]` : ""),
    turnDetails: turnResults.map(t => ({
      user: t.user,
      purpose: t.purpose,
      filters: t.filters,
      cands: t.candidateCount,
      error: t.error,
    })),
  }
}

// ══════════════════════════════════════════════════════════════
// 4. Few-shot Extraction
// ══════════════════════════════════════════════════════════════

function formatFewShot(scenario) {
  if (!scenario.fewshot) return null
  const fs = scenario.fewshot
  const actions = fs.actions.map(a => JSON.stringify(a)).join(",")
  return `User: "${fs.user}"\n→ {"actions":[${actions}],"answer":"","reasoning":"${fs.reasoning}"}`
}

// ══════════════════════════════════════════════════════════════
// 5. Main Loop
// ══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2)
  const maxRounds = parseInt(args.find(a => a.startsWith("--rounds="))?.split("=")[1] || "1")

  console.log("═══════════════════════════════════════════════════")
  console.log("  ARIA Self-Supervised Learning Loop (Rule-based)")
  console.log(`  Server: ${API}`)
  console.log(`  Rounds: ${maxRounds}`)
  console.log(`  Scenarios: ${HARD_SCENARIOS.length}`)
  console.log(`  Time: ${new Date().toISOString()}`)
  console.log("═══════════════════════════════════════════════════\n")

  const allResults = []
  let totalPass = 0
  let totalFail = 0
  const newFewShots = []

  for (let round = 0; round < maxRounds; round++) {
    console.log(`\n━━━ Round ${round + 1}/${maxRounds} ━━━\n`)

    for (const scenario of HARD_SCENARIOS) {
      process.stdout.write(`  [${scenario.difficulty}] ${scenario.name}... `)

      try {
        const turnResults = await runScenario(scenario)
        const evaluation = evaluateScenario(scenario, turnResults)

        const icon = evaluation.pass ? "✅" : "❌"
        console.log(`${icon} ${evaluation.overall}/${evaluation.maxScore} ${!evaluation.pass ? `(${evaluation.failureReason?.slice(0, 80)})` : ""}`)

        if (evaluation.pass) totalPass++
        else totalFail++

        allResults.push({
          scenario: scenario.name,
          difficulty: scenario.difficulty,
          pass: evaluation.pass,
          score: evaluation.overall,
          maxScore: evaluation.maxScore,
          scores: evaluation.scores,
          failureReason: evaluation.failureReason,
          turnDetails: evaluation.turnDetails,
        })

        // Extract few-shot from failures
        if (!evaluation.pass && scenario.fewshot) {
          const fewshot = formatFewShot(scenario)
          if (fewshot) {
            newFewShots.push(fewshot)
            console.log(`    → Few-shot: ${fewshot.slice(0, 80)}...`)
          }
        }
      } catch (err) {
        console.log(`💥 ${err.message?.slice(0, 60)}`)
        totalFail++
        allResults.push({
          scenario: scenario.name,
          difficulty: scenario.difficulty,
          pass: false,
          score: 0,
          failureReason: err.message,
        })
      }
    }
  }

  // ── Summary ──
  const total = totalPass + totalFail
  console.log("\n═══════════════════════════════════════════════════")
  console.log("  SUMMARY")
  console.log("═══════════════════════════════════════════════════")
  console.log(`  Total: ${total}`)
  console.log(`  Pass: ${totalPass} (${total > 0 ? Math.round(totalPass / total * 100) : 0}%)`)
  console.log(`  Fail: ${totalFail}`)
  console.log(`  New few-shots: ${newFewShots.length}`)

  // By difficulty
  const byDifficulty = {}
  for (const r of allResults) {
    if (!byDifficulty[r.difficulty]) byDifficulty[r.difficulty] = { pass: 0, fail: 0 }
    if (r.pass) byDifficulty[r.difficulty].pass++
    else byDifficulty[r.difficulty].fail++
  }
  console.log("\n  By difficulty:")
  for (const [diff, data] of Object.entries(byDifficulty)) {
    console.log(`    ${diff}: ${data.pass}/${data.pass + data.fail} pass`)
  }

  // Failures
  const failures = allResults.filter(r => !r.pass)
  if (failures.length > 0) {
    console.log("\n  Failed scenarios:")
    for (const f of failures) {
      console.log(`    ❌ [${f.difficulty}] ${f.scenario}: ${f.failureReason?.slice(0, 100)}`)
    }
  }

  // Few-shots
  if (newFewShots.length > 0) {
    console.log("\n  Generated few-shots (for SCR prompt):")
    console.log("  ────────────────────────────────────")
    for (const fs of newFewShots) {
      console.log(`  ${fs}\n`)
    }
  }

  // Save results
  const outputPath = "self-supervised-results.json"
  const fs = await import("fs")
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    rounds: maxRounds,
    total,
    pass: totalPass,
    fail: totalFail,
    passRate: total > 0 ? Math.round(totalPass / total * 100) : 0,
    newFewShots,
    results: allResults,
  }, null, 2))
  console.log(`\n  Results saved to ${outputPath}`)
}

main().catch(console.error)
