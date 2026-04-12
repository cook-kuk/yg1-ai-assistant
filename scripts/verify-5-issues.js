#!/usr/bin/env node
/* Verify the 5 fixes from commit 5668777 against deployed API */
const API = process.env.API || "http://20.119.98.136:3000/api/recommend"

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

async function call(label, form, messages, prevState = null, timeoutMs = 60000) {
  const body = { engine: "serve", intakeForm: form, messages, sessionState: prevState, displayedProducts: null, language: "ko" }
  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal })
    const elapsed = Date.now() - started
    const text = await res.text()
    let j
    try { j = JSON.parse(text) } catch { j = { _raw: text.slice(0, 400) } }
    const es = j?.session?.engineState || j?.sessionState || null
    return { ok: res.ok, status: res.status, elapsed, body: j, state: es, text: j?.text || "", purpose: j?.purpose || "" }
  } catch (e) {
    return { ok: false, status: 0, elapsed: Date.now() - started, error: String(e) }
  } finally {
    clearTimeout(timer)
  }
}

function fmtFilters(state) {
  const f = state?.appliedFilters || []
  return f.map(x => `${x.field}=${JSON.stringify(x.value)}${x.op && x.op !== "eq" ? "[" + x.op + "]" : ""}`).join(", ") || "(none)"
}

function getFilter(state, field) {
  return (state?.appliedFilters || []).find(f => f.field === field && f.op !== "skip")
}

async function runTurns(label, form, turns) {
  let messages = []
  let state = null
  let last
  for (const t of turns) {
    messages = [...messages, { role: "user", text: t }]
    last = await call(label, form, messages, state)
    if (!last.ok) { console.log(`  [${label}] HTTP ${last.status} at turn "${t}": ${JSON.stringify(last.body).slice(0, 200)}`); return last }
    if (last.text) messages = [...messages, { role: "ai", text: last.text }]
    state = last.state
  }
  return last
}

async function issue1_coating() {
  console.log("\n=== 1. 코팅 변경 (TiAlN → AlCrN으로 추천해줘) ===")
  const form = makeForm({ toolTypeOrCurrentProduct: { status: "known", value: "Milling" }, material: { status: "known", value: "P" } })
  const r = await runTurns("coating", form, [
    "탄소강 10mm 엔드밀 추천",
    "TiAlN 코팅으로",
    "아 취소하고 AlCrN으로 추천해줘",
  ])
  if (!r.ok) return false
  console.log(`  elapsed=${r.elapsed}ms  filters: ${fmtFilters(r.state)}`)
  const c = getFilter(r.state, "coating")
  const val = JSON.stringify(c?.value ?? "")
  const pass = /AlCrN/i.test(val) && !/TiAlN/i.test(val)
  console.log(`  coating=${val}  ${pass ? "PASS" : "FAIL"}`)
  return pass
}

async function issue2_sus316l() {
  console.log("\n=== 2. SUS316L 괜찮은 거? → 추천 라우팅 ===")
  const form = makeForm({ toolTypeOrCurrentProduct: { status: "known", value: "Milling" } })
  const r = await runTurns("sus316l", form, [
    "엔드밀 추천해주세요",
    "SUS316L 많이 하는데 괜찮은 거?",
  ])
  if (!r.ok) return false
  console.log(`  elapsed=${r.elapsed}ms  purpose=${r.purpose}`)
  console.log(`  filters: ${fmtFilters(r.state)}`)
  console.log(`  reply: ${r.text.slice(0, 200)}`)
  const wp = getFilter(r.state, "workPieceName")
  const wpStr = JSON.stringify(wp?.value ?? "")
  const hasStainless = /Stainless|SUS|316/i.test(wpStr)
  const notGK = !/본사\s*문의|답변\s*드리기\s*어렵|일반\s*지식/i.test(r.text)
  const notEmptyCandidates = (r.state?.candidateCount ?? 0) > 0 || r.purpose === "recommend"
  const pass = hasStainless && notGK
  console.log(`  stainless=${hasStainless} notGK=${notGK} hasCandidates=${notEmptyCandidates}  ${pass ? "PASS" : "FAIL"}`)
  return pass
}

