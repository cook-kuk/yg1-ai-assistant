#!/usr/bin/env node
/**
 * ARIA Eval-Driven Development — LLM-as-Judge
 *
 * Usage: node scripts/eval-judge.mjs
 *
 * 테스트 → 채점 → 리포트를 자동 반복.
 * 점수가 낮은 항목을 찾아 어디를 고쳐야 하는지 알려줌.
 */

// .env.local 자동 로드
import { readFileSync, existsSync, readdirSync } from "fs"
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const ARIA_API = process.env.ARIA_API || "http://20.119.98.136:3000/api/recommend"
const OPENAI_API = "https://api.openai.com/v1/chat/completions"
const OPENAI_KEY = process.env.OPENAI_API_KEY

// ═══ v3 시나리오 10개 (고정, 추가 금지) ═══

const SCENARIOS = [
  { id: "S01", input: "스테인리스 4날 10mm 추천해줘",
    expect: "필터 3개(소재+날수+직경), 제품 카드 표시, 자연스러운 추천" },
  { id: "S02", input: "직경 10mm 이상만",
    expect: "diameterMm gte 10 (eq 아님!). 전장 안 잡힘" },
  { id: "S03", input: "CRX S 빼고 추천해줘",
    expect: "brand neq CRX-S. 제품 카드 표시 (질문만 하지 말고)" },
  { id: "S04", input: "헬릭스가 뭐야?",
    expect: "헬릭스 = 날의 비틀림 각도 설명. 필터 안 걸림. '직경 얼마?' 아님" },
  { id: "S05", input: "공구 수명이 너무 짧아",
    expect: "원인 분석(절삭속도/코팅/가공경화). '직경 얼마?' 아님" },
  { id: "S06", input: "AlCrN이랑 TiAlN 뭐가 나아? 스테인리스인데",
    expect: "비교 분석 + 스테인리스 기반 AlCrN 추천" },
  { id: "S07", input: "100mm 이상이면 좋겠어",
    expect: "직경 gte 100. 전장 안 잡힘 (eq 100 아님!)" },
  { id: "S08", input: "스텐인리스 4낭 10mn",
    expect: "오타 이해 → 스테인리스 4날 10mm 처리" },
  { id: "S09", input: "우리 공장에서 SUS316L 많이 하는데 괜찮은 거?",
    expect: "SUS316L=스테인리스 매칭 + 추천" },
  { id: "S10", input: "아무거나 빨리 10mm",
    expect: "즉시 1~2문장 추천. 추가 질문 최소화" },
]

// ═══ Phase A: 동적 시나리오 확장 ═══

const SYNONYM_MAP = {
  "스테인리스": ["스텐", "SUS304", "SUS316L", "스뎅", "sus"],
  "4날": ["네날", "4F", "4 flute", "사날"],
  "10mm": ["10파이", "φ10", "직경10"],
  "이상": ["넘는", "초과", "위로", "보다 큰", "이상이면 좋겠어"],
  "이하": ["미만", "아래", "보다 작은", "안 넘는"],
  "빼고": ["제외", "말고", "없이", "아닌 거", "빼줘"],
  "추천해줘": ["보여줘", "있어?", "뭐가 좋아?", "골라줘"],
  "뭐야": ["뭔데", "알려줘", "설명해줘", "뭐임", "뭔가요"],
  "짧아": ["너무 짧아", "금방 닳아", "오래 못 써", "수명이 안 나와"],
  "떨림": ["진동", "채터", "흔들림", "떨려"],
}

export function mutateFromFailures(results) {
  const fails = (results ?? [])
    .filter(r => r.grade && (r.grade.total ?? 25) < 20 && !r.error)
    .slice(0, 5)
  const out = []
  for (const r of fails) {
    const orig = r.input ?? ""
    const hitKey = Object.keys(SYNONYM_MAP).find(k => orig.includes(k))
    if (!hitKey) continue
    const syns = SYNONYM_MAP[hitKey]
    const pick = syns[Math.floor(Math.random() * syns.length)]
    const mutated = orig.replace(hitKey, pick)
    if (mutated === orig) continue
    out.push({
      id: `MUT_${r.id}_${Date.now().toString(36)}`,
      input: mutated,
      phase: 5,
      expect: `원본(${r.id}) 변형: "${hitKey}"→"${pick}". 동일 의도로 처리.`,
    })
  }
  return out
}

