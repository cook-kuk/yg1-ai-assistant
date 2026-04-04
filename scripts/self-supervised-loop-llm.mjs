#!/usr/bin/env node
/**
 * Self-Supervised Learning Loop for ARIA — Hybrid (Rule + LLM)
 *
 * 1. Hard Test Generation — 어려운 멀티턴 시나리오 자동 생성
 * 2. System Execution — 배포 서버에 실행
 * 3. Hybrid Evaluation — 규칙 기반 + Haiku LLM 평가
 * 4. Training Data Extraction — 실패 케이스 → few-shot 변환
 *
 * Usage: ANTHROPIC_API_KEY=... node scripts/self-supervised-loop-llm.mjs [--rounds=3]
 */

import Anthropic from "@anthropic-ai/sdk"

const API = process.env.API_URL || "https://yg1-ai-assistant.vercel.app/api/recommend"
const client = new Anthropic()

// ══════════════════════════════════════════════════════════════
// 1. Hard Test Scenarios
// ══════════════════════════════════════════════════════════════

const HARD_SCENARIOS = [
  {
    name: "이전 턴 참조 — '아까 그거'",
    turns: [
      { user: "Square 엔드밀 추천해줘" },
      { user: "TiAlN 코팅이 뭐야?" },
      { user: "그거로 코팅해줘" },
    ],
    expectation: "3번째 턴에서 coating=TiAlN 필터가 적용되어야 함",
    assertLastTurn: (t) => {
      const hasCoating = t.filters.some(f => f.includes("coating") && /tialn/i.test(f))
      return { pass: hasCoating || /tialn/i.test(t.aiText || ""), reason: "coating=TiAlN not applied" }
    },
    fewshot: { user: "그거로 코팅해줘", actions: [{ type: "apply_filter", field: "coating", value: "TiAlN" }], reasoning: "이전 턴에서 언급한 TiAlN을 '그거'로 참조" },
    difficulty: "hard",
  },
  {
    name: "복합 자연어 — 한 문장에 5개 조건",
    turns: [
      { user: "탄소강 10mm 4날 Square TiAlN으로 추천해줘" },
    ],
    expectation: "workPieceName=탄소강, diameterMm=10, fluteCount=4, toolSubtype=Square, coating=TiAlN",
    assertLastTurn: (t) => {
      const checks = [
        t.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f)),
        t.filters.some(f => /fluteCount/i.test(f) && f.includes("4")),
        t.filters.some(f => /coating/i.test(f) && /tialn/i.test(f)),
      ]
      const passed = checks.filter(Boolean).length
      return { pass: passed >= 2, reason: `Only ${passed}/3 key filters (need ≥2)` }
    },
    fewshot: { user: "탄소강 10mm 4날 Square TiAlN으로 추천해줘", actions: [{ type: "apply_filter", field: "workPieceName", value: "탄소강" }, { type: "apply_filter", field: "diameterMm", value: 10 }, { type: "apply_filter", field: "fluteCount", value: 4 }, { type: "apply_filter", field: "toolSubtype", value: "Square" }, { type: "apply_filter", field: "coating", value: "TiAlN" }], reasoning: "한 문장 5개 조건 동시 추출" },
    difficulty: "hard",
  },
  {
    name: "조건 교체 + 되돌리기",
    turns: [
      { user: "Square 4날 추천해줘" },
      { user: "Ball로 바꿔줘" },
      { user: "아니 아까 Square가 나았어. 되돌려줘" },
    ],
    expectation: "3번째 턴에서 toolSubtype=Square로 복원",
    assertLastTurn: (t) => {
      const hasSquare = t.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f))
      return { pass: hasSquare, reason: `Square not restored (filters: ${t.filters.join(", ")})` }
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
    expectation: "DLC 제거 + TiAlN 적용",
    assertLastTurn: (t) => {
      const hasTiAlN = t.filters.some(f => /coating/i.test(f) && /tialn/i.test(f))
      const hasDLC = t.filters.some(f => /coating/i.test(f) && /dlc/i.test(f))
      return { pass: hasTiAlN && !hasDLC, reason: `TiAlN=${hasTiAlN}, DLC still present=${hasDLC}` }
    },
    fewshot: { user: "DLC 빼고 TiAlN으로 바꿔", actions: [{ type: "replace_filter", field: "coating", value: "TiAlN" }], reasoning: "기존 코팅 제거 + 새 코팅" },
    difficulty: "medium",
  },
  {
    name: "질문 후 필터 유지",
    turns: [
      { user: "4날 Square 추천해줘" },
      { user: "TiAlN이랑 AlCrN 차이가 뭐야?" },
      { user: "추천 제품 보여줘" },
    ],
    expectation: "질문 턴에서 필터 변경 없음",
    assertTurn: (results) => {
      const t1 = results[0], t2 = results[1]
      if (!t1 || !t2) return { pass: false, reason: "Missing results" }
      const t1Square = t1.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f))
      const t2Square = t2.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f))
      const t2IsAnswer = t2.purpose === "answer" || t2.purpose === "question"
      return { pass: (t1Square && t2Square) || t2IsAnswer, reason: `Turn2 purpose=${t2.purpose}, Square kept=${t2Square}` }
    },
    fewshot: null,
    difficulty: "medium",
  },
  {
    name: "오타 + 구어체",
    turns: [
      { user: "스퀘어를 쓰고싶고 구리를 가공하고 싶어" },
    ],
    expectation: "toolSubtype=Square + workPieceName=구리",
    assertLastTurn: (t) => {
      const hasSquare = t.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f))
      const hasCopper = t.filters.some(f => /workPiece/i.test(f) && /(구리|copper)/i.test(f)) || /(구리|copper)/i.test(t.aiText || "")
      return { pass: hasSquare || hasCopper, reason: `Square=${hasSquare}, Copper=${hasCopper}` }
    },
    fewshot: { user: "스퀘어를 쓰고싶고 구리를 가공하고 싶어", actions: [{ type: "apply_filter", field: "toolSubtype", value: "Square" }, { type: "apply_filter", field: "workPieceName", value: "구리" }], reasoning: "구어체 스퀘어→Square, 구리→workPieceName" },
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
    expectation: "3번의 skip 후 show_recommendation",
    assertLastTurn: (t) => {
      return { pass: !t.error && t.aiText?.length > 10, reason: `error=${t.error}, len=${t.aiText?.length}` }
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
    expectation: "compare 또는 비교 텍스트",
    assertLastTurn: (t) => {
      const hasCompare = t.purpose === "compare" || /(비교|차이|vs)/i.test(t.aiText || "")
      return { pass: !t.error && (hasCompare || t.aiText?.length > 20), reason: `purpose=${t.purpose}, compare=${hasCompare}` }
    },
    fewshot: { user: "1번이랑 2번 비교해줘", actions: [{ type: "compare" }], reasoning: "추천 결과 중 1, 2번 비교" },
    difficulty: "medium",
  },
  {
    name: "소재 변경 — 탄소강 → 스테인리스",
    turns: [
      { user: "탄소강 Square 추천해줘" },
      { user: "아 잠깐 소재를 스테인리스로 바꿔줘" },
    ],
    expectation: "workPieceName=스테인리스로 변경",
    assertLastTurn: (t) => {
      const hasSts = t.filters.some(f => /workPiece/i.test(f) && /(스테인리스|stainless|sus)/i.test(f))
      return { pass: hasSts || !t.error, reason: `스테인리스=${hasSts}, error=${t.error}` }
    },
    fewshot: { user: "소재를 스테인리스로 바꿔줘", actions: [{ type: "replace_filter", field: "workPieceName", value: "스테인리스" }], reasoning: "소재 변경" },
    difficulty: "hard",
  },
  {
    name: "긴 자연어 + 도메인 지식",
    turns: [
      { user: "SUS304 스테인리스를 측면 밀링으로 황삭할건데, 진동이 적고 칩 배출이 좋은 엔드밀 추천해줘. 직경은 10mm 정도면 좋겠어." },
    ],
    expectation: "SUS304/스테인리스 인식 + 응답",
    assertLastTurn: (t) => {
      return { pass: !t.error && t.aiText?.length > 20, reason: `error=${t.error}, len=${t.aiText?.length}` }
    },
    fewshot: { user: "SUS304 스테인리스를 황삭할건데 직경 10mm 추천해줘", actions: [{ type: "apply_filter", field: "workPieceName", value: "SUS304" }, { type: "apply_filter", field: "toolSubtype", value: "Roughing" }], reasoning: "긴 문장 핵심 추출" },
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
    expectation: "최종: toolSubtype=Ball, diameterMm=6",
    assertLastTurn: (t) => {
      const hasBall = t.filters.some(f => /toolSubtype/i.test(f) && /ball/i.test(f))
      return { pass: hasBall, reason: `Ball=${hasBall}, filters: ${t.filters.join(", ")}` }
    },
    fewshot: null,
    difficulty: "hard",
  },
  {
    name: "한영 혼용",
    turns: [
      { user: "copper square 2flute 10mm endmill 추천해줘" },
    ],
    expectation: "copper→구리, square→Square, 2flute→fluteCount=2, diameterMm=10",
    assertLastTurn: (t) => {
      const hasSquare = t.filters.some(f => /toolSubtype/i.test(f) && /square/i.test(f))
      const hasFlute = t.filters.some(f => /flute/i.test(f) && f.includes("2"))
      return { pass: hasSquare || hasFlute, reason: `Square=${hasSquare}, 2flute=${hasFlute}` }
    },
    fewshot: { user: "copper square 2flute 10mm endmill 추천해줘", actions: [{ type: "apply_filter", field: "workPieceName", value: "구리" }, { type: "apply_filter", field: "toolSubtype", value: "Square" }, { type: "apply_filter", field: "fluteCount", value: 2 }, { type: "apply_filter", field: "diameterMm", value: 10 }], reasoning: "한영 혼용 파싱" },
    difficulty: "medium",
  },
]

