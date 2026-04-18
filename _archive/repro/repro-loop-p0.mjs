// P0 runaway-loop reproduction: "직경 10mm 이상만" across multiple turns.
// Before fix: toolSubtype ASK repeats every turn indefinitely.
// After fix: askedFields accumulates; ASK cycles to different fields or safe-escapes
// to recommendation at history.length >= 3.
const API = process.env.API_URL || "http://127.0.0.1:3000/api/recommend"

const baseIntake = {
  inquiryPurpose: { status: "unanswered" },
  material: { status: "unanswered" },
  operationType: { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: { status: "unanswered" },
  diameterInfo: { status: "unanswered" },
  country: { status: "unanswered" },
}

async function turn(label, messages, sessionState) {
  const body = {
    engine: "serve",
    intakeForm: baseIntake,
    messages,
    sessionState,
    displayedProducts: null,
    language: "ko",
  }
  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60_000)
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    const j = await res.json().catch(() => ({}))
    const engineState = j?.session?.engineState ?? j?.session?.publicState ?? {}
    const ms = Date.now() - t0
    const text = (j?.response?.text ?? j?.text ?? "").slice(0, 90).replace(/\n/g, " ")
    console.log(
      `[${label}] ${ms}ms purpose=${j?.response?.purpose ?? j?.purpose} ` +
      `mode=${engineState?.currentMode ?? "?"} ` +
      `lastAsked=${engineState?.lastAskedField ?? "?"} ` +
      `cands=${engineState?.candidateCount ?? "?"} ` +
      `historyLen=${(engineState?.narrowingHistory ?? []).length} ` +
      `historyAskedFields=[${(engineState?.narrowingHistory ?? []).map(t => t.askedField ?? "_").join(",")}]`
    )
    console.log(`[${label}] text: ${text}`)
    return { engineState, response: j }
  } catch (e) {
    clearTimeout(timer)
    console.log(`[${label}] ERROR ${Date.now() - t0}ms ${e.name}: ${e.message}`)
    return null
  }
}

function nextMessages(prevMessages, assistantText, userText) {
  return [
    ...prevMessages,
    { role: "ai", text: assistantText ?? "" },
    { role: "user", text: userText },
  ]
}

console.log(`[repro-loop-p0] API=${API}`)
const messages1 = [{ role: "user", text: "엔드밀 추천해줘" }]
const r1 = await turn("t1", messages1, null)
if (!r1) process.exit(1)

const messages2 = nextMessages(messages1, r1.response?.response?.text ?? r1.response?.text ?? "", "직경 10mm 이상만")
const sessionState2 = r1.response?.session ?? null
const r2 = await turn("t2", messages2, sessionState2)
if (!r2) process.exit(1)

const messages3 = nextMessages(messages2, r2.response?.response?.text ?? r2.response?.text ?? "", "날 4개로")
const sessionState3 = r2.response?.session ?? null
const r3 = await turn("t3", messages3, sessionState3)
if (!r3) process.exit(1)

const messages4 = nextMessages(messages3, r3.response?.response?.text ?? r3.response?.text ?? "", "코팅은 아무거나")
const sessionState4 = r3.response?.session ?? null
const r4 = await turn("t4", messages4, sessionState4)
if (!r4) process.exit(1)

// Success criterion: across 4 turns, we should NOT keep asking the same field.
const asked = [r1, r2, r3, r4]
  .map(r => r?.engineState?.lastAskedField)
  .filter(Boolean)
console.log(`\n[summary] lastAskedField sequence: ${asked.join(" → ")}`)
const allSame = asked.length > 1 && asked.every(f => f === asked[0])
if (allSame) {
  console.log(`[FAIL] same field asked every turn — runaway loop NOT fixed`)
  process.exit(2)
} else {
  console.log(`[PASS] question field varied across turns — loop guard working`)
}
