#!/usr/bin/env node
const API = "https://yg1-ai-assistant.vercel.app/api/recommend"

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
    body: JSON.stringify({ intakeForm: makeForm(), messages: msgs, session: { publicState: null, engineState }, language: "ko" }),
  })
  return res.json()
}

function add(msgs, role, text) { return [...msgs, { role, text }] }

async function main() {
  let msgs = [], es = null

  msgs = add(msgs, "user", "엔드밀 추천해주세요")
  const r1 = await call(msgs, es); es = r1.session?.engineState; msgs = add(msgs, "ai", r1.text)

  msgs = add(msgs, "user", "Square")
  const r2 = await call(msgs, es); es = r2.session?.engineState; msgs = add(msgs, "ai", r2.text)
  const f2 = (es?.appliedFilters ?? []).map(f => f.field+'='+f.value)
  console.log("After Square:", f2)

  msgs = add(msgs, "user", "Ball로 바꿔줘")
  const r3 = await call(msgs, es)
  const f3 = (r3.session?.engineState?.appliedFilters ?? []).map(f => f.field+'='+f.value)
  console.log("After 'Ball로 바꿔줘':", f3)

  const hasBall = f3.some(f => f.includes("toolSubtype") && f.includes("Ball"))
  const hasSquare = f3.some(f => f.includes("toolSubtype") && f.includes("Square"))

  if (hasBall && !hasSquare) console.log("\n✅ PASS — Ball로 정상 교체")
  else if (hasSquare) console.log("\n❌ FAIL — Square 필터가 아직 남음")
  else console.log(`\n⚠️ 확인 필요: [${f3}]`)
}

main().catch(e => { console.error(e); process.exit(1) })
