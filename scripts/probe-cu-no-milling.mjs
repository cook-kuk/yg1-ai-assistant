#!/usr/bin/env node
const URL = "http://20.119.98.136:3000/api/recommend"
async function probe(input) {
  const res = await fetch(URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", text: input }], form: {}, prevState: null, displayedProducts: null, language: "ko" }),
  })
  const j = await res.json()
  const af = j?.session?.publicState?.appliedFilters ?? []
  const cnt = j?.session?.publicState?.candidateCount
  console.log(`\nQ: ${input}`)
  console.log(`  candidateCount: ${cnt}`)
  console.log(`  appliedFilters:`)
  for (const f of af) console.log(`    · ${f.field} ${f.op} ${JSON.stringify(f.value ?? f.rawValue)}`)
  console.log(`  text: ${String(j.text ?? "").slice(0, 300).replace(/\n/g, " / ")}`)
}
async function main() {
  await probe("구리 공구 추천해줘")
  await probe("구리 가공용 공구 추천해줘")
  await probe("구리 추천")
}
main().catch(e => { console.error(e); process.exit(1) })