async function issue3_reset() {
  console.log("\n=== 3. 초기화(처음부터) → 필터 리셋 ===")
  const form = makeForm({ toolTypeOrCurrentProduct: { status: "known", value: "Milling" }, material: { status: "known", value: "P" }, diameterInfo: { status: "known", value: "10mm" } })
  const r = await runTurns("reset", form, [
    "탄소강 10mm 엔드밀 추천",
    "처음부터",
    "알루미늄 3날 8mm",
  ])
  if (!r.ok) return false
  console.log(`  elapsed=${r.elapsed}ms  filters: ${fmtFilters(r.state)}`)
  const dia = getFilter(r.state, "diameterMm")
  const wp = getFilter(r.state, "workPieceName")
  const flutes = getFilter(r.state, "numberOfFlutes") || getFilter(r.state, "flutes")
  const wpStr = JSON.stringify(wp?.value ?? "")
  const diaVal = dia?.value
  const diaNum = typeof diaVal === "object" ? (diaVal.eq ?? diaVal.min ?? diaVal.max) : diaVal
  const carbonGone = !/Carbon/i.test(wpStr)
  const dia10Gone = diaNum !== 10
  const hasAlu = /Aluminum|Alu|알루미늄|알미늄/i.test(wpStr)
  const pass = carbonGone && dia10Gone && hasAlu
  console.log(`  carbon gone=${carbonGone} dia≠10=${dia10Gone} hasAlu=${hasAlu}  ${pass ? "PASS" : "FAIL"}`)
  return pass
}

async function issue4_fields() {
  console.log("\n=== 4. TaperAngle / CornerRadius / HSK shank / 비틀림각 ===")
  const cases = [
    { tag: "taper", text: "테이퍼 5도 엔드밀 추천", field: "taperAngleDeg", expect: 5 },
    { tag: "corner", text: "코너R 0.5 엔드밀 추천", field: "cornerRadiusMm", expect: 0.5 },
    { tag: "hsk", text: "HSK 생크 엔드밀 추천", field: "shankType", expect: "HSK" },
    { tag: "helix", text: "비틀림각 45도 엔드밀 추천", field: "helixAngleDeg", expect: 45 },
  ]
  const form = makeForm({ toolTypeOrCurrentProduct: { status: "known", value: "Milling" } })
  const results = []
  for (const c of cases) {
    const r = await runTurns(`field-${c.tag}`, form, [c.text])
    if (!r.ok) { console.log(`  [${c.tag}] HTTP error`); results.push(false); continue }
    const f = getFilter(r.state, c.field)
    const val = f?.value
    const matched = JSON.stringify(val ?? "").toLowerCase().includes(String(c.expect).toLowerCase())
    console.log(`  [${c.tag}] "${c.text}" → ${c.field}=${JSON.stringify(val)}  ${matched ? "PASS" : "FAIL"}`)
    results.push(matched)
  }
  return results.every(Boolean)
}

async function issue5_timeout() {
  console.log("\n=== 5. 스트레스 timeout (복합 필터 30초 내) ===")
  const form = makeForm({ toolTypeOrCurrentProduct: { status: "known", value: "Milling" } })
  const r = await runTurns("stress", form, [
    "탄소강 10mm 4날 AlCrN 코팅 초경 엔드밀 헬릭스 45도 긴거 쓰루쿨런트 추천해줘 재고 있는걸로",
  ])
  console.log(`  elapsed=${r.elapsed}ms  status=${r.status}`)
  console.log(`  filters: ${fmtFilters(r.state)}`)
  const pass = r.ok && r.elapsed < 30000
  console.log(`  ${pass ? "PASS" : "FAIL"} (under 30s)`)
  return pass
}

;(async () => {
  const results = {}
  results["1.coating"] = await issue1_coating()
  results["2.sus316l"] = await issue2_sus316l()
  results["3.reset"] = await issue3_reset()
  results["4.fields"] = await issue4_fields()
  results["5.timeout"] = await issue5_timeout()
  console.log("\n=== SUMMARY ===")
  for (const [k, v] of Object.entries(results)) console.log(`  ${v ? "PASS" : "FAIL"}  ${k}`)
  process.exit(Object.values(results).every(Boolean) ? 0 : 1)
})()