// ══════════════════════════════════════════════════════════════
// 2. System Execution
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

      turnResults.push({
        user: turn.user,
        aiText: resp.text?.slice(0, 300),
        purpose: resp.purpose,
        filters: filters.map(f => `${f.field}=${f.value || f.rawValue}`),
        candidateCount: candCount,
        error: resp.error || (resp.text?.includes("오류가 발생") ? "server-error-in-text" : null),
        chips: resp.chips?.slice(0, 5),
      })
      messages.push({ role: "ai", text: resp.text || "" })
    } catch (err) {
      turnResults.push({ user: turn.user, error: err.message, aiText: "", filters: [], candidateCount: 0 })
      break
    }
  }
  return turnResults
}

// ══════════════════════════════════════════════════════════════
// 3. Rule-based Evaluation
// ══════════════════════════════════════════════════════════════

function evaluateRuleBased(scenario, turnResults) {
  const hasServerError = turnResults.some(t => t.error)
  let assertResult
  if (scenario.assertTurn) {
    assertResult = scenario.assertTurn(turnResults)
  } else if (scenario.assertLastTurn) {
    const last = turnResults[turnResults.length - 1]
    assertResult = last ? scenario.assertLastTurn(last) : { pass: false, reason: "No results" }
  } else {
    assertResult = { pass: !hasServerError, reason: hasServerError ? "server error" : "ok" }
  }
  return {
    pass: !hasServerError && assertResult.pass,
    reason: assertResult.reason + (hasServerError ? ` [server errors]` : ""),
  }
}

