#!/usr/bin/env node
const URL = "http://localhost:3000/api/recommend"
const body = {
  messages: [{ role: "user", text: "직경 10 이상" }],
  form: {}, prevState: null, displayedProducts: null, language: "ko",
}
const res = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})
const json = await res.json()
const keys = Object.keys(json)
console.log("top-level keys:", keys.join(", "))
console.log("\nsessionState:", JSON.stringify(json.sessionState, null, 2))
console.log("\nsession:", JSON.stringify(json.session, null, 2))
console.log("\ncandidates length:", Array.isArray(json.candidates) ? json.candidates.length : "(not array)")
console.log("\npagination:", JSON.stringify(json.pagination, null, 2))
console.log("\nrequestPreparation:", JSON.stringify(json.requestPreparation, null, 2)?.slice(0, 800))
console.log("\nrecommendation:", JSON.stringify(json.recommendation, null, 2)?.slice(0, 800))
