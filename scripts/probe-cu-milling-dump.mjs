#!/usr/bin/env node
// 구리 밀링 첫 턴의 응답 JSON 전체 구조를 덤프해서 어디서 0개가 되는지 파악
const BASE = "http://20.119.98.136:3000"
async function main() {
  const r = await fetch(`${BASE}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", text: "구리 밀링" }], sessionId: `cu-${Date.now()}` }),
  })
  const json = await r.json()
  console.log("status=", r.status)
  console.log("top-level keys:", Object.keys(json))
  console.log("---")
  const pick = (o, ks) => Object.fromEntries(ks.filter(k => o && k in o).map(k => [k, o[k]]))
  console.log("recommendations:", JSON.stringify(json.recommendations ?? json.products ?? []).slice(0, 500))
  console.log("chips:", JSON.stringify(json.chips ?? []))
  console.log("questions:", JSON.stringify(json.questions ?? []))
  console.log("session keys:", Object.keys(json.session ?? {}))
  console.log("narrowingState keys:", Object.keys(json.narrowingState ?? json.session?.narrowingState ?? {}))
  const ns = json.narrowingState ?? json.session?.narrowingState ?? {}
  console.log("narrowing.filters:", JSON.stringify(ns.filters ?? ns.appliedFilters ?? []).slice(0, 600))
  console.log("narrowing.input:", JSON.stringify(ns.input ?? ns.resolvedInput ?? {}).slice(0, 600))
  console.log("narrowing.candidateCount:", ns.candidateCount)
  console.log("narrowing.poolCount:", ns.poolCount ?? ns.fullPoolCount)
  const meta = json.meta ?? {}
  console.log("meta keys:", Object.keys(meta))
  console.log("meta.orchestratorResult:", JSON.stringify(meta.orchestratorResult ?? {}).slice(0, 800))
  console.log("meta.extractedField:", JSON.stringify(meta.extractedField ?? {}).slice(0, 400))
  console.log("assistantMessage:", json.assistantMessage ?? json.message)
  console.log("\n--- FULL JSON (truncated) ---")
  console.log(JSON.stringify(json).slice(0, 3500))
}
main().catch(e => { console.error(e); process.exit(1) })
