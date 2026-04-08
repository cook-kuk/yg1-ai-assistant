#!/usr/bin/env node
/**
 * Quick runner — random sampling + NL augmentation + parallel multi-turn
 *
 * 매 iter마다 25 케이스에서 N개 random pick + 각각 random NL variant.
 * :3000 multi-turn 호출 → expected DB count와 비교 → 점수 출력.
 *
 * usage:
 *   node tools/quick-runner.js [--n=8] [--workers=4] [--out=.] [--label=iterX]
 */
const fs = require("fs"), path = require("path")

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); return [k, v ?? "true"] }
  return [a, "true"]
}))

const N = parseInt(argv.n || "8", 10)
const WORKERS = parseInt(argv.workers || "4", 10)
const OUT = argv.out || "test-results/loop"
const LABEL = argv.label || `iter-${Date.now()}`
const ENDPOINT = argv.endpoint || "http://20.119.98.136:3000"

// ── 25 case templates with NL augmentations + DB ground truth ──
// db = expected catalog_app.product_recommendation_mv distinct edp_no count (from build-multiturn-xlsx.js SPECS)
const known = v => ({ status: "known", value: v })
const form = ({ purpose = "new", material, op, tool, diameter, country = "ALL" }) => ({
  inquiryPurpose: known(purpose),
  material: material ? known(material) : { status: "unanswered" },
  operationType: op ? known(op) : { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: tool ? known(tool) : { status: "unanswered" },
  diameterInfo: diameter ? known(diameter) : { status: "unanswered" },
  country: known(country),
})

const TESTS = [
  { id: 1, name: "P 슬로팅 10mm 베이스", db: 290,
    form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    nls: ["추천해줘", "괜찮은 거 추천", "어떤 게 좋아?", "골라줘"] },
  { id: 2, name: "다중소재 P+M+K 6mm", db: 274,
    form: form({ material: "P,M,K", op: "Side_Milling", tool: "Milling", diameter: "6mm" }),
    nls: ["다양한 소재 다 가능한 거", "여러 소재용으로", "범용으로 추천"] },
  { id: 3, name: "직경 8~12mm", db: 1037,
    form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    nls: ["직경 8mm 이상 12mm 이하", "8~12mm 사이", "8에서 12 사이 직경", "8~12밀리"] },
  { id: 4, name: "OAL ≥100", db: 113,
    form: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "10mm" }),
    nls: ["전체 길이 100mm 이상", "전장 100 이상", "OAL 100 넘는 거", "100mm보다 긴 거", "롱타입으로 100 이상"] },
  { id: 5, name: "OAL ≤80", db: 131,
    form: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "10mm" }),
    nls: ["전체 길이 80mm 이하", "전장 80 미만", "짧은 거 80 이하", "OAL 80 안 넘는"] },
  { id: 6, name: "4F 고정", db: 162,
    form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    nls: ["4날만", "4 flute", "날 4개짜리", "4 flute 정확히"] },
  { id: 7, name: "5F 이상 S 12mm", db: 32,
    form: form({ material: "S", op: "Slotting", tool: "Milling", diameter: "12mm" }),
    nls: ["5날 이상", "날 5개 이상", "5 flute 넘게", "최소 5날"] },
  { id: 8, name: "T-Coating P 8mm", db: 62,
    form: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "8mm" }),
    nls: ["T-Coating만", "코팅 T-Coating", "TCoating 종류"] },
  { id: 9, name: "uncoated N 6mm", db: 95,
    form: form({ material: "N", op: "Side_Milling", tool: "Milling", diameter: "6mm" }),
    nls: ["코팅 없는 거", "uncoated", "bright finish", "노코팅", "코팅 안 된 거"] },
  { id: 10, name: "재고 P 10mm", db: 130,
    form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    nls: ["재고 있는 거만", "재고 보유", "in stock", "재고 있는 것"] },
  { id: 11, name: "재고 M 8mm", db: 87,
    form: form({ material: "M", op: "Slotting", tool: "Milling", diameter: "8mm" }),
    nls: ["재고 있고 빠른 납기", "재고 보유 즉시", "stock 있는 거"] },
  { id: 12, name: "X5070 brand", db: 12,
    form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    nls: ["X5070 브랜드로만", "X5070만", "브랜드 X5070"] },
  { id: 13, name: "ALU-POWER 제외", db: 94,
    form: form({ material: "N", op: "Side_Milling", tool: "Milling", diameter: "8mm" }),
    nls: ["ALU-POWER는 빼고", "ALU-POWER 제외", "ALU-POWER 말고"] },
  { id: 14, name: "4중 φ10 OAL≥100 4F TiAlN", db: 1,
    form: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "10mm" }),
    nls: ["직경 10mm 4날 전장 100 이상 TiAlN 코팅", "10mm 4날 전장 100+ TiAlN", "φ10 4F TiAlN OAL≥100"] },
  { id: 15, name: "5중 P/M φ8-12 4F OAL≥80 TiAlN 재고", db: 10,
    form: form({ material: "P,M", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    nls: ["8~12mm 4날 전장 80 이상 TiAlN 재고", "직경 8-12, 4F, OAL 80+, TiAlN, 재고"] },
  { id: 16, name: "헬릭스 ≥45°", db: 17,
    form: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "10mm" }),
    nls: ["헬릭스 45도 이상", "helix angle 45+", "45° 이상 헬릭스"] },
  { id: 17, name: "Shank 6~10", db: 280,
    form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "8mm" }),
    nls: ["샹크 직경 6에서 10 사이", "shank 6~10", "shank 6 이상 10 이하"] },
  { id: 18, name: "CL ≥20mm", db: 206,
    form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    nls: ["절삭 길이 20mm 이상", "날장 20 이상", "CL ≥20", "flute length 20+"] },
  { id: 19, name: "Drill point 140°", db: 0, expectZero: false, // we don't have ground truth from mv (no point col)
    form: form({ material: "P", op: "Drilling", tool: "Holemaking", diameter: "8mm" }),
    nls: ["포인트 각도 140도", "point angle 140", "140도 포인트"] },
  { id: 20, name: "Drill OAL≥100 + 쿨런트", db: 0,
    form: form({ material: "P", op: "Drilling", tool: "Holemaking", diameter: "10mm" }),
    nls: ["전장 100 이상 쿨런트홀 있는 거", "OAL 100+ with coolant hole"] },
  { id: 21, name: "Tap M10 1.5pitch", db: 0,
    form: form({ material: "P", op: "Threading_Through", tool: "Threading", diameter: "10mm" }),
    nls: ["M10 P1.5 관통탭", "M10 1.5 pitch 탭"] },
  { id: 22, name: "999mm (음의 케이스)", db: 0, expectZero: true,
    form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "999mm" }),
    nls: ["직경 999mm 추천", "999mm짜리"] },
  { id: 23, name: "모순 ≥20 ≤5", db: 0, expectZero: true,
    form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    nls: ["직경 20 이상이면서 5 이하", "20 넘고 5 미만 직경"] },
  { id: 24, name: "1/4인치 6.35mm", db: 2,
    form: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "1/4인치" }),
    nls: ["1/4인치 4날", "0.25 inch 4 flute", "쿼터인치 4날"] },
  { id: 25, name: "KOREA 풀필터", db: 1,
    form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm", country: "KOREA" }),
    nls: ["한국 재고로 4날 TiAlN 전장 100 이상", "KOREA 4F TiAlN OAL 100+"] },
]

