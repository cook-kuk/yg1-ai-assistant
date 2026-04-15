#!/usr/bin/env node
/**
 * 철현님 기준 3개 셋(11건) 배포 서버 :3000 probe
 * 코드 수정 없이 현황 보고만.
 */

const HOST = process.argv[2] ?? "20.119.98.136:3000"
const BASE = HOST.startsWith("http") ? HOST : `http://${HOST}`
const URL = `${BASE}/api/recommend`

const CASES = [
  // Set 1: 피삭재 → 브랜드 매핑
  { set: 1, id: "1-a", input: "구리 밀링 공구 추천해줘",
    expectFilters: ["workPieceName", "brand"], expectBrandHints: ["CRX"] },
  { set: 1, id: "1-b", input: "알루미늄 엔드밀 추천",
    expectFilters: ["workPieceName", "brand"], expectBrandHints: ["Alu-Cut", "Alu-Power", "Alu"] },
  { set: 1, id: "1-c", input: "티타늄 가공용 공구",
    expectFilters: ["workPieceName", "brand"], expectBrandHints: ["Titanox"] },
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
    altFields: ["stockStatus", "totalStockQty", "stockQty"] },
  { set: 3, id: "3-b", input: "RPM 5000 이상인 제품 찾아줘",
    expectFilters: [{ field: "rpm", op: "gte", value: 5000 }],
    altFields: ["spindleSpeedRpm", "rpmMax", "rpmMin"] },
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

function getAppliedFilters(j) {
  return j?.session?.publicState?.appliedFilters
    ?? j?.sessionState?.appliedFilters
    ?? []
}
function getCandidateCount(j) {
  return j?.session?.publicState?.candidateCount
    ?? j?.sessionState?.candidateCount
    ?? null
}

function judge(r) {
  if (r.err || !r.json) return { verdict: "fail", reason: `network/parse: ${r.err ?? "no json"}` }
  const af = getAppliedFilters(r.json)
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
    if (hasWP && brandFilter) return { verdict: "partial", reason: `brand 잡혔지만 기대값과 다름: ${JSON.stringify(brandFilter.value)}` }
    if (hasWP && !brandFilter) return { verdict: "partial", reason: `workPieceName만 잡힘, brand 매핑 없음` }
    if (!hasWP && brandFilter) return { verdict: "partial", reason: `brand만 잡힘 (WP 없음)` }
    return { verdict: "fail", reason: `필터 없음 (af.length=${af.length})` }
  }

  // Set 2 / 3: 정확한 field+op+value 매칭
  const exp = c.expectFilters[0]
  const altFields = c.altFields ?? []
  const allowed = [exp.field, ...altFields].map(s => s.toLowerCase())
  const matchExact = af.find(f => f.field === exp.field && f.op === exp.op && Number(f.value ?? f.rawValue) === exp.value)
  if (matchExact) return { verdict: "pass", reason: `정확 매칭: ${exp.field} ${exp.op} ${exp.value}` }
  const matchField = af.find(f => allowed.includes(String(f.field).toLowerCase()))
  if (matchField) {
    return { verdict: "partial", reason: `field 매칭(허용): ${matchField.field} ${matchField.op} ${JSON.stringify(matchField.value ?? matchField.rawValue)} (기대 ${exp.field} ${exp.op} ${exp.value})` }
  }
  if (af.length === 0) return { verdict: "fail", reason: "필터 0개" }
  return { verdict: "fail", reason: `엉뚱한 필터: ${af.map(f => `${f.field}:${f.op}:${JSON.stringify(f.value ?? f.rawValue)}`).join(", ")}` }
}

function fmtFilters(af) {
  if (!af || af.length === 0) return "(none)"
  return af.map(f => `${f.field}:${f.op}:${JSON.stringify(f.value ?? f.rawValue)}`).join(" | ")
}

async function main() {
  console.log(`\nprobe → ${URL}\n`)
  const results = []
  // 순차 (배포 서버 부하 + DB 경합 회피)
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
    const af = getAppliedFilters(j)
    console.log(`\n[${r.c.id}] ${r.c.input}`)
    console.log(`  verdict       : ${r.verdict.toUpperCase()} — ${r.reason}`)
    console.log(`  appliedFilters: ${fmtFilters(af)}`)
    console.log(`  candidateCnt  : ${getCandidateCount(j) ?? "(none)"}`)
    console.log(`  purpose       : ${j.purpose ?? "(none)"}`)
    const chips = j.chips
    const chipCount = Array.isArray(chips) ? chips.length : (chips?.options?.length ?? (chips ? "obj" : 0))
    console.log(`  chips         : ${chipCount === 0 ? "없음" : `${chipCount}개`}`)
    const text200 = String(j.text ?? "").slice(0, 200).replace(/\n/g, " / ")
    console.log(`  text(200)     : ${text200}`)
  }

  console.log(`\n${"━".repeat(70)}\n요약\n${"━".repeat(70)}`)
  for (const set of [1, 2, 3]) {
    const sub = results.filter(r => r.c.set === set)
    const pass = sub.filter(r => r.verdict === "pass").length
    const partial = sub.filter(r => r.verdict === "partial").length
    const fail = sub.filter(r => r.verdict === "fail").length
    console.log(`Set ${set}: ${pass}/${sub.length} pass  (partial=${partial}, fail=${fail})`)
  }
  const total = results.length
  const totalPass = results.filter(r => r.verdict === "pass").length
  const totalPartial = results.filter(r => r.verdict === "partial").length
  console.log(`총: ${totalPass}/${total} pass  (partial=${totalPartial})`)
}

main().catch(err => { console.error("crash:", err); process.exit(1) })
