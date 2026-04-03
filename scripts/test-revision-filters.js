#!/usr/bin/env node
/**
 * "4날로 바꿔줘" revision 후 appliedFilters 검증
 */
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
    body: JSON.stringify({
      intakeForm: makeForm(),
      messages: msgs,
      session: { publicState: null, engineState },
      language: "ko",
    }),
  })
  return res.json()
}

function addMsg(msgs, role, text) {
  return [...msgs, { role, text }]
}

async function main() {
  let msgs = []
  let es = null

  // Turn 1
  msgs = addMsg(msgs, "user", "엔드밀 추천해주세요")
  const r1 = await call(msgs, es)
  es = r1.session?.engineState ?? null
  const f1 = r1.session?.publicState?.appliedFilters?.map(f => `${f.field}=${f.value}`) ?? []
  console.log(`T1: candidateCount=${r1.session?.publicState?.candidateCount}, filters=[${f1}]`)
  msgs = addMsg(msgs, "ai", r1.text)

  // Turn 2: Square
  msgs = addMsg(msgs, "user", "Square")
  const r2 = await call(msgs, es)
  es = r2.session?.engineState ?? null
  const f2 = r2.session?.publicState?.appliedFilters?.map(f => `${f.field}=${f.value}`) ?? []
  console.log(`T2: candidateCount=${r2.session?.publicState?.candidateCount}, filters=[${f2}]`)
  msgs = addMsg(msgs, "ai", r2.text)

  // Turn 3: 6날
  msgs = addMsg(msgs, "user", "6날")
  const r3 = await call(msgs, es)
  es = r3.session?.engineState ?? null
  const f3 = r3.session?.publicState?.appliedFilters?.map(f => `${f.field}=${f.value}`) ?? []
  console.log(`T3: candidateCount=${r3.session?.publicState?.candidateCount}, filters=[${f3}]`)
  msgs = addMsg(msgs, "ai", r3.text)

  // Turn 4: "4날로 바꿔줘"
  msgs = addMsg(msgs, "user", "4날로 바꿔줘")
  const r4 = await call(msgs, es)
  es = r4.session?.engineState ?? null
  const f4 = r4.session?.publicState?.appliedFilters?.map(f => `${f.field}=${f.value}`) ?? []
  const cc4 = r4.session?.publicState?.candidateCount
  console.log(`T4: candidateCount=${cc4}, filters=[${f4}]`)

  // Validation
  const has4flute = f4.some(f => f.includes("fluteCount") && f.includes("4"))
  const has6flute = f4.some(f => f.includes("fluteCount") && f.includes("6"))

  if (has4flute && !has6flute) {
    console.log("\n✅ PASS — 4날 필터로 정상 교체됨")
  } else if (has6flute) {
    console.log("\n❌ FAIL — 6날 필터가 아직 남아있음")
  } else {
    console.log(`\n⚠️  날수 필터 상태 확인 필요: [${f4}]`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