// importance weights (어려운 케이스 우선 sample)
const WEIGHTS = {
  4: 3, 5: 3, 7: 3, 9: 3, 14: 4, 15: 4, 16: 3, 17: 3, 18: 3, 19: 2, 20: 2, 21: 2, 23: 4, 24: 3, 25: 3,
}
function weighted(t) { return WEIGHTS[t.id] ?? 1 }

function pickRandom(n) {
  const pool = TESTS.flatMap(t => Array(weighted(t)).fill(t))
  const out = new Set()
  while (out.size < Math.min(n, TESTS.length)) {
    out.add(pool[Math.floor(Math.random() * pool.length)])
  }
  return [...out]
}

function pickFixed(ids) {
  return ids.map(id => TESTS.find(t => t.id === id)).filter(Boolean)
}

const PURPOSE_LABELS = { new: "신규 제품 추천" }
const MATERIAL_LABELS = { P: "탄소강", M: "스테인리스강", K: "주철", N: "비철금속", S: "초내열합금", H: "고경도강" }
function intakeSummary(form) {
  const lines = []
  const v = key => form[key]?.status === "known" ? form[key].value : null
  if (v("inquiryPurpose")) lines.push(`🧭 문의 목적: ${PURPOSE_LABELS[v("inquiryPurpose")] || v("inquiryPurpose")}`)
  if (v("material")) {
    const mats = String(v("material")).split(",").map(m => MATERIAL_LABELS[m.trim()] || m.trim()).join(", ")
    lines.push(`🧱 가공 소재: ${mats}`)
  }
  if (v("operationType")) lines.push(`📐 가공 형상: ${v("operationType")}`)
  if (v("toolTypeOrCurrentProduct")) lines.push(`🛠️ 가공 방식: ${v("toolTypeOrCurrentProduct")}`)
  if (v("diameterInfo")) lines.push(`📏 공구 직경: ${v("diameterInfo")}`)
  if (v("country")) lines.push(`🌐 국가: ${v("country")}`)
  return lines.join("\n") + "\n\n위 조건에 맞는 YG-1 제품을 추천해 주세요."
}

