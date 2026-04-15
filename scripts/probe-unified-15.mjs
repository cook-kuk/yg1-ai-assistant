#!/usr/bin/env node
/**
 * USE_UNIFIED_LLM=true 로컬 :3000 15건 probe.
 * 코드 수정 없이 현황 보고만.
 */

const HOST = process.argv[2] ?? "localhost:3000"
const BASE = HOST.startsWith("http") ? HOST : `http://${HOST}`
const URL = `${BASE}/api/recommend`

const CASES = [
  // Set 1: 피삭재 → 브랜드 매핑
  { set: 1, id: "1-a", input: "구리 밀링 공구 추천해줘",
    expectFilters: ["workPieceName", "brand"], expectBrandHints: ["CRX", "Cu"] },
  { set: 1, id: "1-b", input: "알루미늄 엔드밀 추천",
    expectFilters: ["workPieceName", "brand"], expectBrandHints: ["Alu-Cut", "Alu-Power", "Alu", "Aluminum"] },
  { set: 1, id: "1-c", input: "티타늄 가공용 공구",
    expectFilters: ["workPieceName", "brand"], expectBrandHints: ["Titanox", "Ti"] },

  // Set 2: Dimension 필터링
  { set: 2, id: "2-a", input: "직경 10 이상",
    expectFilters: [{ field: "diameterMm", op: "gte", value: 10 }] },
  { set: 2, id: "2-b", input: "날장 24 이상",
    expectFilters: [{ field: "lengthOfCutMm", op: "gte", value: 24 }] },
  { set: 2, id: "2-c", input: "전장 100",
    expectFilters: [{ field: "overallLengthMm", op: "eq", value: 100 }] },
  { set: 2, id: "2-d", input: "유효장 50 이상",
    expectFilters: [{ field: "effectiveLengthMm", op: "gte", value: 50 }] },
  { set: 2, id: "2-e", input: "넥경 4mm 이하",
    expectFilters: [{ field: "neckDiameterMm", op: "lte", value: 4 }] },
  { set: 2, id: "2-f", input: "헬릭스각 45도",
    expectFilters: [{ field: "helixAngleDeg", op: "eq", value: 45 }] },

  // Set 3: DB 기반 필터링
  { set: 3, id: "3-a", input: "재고 100개 이상인 제품 찾아줘",
    expectFilters: [{ field: "totalStock", op: "gte", value: 100 }],
    altFields: ["stockStatus", "totalStockQty", "stockQty", "stock"] },
  { set: 3, id: "3-b", input: "RPM 5000 이상인 제품 찾아줘",
    expectFilters: [{ field: "rpm", op: "gte", value: 5000 }],
    altFields: ["spindleSpeedRpm", "rpmMax", "rpmMin", "maxRpm"] },

  // CoT 통합 검증
  { set: 4, id: "E-1", input: "구리 브랜드 뭐가 있어?", kind: "qa" },
  { set: 4, id: "E-2", input: "CE7659120 날장길이 얼마?", kind: "qa" },
  { set: 4, id: "E-3", input: "스테인리스 10mm 4날", kind: "rec" },
  { set: 4, id: "E-4", input: "이대로 보여줘", kind: "show" },
]

async function probe(c) {
  const body = {
    messages: [{ role: "user", text: c.input }],
    form: {},
    prevState: null,
    displayedProducts: null,
    language: "ko",
  }
  const t0 = Date.now()
  let res, json, raw
  try {
    res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    raw = await res.text()
    try { json = JSON.parse(raw) } catch { json = null }
  } catch (err) {
    return { c, err: err.message, ms: Date.now() - t0 }
  }
  return { c, ms: Date.now() - t0, status: res.status, json, raw }
}

function extractCotHead(j) {
  const candidates = [
    j?.thinkingDeep,
    j?.thinkingProcess,
    j?.thinkingProcess?.text,
    j?.cot,
    j?.reasoning,
    j?.sessionState?.cot,
    j?.sessionState?.reasoning,
    j?.requestPreparation?.cot,
    j?.requestPreparation?.reasoning,
  ]
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.slice(0, 300)
    if (c && typeof c === "object") {
      const s = JSON.stringify(c)
      if (s.length > 5) return s.slice(0, 300)
    }
  }
  return "(none)"
}

function fmtFilters(af) {
  if (!af || af.length === 0) return "(none)"
  return af.map(f => `${f.field}:${f.op}:${JSON.stringify(f.value ?? f.rawValue)}`).join(" | ")
}

function chipsAsArray(chips) {
  if (!chips) return []
  if (Array.isArray(chips)) return chips
  if (Array.isArray(chips?.options)) return chips.options
  if (Array.isArray(chips?.chips)) return chips.chips
  return []
}

function fmtChips(chips) {
  const arr = chipsAsArray(chips)
  if (arr.length === 0) return "(none)"
  return arr.map(c => typeof c === "string" ? c : (c.label ?? c.text ?? JSON.stringify(c))).join(" | ")
}

function getApplied(j) {
  return j?.session?.publicState?.appliedFilters
    ?? j?.sessionState?.appliedFilters
    ?? []
}
function getCandCount(j) {
  return j?.session?.publicState?.candidateCount
    ?? j?.sessionState?.candidateCount
    ?? "(none)"
}