export function generateRangeScenarios() {
  const fields = [
    { key: "diameterMm", ko: "직경", vals: [4, 6, 8, 10, 12, 16, 20] },
    { key: "overallLengthMm", ko: "전장", vals: [50, 75, 100, 150, 200, 250] },
    { key: "fluteCount", ko: "날수", vals: [2, 3, 4, 6] },
  ]
  const ops = [
    { key: "gte", ko: "이상" },
    { key: "lte", ko: "이하" },
    { key: "lt", ko: "미만" },
    { key: "between", ko: "사이" },
  ]
  const combos = []
  for (const f of fields) {
    for (const op of ops) {
      let text
      if (op.key === "between") {
        const a = f.vals[Math.floor(Math.random() * (f.vals.length - 1))]
        const b = f.vals[f.vals.length - 1]
        text = `${f.ko} ${a}${f.key === "fluteCount" ? "날" : "mm"}에서 ${b}${f.key === "fluteCount" ? "날" : "mm"} 사이`
      } else {
        const v = f.vals[Math.floor(Math.random() * f.vals.length)]
        text = `${f.ko} ${v}${f.key === "fluteCount" ? "날" : "mm"} ${op.ko}`
      }
      combos.push({
        id: `RNG_${f.key}_${op.key}_${Date.now().toString(36)}_${Math.floor(Math.random()*1000)}`,
        input: text,
        phase: 5,
        expect: `${f.key} ${op.key} 필터 정확 추출`,
      })
    }
  }
  // shuffle and cap 10
  return combos.sort(() => Math.random() - 0.5).slice(0, 10)
}

export async function generateCustomerScenarios(results, openaiKey) {
  if (!openaiKey) return []
  const sys = `당신은 한국 제조현장 절삭공구 구매 담당자 페르소나 생성기.
YG-1 절삭공구 AI 어시스턴트에 물어볼 법한 실전 질문 10개를 생성하라.
- 존댓말/반말 섞어서
- 오타/축약어/구어체 포함
- 소재(스테인리스/알루미늄/티타늄/탄소강/구리), 직경/전장/날수, 브랜드, 트러블슈팅 등 다양
- 너무 쉬운 건 피하고 실전 엣지 케이스 위주

응답은 반드시 JSON 배열만 (다른 텍스트 금지):
[{"input":"질문","expect":"기대 동작"},...]`
  try {
    const res = await fetch(OPENAI_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: "10개 생성" },
        ],
        max_tokens: 1500,
        temperature: 0.9,
      }),
    })
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content ?? ""
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []
    const arr = JSON.parse(match[0])
    const ts = Date.now().toString(36)
    return arr.slice(0, 10).map((x, i) => ({
      id: `GEN_${ts}_${i}`,
      input: String(x.input ?? ""),
      phase: 5,
      expect: String(x.expect ?? "자연스러운 추천/답변"),
    })).filter(s => s.input.length > 0)
  } catch (e) {
    console.warn(`generateCustomerScenarios failed: ${e.message}`)
    return []
  }
}

export async function refreshScenarios(baseScenarios, lastResults, openaiKey) {
  const mutated = mutateFromFailures(lastResults)
  const ranges = generateRangeScenarios()
  const gen = await generateCustomerScenarios(lastResults, openaiKey)
  const seenIds = new Set(baseScenarios.map(s => s.id))
  const merged = [...baseScenarios]
  for (const s of [...mutated, ...ranges, ...gen]) {
    if (seenIds.has(s.id)) continue
    seenIds.add(s.id)
    merged.push(s)
  }
  // 50개 상한: phase>=5 이고 22+ 안정 시나리오 제거
  if (merged.length > 50) {
    const byId = Object.fromEntries((lastResults ?? []).map(r => [r.id, r.grade?.total ?? 0]))
    const keep = merged.filter(s => {
      if ((s.phase ?? 0) < 5) return true
      const score = byId[s.id] ?? 0
      return score < 22
    })
    while (keep.length > 50) keep.pop()
    return keep
  }
  return merged
}

export { SCENARIOS, SYNONYM_MAP, callARIA, judgeResponse, runScenario }

// ═══ 채점 루브릭 ═══

