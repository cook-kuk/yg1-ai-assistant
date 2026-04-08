/**
 * Multi-turn UI mirror stress test
 *
 * UI 동작 미러:
 *   Turn 0: form submit (intake summary user msg)
 *   Turn N: prev session + (옵션) displayedProducts + accumulated messages + new user NL
 *
 * 비교 기준: response.session.publicState.candidateCount (UI가 화면에 표시하는 narrowing 결과)
 *
 * usage:
 *   node multiturn-stress.js <ENDPOINT> [--mode=A|C] [--cases=1,2,3] [--out=name]
 *     ENDPOINT: http://20.119.98.136:2999 (suchan) | http://20.119.98.136:3000 (mine)
 *     --mode=A: displayedProducts echo (안전)
 *     --mode=C: displayedProducts 생략 (간결, 검증 필요)
 *     --cases=1,2  : 특정 케이스만 (1-indexed)
 */
const fs = require("fs")
const path = require("path")

const argv = process.argv.slice(2)
const ENDPOINT = argv.find(a => a.startsWith("http")) || "http://20.119.98.136:2999"
const MODE = (argv.find(a => a.startsWith("--mode="))?.split("=")[1] || "A").toUpperCase()
const CASES = argv.find(a => a.startsWith("--cases="))?.split("=")[1]?.split(",").map(Number) || null
const OUT_NAME = argv.find(a => a.startsWith("--out="))?.split("=")[1] || `multiturn-${ENDPOINT.includes("2999") ? "suchan" : "mine"}-${MODE}`

const STAMP = new Date().toISOString().replace(/[:.]/g, "-")
const OUT_JSON = path.join(__dirname, `${OUT_NAME}-${STAMP}.json`)