async function fetchWithRetry(url, body, timeoutMs = 90000, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: ctrl.signal,
      })
      clearTimeout(t)
      return await res.json()
    } catch (e) {
      clearTimeout(t)
      if (attempt === retries) throw e
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
}

async function runOne(test) {
  const t0 = Date.now()
  const nl = test.nls[Math.floor(Math.random() * test.nls.length)]
  const turn0 = {
    intakeForm: test.form,
    messages: [],
    session: null,
    pagination: { page: 0, pageSize: 1000 },
    language: "ko",
  }
  let r0
  try {
    r0 = await fetchWithRetry(`${ENDPOINT}/api/recommend`, turn0)
  } catch (e) { return { id: test.id, name: test.name, error: `T0: ${e.message}`, ms: Date.now() - t0 } }
  const session0 = r0.session
  const aiText0 = typeof r0.text === "string" ? r0.text : ""
  const turn1 = {
    intakeForm: test.form,
    messages: [
      { role: "user", text: intakeSummary(test.form) },
      { role: "ai", text: aiText0 },
      { role: "user", text: nl },
    ],
    session: session0,
    pagination: { page: 0, pageSize: 1000 },
    language: "ko",
  }
  let r1
  try {
    r1 = await fetchWithRetry(`${ENDPOINT}/api/recommend`, turn1)
  } catch (e) { return { id: test.id, name: test.name, nl, db: test.db, error: `T1: ${e.message}`, ms: Date.now() - t0 } }
  const cand = r1.session?.publicState?.candidateCount ?? null
  const filters = (r1.session?.publicState?.appliedFilters || []).map(f => `${f.field}:${f.op}:${f.rawValue ?? f.value}`)
  return {
    id: test.id, name: test.name, nl,
    db: test.db, ep: cand,
    filters, ms: Date.now() - t0,
    verdict: judge(test, cand),
  }
}

function judge(test, ep) {
  if (ep == null) ep = 0
  if (test.expectZero) return ep === 0 ? "✅" : "❌오탐"
  if (test.db === 0 && ep === 0) return "✅"
  if (test.db === 0 && ep > 0) return "❌오탐"
  if (test.db > 0 && ep === 0) return "❌누락"
  if (Math.abs(ep - test.db) <= Math.max(2, test.db * 0.15)) return "✅"
  if (ep > test.db * 1.5) return "⚠️과다"
  if (ep < test.db * 0.5) return "⚠️과소"
  return "🟡차이"
}

async function pool(items, workers, fn) {
  const results = []
  let idx = 0
  await Promise.all(Array(Math.min(workers, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i])
    }
  }))
  return results
}

async function main() {
  const fixedArg = argv.fixed
  const sampled = fixedArg
    ? pickFixed(fixedArg.split(",").map(Number))
    : pickRandom(N)
  console.log(`\n[quick] ${LABEL} | endpoint=${ENDPOINT} | n=${sampled.length} workers=${WORKERS}`)
  console.log(`[quick] sample: ${sampled.map(t => "#" + t.id).join(",")}`)
  const t0 = Date.now()
  const results = await pool(sampled, WORKERS, runOne)
  const ms = Date.now() - t0
  const passed = results.filter(r => r.verdict === "✅").length
  const failed = results.filter(r => r.verdict?.startsWith("❌")).length
  const warn = results.filter(r => r.verdict?.startsWith("⚠️") || r.verdict?.startsWith("🟡")).length
  console.log(`\n--- ${LABEL} | ${passed}/${sampled.length} ✅  ${failed} ❌  ${warn} ⚠️  in ${ms}ms ---`)
  results.forEach(r => {
    const tag = (r.verdict || "?").padEnd(5)
    console.log(`  ${tag} #${r.id} ${r.name.padEnd(34)} db=${String(r.db).padStart(5)} ep=${String(r.ep ?? "-").padStart(5)} | "${(r.nl||"").slice(0,30)}"`)
    if (r.filters?.length) console.log(`        filters: ${r.filters.join(", ")}`)
  })

  fs.mkdirSync(OUT, { recursive: true })
  const outFile = path.join(OUT, `${LABEL}.json`)
  fs.writeFileSync(outFile, JSON.stringify({
    label: LABEL, endpoint: ENDPOINT, runAt: new Date().toISOString(),
    n: sampled.length, passed, failed, warn, ms, results,
  }, null, 2))
  console.log(`\n→ ${outFile}`)
}

main().catch(e => { console.error("FATAL:", e); process.exit(1) })
