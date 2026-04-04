#!/usr/bin/env node
/**
 * CRX-S 구리 E2E 테스트 - 배포 서버 대상
 * 올바른 세션 포맷으로 멀티턴 + 20개 변주 테스트
 */

const API = "http://20.119.98.136:3000/api/recommend"

async function callApi(body) {
  const resp = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55000),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

function makeIntakeForm(material = "N", diameter = "10mm") {
  return {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "known", value: material },
    operationType: { status: "known", value: "Side_Milling" },
    machiningIntent: { status: "unanswered" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "known", value: diameter },
    country: { status: "known", value: "ALL" },
  }
}

function checkCRXS(candidates, label) {
  const top5 = candidates.slice(0, 5)
  const crxsInTop5 = top5.filter(c => (c.seriesName || "").toUpperCase().includes("CRX"))
  const crxsAll = candidates.filter(c => (c.seriesName || "").toUpperCase().includes("CRX"))

  if (crxsInTop5.length > 0) {
    crxsInTop5.forEach(c => {
      const idx = candidates.indexOf(c)
      console.log(`    ✅ #${idx+1}: ${c.seriesName} ${c.displayCode} D${c.diameterMm} mat:${c.materialRatingScore}`)
    })
    return "pass"
  }
  console.log(`    ❌ [${label}] CRX-S not in top5. Total CRX-S: ${crxsAll.length}/${candidates.length}`)
  top5.forEach((c, i) => {
    console.log(`    #${i+1}: ${c.seriesName} ${c.displayCode} D${c.diameterMm} score:${c.totalScore} mat:${c.materialRatingScore}`)
  })
  return crxsAll.length > 0 ? "low_rank" : "absent"
}

// ── Test: Multi-turn flow ──
async function testMultiTurn() {
  console.log("\n=== Multi-turn: N+10mm → 2날 → Square → 추천 ===")

  // Turn 1: Initial
  const r1 = await callApi({
    intakeForm: makeIntakeForm("N", "10mm"),
    messages: [],
    session: null,
    language: "ko",
  })
  console.log(`T1: ${r1.purpose} candCount=${r1.session?.publicState?.candidateCount}`)

  // Turn 2: 2날 - pass full session object
  const r2 = await callApi({
    intakeForm: makeIntakeForm("N", "10mm"),
    messages: [{ role: "ai", text: r1.text }, { role: "user", text: "2날" }],
    session: r1.session,
    language: "ko",
  })
  console.log(`T2: ${r2.purpose} candCount=${r2.session?.publicState?.candidateCount} text=${r2.text?.slice(0,80)}`)

  // Turn 3: Square
  const r3 = await callApi({
    intakeForm: makeIntakeForm("N", "10mm"),
    messages: [
      { role: "ai", text: r1.text }, { role: "user", text: "2날" },
      { role: "ai", text: r2.text }, { role: "user", text: "Square" },
    ],
    session: r2.session,
    language: "ko",
  })
  console.log(`T3: ${r3.purpose} candCount=${r3.session?.publicState?.candidateCount} text=${r3.text?.slice(0,80)}`)

  // If still questioning, request "지금 바로 제품 보기"
  if (!r3.candidateSnapshot?.candidates && r3.purpose !== "recommendation") {
    const r4 = await callApi({
      intakeForm: makeIntakeForm("N", "10mm"),
      messages: [
        { role: "ai", text: r1.text }, { role: "user", text: "2날" },
        { role: "ai", text: r2.text }, { role: "user", text: "Square" },
        { role: "ai", text: r3.text }, { role: "user", text: "지금 바로 제품 보기" },
      ],
      session: r3.session,
      language: "ko",
    })
    console.log(`T4: ${r4.purpose} candCount=${r4.session?.publicState?.candidateCount}`)
    const cands = r4.candidateSnapshot?.candidates || r4.candidates || []
    if (cands.length > 0) return checkCRXS(cands, "multi-t4")
    console.log("  ❌ No candidates at T4")
    return "fail"
  }

  const cands = r3.candidateSnapshot?.candidates || r3.candidates || []
  if (cands.length > 0) return checkCRXS(cands, "multi-t3")
  console.log("  ❌ No candidates at T3")
  return "fail"
}

// ── Test: Single message with all specs ──
async function testSingleMessage(msg, label) {
  // First get a session
  const r1 = await callApi({
    intakeForm: makeIntakeForm("N", "10mm"),
    messages: [],
    session: null,
    language: "ko",
  })

  // Send the natural language message as follow-up
  const r2 = await callApi({
    intakeForm: makeIntakeForm("N", "10mm"),
    messages: [{ role: "ai", text: r1.text }, { role: "user", text: msg }],
    session: r1.session,
    language: "ko",
  })

  const filters = r2.session?.publicState?.appliedFilters || []
  const candCount = r2.session?.publicState?.candidateCount ?? 0
  const cands = r2.candidateSnapshot?.candidates || []

  if (r2.error === "internal_error") {
    console.log(`  💥 [${label}] Server error: ${r2.text?.slice(0,60)}`)
    return "error"
  }

  if (cands.length > 0) {
    return checkCRXS(cands, label)
  }

  // Check if filters were applied (even without candidate list)
  const filterStr = filters.map(f => `${f.field}=${f.value}`).join(", ")
  console.log(`  ⚠️ [${label}] ${r2.purpose} filters=[${filterStr}] cands=${candCount} text=${r2.text?.slice(0,60)}`)
  return filters.length > 0 ? "filtered_no_result" : "no_parse"
}

