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
  console.log("T1 done, filters:", (es?.appliedFilters ?? []).map(f=>f.field+'='+f.value))

  msgs = add(msgs, "user", "Square")
  const r2 = await call(msgs, es); es = r2.session?.engineState; msgs = add(msgs, "ai", r2.text)
  console.log("T2 done, filters:", (es?.appliedFilters ?? []).map(f=>f.field+'='+f.value))

  msgs = add(msgs, "user", "6날")
  const r3 = await call(msgs, es); es = r3.session?.engineState; msgs = add(msgs, "ai", r3.text)
  console.log("T3 done, filters:", (es?.appliedFilters ?? []).map(f=>f.field+'='+f.value))

  msgs = add(msgs, "user", "4날로 바꿔줘")
  const r4 = await call(msgs, es)
  console.log("\n=== T4 FULL RESPONSE (key fields) ===")
  console.log("purpose:", r4.purpose)
  console.log("candidateCount:", r4.session?.publicState?.candidateCount)
  console.log("filters:", (r4.session?.engineState?.appliedFilters ?? []).map(f=>f.field+'='+f.value))
  console.log("meta.orchestratorResult:", JSON.stringify(r4.meta?.orchestratorResult ?? null, null, 2))
  console.log("text (first 200):", r4.text?.slice(0, 200))
  console.log("error:", r4.error)
  console.log("detail:", r4.detail)
}

main().catch(e => { console.error(e); process.exit(1) })
