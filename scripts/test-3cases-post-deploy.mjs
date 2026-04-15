#!/usr/bin/env node
// 배포 후 3 케이스 검증
// 1) "스테인리스 10mm 4날" → 칩으로 되묻는지 (질문/칩 생성)
// 2) "구리 밀링" → CRX S 나오는지
// 3) "CE7659120 날장길이" → 답 나오는지

const BASE = "http://20.119.98.136:3000"

async function call(text, sessionId = `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`) {
  const r = await fetch(`${BASE}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", text }], sessionId }),
  })
  const status = r.status
  const json = await r.json().catch(() => ({}))
  return { status, json, sessionId }
}

function summary(resp, label) {
  const { status, json } = resp
  const recs = json?.recommendations ?? []
  const chips = json?.chips ?? json?.questions ?? []
  const msg = json?.assistantMessage ?? json?.message ?? json?.response ?? ""
  const narrowing = json?.narrowingState ?? null
  console.log(`\n━━━━━━━━ ${label} ━━━━━━━━`)
  console.log(`  status=${status}`)
  console.log(`  recs.count=${recs.length}`)
  if (recs.length > 0) {
    for (const p of recs.slice(0, 5)) {
      const b = p?.product?.brand ?? p?.brand ?? "?"
      const s = p?.product?.seriesName ?? p?.seriesName ?? "?"
      const c = p?.product?.displayCode ?? p?.displayCode ?? "?"
      const mc = p?.product?.machiningCategory ?? p?.machiningCategory ?? "(none)"
      console.log(`    · brand=${b} series=${s} code=${c} mc=${mc}`)
    }
  }
  if (chips?.length) console.log(`  chips=${JSON.stringify(chips).slice(0, 300)}`)
  if (msg) console.log(`  msg=${String(msg).slice(0, 300)}`)
  if (narrowing) console.log(`  narrowing.filters=${JSON.stringify(narrowing?.filters ?? narrowing?.appliedFilters ?? {}).slice(0, 300)}`)
}

async function main() {
  const t1 = await call("스테인리스 10mm 4날")
  summary(t1, "Test 1: 스테인리스 10mm 4날 → 칩으로 되묻는지")

  const t2 = await call("구리 밀링")
  summary(t2, "Test 2: 구리 밀링 → CRX S 나오는지")

  const t3 = await call("CE7659120 날장길이")
  summary(t3, "Test 3: CE7659120 날장길이 → 답 나오는지")
}
main().catch(e => { console.error(e); process.exit(1) })
