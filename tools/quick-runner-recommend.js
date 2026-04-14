#!/usr/bin/env node
/**
 * Quick runner v3 — /api/recommend (the REAL UI path) with quality-based scoring.
 *
 * Real metric: did endpoint return valid recommendations?
 *   PASS = candidates >= 1 AND text contains a product or recommendation message
 *   FAIL = candidates 0 AND text says "0건" or recommendation intent fails
 *   ERROR = HTTP error
 *
 * usage: node tools/quick-runner-recommend.js [--n=N] [--workers=W] [--label=X] [--feedback=true]
 */
const fs = require("fs"), path = require("path")

const argv = Object.fromEntries(process.argv.slice(2).map(a => {
  if (a.startsWith("--")) { const [k, v] = a.slice(2).split("="); return [k, v ?? "true"] }
  return [a, "true"]
}))

const N = parseInt(argv.n || "12", 10)
const WORKERS = parseInt(argv.workers || "2", 10)
const LABEL = argv.label || `recommend-iter-${Date.now()}`
const OUT = argv.out || "test-results/loop"
const ENDPOINT = argv.endpoint || "http://20.119.98.136:3000"
const FEEDBACK_CASES_PATH = path.join(__dirname, "..", "testset", "autohunt", "feedback-cases.json")

// ── Test cases (mirror quick-runner-quality CASES) ──
const HAND_CASES = [
  { id: "S01", name: "탄소강 P 슬로팅 10mm", intake: { mat: "P", op: "Slotting", tool: "Milling", dia: "10mm" }, nls: ["추천해줘"] },
  { id: "S02", name: "비철 N 6mm side", intake: { mat: "N", op: "Side_Milling", tool: "Milling", dia: "6mm", country: "KOREA" }, nls: ["좋은 거 추천"] },
  { id: "S03", name: "스테인리스 M 8mm", intake: { mat: "M", op: "Slotting", tool: "Milling", dia: "8mm" }, nls: ["추천"] },
  { id: "S04", name: "초내열 S 12mm", intake: { mat: "S", op: "Side_Milling", tool: "Milling", dia: "12mm" }, nls: ["고온합금용"] },
  { id: "S05", name: "주철 K 10mm", intake: { mat: "K", op: "Slotting", tool: "Milling", dia: "10mm" }, nls: ["주철용"] },
  { id: "M01", name: "Multi: 베이스 → 4날", intake: { mat: "P", op: "Slotting", tool: "Milling", dia: "10mm" }, nls: ["4날만"] },
  { id: "M02", name: "Multi: OAL → TiAlN", intake: { mat: "P", op: "Side_Milling", tool: "Milling", dia: "10mm" }, nls: ["전체 길이 100mm 이상", "TiAlN 코팅"] },
  { id: "M03", name: "Multi: brand 제외", intake: { mat: "N", op: "Side_Milling", tool: "Milling", dia: "8mm" }, nls: ["ALU-POWER 빼고"] },
  { id: "M04", name: "Multi: 단일 series", intake: { mat: "P", op: "Slotting", tool: "Milling", dia: "10mm" }, nls: ["X5070 series"] },
  { id: "M05", name: "Multi: 헬릭스 + cl", intake: { mat: "P", op: "Side_Milling", tool: "Milling", dia: "10mm" }, nls: ["헬릭스 45도 이상"] },
  { id: "E01", name: "999mm (음의 케이스)", intake: { mat: "P", op: "Slotting", tool: "Milling", dia: "999mm" }, nls: ["추천"] },
  { id: "E02", name: "모순 ≥20 ≤5", intake: { mat: "P", op: "Slotting", tool: "Milling", dia: "10mm" }, nls: ["직경 20 이상이면서 5 이하"] },
  { id: "H01", name: "초내열 누락 지적", intake: { mat: "S", op: "Corner_Radius", tool: "Milling", dia: "10mm" }, nls: ["근데 왜 초내열합금용으로는 추천 안해줘?"] },
  { id: "H03", name: "Chip Splitter 없는 거", intake: { mat: "S", op: "", tool: "Milling", dia: "10mm" }, nls: ["Chip Splitter 가 없는 제품으로 알려주세요"] },
  { id: "H04", name: "초경만", intake: { mat: "P", op: "Side_Milling", tool: "Milling", dia: "10mm" }, nls: ["초경 엔드밀로만 추천해줘"] },
]

const known = v => ({ status: "known", value: v })
const unanswered = { status: "unanswered" }
const PURPOSE_LABELS = { new: "신규 제품 추천" }
const MATERIAL_LABELS = { P: "탄소강", M: "스테인리스강", K: "주철", N: "비철금속", S: "초내열합금", H: "고경도강" }

function buildIntakeForm(intake) {
  return {
    inquiryPurpose: known("new"),
    material: intake.mat ? known(intake.mat) : unanswered,
    operationType: intake.op ? known(intake.op) : unanswered,
    machiningIntent: unanswered,
    toolTypeOrCurrentProduct: known(intake.tool || "Milling"),
    diameterInfo: intake.dia ? known(intake.dia) : unanswered,
    country: known(intake.country || "ALL"),
  }
}

function intakeSummaryText(form) {
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

async function fetchWithRetry(url, body, timeoutMs = 120000, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal })
      clearTimeout(t)
      return { ok: res.ok, status: res.status, body: await res.json() }
    } catch (e) {
      clearTimeout(t)
      if (attempt === retries) return { ok: false, status: 0, error: e.message }
      await new Promise(r => setTimeout(r, 1500))
    }
  }
}

