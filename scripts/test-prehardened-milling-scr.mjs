#!/usr/bin/env node
// A안 검증: 초기 필터(workPieceName=Prehardened Steels, machiningCategory=Milling)가
// 걸린 상태에서 "날은 Square고 직경은 10 에 날장은 20이상" 메시지가
// clarification으로 빠지지 않고 3개 filter로 추출되는지 확인.

const BASE = process.env.BASE || "http://20.119.98.136:2999"
const SESSION_ID = `a-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function call(messages) {
  const r = await fetch(`${BASE}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, sessionId: SESSION_ID }),
  })
  const json = await r.json().catch(() => ({}))
  return { status: r.status, json }
}

function extractFilters(json) {
  // UI narrowing path: several possible shapes — try them all
  const candidates = [
    json?.sessionState?.appliedFilters,
    json?.sessionState?.filters,
    json?.session?.appliedFilters,
    json?.narrowingState?.appliedFilters,
    json?.appliedFilters,
  ].filter(x => Array.isArray(x))
  return candidates[0] ?? []
}

function inspect(resp, label) {
  const { status, json } = resp
  const recs = json?.recommendations ?? json?.products ?? []
  const chips = json?.chips ?? json?.questions ?? []
  const msg = json?.text ?? json?.assistantMessage ?? json?.message ?? json?.response ?? json?.answer ?? ""
  const filters = extractFilters(json)
  console.log(`\n━━━ ${label} ━━━`)
  console.log(`  status=${status}`)
  console.log(`  top-level keys: ${Object.keys(json ?? {}).join(", ")}`)
  console.log(`  recs.count=${recs.length}`)
  console.log(`  filters=${JSON.stringify(filters)}`)
  if (chips?.length) console.log(`  chips=${JSON.stringify(chips).slice(0, 250)}`)
  if (msg) console.log(`  msg=${String(msg).slice(0, 500)}`)
  return { filters, msg: String(msg), recs, json }
}

async function main() {
  console.log(`BASE=${BASE}`)
  console.log(`sessionId=${SESSION_ID}`)

  const t1 = await call([
    { role: "user", text: "프리하든 강 SKD12 밀링 가공합니다" },
  ])
  const r1 = inspect(t1, "Turn 1: 초기 셋팅 (프리하든강 + 밀링)")

  // dump narrowingState shape once
  if (r1.json?.sessionState) {
    console.log("  T1 sessionState:", JSON.stringify(r1.json.sessionState, null, 2).slice(0, 1500))
  }

  const t2 = await call([
    { role: "user", text: "프리하든 강 SKD12 밀링 가공합니다" },
    { role: "ai", text: r1.msg || "(prev)" },
    { role: "user", text: "날은 Square고 직경은 10 에 날장은 20이상" },
  ])
  const r2 = inspect(t2, "Turn 2: 날 Square + 직경 10 + 날장 20이상 (A안 검증)")

  console.log("\n━━━ 판정 ━━━")
  const hasSquare = r2.filters.some(f => f.field === "toolSubtype" && /square/i.test(String(f.value)))
  const hasDiameter = r2.filters.some(f => f.field === "diameterMm" && Number(f.value) === 10)
  const hasLoc = r2.filters.some(f => f.field === "lengthOfCutMm" && f.op === "gte" && Number(f.value) === 20)
  const isClarification = /수정할지|새 추천으로|다시 시작할지/.test(r2.msg)
  console.log(`  toolSubtype=Square: ${hasSquare ? "✅" : "❌"}`)
  console.log(`  diameterMm=10:      ${hasDiameter ? "✅" : "❌"}`)
  console.log(`  lengthOfCutMm>=20:  ${hasLoc ? "✅" : "❌"}`)
  console.log(`  clarification 회피: ${!isClarification ? "✅" : "❌ (여전히 clarification 분기)"}`)
  const pass = hasSquare && hasDiameter && hasLoc && !isClarification
  console.log(`\n  RESULT: ${pass ? "✅ PASS" : "❌ FAIL"}`)
  process.exit(pass ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(2) })
