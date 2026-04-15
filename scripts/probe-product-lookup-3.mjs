#!/usr/bin/env node
const URL = "http://localhost:3000/api/recommend"
const CASES = [
  "CE7659120 날장길이 얼마?",
  "CE7659120 코팅 뭐야?",
  "CE7659120 코너R 얼마?",
]
for (const input of CASES) {
  const t0 = Date.now()
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", text: input }],
      form: {}, prevState: null, displayedProducts: null, language: "ko",
    }),
  })
  const j = await res.json()
  const ms = Date.now() - t0
  const hasCard = !!j.recommendation
  const text = String(j.text ?? "").slice(0, 240).replace(/\n/g, " / ")
  console.log(`\n[${input}] (${ms}ms)`)
  console.log(`  purpose : ${j.purpose}`)
  console.log(`  card?   : ${hasCard ? "YES (BAD)" : "NO (good)"}`)
  console.log(`  text    : ${text}`)
}