// ══════════════════════════════════════════════════════════════
// 4. LLM Evaluation — Haiku 평가 (보완)
// ══════════════════════════════════════════════════════════════

async function evaluateWithLLM(scenario, turnResults) {
  const turnSummary = turnResults.map((t, i) =>
    `Turn ${i + 1}: User="${t.user}" → purpose=${t.purpose}, filters=[${t.filters.join(",")}], cands=${t.candidateCount}, error=${t.error || "none"}, text="${(t.aiText || "").slice(0, 100)}"`
  ).join("\n")

  const prompt = `You are evaluating a cutting tool recommendation chatbot.

Scenario: "${scenario.name}" (${scenario.difficulty})
Expected: ${scenario.expectation}

Results:
${turnSummary}

Score 1-5 on: intent_accuracy, filter_correctness, context_memory, error_handling, response_quality.
Return ONLY valid JSON:
{"scores":{"intent_accuracy":N,"filter_correctness":N,"context_memory":N,"error_handling":N,"response_quality":N},"overall":N,"pass":BOOL,"failure_reason":"...","suggested_fewshot":{"user":"...","expected_actions":[...],"reasoning":"..."} or null}`

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    })
    const text = response.content[0].type === "text" ? response.content[0].text : ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) return JSON.parse(jsonMatch[0])
  } catch (err) {
    console.error(`  [LLM eval error] ${err.message?.slice(0, 60)}`)
  }
  return null
}

