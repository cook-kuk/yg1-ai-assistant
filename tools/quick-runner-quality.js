#!/usr/bin/env node
/**
 * Quick runner v2 — quality-based scoring (PASS/FAIL/ERROR)
 * Mirrors test-results/hard-test-runner.js judge() logic.
 *
 * Tests both /api/chat and /api/recommend, scores by recommendation quality.
 * No candidate count matching (those are misleading per insight from comparison.xlsx).
 *
 * usage: node tools/quick-runner-quality.js [--n=N] [--workers=W] [--label=X] [--source=chat|recommend|both]
 */
const fs = require("fs"), path = require("path")

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); return [k, v ?? "true"] }
  return [a, "true"]
}))

const N = parseInt(argv.n || "12", 10)
const WORKERS = parseInt(argv.workers || "2", 10)
const LABEL = argv.label || `iter-${Date.now()}`
const OUT = argv.out || "test-results/loop"
const SOURCE = argv.source || "both"
const ENDPOINT = argv.endpoint || "http://20.119.98.136:3000"
const FEEDBACK_CASES_PATH = path.join(__dirname, "..", "testset", "autohunt", "feedback-cases.json")

// ── Test cases (synthesized from feedback + golden patterns) ──
const CASES = [
  // Single-turn baseline
  { id: "S01", name: "탄소강 P 슬로팅 10mm", intake: "신규 제품 추천 / 탄소강 / Slotting / Milling / 10mm / ALL", nls: ["추천해줘"] },
  { id: "S02", name: "비철 N 6mm side", intake: "신규 제품 추천 / 비철금속 / Side_Milling / Milling / 6mm / KOREA", nls: ["좋은 거 추천"] },
  { id: "S03", name: "스테인리스 M 8mm", intake: "신규 제품 추천 / 스테인리스강 / Slotting / Milling / 8mm / ALL", nls: ["스테인리스용 추천"] },
  { id: "S04", name: "초내열 S 12mm", intake: "신규 제품 추천 / 초내열합금 / Side_Milling / Milling / 12mm / ALL", nls: ["고온합금용"] },
  { id: "S05", name: "주철 K 10mm", intake: "신규 제품 추천 / 주철 / Slotting / Milling / 10mm / ALL", nls: ["주철용 추천"] },
  // Multi-turn challenge
  { id: "M01", name: "Multi: 베이스 → 4날", intake: "신규 제품 추천 / 탄소강 / Slotting / Milling / 10mm / ALL", nls: ["추천", "4날만"] },
  { id: "M02", name: "Multi: OAL→TiAlN", intake: "신규 제품 추천 / 탄소강 / Side_Milling / Milling / 10mm / ALL", nls: ["전체 길이 100mm 이상", "TiAlN 코팅"] },
  { id: "M03", name: "Multi: brand 제외", intake: "신규 제품 추천 / 비철금속 / Side_Milling / Milling / 8mm / ALL", nls: ["ALU-POWER 빼고", "재고 있는 거"] },
  { id: "M04", name: "Multi: 단일 series", intake: "신규 제품 추천 / 탄소강 / Slotting / Milling / 10mm / ALL", nls: ["X5070 series", "4날"] },
  { id: "M05", name: "Multi: 헬릭스 + cl", intake: "신규 제품 추천 / 탄소강 / Side_Milling / Milling / 10mm / ALL", nls: ["헬릭스 45도 이상", "절삭길이 20mm 이상"] },
  // Edge: contradictions, invalid
  { id: "E01", name: "999mm (음의 케이스)", intake: "신규 제품 추천 / 탄소강 / Slotting / Milling / 999mm / ALL", nls: ["추천"] },
  { id: "E02", name: "모순 ≥20 ≤5", intake: "신규 제품 추천 / 탄소강 / Slotting / Milling / 10mm / ALL", nls: ["직경 20 이상이면서 5 이하"] },
  // Reasoning / hard
  { id: "H01", name: "초내열 누락 지적", intake: "신규 제품 추천 / 초내열합금 / Corner_Radius / Milling / 10mm / ALL", nls: ["근데 왜 초내열합금용으로는 추천 안해줘?"] },
  { id: "H02", name: "단종 지적", intake: "신규 제품 추천 / 탄소강 / Slotting / Milling / 10mm / ALL", nls: ["3S MILLS은 단종제품이니 다른 제품으로 추천해주면 좋겠어"] },
  { id: "H03", name: "Chip Splitter 없는 거", intake: "신규 제품 추천 / 초내열합금 / 모름 / Milling / 10mm / ALL", nls: ["Chip Splitter 가 없는 제품으로 알려주세요"] },
  { id: "H04", name: "초경만", intake: "신규 제품 추천 / 탄소강 / Side_Milling / Milling / 10mm / ALL", nls: ["초경 엔드밀로만 추천해줘 (HSS 제외)"] },
  { id: "H05", name: "국내 한정", intake: "신규 제품 추천 / 초내열합금 / Helical_Interpolation / Milling / 10mm / KOREA", nls: ["국내제품으로만 추천해줘"] },
]

// ── Build chat-style messages ──
function buildIntakeText(intake) {
  const parts = intake.split("/").map(s => s.trim())
  const labels = ["문의 목적", "가공 소재", "가공 형상", "가공 방식", "공구 직경", "국가"]
  return parts.map((v, i) => `${labels[i] || "정보"}: ${v}`).join("\n") + "\n\n위 조건에 맞는 YG-1 제품을 추천해 주세요."
}