const JUDGE_PROMPT = `당신은 AI 절삭공구 추천 시스템의 품질 평가자입니다.
아래 "유저 입력"과 "AI 응답"을 보고, 5개 기준으로 1~5점을 매기세요.

## 채점 기준

1. **정확성** (1~5): 필터가 정확한가? 소재/코팅/직경 등이 유저 의도와 일치하는가?
   1=완전 틀림 2=주요 필터 누락 3=대부분 맞지만 op 오류 4=거의 정확 5=완벽

2. **자연스러움** (1~5): 사람과 대화하는 느낌인가?
   1=에러메시지 2="N개 검색됨" 기계적 3=정보 나열 4=대부분 자연스러움 5=10년차 영업과 대화 느낌

3. **통찰력** (1~5): 유저가 몰랐을 정보를 제공하는가? 위험 경고, 전문가 팁 포함?
   1=정보 없음 2=카탈로그 수준 3=기본 설명 4=유용한 팁 포함 5=전문가만 아는 통찰

4. **길이적절성** (1~5): 질문 복잡도에 맞는 응답 길이인가?
   1=극단적 불일치 2=너무 길거나 짧음 3=약간 불일치 4=대부분 적절 5=완벽 매칭

5. **맥락연결** (1~5): 이전 대화를 자연스럽게 이어가는가? (싱글턴이면 5 기본)
   1=완전 리셋 2=이전 맥락 무시 3=일부 참조 4=자연스럽게 연결 5=한 대화처럼

## 기대 결과
{expected}

## 응답 형식 (반드시 JSON만 출력)
{"accuracy":N,"naturalness":N,"insight":N,"length_fit":N,"context":N,"total":합계,"issues":["문제1","문제2"],"suggestion":"개선제안"}
`

// ═══ 메인 루프 ═══

async function callARIA(messages) {
  let lastErr
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(ARIA_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: "serve", language: "ko", messages }),
        signal: AbortSignal.timeout(120000),
      })
      return await res.json()
    } catch (e) {
      lastErr = e
      console.warn(`  [aria] attempt ${attempt + 1} failed: ${e.message}`)
      if (attempt < 2) await new Promise(r => setTimeout(r, 10000))
    }
  }
  throw new Error("ARIA 3회 실패: " + (lastErr?.message ?? "unknown"))
}

async function judgeResponse(input, response, expected) {
  if (!OPENAI_KEY) return null
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(OPENAI_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: JUDGE_PROMPT.replace("{expected}", expected) },
            { role: "user", content: `유저: "${input}"\nAI: "${response}"` },
          ],
          max_tokens: 300,
          temperature: 0,
        }),
      })
      if (res.status === 429) {
        const wait = (attempt + 1) * 30
        console.warn(`  [judge] 429 rate limit — ${wait}초 대기 (attempt ${attempt + 1})`)
        await new Promise(r => setTimeout(r, wait * 1000))
        continue
      }
      const data = await res.json()
      const text = data.choices?.[0]?.message?.content ?? ""
      const match = text.match(/\{[\s\S]*\}/)
      if (match) return JSON.parse(match[0])
      console.warn(`  [judge] no JSON in response — retry`)
      await new Promise(r => setTimeout(r, 5000))
    } catch (e) {
      console.warn(`  [judge] error: ${e.message} — 15초 대기`)
      await new Promise(r => setTimeout(r, 15000))
    }
  }
  return null
}

async function runScenario(scenario) {
  const t0 = Date.now()
  try {
    let messages, inputText
    if (scenario.turns) {
      messages = []
      for (const turn of scenario.turns) {
        if (turn === null) {
          const res = await callARIA(messages)
          const aiText = res.text ?? res.data?.message?.text ?? res.message ?? ""
          messages.push({ role: "ai", text: aiText })
        } else {
          messages.push(turn)
        }
      }
      inputText = scenario.turns.filter(t => t?.role === "user").map(t => t.text).join(" → ")
    } else {
      messages = [{ role: "user", text: scenario.input }]
      inputText = scenario.input
    }

    const res = await callARIA(messages)
    const ms = Date.now() - t0
    const aiText = res.text ?? res.data?.message?.text ?? res.message ?? ""
    const ps = res.session?.publicState ?? {}
    const candidateCount = ps.candidateCount ?? res.candidateCount ?? 0
    const filters = ps.appliedFilters ?? res.data?.appliedFilters ?? []

    const grade = await judgeResponse(inputText, aiText, scenario.expect)

    return {
      id: scenario.id,
      input: inputText.slice(0, 60),
      ms,
      candidateCount,
      filterCount: filters.length,
      responsePreview: aiText.slice(0, 100).replace(/\n/g, " "),
      grade,
      error: null,
    }
  } catch (e) {
    return { id: scenario.id, input: scenario.input?.slice(0, 60) ?? "멀티턴",
      ms: Date.now() - t0, candidateCount: 0, filterCount: 0,
      responsePreview: "", grade: null, error: e.message?.slice(0, 60) }
  }
}

// ═══ 실행 ═══

