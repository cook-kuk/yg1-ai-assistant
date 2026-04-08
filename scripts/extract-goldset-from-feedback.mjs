#!/usr/bin/env node
/**
 * :3001 feedback dump → top-K goldset.
 *
 * 입력: test-results/_feedback_dump.json (curl -o 로 덤프)
 * 출력: test-results/goldset/from-feedback.json
 *       { cases: [{ id, formSnapshot, nlMessages, expectedTop3/5/10, badExcludes }] }
 *
 * Logic:
 *  - turn_feedback 중 feedback==='good' && candidateHighlights>=3 → positive
 *  - 같은 feedback==='bad' && 동일 form signature → anti-example (top-3 에서 제외 되어야)
 *  - 중복 제거: formSignature + (lastUserMessage || "") 기준 최신 것만
 *  - NL message 없는 케이스는 form 만으로 입력 복원 가능
 */
import fs from "node:fs"
import path from "node:path"

const IN = process.argv[2] || "test-results/_feedback_dump.json"
const OUT = process.argv[3] || "test-results/goldset/from-feedback.json"

const raw = JSON.parse(fs.readFileSync(IN, "utf8"))
const all = [
  ...(raw.generalEntries || []),
  ...(raw.feedbackEntries || []),
]

function formSig(f) {
  if (!f) return ""
  const g = (k) => {
    const v = f[k]
    if (!v || v.status !== "known") return "-"
    return String(v.value ?? "-")
  }
  return [
    g("inquiryPurpose"),
    g("material"),
    g("operationType"),
    g("machiningIntent"),
    g("toolTypeOrCurrentProduct"),
    g("diameterInfo"),
    g("country"),
  ].join("|")
}

function cleanMsg(m) {
  if (!m) return ""
  const s = String(m).trim()
  if (s.startsWith("🧭") || s === "(선택지 평가)") return ""
  return s.slice(0, 200)
}

// Bucket by form signature
const buckets = new Map() // sig → { good: [], bad: [] }
for (const e of all) {
  const sig = formSig(e.formSnapshot)
  if (!sig || sig === "-|-|-|-|-|-|-") continue
  if (!e.candidateHighlights || e.candidateHighlights.length < 3) continue
  const fb = e.feedback || e.responseFeedback
  if (fb !== "good" && fb !== "bad") continue
  if (!buckets.has(sig)) buckets.set(sig, { good: [], bad: [] })
  const bucket = buckets.get(sig)
  const record = {
    id: e.id,
    ts: e.timestamp || e.clientCapturedAt,
    msg: cleanMsg(e.lastUserMessage || e.userMessage),
    top: e.candidateHighlights.map(c => c.productCode).filter(Boolean),
    form: e.formSnapshot,
  }
  bucket[fb].push(record)
}

// Build goldcases
const cases = []
for (const [sig, bucket] of buckets) {
  if (bucket.good.length === 0) continue
  // latest good
  const latestGood = bucket.good.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""))[0]
  // All NL messages seen on this form (for seed diversity)
  const nlMessages = [...new Set(bucket.good.map(g => g.msg).filter(Boolean))]
  // Bad picks → must-exclude (only if they appear NOT in any good top-3)
  const goodTop3Union = new Set()
  for (const g of bucket.good) for (const p of g.top.slice(0, 3)) goodTop3Union.add(p)
  const badExcludes = [...new Set(
    bucket.bad.flatMap(b => b.top.slice(0, 5)).filter(p => !goodTop3Union.has(p))
  )].slice(0, 10)

  cases.push({
    sigHash: sig,
    formSnapshot: latestGood.form,
    nlMessages,
    expectedTop3: latestGood.top.slice(0, 3),
    expectedTop5: latestGood.top.slice(0, 5),
    expectedTop10: latestGood.top.slice(0, 10),
    badExcludes,
    goodSamples: bucket.good.length,
    badSamples: bucket.bad.length,
    latestId: latestGood.id,
    latestTs: latestGood.ts,
  })
}

// Sort by signal strength: good samples count desc
cases.sort((a, b) => (b.goodSamples + b.badSamples) - (a.goodSamples + a.badSamples))

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), total: cases.length, cases }, null, 2))

console.log(`[goldset] ${cases.length} unique form signatures`)
console.log(`[goldset] ${cases.filter(c => c.nlMessages.length > 0).length} have NL messages`)
console.log(`[goldset] ${cases.filter(c => c.badExcludes.length > 0).length} have bad excludes`)
console.log(`[goldset] saved → ${OUT}`)

// Top 5 summary
console.log("\ntop 5 by sample volume:")
for (const c of cases.slice(0, 5)) {
  const f = c.formSnapshot
  const mat = f.material?.value || "-"
  const op = f.operationType?.value || "-"
  const tool = f.toolTypeOrCurrentProduct?.value || "-"
  const dia = f.diameterInfo?.value || "-"
  console.log(`  [${c.goodSamples}g/${c.badSamples}b] ${mat} ${op} ${tool} ${dia} → ${c.expectedTop3.join(",")}`)
}