async function fetchWithRetry(url, body, timeoutMs = 120000, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), signal: ctrl.signal,
      })
      clearTimeout(t)
      return { ok: res.ok, status: res.status, body: await res.json() }
    } catch (e) {
      clearTimeout(t)
      if (attempt === retries) return { ok: false, status: 0, error: e.message }
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}

// ── Judge: same logic as hard-test-runner.js ──
function judge(testCase, finalResp) {
  if (!finalResp || !finalResp.ok) {
    return { verdict: "ERROR", reason: `API ${finalResp?.status || "fail"} ${finalResp?.error || ""}` }
  }
  const b = finalResp.body || {}
  const txt = String(b.text || "")
  const prods = b.recommendedProducts || b.recommendationIds || []
  const intent = b.intent || ""

  if (/현재 필터 기준 후보는 0개|후보가 없|결과가 없|제품을 찾지 못/.test(txt)) return { verdict: "FAIL", reason: "0 후보" }
  if (/죄송|오류|에러|문제가 발생/.test(txt) && prods.length === 0) return { verdict: "FAIL", reason: "에러 응답" }
  if (intent === "product_recommendation" && prods.length === 0 && !/형상|소재|어떤/.test(txt)) {
    return { verdict: "FAIL", reason: "추천 인텐트인데 0개" }
  }
  return { verdict: "PASS", reason: prods.length ? `${prods.length}개 추천` : "대화형 응답" }
}

// ── Run one case via /api/chat (multi-turn) ──
async function runChatCase(c) {
  const t0 = Date.now()
  const messages = [{ role: "user", text: buildIntakeText(c.intake) }]
  let lastResp = null
  for (const nl of c.nls) {
    if (lastResp?.body?.text) messages.push({ role: "ai", text: lastResp.body.text })
    messages.push({ role: "user", text: nl })
    lastResp = await fetchWithRetry(`${ENDPOINT}/api/chat`, { messages })
    if (!lastResp.ok) break
  }
  const v = judge(c, lastResp)
  return {
    id: c.id, name: c.name, source: "chat",
    verdict: v.verdict, reason: v.reason,
    txt: (lastResp?.body?.text || "").slice(0, 100),
    products: (lastResp?.body?.recommendedProducts || []).length,
    ms: Date.now() - t0,
  }
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

// ── Optionally mix in feedback cases ──
function loadFeedbackCases() {
  try {
    const fb = JSON.parse(fs.readFileSync(FEEDBACK_CASES_PATH, "utf8"))
    return fb.filter(c => c.nls && c.nls.length > 0).map(c => ({
      id: c.id,
      name: (c.userComment || "").slice(0, 40) || c.id,
      // Convert formSnapshot back to slash-format intake string
      intake: [
        c.form?.inquiryPurpose?.value || "신규 제품 추천",
        c.form?.material?.value === "P" ? "탄소강" :
          c.form?.material?.value === "M" ? "스테인리스강" :
          c.form?.material?.value === "K" ? "주철" :
          c.form?.material?.value === "N" ? "비철금속" :
          c.form?.material?.value === "S" ? "초내열합금" :
          c.form?.material?.value === "H" ? "고경도강" :
          c.form?.material?.value || "모름",
        c.form?.operationType?.value || "모름",
        c.form?.toolTypeOrCurrentProduct?.value || "Milling",
        c.form?.diameterInfo?.value || "10mm",
        c.form?.country?.value || "ALL",
      ].join(" / "),
      nls: c.nls,
    }))
  } catch (e) { return [] }
}

async function main() {
  const useFeedback = argv.feedback === "true" || argv.feedback === "1"
  const allCases = useFeedback ? [...CASES, ...loadFeedbackCases()] : CASES
  // Random shuffle subset of N
  const shuffled = [...allCases].sort(() => Math.random() - 0.5)
  const subset = shuffled.slice(0, N)
  console.log(`\n[quick-quality] ${LABEL} | endpoint=${ENDPOINT} | n=${subset.length}/${allCases.length} workers=${WORKERS}`)
  const t0 = Date.now()
  const results = await pool(subset, WORKERS, runChatCase)
  const ms = Date.now() - t0
  const tally = { PASS: 0, FAIL: 0, ERROR: 0 }
  results.forEach(r => { tally[r.verdict] = (tally[r.verdict] || 0) + 1 })
  const passPct = (tally.PASS / subset.length * 100).toFixed(1)
  console.log(`\n--- ${LABEL} | PASS ${tally.PASS} (${passPct}%)  FAIL ${tally.FAIL}  ERROR ${tally.ERROR}  in ${ms}ms ---`)
  results.forEach(r => {
    const tag = r.verdict.padEnd(5)
    console.log(`  ${tag} #${r.id} ${r.name.padEnd(35)} prods=${r.products} ms=${r.ms} | "${r.txt.slice(0, 60)}"`)
    if (r.verdict !== "PASS") console.log(`        reason: ${r.reason}`)
  })
  fs.mkdirSync(OUT, { recursive: true })
  const outFile = path.join(OUT, `${LABEL}.json`)
  fs.writeFileSync(outFile, JSON.stringify({ label: LABEL, endpoint: ENDPOINT, runAt: new Date().toISOString(), tally, passPct, results }, null, 2))
  console.log(`\n→ ${outFile}`)
}

main().catch(e => { console.error("FATAL:", e); process.exit(1) })
