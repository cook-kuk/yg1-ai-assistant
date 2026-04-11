#!/usr/bin/env node
/* Narrow test for issue #4 — KG field additions */
const API = process.env.API || "http://20.119.98.136:3000/api/recommend"

function makeForm() {
  return {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "unanswered" },
    operationType: { status: "unanswered" },
    machiningIntent: { status: "unanswered" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "unanswered" },
    country: { status: "unanswered" },
  }
}

async function once(text) {
  const body = { engine: "serve", intakeForm: makeForm(), messages: [{ role: "user", text }], sessionState: null, displayedProducts: null, language: "ko" }
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const j = await res.json()
  const state = j?.session?.engineState || j?.sessionState
  const filters = state?.appliedFilters || []
  return filters.filter(f => f.op !== "skip").map(f => `${f.field}=${JSON.stringify(f.value)}`)
}

;(async () => {
  const cases = [
    "테이퍼각 5도 엔드밀 추천",
    "taper 3도 엔드밀",
    "비틀림각 45도 엔드밀",
    "헬릭스 45도 엔드밀",
    "HSK 생크 엔드밀",
    "원통 생크 엔드밀",
    "스트레이트 생크 엔드밀",
    "코너 R 0.5 엔드밀",
    "corner radius 0.5 엔드밀",
    "볼 반경 1mm 엔드밀",
  ]
  for (const c of cases) {
    const fs = await once(c)
    console.log(`  "${c}" → ${fs.join(", ") || "(none)"}`)
  }
})()