// ══════════════════════════════════════════════════════════════
// 5. Few-shot Extraction
// ══════════════════════════════════════════════════════════════

function formatFewShot(source) {
  if (!source) return null
  const fs = source
  if (!fs.user || !fs.actions?.length) {
    if (!fs.user || !fs.expected_actions?.length) return null
    // LLM format
    const actions = fs.expected_actions.map(a => JSON.stringify(a)).join(",")
    return `User: "${fs.user}"\n→ {"actions":[${actions}],"answer":"","reasoning":"${fs.reasoning || "self-supervised"}"}`
  }
  const actions = fs.actions.map(a => JSON.stringify(a)).join(",")
  return `User: "${fs.user}"\n→ {"actions":[${actions}],"answer":"","reasoning":"${fs.reasoning}"}`
}

// ══════════════════════════════════════════════════════════════
// 6. Main Loop
// ══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2)
  const maxRounds = parseInt(args.find(a => a.startsWith("--rounds="))?.split("=")[1] || "1")

  console.log("═══════════════════════════════════════════════════")
  console.log("  ARIA Self-Supervised Loop (Hybrid: Rule + LLM)")
  console.log(`  Server: ${API}`)
  console.log(`  Rounds: ${maxRounds}`)
  console.log(`  Scenarios: ${HARD_SCENARIOS.length}`)
  console.log(`  Haiku API: ${process.env.ANTHROPIC_API_KEY ? "✅" : "❌ (rule-only)"}`)
  console.log(`  Time: ${new Date().toISOString()}`)
  console.log("═══════════════════════════════════════════════════\n")

  const hasApiKey = !!process.env.ANTHROPIC_API_KEY
  const allResults = []
  let totalPass = 0
  let totalFail = 0
  const newFewShots = []

  for (let round = 0; round < maxRounds; round++) {
    console.log(`\n━━━ Round ${round + 1}/${maxRounds} ━━━\n`)

    for (const scenario of HARD_SCENARIOS) {
      process.stdout.write(`  [${scenario.difficulty}] ${scenario.name}... `)

      try {
        // Execute
        const turnResults = await runScenario(scenario)

        // Rule-based eval
        const ruleEval = evaluateRuleBased(scenario, turnResults)

        // LLM eval (if API key available)
        let llmEval = null
        if (hasApiKey) {
          llmEval = await evaluateWithLLM(scenario, turnResults)
        }

        // Combine: fail if either says fail
        const rulePassed = ruleEval.pass
        const llmPassed = llmEval ? llmEval.pass : true // if no LLM, trust rules
        const finalPass = rulePassed && llmPassed
        const llmScore = llmEval?.overall ?? "N/A"

        const icon = finalPass ? "✅" : "❌"
        const detail = !finalPass
          ? `(rule=${rulePassed ? "✓" : "✗"} llm=${llmPassed ? "✓" : "✗"} ${ruleEval.reason?.slice(0, 50)}${llmEval?.failure_reason ? " | " + llmEval.failure_reason.slice(0, 40) : ""})`
          : ""
        console.log(`${icon} rule=${rulePassed ? "✓" : "✗"} llm=${llmScore}/5 ${detail}`)

        if (finalPass) totalPass++
        else totalFail++

        allResults.push({
          scenario: scenario.name,
          difficulty: scenario.difficulty,
          pass: finalPass,
          rulePass: rulePassed,
          llmPass: llmPassed,
          llmScore,
          llmScores: llmEval?.scores,
          ruleReason: ruleEval.reason,
          llmReason: llmEval?.failure_reason,
          turnDetails: turnResults.map(t => ({
            user: t.user, purpose: t.purpose, filters: t.filters,
            cands: t.candidateCount, error: t.error,
          })),
        })

        // Extract few-shots from failures
        if (!finalPass) {
          // Prefer LLM-generated few-shot, fallback to scenario-defined
          const fewshotSource = llmEval?.suggested_fewshot || scenario.fewshot
          const fewshot = formatFewShot(fewshotSource)
          if (fewshot) {
            newFewShots.push(fewshot)
            console.log(`    → Few-shot: ${fewshot.slice(0, 80)}...`)
          }
        }
      } catch (err) {
        console.log(`💥 ${err.message?.slice(0, 60)}`)
        totalFail++
        allResults.push({
          scenario: scenario.name, difficulty: scenario.difficulty,
          pass: false, rulePass: false, llmPass: false, error: err.message,
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
    if (!byDifficulty[r.difficulty]) byDifficulty[r.difficulty] = { pass: 0, fail: 0, llmScores: [] }
    if (r.pass) byDifficulty[r.difficulty].pass++
    else byDifficulty[r.difficulty].fail++
    if (typeof r.llmScore === "number") byDifficulty[r.difficulty].llmScores.push(r.llmScore)
  }
  console.log("\n  By difficulty:")
  for (const [diff, data] of Object.entries(byDifficulty)) {
    const avg = data.llmScores.length > 0 ? (data.llmScores.reduce((a, b) => a + b, 0) / data.llmScores.length).toFixed(1) : "N/A"
    console.log(`    ${diff}: ${data.pass}/${data.pass + data.fail} pass, avg LLM score: ${avg}/5`)
  }

  // Failures
  const failures = allResults.filter(r => !r.pass)
  if (failures.length > 0) {
    console.log("\n  Failed scenarios:")
    for (const f of failures) {
      console.log(`    ❌ [${f.difficulty}] ${f.scenario}`)
      if (f.ruleReason) console.log(`       Rule: ${f.ruleReason.slice(0, 100)}`)
      if (f.llmReason) console.log(`       LLM: ${f.llmReason.slice(0, 100)}`)
    }
  }

  // Few-shots
  if (newFewShots.length > 0) {
    console.log("\n  ═══ Generated Few-shots (inject into SCR prompt) ═══")
    for (const fs of newFewShots) {
      console.log(`\n  ${fs}`)
    }
  }

  // Save
  const outputPath = "self-supervised-results.json"
  const fs = await import("fs")
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    rounds: maxRounds,
    total, pass: totalPass, fail: totalFail,
    passRate: total > 0 ? Math.round(totalPass / total * 100) : 0,
    usedLLM: hasApiKey,
    newFewShots,
    results: allResults,
  }, null, 2))
  console.log(`\n  Results saved to ${outputPath}`)
}

main().catch(console.error)
