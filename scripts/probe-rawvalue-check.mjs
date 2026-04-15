#!/usr/bin/env node
const URL = "http://localhost:3000/api/recommend"
const inputs = ["직경 10 이상", "RPM 5000 이상인 제품 찾아줘", "헬릭스각 45도", "전장 100"]
for (const input of inputs) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", text: input }],
      form: {}, prevState: null, displayedProducts: null, language: "ko",
    }),
  })
  const j = await res.json()
  const af = j?.session?.publicState?.appliedFilters ?? []
  console.log(`\n[${input}]`)
  console.log(`  candidateCount(top): ${j?.session?.publicState?.candidateCount}`)
  console.log(`  narrowAfter        : ${j?.session?.publicState?.narrowingHistory?.[0]?.candidateCountAfter}`)
  for (const f of af) {
    console.log(`  ${f.field} ${f.op}  value="${f.value}"  rawValue=${JSON.stringify(f.rawValue)} (typeof ${typeof f.rawValue})`)
  }
  if (af.length === 0) console.log("  (no filters)")
}
