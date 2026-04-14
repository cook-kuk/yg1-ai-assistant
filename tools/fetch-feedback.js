#!/usr/bin/env node
/**
 * Pull feedback entries from :3001/api/feedback and convert to replay test cases.
 * Saves to testset/autohunt/feedback-cases.json
 */
const fs = require("fs"), path = require("path")
const URL = process.argv[2] || "http://20.119.98.136:3001/api/feedback?limit=500"
const OUT = path.join(__dirname, "..", "testset", "autohunt", "feedback-cases.json")

;(async () => {
  console.log("[fetch-feedback] GET", URL)
  const res = await fetch(URL)
  const data = await res.json()
  const entries = data.generalEntries || data.entries || data || []
  console.log(`[fetch-feedback] ${entries.length} entries`)

  const cases = entries
    .filter(e => e.formSnapshot && Array.isArray(e.chatHistory) && e.chatHistory.length > 0)
    .map((e, i) => {
      // Extract user NL turns (skip the first "intake summary" formatted one)
      const userMsgs = e.chatHistory.filter(m => m.role === "user").map(m => m.text)
      const intakeIdx = userMsgs.findIndex(t => /🧭|문의 목적/.test(t))
      const nls = userMsgs.slice(intakeIdx + 1).filter(Boolean)
      return {
        id: `fb-${e.id || i}`,
        source: "feedback",
        name: (e.comment || e.intakeSummary || "").slice(0, 60).replace(/\s+/g, " "),
        form: e.formSnapshot,
        nls,
        expectedRecommendation: e.recommendationSummary || null,
        userComment: e.comment || null,
        tags: e.tags || [],
        rating: e.rating ?? null,
        timestamp: e.timestamp,
        // No deterministic db ground truth — use as regression detector
        groundTruthMode: "regression",
      }
    })
    .filter(c => c.nls.length > 0)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(cases, null, 2))
  console.log(`[fetch-feedback] saved ${cases.length} replay cases → ${OUT}`)
  // tag distribution
  const tags = {}
  cases.forEach(c => (c.tags || []).forEach(t => { tags[t] = (tags[t] || 0) + 1 }))
  console.log("[fetch-feedback] tags:", tags)
})().catch(e => { console.error("FATAL:", e); process.exit(1) })
