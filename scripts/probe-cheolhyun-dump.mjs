#!/usr/bin/env node
const URL = "http://20.119.98.136:3000/api/recommend"
async function main() {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", text: "직경 10 이상" }],
      form: {}, prevState: null, displayedProducts: null, language: "ko",
    }),
  })
  const j = await res.json()
  console.log("=== session ===")
  console.log(JSON.stringify(j.session, null, 2)?.slice(0, 1500))
  console.log("\n=== requestPreparation ===")
  console.log(JSON.stringify(j.requestPreparation, null, 2)?.slice(0, 1500))
  console.log("\n=== extractedField ===")
  console.log(JSON.stringify(j.extractedField, null, 2)?.slice(0, 1000))
  console.log("\n=== candidateSnapshot keys ===")
  console.log(j.candidateSnapshot ? Object.keys(j.candidateSnapshot) : "(none)")
  console.log("candidateSnapshot.count:", j.candidateSnapshot?.count ?? j.candidateSnapshot?.totalCount)
  console.log("\n=== last 3 debugTrace events ===")
  const ev = j.meta?.debugTrace?.events ?? []
  console.log(`total events: ${ev.length}`)
  for (const e of ev.slice(-5)) {
    console.log(`- step=${e.step} cat=${e.category} latency=${e.latencyMs}ms`)
    console.log(`  in: ${JSON.stringify(e.inputSummary).slice(0, 250)}`)
    console.log(`  out: ${JSON.stringify(e.outputSummary).slice(0, 250)}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