// ── intake form 빌더 ──
const known = v => ({ status: "known", value: v })
const form = ({ purpose = "new", material, op, tool, diameter, country = "ALL" }) => ({
  inquiryPurpose: known(purpose),
  material: material ? known(material) : { status: "unanswered" },
  operationType: op ? known(op) : { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: tool ? known(tool) : { status: "unanswered" },
  diameterInfo: diameter ? known(diameter) : { status: "unanswered" },
  country: known(country),
})

// ── intake summary text (UI가 자동 생성하는 첫 user msg) ──
// 캡처된 payload 기준 형식 정확 미러
const PURPOSE_LABELS = {
  new: "신규 제품 추천",
  substitute: "YG-1 대체품 찾기",
  inventory_substitute: "재고 대체품 찾기",
  cutting_condition: "가공 조건 참고",
  product_lookup: "현재 제품 정보 확인",
}
const MATERIAL_LABELS = { P: "탄소강", M: "스테인리스강", K: "주철", N: "비철금속", S: "초내열합금", H: "고경도강" }

function intakeSummaryText(form) {
  const lines = []
  const v = key => form[key]?.status === "known" ? form[key].value : null
  if (v("inquiryPurpose")) lines.push(`🧭 문의 목적: ${PURPOSE_LABELS[v("inquiryPurpose")] || v("inquiryPurpose")}`)
  if (v("material")) {
    const mats = String(v("material")).split(",").map(m => MATERIAL_LABELS[m.trim()] || m.trim()).join(", ")
    lines.push(`🧱 가공 소재: ${mats}`)
  }
  if (v("operationType")) lines.push(`📐 가공 형상: ${v("operationType")}`)
  if (v("toolTypeOrCurrentProduct")) lines.push(`🛠️ 가공 방식: ${v("toolTypeOrCurrentProduct")}`)
  if (v("diameterInfo")) lines.push(`📏 공구 직경: ${v("diameterInfo")}`)
  if (v("country")) lines.push(`🌐 국가: ${v("country")}`)
  return lines.join("\n") + "\n\n위 조건에 맞는 YG-1 제품을 추천해 주세요."
}

// ── 25 케이스 — 기존 stress와 동일 ──
const TESTS = [
  { name: "베이스: 탄소강 슬로팅 밀링 10mm", form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }), nl: [] },
  { name: "다중소재: P+M+K, 6mm, 4G MILLS", form: form({ material: "P,M,K", op: "Side_Milling", tool: "Milling", diameter: "6mm" }), nl: ["다양한 소재 다 가능한 거 추천"] },
  { name: "직경 범위: 8~12mm 슬로팅", form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }), nl: ["직경 8mm 이상 12mm 이하 제품만 보여줘"] },
  { name: "OAL ≥100mm", form: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "10mm" }), nl: ["전체 길이 100mm 이상인 것만"] },
  { name: "OAL ≤80mm", form: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "10mm" }), nl: ["전체 길이 80mm 이하 짧은 거"] },
  { name: "4날 고정", form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }), nl: ["4날만"] },
  { name: "날수 ≥5", form: form({ material: "S", op: "Slotting", tool: "Milling", diameter: "12mm" }), nl: ["날수 5개 이상"] },
  { name: "T-Coating 한정", form: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "8mm" }), nl: ["T-Coating만"] },
  { name: "코팅 없는 것 (bright finish)", form: form({ material: "N", op: "Side_Milling", tool: "Milling", diameter: "6mm" }), nl: ["비철용인데 코팅 없는 거 (bright finish)"] },
  { name: "재고 있는 것만", form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }), nl: ["재고 있는 거만 보여줘"] },
  { name: "재고 즉시 출하", form: form({ material: "M", op: "Slotting", tool: "Milling", diameter: "8mm" }), nl: ["재고 있고 빠른 납기 가능한 거"] },
  { name: "X5070 브랜드만", form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }), nl: ["X5070 브랜드로만"] },
  { name: "ALU-POWER 제외", form: form({ material: "N", op: "Side_Milling", tool: "Milling", diameter: "8mm" }), nl: ["ALU-POWER는 빼고"] },
  { name: "4중: φ10 OAL≥100 4F TiAlN", form: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "10mm" }), nl: ["직경 10mm 4날 전장 100 이상 TiAlN 코팅"] },
  { name: "5중+범위: φ8~12 OAL≥80 4F P/M N-coat 재고", form: form({ material: "P,M", op: "Slotting", tool: "Milling", diameter: "10mm" }), nl: ["직경 8~12mm, 전장 80 이상, 4날, TiAlN 코팅, 재고 있는 거"] },
  { name: "헬릭스 ≥45°", form: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "10mm" }), nl: ["헬릭스 각도 45도 이상"] },
  { name: "Shank 6~10", form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "8mm" }), nl: ["샹크 직경 6에서 10 사이"] },
  { name: "CL ≥20mm", form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }), nl: ["절삭 길이(날장) 20mm 이상"] },
  { name: "Drill point angle 140°", form: form({ material: "P", op: "Drilling", tool: "Holemaking", diameter: "8mm" }), nl: ["포인트 각도 140도"] },
  { name: "Drill OAL≥100 + 쿨런트홀", form: form({ material: "P", op: "Drilling", tool: "Holemaking", diameter: "10mm" }), nl: ["전장 100 이상이고 쿨런트홀 있는 거"] },
  { name: "Tap M10 1.5pitch", form: form({ material: "P", op: "Threading_Through", tool: "Threading", diameter: "10mm" }), nl: ["M10 P1.5 관통탭"] },
  { name: "터무니없는 직경 999mm", form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "999mm" }), nl: ["직경 999mm 추천"] },
  { name: "모순: 직경 ≥20 ≤5", form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }), nl: ["직경 20 이상이면서 5 이하"] },
  { name: "1/4인치 (6.35mm)", form: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "1/4인치" }), nl: ["1/4인치 4날 추천"] },
  { name: "KOREA + φ10 4F P TiAlN OAL≥100 재고", form: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm", country: "KOREA" }), nl: ["한국 재고로 4날 TiAlN 전장 100 이상"] },
]

