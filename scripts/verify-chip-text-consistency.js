#!/usr/bin/env node
/**
 * 칩 숫자 vs 텍스트 숫자 일관성 검증 스크립트
 * 5개 시나리오: 2턴씩 — 첫 턴(조건) → 둘째 턴(칩 클릭) → 텍스트에 나온 숫자가 칩과 일치하는지 확인
 */

const API = "https://yg1-ai-assistant.vercel.app/api/recommend"

async function call(intakeForm, messages, engineState) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intakeForm,
      messages,
      session: { publicState: null, engineState },
      language: "ko",
    }),
  })
  return res.json()
}

function makeForm(overrides = {}) {
  return {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "unanswered" },
    operationType: { status: "unanswered" },
    machiningIntent: { status: "unanswered" },
    toolTypeOrCurrentProduct: { status: "unanswered" },
    diameterInfo: { status: "unanswered" },
    country: { status: "unanswered" },
    ...overrides,
  }
}

// 텍스트에서 "N개", "N,NNN개", "약 N개" 패턴 추출
function extractNumbersFromText(text) {
  const matches = []
  // "약 860개", "1,722개", "650개" 등
  const regex = /약?\s*(\d[\d,]*)\s*개/g
  let m
  while ((m = regex.exec(text)) !== null) {
    matches.push({ raw: m[0], num: parseInt(m[1].replace(/,/g, "")) })
  }
  return matches
}

// 칩에서 "(N개)" 패턴 추출
function extractChipCounts(chips) {
  const counts = []
  for (const chip of chips) {
    const m = chip.match(/\((\d[\d,]*)\s*개\)/)
    if (m) counts.push({ chip, num: parseInt(m[1].replace(/,/g, "")) })
  }
  return counts
}

const scenarios = [
  {
    name: "탄소강 10mm Milling → Square 클릭 후 날수 질문",
    form: makeForm({
      material: { status: "known", value: "P" },
      toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
      diameterInfo: { status: "known", value: "10mm" },
    }),
    turn1: "엔드밀 추천해주세요",
    turn2: "Square",
  },
  {
    name: "스테인리스 Milling → Square 클릭 후 날수 질문",
    form: makeForm({
      material: { status: "known", value: "M" },
      toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    }),
    turn1: "스테인리스 엔드밀 추천해주세요",
    turn2: "Square",
  },
  {
    name: "알루미늄 8mm Milling → Ball 클릭 후 날수 질문",
    form: makeForm({
      material: { status: "known", value: "N" },
      toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
      diameterInfo: { status: "known", value: "8mm" },
    }),
    turn1: "알루미늄 엔드밀 추천해주세요",
    turn2: "Ball",
  },
  {
    name: "탄소강 Milling → Square → 4날 클릭 후 코팅 질문",
    form: makeForm({
      material: { status: "known", value: "P" },
      toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
      diameterInfo: { status: "known", value: "10mm" },
    }),
    turn1: "엔드밀 추천해주세요",
    turn2: "Square",
    turn3: "4날",
  },
  {
    name: "주철 12mm Milling → toolSubtype 질문에서 숫자 확인",
    form: makeForm({
      material: { status: "known", value: "K" },
      toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
      diameterInfo: { status: "known", value: "12mm" },
    }),
    turn1: "주철 12mm 엔드밀 추천해주세요",
    turn2: "Square",
  },
]

async function runScenario(scenario) {
  const msgs = [{ role: "user", text: scenario.turn1 }]

  // Turn 1
  const r1 = await call(scenario.form, msgs, null)
  const es1 = r1.session?.engineState ?? null
  msgs.push({ role: "ai", text: r1.text })

  // Turn 2
  msgs.push({ role: "user", text: scenario.turn2 })
  const r2 = await call(scenario.form, msgs, es1)
  const es2 = r2.session?.engineState ?? null
  msgs.push({ role: "ai", text: r2.text })

  let finalResp = r2

  // Turn 3 (if exists)
  if (scenario.turn3) {
    msgs.push({ role: "user", text: scenario.turn3 })
    const r3 = await call(scenario.form, msgs, es2)
    msgs.push({ role: "ai", text: r3.text })
    finalResp = r3
  }

  // Check consistency
  const textNums = extractNumbersFromText(finalResp.text)
  const chipCounts = extractChipCounts(finalResp.chips ?? [])
  const totalCandidate = finalResp.session?.publicState?.candidateCount ?? 0

  // Build set of valid numbers: chip counts + totalCandidate
  const validNums = new Set(chipCounts.map(c => c.num))
  validNums.add(totalCandidate)

  // Check each number in text
  const issues = []
  for (const tn of textNums) {
    if (!validNums.has(tn)) {
      // Allow ±5% tolerance for rounding ("약")
      const closeEnough = [...validNums].some(v => Math.abs(v - tn.num) / Math.max(v, 1) < 0.05)
      if (!closeEnough) {
        issues.push(`텍스트 "${tn.raw}" → ${tn.num} — 칩/후보에 없는 숫자`)
      }
    }
  }

  return { scenario: scenario.name, text: finalResp.text, chips: finalResp.chips, chipCounts, textNums, totalCandidate, issues }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════")
  console.log("  칩-텍스트 숫자 일관성 검증 (5 시나리오)")
  console.log("═══════════════════════════════════════════════════════════\n")

  let passCount = 0
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i]
    console.log(`[${i + 1}/5] ${s.name}`)
    try {
      const result = await runScenario(s)

      console.log(`  후보: ${result.totalCandidate}개`)
      console.log(`  칩 숫자: ${result.chipCounts.map(c => `${c.chip}`).join(", ") || "없음"}`)
      console.log(`  텍스트 숫자: ${result.textNums.map(t => t.raw).join(", ") || "없음"}`)

      if (result.issues.length === 0) {
        console.log(`  ✅ PASS — 텍스트 숫자가 칩/후보와 일치\n`)
        passCount++
      } else {
        console.log(`  ❌ FAIL:`)
        for (const issue of result.issues) console.log(`    - ${issue}`)
        console.log(`  텍스트: ${result.text.slice(0, 300)}`)
        console.log()
      }
    } catch (err) {
      console.log(`  ❌ ERROR: ${err.message}\n`)
    }
  }

  console.log("═══════════════════════════════════════════════════════════")
  console.log(`  결과: ${passCount}/5 통과`)
  console.log("═══════════════════════════════════════════════════════════")
  process.exit(passCount === 5 ? 0 : 1)
}

main()