// ── Multi-turn UI mirror via /api/recommend ──
async function runRecommendCase(c) {
  const t0 = Date.now()
  const form = c.form || buildIntakeForm(c.intake || {})
  // Turn 0: form submit
  let resp = await fetchWithRetry(`${ENDPOINT}/api/recommend`, {
    intakeForm: form,
    messages: [],
    session: null,
    pagination: { page: 0, pageSize: 1000 },
    language: "ko",
  })
  if (!resp.ok) return { id: c.id, name: c.name, error: `T0:${resp.error || resp.status}`, ms: Date.now() - t0, verdict: "ERROR", reason: `T0 ${resp.status}` }
  let session = resp.body?.session || null
  const aiText0 = String(resp.body?.text || "")

  // Turn 1+: NL turns
  const messages = [{ role: "user", text: intakeSummaryText(form) }, { role: "ai", text: aiText0 }]
  for (let i = 0; i < c.nls.length; i++) {
    messages.push({ role: "user", text: c.nls[i] })
    resp = await fetchWithRetry(`${ENDPOINT}/api/recommend`, {
      intakeForm: form,
      messages: [...messages],
      session,
      pagination: { page: 0, pageSize: 1000 },
      language: "ko",
    })
    if (!resp.ok) return { id: c.id, name: c.name, error: `T${i + 1}:${resp.error || resp.status}`, ms: Date.now() - t0, verdict: "ERROR", reason: `T${i + 1} ${resp.status}` }
    session = resp.body?.session || session
    messages.push({ role: "ai", text: String(resp.body?.text || "") })
  }

  // Final response → judge
  const b = resp.body || {}
  const cand = b.session?.publicState?.candidateCount ?? 0
  const candLen = (b.candidates || []).length
  const txt = String(b.text || "")
  const purpose = b.purpose || ""
  // Quality judgement (mirror hard-test logic but for /api/recommend response shape)
  let verdict = "PASS", reason = `${cand}건 narrowing, ${candLen}건 표시`
  if (/현재 필터 기준 후보는 0개|후보가 없|결과가 없|제품을 찾지 못/.test(txt)) { verdict = "FAIL"; reason = "0 후보 (텍스트)" }
  else if (/죄송|오류|에러|문제가 발생/.test(txt) && candLen === 0) { verdict = "FAIL"; reason = "에러 응답" }
  else if (cand === 0 && candLen === 0) { verdict = "FAIL"; reason = "candidates 0건" }
  // PASS for other cases (broad/question/recommendation modes)

  return {
    id: c.id, name: c.name, verdict, reason,
    cand, candLen, purpose,
    txt: txt.slice(0, 80),
    appliedFilters: ((b.session?.publicState?.appliedFilters) || []).map(f => `${f.field}:${f.op}:${f.rawValue ?? f.value}`),
    ms: Date.now() - t0,
  }
}

async function pool(items, workers, fn) {
  const results = []
  let idx = 0
  await Promise.all(Array(Math.min(workers, items.length)).fill(0).map(async () => {
    while (idx < items.length) { const i = idx++; results[i] = await fn(items[i]) }
  }))
  return results
}

// Convert feedback cases to the form needed
function loadFeedbackCases() {
  try {
    const fb = JSON.parse(fs.readFileSync(FEEDBACK_CASES_PATH, "utf8"))
    return fb.filter(c => c.nls && c.nls.length > 0 && c.form).map(c => ({
      id: c.id,
      name: (c.userComment || "").slice(0, 40) || c.id,
      form: c.form,
      nls: c.nls,
    }))
  } catch (e) { return [] }
}

async function main() {
  const useFeedback = argv.feedback === "true" || argv.feedback === "1"
  const allCases = useFeedback ? [...HAND_CASES, ...loadFeedbackCases()] : HAND_CASES
  const subset = [...allCases].sort(() => Math.random() - 0.5).slice(0, N)
  console.log(`\n[recommend-quality] ${LABEL} | endpoint=${ENDPOINT} | n=${subset.length}/${allCases.length} workers=${WORKERS}`)

  const t0 = Date.now()
  const results = await pool(subset, WORKERS, runRecommendCase)
  const ms = Date.now() - t0
  const tally = { PASS: 0, FAIL: 0, ERROR: 0 }
  results.forEach(r => { tally[r.verdict] = (tally[r.verdict] || 0) + 1 })
  const passPct = (tally.PASS / subset.length * 100).toFixed(1)

  console.log(`\n--- ${LABEL} | PASS ${tally.PASS} (${passPct}%)  FAIL ${tally.FAIL}  ERROR ${tally.ERROR}  in ${ms}ms ---`)
  results.forEach(r => {
    const tag = (r.verdict || "?").padEnd(5)
    console.log(`  ${tag} #${r.id} ${(r.name || "").slice(0, 32).padEnd(32)} cand=${String(r.cand ?? "-").padStart(5)} ms=${r.ms}`)
    if (r.verdict !== "PASS") console.log(`         reason: ${r.reason}`)
  })

  fs.mkdirSync(OUT, { recursive: true })
  const outFile = path.join(OUT, `${LABEL}.json`)
  fs.writeFileSync(outFile, JSON.stringify({ label: LABEL, endpoint: ENDPOINT, runAt: new Date().toISOString(), tally, passPct, results }, null, 2))
  console.log(`\n→ ${outFile}`)
}

main().catch(e => { console.error("FATAL:", e); process.exit(1) })
