#!/usr/bin/env node
// Quick smoke test for machiningCategory + cuttingType KG routing.
// Expects dev server on http://localhost:3000.

const cases = [
  { label: "엔드밀 → Milling",      message: "엔드밀 추천해줘" },
  { label: "드릴 → Holemaking",     message: "드릴 추천해줘" },
  { label: "탭 → Threading",         message: "탭 추천해줘" },
  { label: "포켓 가공 → Pocket",     message: "포켓 가공 공구 추천해줘" },
  { label: "측면 가공 → Side_Milling", message: "측면 가공 공구 추천" },
  { label: "황삭 → Roughing",        message: "황삭용 엔드밀 추천" },
]

async function run() {
  for (const c of cases) {
    const sessionId = "smoke-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)
    try {
      const res = await fetch("http://localhost:3000/api/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          engine: "serve",
          language: "ko",
          messages: [{ role: "user", text: c.message }],
          sessionId,
        }),
      })
      const json = await res.json().catch(() => null)
      const rec = json?.recommendation ?? null
      const products = rec?.products ?? rec?.candidates ?? json?.candidates ?? []
      const purpose = json?.purpose ?? "?"
      const appliedFilters = json?.session?.publicState?.appliedFilters
        ?? json?.sessionState?.appliedFilters
        ?? rec?.appliedFilters
        ?? []
      const filterFields = (Array.isArray(appliedFilters) ? appliedFilters : [])
        .map(f => `${f.field}=${Array.isArray(f.value) ? f.value.join("|") : f.value}`)
      const text = (json?.text ?? "").slice(0, 80).replace(/\s+/g, " ")
      const productCount = Array.isArray(products) ? products.length : (typeof products === "number" ? products : "?")
      console.log(`${c.label.padEnd(30)} → products=${String(productCount).padStart(3)} purpose=${purpose} filters=[${filterFields.join(", ")}] :: ${text}`)
    } catch (e) {
      console.log(`${c.label.padEnd(28)} → ERROR ${e.message}`)
    }
  }
}
run()
