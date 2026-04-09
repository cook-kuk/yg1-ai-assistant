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

// ═══ 테스트 시나리오 (Phase별로 점점 어려워짐) ═══

const SCENARIOS = [
  // Phase 1: 기본
  { id: "B01", input: "스테인리스 4날 10mm 추천해줘", phase: 1,
    expect: "필터 3개(소재+날수+직경), 후보 있음, 자연스러운 추천" },
  { id: "B02", input: "직경 10mm 이상만", phase: 1,
    expect: "diameterMm gte 10 (eq 아님). overallLength 안 잡힘" },
  { id: "B03", input: "CRX S 빼고 추천해줘", phase: 1,
    expect: "brand neq CRX S" },
  { id: "B04", input: "아무거나 빨리 10mm", phase: 1,
    expect: "1~2문장 즉답. 추가 질문 안 함" },
  { id: "B05", input: "헬릭스가 뭐야?", phase: 1,
    expect: "용어 설명 1~2문장. 필터 안 걸림" },

  // Phase 2: 복합
  { id: "C01", input: "스테인리스 추천해줘 그리고 알루파워가 뭐야?", phase: 2,
    expect: "스테인리스 추천 + 알루파워 설명, 둘 다 답변" },
  { id: "C02", input: "구리 비슷한 거 떨림 없는 걸로", phase: 2,
    expect: "비철금속 매칭 + 떨림 관련 통찰이나 질문" },
  { id: "C03", input: "AlCrN이랑 TiAlN 뭐가 나아? 스테인리스인데", phase: 2,
    expect: "4~6문장 비교 분석 + 소재 기반 추천" },
  { id: "C04", input: "스테인리스 DLC 코팅으로", phase: 2,
    expect: "DLC+스테인리스 부적합 경고 + 대안 코팅 제시" },
  { id: "C05", input: "공구 수명이 너무 짧아", phase: 2,
    expect: "트러블슈팅: 원인 분석(절삭속도?) + 해결책" },

  // Phase 3: 멀티턴
  { id: "M01", phase: 3,
    turns: [
      { role: "user", text: "스테인리스 엔드밀 추천" },
      null,
      { role: "user", text: "4날로" },
      null,
      { role: "user", text: "10mm" },
    ],
    expect: "Turn 2~3이 이전 맥락 이어감. '아까 스테인리스~' 느낌. 기계적 보고 없음" },
  { id: "M02", phase: 3,
    turns: [
      { role: "user", text: "스테인리스 4날 스퀘어 추천" },
      null,
      { role: "user", text: "아니 볼로 바꿔" },
    ],
    expect: "스퀘어→볼 교체 정상. 이전 필터(소재+날수) 유지" },

  // Phase 4: 엣지 케이스
  { id: "E01", input: "스텐인리스 4낭 10mn", phase: 4,
    expect: "오타 이해하고 스테인리스 4날 10mm로 처리" },
  { id: "E02", input: "좋은 거 추천해줘", phase: 4,
    expect: "모호해도 범용 추천. 에러 아님. 추가 질문으로 좁혀가기" },
  { id: "E03", input: "네", phase: 4,
    expect: "1~2문장. 과잉 응답 금지" },
]

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
  for (let attempt = 0; attempt < 2; attempt++) {
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
      if (attempt === 0) {
        console.warn(`  [retry] fetch failed (${e.message}) — 5초 후 재시도`)
        await new Promise(r => setTimeout(r, 5000))
      }
    }
  }
  throw lastErr
}

async function judgeResponse(input, response, expected) {
  if (!OPENAI_KEY) {
    console.warn("OPENAI_API_KEY 없음 — 수동 채점 모드")
    return null
  }
  const res = await fetch(OPENAI_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: JUDGE_PROMPT.replace("{expected}", expected) },
        { role: "user", content: `유저 입력: "${input}"\n\nAI 응답: "${response}"` },
      ],
      max_tokens: 500,
      temperature: 0,
    }),
  })
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content ?? ""
  try {
    const match = text.match(/\{[\s\S]*\}/)
    return match ? JSON.parse(match[0]) : null
  } catch { return null }
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

console.log("\n" + "═".repeat(60))
const graded = results.filter(r => r.grade)
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
