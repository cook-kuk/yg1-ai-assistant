#!/usr/bin/env node
/**
 * ARIA Eval — Golden Set Full (367개 noPreState) 3단계 채점
 *
 * 채점:
 *   exact — field/op/value 모두 정확 일치
 *   soft  — 관대 매칭 (alias 치환 + op 호환: eq≈includes, between≈gte+lte)
 *   miss  — 위 둘 다 아님
 *
 * 출력:
 *   test-results/eval-golden-soft-결과.json     (failures 포함 JSON)
 *   test-results/eval-golden-qa-log.txt         (케이스별 상세 QA 로그)
 *   test-results/eval-golden-summary.txt        (사람이 읽는 요약)
 *
 * Usage:
 *   node scripts/eval-golden-full.mjs                    # 367 전부
 *   node scripts/eval-golden-full.mjs --limit=50         # 50개만
 *   node scripts/eval-golden-full.mjs --cat=A,C          # 카테고리 필터
 *   node scripts/eval-golden-full.mjs --parallel=6       # 동시 실행 (default 4)
 *   node scripts/eval-golden-full.mjs --include-prestate # preState 케이스도 포함
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"
import { callARIA } from "./eval-judge.mjs"

// .env.local
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] ?? true] : [a, true]
  })
)
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity
const CATS = args.cat ? String(args.cat).toUpperCase().split(",") : null
const PARALLEL = args.parallel ? parseInt(args.parallel, 10) : 4
const INCLUDE_PRESTATE = Boolean(args["include-prestate"])
const MAX_TURNS = args.turns ? parseInt(args.turns, 10) : 3  // 멀티턴 자동 채점 최대 턴
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? ""

// ═══ 골든셋 로드 ═══
const golden = JSON.parse(readFileSync("testset/golden-set-v1.json", "utf8"))
let cases = golden.cases.filter(c => Array.isArray(c.expected?.filtersAdded))
if (CATS) cases = cases.filter(c => CATS.includes(c.category))
if (!INCLUDE_PRESTATE) cases = cases.filter(c => !c.preState)
cases = cases.slice(0, LIMIT)

console.log(`\n🧪 Golden Full Eval (soft) — ${cases.length}개 (parallel=${PARALLEL})`)
console.log(`   카테고리: ${[...new Set(cases.map(c => c.category))].sort().join(",")}`)
if (!INCLUDE_PRESTATE) console.log(`   (preState 필요 케이스 제외됨)\n`)

// ═══ 필드 alias 매핑 (expected 골든셋 표기 → 실제 AppliedFilter.field) ═══
const FIELD_ALIAS = {
  OutsideDia: "diameterMm",
  NumberOfFlute: "fluteCount",
  OverAllLength: "overallLengthMm",
  LengthOfCut: "lengthOfCutMm",
  TaperAngle: "taperAngleDeg",
  HelixAngle: "helixAngleDeg",
  BallRadius: "ballRadiusMm",
  CornerRadius: "cornerRadiusMm",
  ShankDia: "shankDiameterMm",
  PointAngle: "pointAngleDeg",
  CoolantHole: "coolantHole",
  // ── Round 2 확대 ──
  NumberofFlute: "fluteCount",
  Coating: "coating",
  Cutter_Diameter: "diameterMm",
  ToolMaterial: "toolMaterial",
  RadiusAll: "ballRadiusMm",
  NeckDiameter: "neckDiameter",
  ShankType: "shankType",
  NeckLength: "neckLength",
  ThreadPitch: "threadPitch",
}
function canonField(f) {
  const s = String(f ?? "").trim()
  return FIELD_ALIAS[s] ?? s
}

// ═══ 값 정규화 ═══
function normVal(v) {
  if (v == null) return null
  if (Array.isArray(v)) return v.map(normVal)
  if (typeof v === "number") return String(v)
  return String(v).trim().toLowerCase().replace(/\s+/g, "").replace(/-/g, "")
}
function normFilter(f) {
  return {
    field: canonField(f.field),
    op: String(f.op ?? "eq").trim().toLowerCase(),
    value: normVal(f.rawValue ?? f.value),
    _raw: f,
  }
}

// ═══ op 호환 규칙 ═══
// exact: field/op/value 모두 일치
// soft: op만 호환 (eq↔includes), 나머지 동일
const OP_COMPAT = new Map([
  ["eq|includes", true], ["includes|eq", true],
])
function opCompat(a, b) {
  if (a === b) return "exact"
  if (OP_COMPAT.get(`${a}|${b}`)) return "soft"
  return "none"
}

function valuesEqual(ev, av) {
  if (ev == null) return true // 값 미지정 → field+op 만 맞으면 OK
  if (Array.isArray(ev) && Array.isArray(av)) {
    if (ev.length !== av.length) return false
    return ev.every((v, i) => v === av[i])
  }
  return String(ev) === String(av)
}

// between 을 (gte + lte) 2개로 분해
function expandBetween(filters) {
  const out = []
  for (const f of filters) {
    if (f.op === "between" && Array.isArray(f.value) && f.value.length >= 2) {
      out.push({ ...f, op: "gte", value: normVal(f.value[0]) })
      out.push({ ...f, op: "lte", value: normVal(f.value[1]) })
    } else if (f.op === "between" && f._raw && f._raw.rawValue2 != null) {
      out.push({ ...f, op: "gte", value: normVal(f._raw.rawValue) })
      out.push({ ...f, op: "lte", value: normVal(f._raw.rawValue2) })
    } else {
      out.push(f)
    }
  }
  return out
}

// ═══ 3단계 채점 ═══
function grade(expFiltersRaw, actFiltersRaw) {
  const expNorm = expFiltersRaw.map(normFilter)
  const actNorm = actFiltersRaw.map(normFilter)

  // 1) strict exact 채점
  let exactHits = 0
  const actUsedExact = new Set()
  const expMissExact = []
  for (const e of expNorm) {
    const idx = actNorm.findIndex((a, i) => !actUsedExact.has(i)
      && a.field === e.field
      && a.op === e.op
      && valuesEqual(e.value, a.value))
    if (idx >= 0) { exactHits++; actUsedExact.add(idx) }
    else expMissExact.push(e)
  }
  const isExact = expMissExact.length === 0 && actNorm.length === expNorm.length

  if (isExact) {
    return { kind: "exact", matched: exactHits, missing: [], extra: [], notes: [] }
  }

  // 2) soft 채점 — between 분해 + op 호환
  const expSoft = expandBetween(expNorm)
  const actSoft = expandBetween(actNorm)
  const actUsed = new Set()
  let softHits = 0
  const softNotes = []
  const missing = []

  for (const e of expSoft) {
    let bestIdx = -1
    let bestKind = "none" // exact > soft
    for (let i = 0; i < actSoft.length; i++) {
      if (actUsed.has(i)) continue
      const a = actSoft[i]
      if (a.field !== e.field) continue
      if (!valuesEqual(e.value, a.value)) continue
      const oc = opCompat(e.op, a.op)
      if (oc === "exact") { bestIdx = i; bestKind = "exact"; break }
      if (oc === "soft" && bestKind === "none") { bestIdx = i; bestKind = "soft" }
    }
    if (bestIdx >= 0) {
      softHits++
      actUsed.add(bestIdx)
      if (bestKind === "soft") {
        softNotes.push(`${e.field} op 불일치(${e.op}↔${actSoft[bestIdx].op})`)
      }
    } else {
      missing.push(e)
    }
  }
  const extra = actSoft.filter((_, i) => !actUsed.has(i))
  const allMatched = missing.length === 0

  if (allMatched && extra.length === 0) {
    return { kind: "soft", matched: softHits, missing: [], extra: [], notes: [...new Set(softNotes)] }
  }
  if (allMatched && extra.length > 0) {
    // expected 전부 매칭, 다만 실제가 더 많음 → 여전히 soft
    return { kind: "soft", matched: softHits, missing: [], extra, notes: [...new Set([...softNotes, "extra_filters"])] }
  }

  // miss 분류
  let missReason = "필터_필드_불일치"
  if (actNorm.length === 0) missReason = "빈배열_추출실패"
  else if (missing.every(e => actNorm.some(a => canonField(a.field) === e.field))) {
    missReason = missing.every(e => actNorm.some(a => canonField(a.field) === e.field && valuesEqual(e.value, a.value)))
      ? "op_불일치"
      : "값_불일치"
  }
  return { kind: "miss", matched: softHits, missing, extra, notes: [missReason] }
}

// ═══ LLM chip 선택기 (멀티턴용) ═══
// 기대 필터와 chip 목록을 보여주고 가장 근접한 chip 하나를 고르게 함.
// 전용 cue 사전 없이 LLM이 컨텍스트로 판단.
async function pickChipWithLLM(question, expected, chips, aiQuestion) {
  if (!OPENAI_KEY || !Array.isArray(chips) || chips.length === 0) return null
  const expStr = expected.map(fmtFilter).join(", ")
  const sys = `당신은 자동 평가 에이전트입니다. 사용자의 원본 질문과 기대 필터를 보고, AI가 제시한 chip 중 정답에 가장 가까운 하나를 골라 반환하세요.
규칙:
- 기대 필터의 field/op/value를 가장 잘 충족시키는 chip 선택.
- chip 레이블을 그대로(verbatim) 반환. 다른 텍스트 금지.
- 없으면 "직접 입력".`
  const usr = `원본 질문: "${question}"
기대 필터: ${expStr || "(없음)"}
AI 질문: "${aiQuestion ?? ""}"
chip 후보:
${chips.map((c, i) => `${i + 1}. ${c}`).join("\n")}

정답 chip 레이블 한 줄만:`
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
        max_tokens: 60,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    const raw = (data.choices?.[0]?.message?.content ?? "").trim().replace(/^["']|["']$/g, "")
    // chip 목록에서 정확/부분 매칭
    const exact = chips.find(c => c === raw)
    if (exact) return exact
    const partial = chips.find(c => raw.includes(c) || c.includes(raw))
    return partial ?? chips[0]
  } catch {
    return chips[0]
  }
}

// ═══ 한 케이스 실행 (최대 MAX_TURNS 턴) ═══
async function runOne(c) {
  const t0 = Date.now()
  const turnLog = []  // [{turn, input, filters, chips, ms}]
  try {
    const messages = [{ role: "user", text: c.input }]
    let prior = { session: null, candidates: null }
    let res = null
    let actualFilters = []
    let ps = {}
    let responseText = ""
    let chips = []
    let turnCount = 0

    for (let t = 1; t <= MAX_TURNS; t++) {
      turnCount = t
      const tTurn = Date.now()
      res = await callARIA(messages, prior)
      const turnMs = Date.now() - tTurn
      ps = res.session?.publicState ?? {}
      actualFilters = ps.appliedFilters ?? res.data?.appliedFilters ?? []
      responseText = res.text ?? res.data?.message?.text ?? res.message ?? ""
      chips = ps.displayedChips ?? res.chips ?? []
      turnLog.push({
        turn: t,
        input: messages[messages.length - 1]?.text ?? "",
        filters: actualFilters,
        chips,
        responseText,
        ms: turnMs,
      })
      // 필터 1개 이상 추출되면 종료
      if (actualFilters.length > 0) break
      // 마지막 턴이거나 chip 없으면 종료
      if (t === MAX_TURNS) break
      if (!chips || chips.length === 0) break
      // LLM이 chip 선택
      const pick = await pickChipWithLLM(c.input, c.expected.filtersAdded ?? [], chips, responseText)
      if (!pick) break
      messages.push({ role: "ai", text: responseText })
      messages.push({ role: "user", text: pick })
      prior = { session: res.session ?? null, candidates: res.candidates ?? null }
    }

    const ms = Date.now() - t0
    const actualRouter = ps.lastRouter ?? ps.router ?? res?.router ?? null
    const candidateCount = ps.candidateCount ?? (Array.isArray(res?.candidates) ? res.candidates.length : 0)
    const thinkingProcess = ps.thinkingProcess ?? res?.thinkingProcess ?? null
    const thinkingDeep = ps.thinkingDeep ?? res?.thinkingDeep ?? null

    const g = grade(c.expected.filtersAdded, actualFilters)
    const routerExpected = c.expected.router ?? null
    const routerMatch = routerExpected == null ? null : (actualRouter === routerExpected)

    return {
      id: c.id,
      category: c.category,
      input: c.input,
      ms,
      turns: turnCount,
      turnLog,
      expected: c.expected.filtersAdded,
      actual: actualFilters,
      expectedRouter: routerExpected,
      actualRouter,
      routerMatch,
      kind: g.kind,
      matched: g.matched,
      missing: g.missing,
      extra: g.extra,
      notes: g.notes,
      candidateCount,
      responseText,
      thinkingProcess,
      thinkingDeep,
      error: null,
    }
  } catch (e) {
    return {
      id: c.id,
      category: c.category,
      input: c.input,
      ms: Date.now() - t0,
      turns: turnLog.length,
      turnLog,
      kind: "miss",
      error: (e?.message ?? "unknown").slice(0, 200),
      expected: c.expected.filtersAdded,
      actual: [],
      expectedRouter: c.expected?.router ?? null,
      actualRouter: null,
      routerMatch: null,
      matched: 0,
      missing: (c.expected.filtersAdded ?? []).map(normFilter),
      extra: [],
      notes: ["ERROR"],
      candidateCount: 0,
      responseText: "",
      thinkingProcess: null,
      thinkingDeep: null,
    }
  }
}

// ═══ 병렬 실행 ═══
async function runAll(items, concurrency) {
  const results = []
  let idx = 0
  let done = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      const c = items[i]
      const r = await runOne(c)
      results[i] = r
      done++
      const icon = r.kind === "exact" ? "✅" : r.kind === "soft" ? "🟢" : r.error ? "💥" : "❌"
      const inputStr = String(r.input ?? c.input ?? "").slice(0, 40)
      const turnTag = r.turns && r.turns > 1 ? `·${r.turns}턴` : ""
      process.stdout.write(`${icon} [${done}/${items.length}] ${r.id} ${(r.ms/1000).toFixed(1)}s ${r.kind}${turnTag}  "${inputStr}"\n`)
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker)
  await Promise.all(workers)
  return results
}

// ═══ 포맷 유틸 ═══
function fmtFilter(f) {
  const field = canonField(f.field)
  const val = Array.isArray(f.rawValue ?? f.value)
    ? JSON.stringify(f.rawValue ?? f.value)
    : (f.rawValue ?? f.value)
  const v2 = f.rawValue2 != null ? `..${f.rawValue2}` : ""
  return `${field} ${f.op ?? "eq"} ${val}${v2}`
}
function secs(ms) { return (ms / 1000).toFixed(1) + "초" }

// ═══ 메인 ═══
const startAt = Date.now()
const results = await runAll(cases, PARALLEL)
const totalMs = Date.now() - startAt

// ═══ 집계 ═══
const exactN = results.filter(r => r.kind === "exact").length
const softN = results.filter(r => r.kind === "soft").length
const missN = results.filter(r => r.kind === "miss").length
const totalN = results.length
const exactRate = ((exactN / totalN) * 100).toFixed(1)
const softRate = (((exactN + softN) / totalN) * 100).toFixed(1)
const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / totalN)

// 속도 분포
const buckets = { under1: 0, "1to5": 0, "5to15": 0, "15to30": 0, "over30": 0 }
for (const r of results) {
  if (r.ms < 1000) buckets.under1++
  else if (r.ms < 5000) buckets["1to5"]++
  else if (r.ms < 15000) buckets["5to15"]++
  else if (r.ms < 30000) buckets["15to30"]++
  else buckets.over30++
}
const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5)

// miss 패턴 집계
const missPatterns = {}
for (const r of results.filter(x => x.kind === "miss")) {
  for (const n of (r.notes ?? ["기타"])) missPatterns[n] = (missPatterns[n] ?? 0) + 1
}
const topMissPatterns = Object.entries(missPatterns).sort((a, b) => b[1] - a[1]).slice(0, 5)

// 카테고리별
const catStat = {}
for (const r of results) {
  catStat[r.category] ??= { total: 0, exact: 0, soft: 0, miss: 0 }
  catStat[r.category].total++
  catStat[r.category][r.kind] = (catStat[r.category][r.kind] ?? 0) + 1
}

// ═══ 파일 1: JSON ═══
mkdirSync("test-results", { recursive: true })
const nowIso = new Date().toISOString()
const failures = results.filter(r => r.kind !== "exact").map(r => ({
  id: r.id,
  input: r.input,
  expected: r.expected,
  actual: r.actual,
  reason: r.notes?.join("; ") || r.error || r.kind,
  timeMs: r.ms,
  turns: r.turns ?? 1,
  turnLog: (r.turnLog ?? []).map(t => ({
    turn: t.turn, input: t.input, filtersCount: (t.filters ?? []).length, chips: t.chips ?? [],
  })),
}))
const jsonOut = {
  timestamp: nowIso,
  total: totalN,
  exact: exactN,
  soft: softN,
  miss: missN,
  exactRate: Number(exactRate),
  softRate: Number(softRate),
  totalTimeMs: totalMs,
  avgTimeMs: avgMs,
  failures,
}
writeFileSync("test-results/eval-golden-soft-결과.json", JSON.stringify(jsonOut, null, 2))

// ═══ 파일 2: QA log ═══
const qaLines = []
for (const r of results) {
  const expStr = (r.expected ?? []).map(fmtFilter).join(", ") || "(없음)"
  const actStr = (r.actual ?? []).map(f => fmtFilter(f)).join(", ") || "(없음)"
  const kindIcon = r.kind === "exact" ? "✅" : r.kind === "soft" ? "🟢 (alias/op 관대)" : "❌"
  const notesStr = r.notes?.length ? ` [${r.notes.join(", ")}]` : ""
  const turnTag = r.turns && r.turns > 1 ? ` ${r.turns}턴` : ""
  qaLines.push(`=== ${r.id} [${secs(r.ms)}${turnTag}] ===`)
  qaLines.push(`질문: ${r.input}`)
  qaLines.push(`기대 라우터: ${r.expectedRouter ?? "(미지정)"}`)
  qaLines.push(`실제 라우터: ${r.actualRouter ?? "(unknown)"}${r.routerMatch === false ? " ⚠️" : ""}`)
  qaLines.push(`기대 필터: ${expStr}`)
  qaLines.push(`실제 필터: ${actStr}`)
  qaLines.push(`채점: ${r.kind} ${kindIcon}${notesStr}`)
  qaLines.push(`턴 수: ${r.turns ?? 1}`)
  if (Array.isArray(r.turnLog) && r.turnLog.length > 1) {
    for (const t of r.turnLog) {
      const tf = (t.filters ?? []).map(fmtFilter).join(", ") || "(빈 배열)"
      const tc = (t.chips ?? []).length > 0 ? ` chips=[${t.chips.join(" | ")}]` : ""
      qaLines.push(`  · T${t.turn} [${secs(t.ms)}] "${String(t.input).slice(0, 50)}" → ${tf}${tc}`)
    }
  }
  qaLines.push(`후보 수: ${r.candidateCount}개`)
  qaLines.push(`응답 텍스트: ${r.responseText || "(없음)"}`)
  qaLines.push(`사고과정(CoT): ${r.thinkingProcess || "없음"}`)
  qaLines.push(`상세 사고(Deep): ${r.thinkingDeep || "없음"}`)
  qaLines.push(`추론 시간: ${secs(r.ms)}`)
  if (r.error) qaLines.push(`에러: ${r.error}`)
  qaLines.push(`---`)
  qaLines.push("")
}
writeFileSync("test-results/eval-golden-qa-log.txt", qaLines.join("\n"))

// ═══ 파일 3: summary ═══
const sumLines = []
sumLines.push(`═══ ARIA 골든셋 ${totalN}개 평가 결과 ═══`)
sumLines.push(`실행 시각: ${nowIso}`)
const totalMin = Math.floor(totalMs / 60000)
const totalSec = Math.floor((totalMs % 60000) / 1000)
sumLines.push(`총 소요 시간: ${totalMin}분 ${totalSec}초`)
sumLines.push(`평균 응답 시간: ${(avgMs / 1000).toFixed(1)}초`)
sumLines.push("")
sumLines.push(`정확도:`)
sumLines.push(`  exact: ${exactN}개 (${exactRate}%)`)
sumLines.push(`  soft:  ${softN}개 (${((softN/totalN)*100).toFixed(1)}%) ← 진짜 실력: ${softRate}%`)
sumLines.push(`  miss:  ${missN}개 (${((missN/totalN)*100).toFixed(1)}%)`)
sumLines.push("")

// ═══ 멀티턴 집계 ═══
// 1턴 softRate = 1턴에 filters 추출 성공한 케이스 / total
// N턴 softRate = N턴까지 누적 + 최종 soft/exact 비율
const turnBucket = { 1: 0, 2: 0, 3: 0, "4+": 0 }
let oneTurnHit = 0, twoTurnHit = 0, threeTurnHit = 0
for (const r of results) {
  const t = r.turns ?? 1
  if (t === 1) turnBucket[1]++
  else if (t === 2) turnBucket[2]++
  else if (t === 3) turnBucket[3]++
  else turnBucket["4+"]++
  const hit = r.kind === "exact" || r.kind === "soft"
  if (hit) {
    if (t === 1) oneTurnHit++
    if (t <= 2) twoTurnHit++
    if (t <= 3) threeTurnHit++
  }
}
const pct = n => ((n / totalN) * 100).toFixed(1)
sumLines.push(`멀티턴 분포:`)
sumLines.push(`  1턴 해결:  ${turnBucket[1]}개 (${pct(turnBucket[1])}%)`)
sumLines.push(`  2턴 필요:  ${turnBucket[2]}개 (${pct(turnBucket[2])}%)`)
sumLines.push(`  3턴 필요:  ${turnBucket[3]}개 (${pct(turnBucket[3])}%)`)
if (turnBucket["4+"] > 0) sumLines.push(`  4턴 이상:  ${turnBucket["4+"]}개`)
sumLines.push("")
sumLines.push(`누적 정답률:`)
sumLines.push(`  1턴까지:   ${oneTurnHit}/${totalN} (${pct(oneTurnHit)}%)`)
sumLines.push(`  2턴까지:   ${twoTurnHit}/${totalN} (${pct(twoTurnHit)}%)`)
sumLines.push(`  3턴까지:   ${threeTurnHit}/${totalN} (${pct(threeTurnHit)}%) ← 멀티턴 softRate`)
sumLines.push("")
sumLines.push(`속도 분포:`)
sumLines.push(`  1초 미만:  ${buckets.under1}개`)
sumLines.push(`  1~5초:    ${buckets["1to5"]}개`)
sumLines.push(`  5~15초:   ${buckets["5to15"]}개`)
sumLines.push(`  15~30초:  ${buckets["15to30"]}개`)
sumLines.push(`  30초 이상: ${buckets.over30}개`)
const maxR = slowest[0]
if (maxR) sumLines.push(`  최대: ${secs(maxR.ms)} (${maxR.id})`)
sumLines.push("")
sumLines.push(`Top 5 실패 패턴 (miss 기준):`)
if (topMissPatterns.length === 0) sumLines.push(`  (없음)`)
topMissPatterns.forEach(([k, n], i) => sumLines.push(`  ${i + 1}. ${k} — ${n}건`))
sumLines.push("")
sumLines.push(`실패 샘플 (가장 중요한 5개):`)
const failSamples = results.filter(r => r.kind === "miss").slice(0, 5)
for (const r of failSamples) {
  const expStr = (r.expected ?? []).map(fmtFilter).join(", ") || "(없음)"
  const actStr = (r.actual ?? []).map(fmtFilter).join(", ") || "(빈 배열)"
  const note = r.notes?.[0] ?? r.error ?? "miss"
  sumLines.push(`  ${r.id}: "${String(r.input).slice(0, 40)}" → 기대 ${expStr}, 실제 ${actStr} → ${note}`)
}
sumLines.push("")
sumLines.push(`Top 5 느린 케이스:`)
for (const r of slowest) {
  const cotLen = (r.thinkingProcess ?? "").length
  sumLines.push(`  ${r.id}: "${String(r.input).slice(0, 40)}" → ${secs(r.ms)}${cotLen > 0 ? ` (사고과정 ${cotLen}자)` : ""}`)
}
sumLines.push("")
sumLines.push(`카테고리별:`)
for (const [cat, s] of Object.entries(catStat).sort()) {
  const exactPct = ((s.exact / s.total) * 100).toFixed(0)
  const softPct = (((s.exact + (s.soft ?? 0)) / s.total) * 100).toFixed(0)
  sumLines.push(`  ${cat}: ${s.exact}/${s.total} exact (${exactPct}%), soft ${softPct}%`)
}
sumLines.push("")
sumLines.push(`═══ 끝 ═══`)
writeFileSync("test-results/eval-golden-summary.txt", sumLines.join("\n"))

// ═══ 콘솔 요약 ═══
console.log("\n" + "═".repeat(70))
console.log(`📊 골든셋 ${totalN}개 결과  (${secs(totalMs)})`)
console.log("═".repeat(70))
console.log(`  ✅ exact: ${exactN} (${exactRate}%)`)
console.log(`  🟢 soft:  ${softN} (누적 ${softRate}%)`)
console.log(`  ❌ miss:  ${missN}`)
console.log(`  평균 ${(avgMs/1000).toFixed(1)}초/건`)
console.log(`\n💾 저장:`)
console.log(`  test-results/eval-golden-soft-결과.json`)
console.log(`  test-results/eval-golden-qa-log.txt`)
console.log(`  test-results/eval-golden-summary.txt`)
