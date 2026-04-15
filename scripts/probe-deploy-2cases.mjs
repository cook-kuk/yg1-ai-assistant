#!/usr/bin/env node
/**
 * 배포 서버 :3000 (company/main) 2 시나리오 probe
 *   1) "구리 브랜드 뭐가 있어?"  → explain 분류, brand 필터 X, 텍스트만
 *   2) "CE7659120 날장길이 얼마?" → purpose=question, 카드 X, "55mm" 텍스트
 *
 * 사용법: node scripts/probe-deploy-2cases.mjs [host]
 *   기본: 20.119.98.136:3000
 */

const HOST = process.argv[2] ?? "20.119.98.136:3000"
const BASE = HOST.startsWith("http") ? HOST : `http://${HOST}`
const URL = `${BASE}/api/recommend`

async function probe(label, message, extra = {}) {
  const body = {
    messages: [{ role: "user", text: message }],
    form: {},
    prevState: null,
    displayedProducts: null,
    language: "ko",
    ...extra,
  }
  const started = Date.now()
  let res, json, text
  try {
    res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    text = await res.text()
    try { json = JSON.parse(text) } catch { json = null }
  } catch (err) {
    console.log(`❌ [${label}] fetch failed: ${err.message}`)
    return null
  }
  const elapsed = Date.now() - started
  console.log(`\n━━━━━━━ ${label} (${elapsed}ms, HTTP ${res.status}) ━━━━━━━`)
  console.log(`Q: ${message}`)
  if (!json) {
    console.log("raw response (not JSON):", text.slice(0, 600))
    return null
  }
  console.log(`purpose     : ${json.purpose ?? "(none)"}`)
  console.log(`text        : ${(json.text ?? "").slice(0, 300).replace(/\n/g, " / ")}`)
  console.log(`chips       : ${JSON.stringify(json.chips ?? null)}`)
  const appliedFilters = json.sessionState?.appliedFilters ?? []
  console.log(`appliedFilters (${appliedFilters.length}):`)
  for (const f of appliedFilters) {
    console.log(`   · ${f.field} ${f.op} ${JSON.stringify(f.rawValue ?? f.value)}`)
  }
  const rec = json.recommendation
  const hasCards = !!(rec && (rec.primary || (Array.isArray(rec.alternates) && rec.alternates.length > 0)))
  console.log(`has cards   : ${hasCards} (primary=${rec?.primary?.productCode ?? "null"}, alts=${rec?.alternates?.length ?? 0})`)
  const candidateCount = json.sessionState?.candidateCount ?? null
  console.log(`candidateCnt: ${candidateCount}`)
  const meta = json.meta ?? {}
  if (meta.orchestratorResult) console.log(`orchestrator: ${JSON.stringify(meta.orchestratorResult).slice(0, 240)}`)
  return json
}

async function main() {
  console.log(`\n🔎 배포 서버 probe → ${URL}\n`)

  // 1. 탐색형: 구리 브랜드 뭐가 있어?
  const r1 = await probe("시나리오1: 구리 브랜드 탐색", "구리 브랜드 뭐가 있어?")

  // 2. 정보 조회: CE7659120 날장길이 얼마?
  const r2 = await probe("시나리오2: CE7659120 날장길이", "CE7659120 날장길이 얼마?")

  // 판정
  console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("판정")
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

  if (r1) {
    const af1 = r1.sessionState?.appliedFilters ?? []
    const brandFilter = af1.find(f => String(f.field).toLowerCase().includes("brand"))
    const hasCards1 = !!(r1.recommendation && (r1.recommendation.primary || (r1.recommendation.alternates ?? []).length > 0))
    const passText = !hasCards1 && typeof r1.text === "string" && r1.text.length > 0
    console.log(`\n[1] 구리 브랜드 탐색`)
    console.log(`    ✓/✗ 카드 없음:   ${hasCards1 ? "✗ (카드 나옴 → 실패)" : "✓"}`)
    console.log(`    ✓/✗ brand 필터 X: ${brandFilter ? `✗ (${brandFilter.field}=${brandFilter.value})` : "✓"}`)
    console.log(`    ✓/✗ 텍스트 답변:  ${passText ? "✓" : "✗"}`)
    console.log(`    purpose: ${r1.purpose} (question 이어야 탐색형)`)
  }
  if (r2) {
    const hasCards2 = !!(r2.recommendation && (r2.recommendation.primary || (r2.recommendation.alternates ?? []).length > 0))
    const mentions55 = /55\s*(?:mm|㎜)?/.test(String(r2.text ?? ""))
    const isQuestion = r2.purpose === "question"
    console.log(`\n[2] CE7659120 날장길이`)
    console.log(`    ✓/✗ purpose=question: ${isQuestion ? "✓" : `✗ (${r2.purpose})`}`)
    console.log(`    ✓/✗ 카드 없음:        ${hasCards2 ? "✗ (카드 나옴)" : "✓"}`)
    console.log(`    ✓/✗ "55mm" 포함:      ${mentions55 ? "✓" : "✗"}`)
  }
  console.log()
}

main().catch(err => { console.error("probe crashed:", err); process.exit(1) })