// ── 20 copper variations ──
async function testCopperVariations() {
  console.log("\n=== 20 Copper Variations ===")
  const variations = [
    "피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘",
    "구리 스퀘어 2날 10mm",
    "구리 가공용 평날 2날 직경 10",
    "copper square 2flute 10mm",
    "Cu 소재 스퀘어 2날 10파이",
    "구리 전용 엔드밀 10mm 2날",
    "비철금속 구리 10mm 2날 Square",
    "동 가공용 엔드밀 10mm",
    "구리합금 스퀘어 2날 10밀리",
    "N소재 구리 Square 2F 10",
    "구리 평날 두날 열미리",
    "red copper 10mm 2 flute square",
    "피삭재 구리 10mm 이날 사각",
    "Cu material square endmill D10 2flute",
    "동 소재 평엔드밀 2날 10mm",
    "구리용 2날 스퀘어 D10",
    "구리 절삭용 10mm 두날",
    "비철 구리 Square 2날 Ø10",
    "구리 가공 엔드밀 추천 10mm 2날 평날",
    "copper cutting 2flute flat 10mm",
  ]

  const results = { pass: 0, low_rank: 0, filtered_no_result: 0, no_parse: 0, error: 0, fail: 0 }

  for (let i = 0; i < variations.length; i++) {
    const v = variations[i]
    process.stdout.write(`#${i+1}/${variations.length} "${v.slice(0,35)}..." → `)
    try {
      const r = await testSingleMessage(v, `v${i+1}`)
      results[r] = (results[r] || 0) + 1
      if (r === "pass") console.log("") // newline after checkCRXS output
    } catch (err) {
      console.log(`💥 ${err.message}`)
      results.error++
    }
  }

  console.log("\n--- Variation Results ---")
  console.log(JSON.stringify(results, null, 2))
  return results
}

// ── Diameter variations ──
async function testDiameterVariations() {
  console.log("\n=== Diameter Variations (구리 Square 2날 + D変) ===")
  const diameters = ["4mm", "6mm", "8mm", "12mm"]
  for (const d of diameters) {
    process.stdout.write(`D${d}: `)
    try {
      const r = await testSingleMessage(`구리 Square 2날 ${d}`, `D${d}`)
      console.log("")
    } catch (err) {
      console.log(`💥 ${err.message}`)
    }
  }
}

// ── Material-only ──
async function testMaterialOnly() {
  console.log("\n=== Material-only tests ===")
  const tests = ["구리 엔드밀 추천해줘", "동 가공용 추천"]
  for (const t of tests) {
    process.stdout.write(`"${t}" → `)
    try {
      // Use unanswered material to test if LLM picks up copper from message
      const r1 = await callApi({
        intakeForm: {
          inquiryPurpose: { status: "known", value: "new" },
          material: { status: "unanswered" },
          operationType: { status: "unanswered" },
          machiningIntent: { status: "unanswered" },
          toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
          diameterInfo: { status: "unanswered" },
          country: { status: "known", value: "ALL" },
        },
        messages: [],
        session: null,
        language: "ko",
      })
      const r2 = await callApi({
        intakeForm: {
          inquiryPurpose: { status: "known", value: "new" },
          material: { status: "unanswered" },
          operationType: { status: "unanswered" },
          machiningIntent: { status: "unanswered" },
          toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
          diameterInfo: { status: "unanswered" },
          country: { status: "known", value: "ALL" },
        },
        messages: [{ role: "ai", text: r1.text }, { role: "user", text: t }],
        session: r1.session,
        language: "ko",
      })
      const filters = r2.session?.publicState?.appliedFilters || []
      console.log(`${r2.purpose} filters=${filters.map(f=>`${f.field}=${f.value}`).join(",")} cands=${r2.session?.publicState?.candidateCount}`)
    } catch (err) {
      console.log(`💥 ${err.message}`)
    }
  }
}

// ── Main ──
async function main() {
  console.log("=== CRX-S Copper E2E Test Suite v2 ===")
  console.log(`Server: ${API}`)
  console.log(`Time: ${new Date().toISOString()}\n`)

  const multiTurn = await testMultiTurn()
  await testMaterialOnly()
  await testDiameterVariations()
  const variations = await testCopperVariations()

  console.log("\n========== SUMMARY ==========")
  console.log(`Multi-turn: ${multiTurn}`)
  console.log(`Variations: ${JSON.stringify(variations)}`)
  const total = Object.values(variations).reduce((a, b) => a + b, 0)
  console.log(`Pass rate: ${variations.pass}/${total} (${Math.round(variations.pass/total*100)}%)`)
}

main().catch(console.error)
