#!/usr/bin/env node
/**
 * Local test: "4날로 바꿔줘" revision - with server console logs
 */
const API = "http://localhost:3334/api/recommend"

function makeForm() {
  return {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "unanswered" },
    operationType: { status: "unanswered" },
    machiningIntent: { status: "unanswered" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "known", value: "10mm" },
    country: { status: "unanswered" },
  }
}

async function call(msgs, engineState) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intakeForm: makeForm(),
      messages: msgs,
      session: { publicState: null, engineState },
      language: "ko",
    }),
  })
  return res.json()
}

function addMsg(msgs, role, text) { return [...msgs, { role, text }] }

async function main() {
  let msgs = [], es = null

  console.log("=== T1: 초기 요청 ===")
  msgs = addMsg(msgs, "user", "엔드밀 추천해주세요")
  const r1 = await call(msgs, es)
  es = r1.session?.engineState ?? null
  console.log(`  filters: [${(r1.session?.engineState?.appliedFilters ?? []).map(f => f.field+'='+f.value)}]`)
  msgs = addMsg(msgs, "ai", r1.text)

  console.log("=== T2: Square ===")
  msgs = addMsg(msgs, "user", "Square")
  const r2 = await call(msgs, es)
  es = r2.session?.engineState ?? null
  console.log(`  filters: [${(r2.session?.engineState?.appliedFilters ?? []).map(f => f.field+'='+f.value)}]`)
  msgs = addMsg(msgs, "ai", r2.text)

  console.log("=== T3: 6날 ===")
  msgs = addMsg(msgs, "user", "6날")
  const r3 = await call(msgs, es)
  es = r3.session?.engineState ?? null
  console.log(`  filters: [${(r3.session?.engineState?.appliedFilters ?? []).map(f => f.field+'='+f.value)}]`)
  msgs = addMsg(msgs, "ai", r3.text)

  console.log("=== T4: 4날로 바꿔줘 ===")
  msgs = addMsg(msgs, "user", "4날로 바꿔줘")
  const r4 = await call(msgs, es)
  const f4 = (r4.session?.engineState?.appliedFilters ?? []).map(f => f.field+'='+f.value)
  console.log(`  filters: [${f4}]`)
  console.log(`  candidateCount: ${r4.session?.publicState?.candidateCount}`)

  const has4 = f4.some(f => f.includes("fluteCount") && f.includes("4"))
  console.log(has4 ? "\n✅ PASS" : "\n❌ FAIL — 4날 필터 없음")
}

main().catch(e => { console.error(e); process.exit(1) })