// ── 한 케이스 multi-turn 실행 ──
async function runCase(test, mode) {
  const t0 = Date.now()
  let session = null
  let displayedProducts = null
  const turns = []

  // intake summary (Turn 1+ history에만 추가)
  const intakeMsg = intakeSummaryText(test.form)

  // Turn 0: form submit only — messages=[] per captured UI payload
  const turn0Payload = {
    intakeForm: test.form,
    messages: [],
    session: null,
    pagination: { page: 0, pageSize: 1000 },
    language: "ko",
    ...(mode === "A" ? { displayedProducts: null } : {}),
  }
  let turn0Resp
  try {
    const r = await fetch(`${ENDPOINT}/api/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-precision-match": "1", "x-disable-kg": "1" },
      body: JSON.stringify(turn0Payload),
    })
    turn0Resp = await r.json()
  } catch (e) {
    return { name: test.name, error: `Turn 0: ${e.message}`, ms: Date.now() - t0 }
  }
  session = turn0Resp.session ?? null
  displayedProducts = turn0Resp.candidates ?? null
  const aiText0 = typeof turn0Resp.text === "string" ? turn0Resp.text : ""
  turns.push({
    turn: 0,
    candidateCount: turn0Resp.session?.publicState?.candidateCount ?? null,
    candidatesLen: (turn0Resp.candidates || []).length,
    purpose: turn0Resp.purpose,
    aiPreview: aiText0.slice(0, 80),
  })

  // Turn 1+: NL messages — UI는 history에 [intake user msg, ai answer, ...prev turns..., new user NL] 누적
  const messages = []
  let lastAiText = aiText0
  for (let i = 0; i < test.nl.length; i++) {
    if (i === 0) {
      // 첫 NL turn: history의 시작은 intake summary user msg + Turn 0의 AI 응답
      messages.push({ role: "user", text: intakeMsg })
      messages.push({ role: "ai", text: lastAiText || "" })
    } else {
      // 이후 NL turn: 직전 AI 응답 추가
      messages.push({ role: "ai", text: lastAiText || "" })
    }
    messages.push({ role: "user", text: test.nl[i] })

    const payload = {
      intakeForm: test.form,
      messages: [...messages],
      session,
      pagination: { page: 0, pageSize: 1000 },
      language: "ko",
      ...(mode === "A" ? { displayedProducts } : {}),
    }
    let resp
    try {
      const r = await fetch(`${ENDPOINT}/api/recommend`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-precision-match": "1", "x-disable-kg": "1" },
        body: JSON.stringify(payload),
      })
      resp = await r.json()
    } catch (e) {
      return { name: test.name, error: `Turn ${i + 1}: ${e.message}`, ms: Date.now() - t0, turns }
    }
    session = resp.session ?? session
    displayedProducts = resp.candidates ?? displayedProducts
    const aiTextN = typeof resp.text === "string" ? resp.text : ""
    lastAiText = aiTextN
    turns.push({
      turn: i + 1,
      nl: test.nl[i],
      candidateCount: resp.session?.publicState?.candidateCount ?? null,
      candidatesLen: (resp.candidates || []).length,
      appliedFilters: resp.session?.publicState?.appliedFilters ?? [],
      purpose: resp.purpose,
      aiPreview: aiTextN.slice(0, 80),
      sampleProducts: (resp.candidates || []).slice(0, 3).map(p => ({
        code: p.code, series: p.series, brand: p.brand,
        diameter: p.diameter, flute: p.flute, oal: p.oal ?? null, cl: p.cl ?? null,
        coating: p.coating,
      })),
    })
  }

  return {
    name: test.name,
    ms: Date.now() - t0,
    turns,
    finalCandidateCount: turns[turns.length - 1].candidateCount,
    finalCandidatesLen: turns[turns.length - 1].candidatesLen,
    finalAppliedFilters: turns[turns.length - 1].appliedFilters || [],
  }
}

async function main() {
  console.log(`\n[multiturn-stress] target=${ENDPOINT} mode=${MODE}`)
  const cases = CASES ? TESTS.filter((_, i) => CASES.includes(i + 1)) : TESTS
  console.log(`Running ${cases.length} cases...\n`)

  const results = []
  for (let i = 0; i < cases.length; i++) {
    const t = cases[i]
    const idx = TESTS.indexOf(t) + 1
    process.stdout.write(`[${String(idx).padStart(2, "0")}] ${t.name.padEnd(40)} `)
    const r = await runCase(t, MODE)
    r.caseIndex = idx
    results.push(r)
    if (r.error) {
      console.log(`ERROR ${r.error}`)
    } else {
      console.log(`${r.ms}ms  finalCand=${r.finalCandidateCount} (resp len ${r.finalCandidatesLen})  filters=${(r.finalAppliedFilters || []).length}`)
    }
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify({ endpoint: ENDPOINT, mode: MODE, runAt: new Date().toISOString(), results }, null, 2))
  console.log(`\nresults → ${OUT_JSON}`)
}

main().catch(e => { console.error("FATAL:", e); process.exit(1) })