function judge(r) {
  if (r.err || !r.json) return { verdict: "fail", reason: `network/parse: ${r.err ?? "no json"}` }
  const j = r.json
  const af = getApplied(j)
  const c = r.c

  // Set 1: brand 매핑
  if (c.set === 1) {
    const hasWP = af.some(f => /workPiece/i.test(f.field))
    const brandFilter = af.find(f => /brand/i.test(f.field))
    let brandMatches = false
    if (brandFilter) {
      const v = JSON.stringify(brandFilter.value ?? brandFilter.rawValue ?? "")
      brandMatches = c.expectBrandHints.some(h => v.toLowerCase().includes(h.toLowerCase()))
    }
    if (hasWP && brandFilter && brandMatches) return { verdict: "pass", reason: `WP+brand=${JSON.stringify(brandFilter.value)}` }
    if (hasWP && brandFilter) return { verdict: "partial", reason: `brand≠기대: ${JSON.stringify(brandFilter.value)}` }
    if (hasWP && !brandFilter) return { verdict: "partial", reason: `WP만, brand 매핑 없음` }
    if (!hasWP && brandFilter) return { verdict: "partial", reason: `brand만 (WP 없음)` }
    return { verdict: "fail", reason: `필터 없음 (af=${af.length})` }
  }

  // Set 2/3: field+op+value 매칭
  if (c.set === 2 || c.set === 3) {
    const exp = c.expectFilters[0]
    const altFields = c.altFields ?? []
    const allowed = [exp.field, ...altFields].map(s => s.toLowerCase())
    const matchExact = af.find(f => f.field === exp.field && f.op === exp.op && Number(f.value ?? f.rawValue) === exp.value)
    if (matchExact) return { verdict: "pass", reason: `정확: ${exp.field} ${exp.op} ${exp.value}` }
    const matchField = af.find(f => allowed.includes(String(f.field).toLowerCase()))
    if (matchField) {
      return { verdict: "partial", reason: `field 허용: ${matchField.field} ${matchField.op} ${JSON.stringify(matchField.value ?? matchField.rawValue)} (기대 ${exp.field} ${exp.op} ${exp.value})` }
    }
    if (af.length === 0) return { verdict: "fail", reason: "필터 0개" }
    return { verdict: "fail", reason: `엉뚱: ${fmtFilters(af)}` }
  }

  // Set 4 (CoT 통합): purpose + 응답 텍스트 정합성
  if (c.set === 4) {
    const purpose = j.purpose ?? ""
    const text = String(j.text ?? "")
    if (c.kind === "qa") {
      if (/qa|answer|question/i.test(purpose) && text.length > 0) return { verdict: "pass", reason: `qa(${purpose}) text=${text.length}자` }
      if (text.length > 0) return { verdict: "partial", reason: `purpose=${purpose} (qa 기대) text=${text.length}자` }
      return { verdict: "fail", reason: `text 비어있음 purpose=${purpose}` }
    }
    if (c.kind === "rec") {
      if (/recommend|result|product/i.test(purpose)) return { verdict: "pass", reason: `rec(${purpose})` }
      if (af.length > 0) return { verdict: "partial", reason: `purpose=${purpose} but filters=${af.length}` }
      return { verdict: "fail", reason: `purpose=${purpose} af=0` }
    }
    if (c.kind === "show") {
      if (/show|recommend|result|reset|narrow/i.test(purpose)) return { verdict: "pass", reason: `show(${purpose})` }
      return { verdict: "partial", reason: `purpose=${purpose}` }
    }
  }
  return { verdict: "fail", reason: "unknown set" }
}

async function main() {
  console.log(`\nprobe → ${URL}\n`)
  const results = []
  for (const c of CASES) {
    process.stdout.write(`[${c.id}] ${c.input} ... `)
    const r = await probe(c)
    const j = judge(r)
    results.push({ ...r, verdict: j.verdict, reason: j.reason })
    console.log(`${j.verdict.toUpperCase()} (${r.ms}ms)`)
  }

  console.log(`\n${"━".repeat(70)}\n상세\n${"━".repeat(70)}`)
  for (const r of results) {
    const j = r.json ?? {}
    const af = getApplied(j)
    const histCount = j?.session?.publicState?.narrowingHistory?.[0]?.candidateCountAfter ?? "(none)"
    console.log(`\n[${r.c.id}] input        : ${r.c.input}`)
    console.log(`  cot(300)      : ${extractCotHead(j)}`)
    console.log(`  filters       : ${fmtFilters(af)}`)
    console.log(`  candidateCnt  : ${getCandCount(j)}  (narrowAfter=${histCount})`)
    console.log(`  purpose       : ${j.purpose ?? "(none)"}`)
    console.log(`  chips         : ${fmtChips(j.chips)}`)
    const text200 = String(j.text ?? "").slice(0, 200).replace(/\n/g, " / ")
    console.log(`  text(200)     : ${text200}`)
    console.log(`  verdict       : ${r.verdict.toUpperCase()} — ${r.reason}`)
  }

  console.log(`\n${"━".repeat(70)}\n요약\n${"━".repeat(70)}`)
  const setNames = { 1: "Set 1", 2: "Set 2", 3: "Set 3", 4: "CoT  " }
  for (const set of [1, 2, 3, 4]) {
    const sub = results.filter(r => r.c.set === set)
    const pass = sub.filter(r => r.verdict === "pass").length
    const partial = sub.filter(r => r.verdict === "partial").length
    const fail = sub.filter(r => r.verdict === "fail").length
    console.log(`${setNames[set]}: ${pass}/${sub.length}  (partial=${partial}, fail=${fail})`)
  }
  const total = results.length
  const totalPass = results.filter(r => r.verdict === "pass").length
  const totalPartial = results.filter(r => r.verdict === "partial").length
  const totalFail = results.filter(r => r.verdict === "fail").length
  console.log(`총:    ${totalPass}/${total}  (partial=${totalPartial}, fail=${totalFail})`)
}

main().catch(err => { console.error("crash:", err); process.exit(1) })