const __entry = (process.argv[1] ?? "").replace(/\\/g, "/").split("/").pop() ?? ""
const __isMain = __entry === "eval-judge.mjs"
if (__isMain) {
console.log("\n🧪 ARIA Eval-Driven Development — LLM-as-Judge\n")

const results = []
for (const s of SCENARIOS) {
  const r = await runScenario(s)
  results.push(r)

  const score = r.grade?.total ?? "?"
  const icon = r.error ? "💥" : (r.grade?.total >= 20 ? "✅" : r.grade?.total >= 15 ? "⚠️" : "❌")
  console.log(`${icon} ${r.id} [${r.ms}ms] ${score}/25 "${r.input}" → ${r.candidateCount}건`)

  if (r.grade?.issues?.length > 0) {
    for (const issue of r.grade.issues) console.log(`   ⚡ ${issue}`)
  }
  if (r.grade?.suggestion) console.log(`   💡 ${r.grade.suggestion}`)
  if (r.error) console.log(`   💥 ${r.error}`)
}

// 미채점 재시도 가드 — 10개 전부 채점되도록
let ungraded = results.filter(r => !r.grade || r.grade.total == null)
let retryRound = 0
while (ungraded.length > 0 && retryRound < 3) {
  retryRound++
  console.log(`\n⏳ 미채점 ${ungraded.length}개 재시도 라운드 ${retryRound}`)
  await new Promise(r => setTimeout(r, 30000))
  for (const r of ungraded) {
    const sc = SCENARIOS.find(s => s.id === r.id)
    if (!sc) continue
    const inputForJudge = r.input || sc.input || ""
    r.grade = await judgeResponse(inputForJudge, r.responsePreview ?? "", sc.expect ?? "")
    if (r.grade?.total != null) console.log(`  ✓ ${r.id} 재채점: ${r.grade.total}/25`)
  }
  ungraded = results.filter(r => !r.grade || r.grade.total == null)
}
if (ungraded.length > 0) {
  console.error(`\n⛔ ${ungraded.length}개 끝내 채점 실패 — 이 라운드 신뢰도 낮음`)
}

console.log("\n" + "═".repeat(60))
const graded = results.filter(r => r.grade && r.grade.total != null)
console.log(`채점 완료: ${graded.length}/${results.length}`)
if (graded.length > 0) {
  const avg = (field) => (graded.reduce((s, r) => s + (r.grade?.[field] ?? 0), 0) / graded.length).toFixed(1)
  console.log(`평균 점수:`)
  console.log(`  정확성: ${avg("accuracy")}/5`)
  console.log(`  자연스러움: ${avg("naturalness")}/5`)
  console.log(`  통찰력: ${avg("insight")}/5`)
  console.log(`  길이적절성: ${avg("length_fit")}/5`)
  console.log(`  맥락연결: ${avg("context")}/5`)
  console.log(`  종합: ${avg("total")}/25`)
}

const lowScores = graded
  .filter(r => (r.grade?.total ?? 25) < 20)
  .sort((a, b) => (a.grade?.total ?? 0) - (b.grade?.total ?? 0))
if (lowScores.length > 0) {
  console.log(`\n⚡ 개선 필요 (20점 미만):`)
  for (const r of lowScores) {
    console.log(`  ${r.id}: ${r.grade?.total}/25 — ${r.grade?.suggestion ?? ""}`)
  }
}

// Regression 가드: 직전 eval 결과와 비교
try {
  const prior = readdirSync("test-results")
    .filter(f => f.startsWith("eval-") && f.endsWith(".json"))
    .sort().reverse()[0]
  if (prior) {
    const prev = JSON.parse(readFileSync(`test-results/${prior}`, "utf8"))
    const prevById = Object.fromEntries((prev.results ?? []).map(r => [r.id, r.grade?.total ?? 0]))
    const regressions = []
    const improvements = []
    for (const r of results) {
      const now = r.grade?.total ?? 0
      const before = prevById[r.id]
      if (before == null) continue
      if (now < before) regressions.push(`${r.id}: ${before}→${now}`)
      else if (now > before) improvements.push(`${r.id}: ${before}→${now}`)
    }
    console.log(`\n📈 이전 실행(${prior}) 대비:`)
    if (improvements.length) console.log(`  ✅ 개선 ${improvements.length}개: ${improvements.join(", ")}`)
    if (regressions.length) console.log(`  🔻 REGRESSION ${regressions.length}개: ${regressions.join(", ")}`)
    if (!improvements.length && !regressions.length) console.log(`  ➡️  변화 없음`)
  }
} catch (e) { console.warn(`regression compare skipped: ${e.message}`) }

const fs = await import("fs")
const fname = `test-results/eval-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`
fs.writeFileSync(fname, JSON.stringify({ timestamp: new Date().toISOString(), results, summary: {
  total: results.length, graded: graded.length,
  avgTotal: graded.length > 0 ? (graded.reduce((s, r) => s + (r.grade?.total ?? 0), 0) / graded.length).toFixed(1) : 0,
}}, null, 2))
console.log(`\n📊 결과 저장: ${fname}`)
} // end __isMain
