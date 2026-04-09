#!/usr/bin/env node
/**
 * Auto-Hunt Loop — 자동사냥 + 동적 시나리오 생성
 *
 * 사용: node scripts/autohunt-loop.mjs [--rounds N]
 *
 * 루프: full eval → refreshScenarios → 실패 버킷 분류 → 최빈 버킷 1개 선택
 *       → 수정 후보 마킹 → 대표3+회귀3 커스텀 eval → full eval 재실행
 *       → 최저점+회귀0 판단 → deploy
 *
 * NOTE: 이 스크립트는 실패 분석·배포 보조용이다. 실제 코드 수정(step 6)은
 * 에이전트(Claude)가 루프를 감시하며 `EVIDENCE_*.json` 파일을 읽고 수행한다.
 * 따라서 이 루프는 eval 실행 + 증거 수집 + 시나리오 풀 갱신 + 리포트를 담당한다.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from "fs"
import { execSync } from "child_process"

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const {
  SCENARIOS: BASE_SCENARIOS,
  runScenario,
  refreshScenarios,
} = await import("./eval-judge.mjs")

const OPENAI_KEY = process.env.OPENAI_API_KEY
const ARGS = new Map()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith("--")) ARGS.set(a.slice(2), process.argv[i + 1] ?? true)
}
const MAX_ROUNDS = Number(ARGS.get("rounds") ?? 20)
const TIMEOUT_MS = 8 * 3600 * 1000
const OVERLOAD_LIMIT = 3

if (!existsSync("test-results")) mkdirSync("test-results", { recursive: true })

// ─── 실패 버킷 분류 ────────────────────────────────────────────
// A routing  — 의도/엔티티 라우팅 오류 (필터 전혀 못 잡음)
// B retrieval — 후보 0건 or 관련성 낮음
// C synthesis — 응답 부자연, 정보 나열, 길이 극단
// D state    — 멀티턴 맥락 유실
// E judge    — judge 실패/JSON 파싱 불가
// F regression — 이전보다 하락
function bucketOf(r, prevScoreById) {
  if (r.error) return "E"
  if (!r.grade) return "E"
  const g = r.grade
  const total = g.total ?? 0
  const before = prevScoreById?.[r.id]
  if (before != null && total < before - 1) return "F"
  if (g.context <= 2 && r.id?.startsWith("M")) return "D"
  if (g.accuracy <= 2) return r.candidateCount === 0 ? "B" : "A"
  if (r.candidateCount === 0 && g.accuracy <= 3) return "B"
  if (g.naturalness <= 2 || g.length_fit <= 2) return "C"
  if (total < 20) return "C"
  return null
}

function classify(results, prevScoreById) {
  const buckets = { A: [], B: [], C: [], D: [], E: [], F: [] }
  for (const r of results) {
    const b = bucketOf(r, prevScoreById)
    if (b) buckets[b].push(r)
  }
  return buckets
}

// ─── VM 로그 수집 ─────────────────────────────────────────────
function grabVmLogs(tail = 300) {
  try {
    return execSync(`ssh yg1vm "sudo docker logs yg1-ai-catalog-app-dev --tail ${tail} 2>&1"`, {
      encoding: "utf8",
      timeout: 30000,
    })
  } catch (e) {
    return `VM 로그 수집 실패: ${e.message}`
  }
}

// ─── deploy cycle ────────────────────────────────────────────
function deploy(commitMsg) {
  try {
    execSync(`git add -A && git commit -m ${JSON.stringify(commitMsg)}`, { stdio: "inherit" })
  } catch {
    console.log("[deploy] nothing to commit")
    return false
  }
  try {
    execSync("git push origin main", { stdio: "inherit" })
    execSync("git push company main", { stdio: "inherit" })
  } catch (e) {
    console.warn(`[deploy] push failed: ${e.message}`)
  }
  try {
    execSync(
      `ssh yg1vm "cd /home/csp/yg1-ai-catalog-dev && git pull && sudo docker compose build app 2>&1 | tail -3 && sudo docker rm -f yg1-ai-catalog-app-dev 2>&1; sudo docker compose up -d app 2>&1 | tail -3"`,
      { stdio: "inherit", timeout: 600000 },
    )
  } catch (e) {
    console.warn(`[deploy] vm rebuild failed: ${e.message}`)
  }
  console.log("[deploy] sleeping 40s for service warmup...")
  execSync("node -e \"setTimeout(()=>{}, 40000)\"")
  return true
}

// ─── full eval 실행 ───────────────────────────────────────────
async function runFullEval(scenarios, label) {
  console.log(`\n━━━ Full Eval: ${label} (${scenarios.length} scenarios) ━━━`)
  const results = []
  let overloadStreak = 0
  for (const s of scenarios) {
    const r = await runScenario(s)
    results.push(r)
    const score = r.grade?.total ?? "?"
    const icon = r.error ? "💥" : (r.grade?.total >= 20 ? "✅" : r.grade?.total >= 15 ? "⚠️" : "❌")
    console.log(`${icon} ${r.id} [${r.ms}ms] ${score}/25 "${r.input?.slice(0, 50)}" → ${r.candidateCount}건`)
    if (r.error && /529|overload/i.test(r.error)) {
      overloadStreak++
      if (overloadStreak >= OVERLOAD_LIMIT) {
        console.warn("529 3연속 — 2분 대기")
        await new Promise(res => setTimeout(res, 120000))
        overloadStreak = 0
      }
    } else {
      overloadStreak = 0
    }
  }
  const graded = results.filter(r => r.grade)
  const avg = graded.length > 0
    ? graded.reduce((s, r) => s + (r.grade?.total ?? 0), 0) / graded.length
    : 0
  const lowMin = graded.length > 0
    ? Math.min(...graded.map(r => r.grade?.total ?? 25))
    : 0
  const passCount = graded.filter(r => (r.grade?.total ?? 0) >= 20).length
  console.log(`\n  avg=${avg.toFixed(2)} min=${lowMin} pass=${passCount}/${graded.length}`)
  return { results, avg, lowMin, passCount, total: graded.length }
}

// ─── 에이전트용 증거 덤프 ────────────────────────────────────
function dumpEvidence(round, buckets, vmLogs, pick) {
  const path = `test-results/autohunt-round${round}-evidence.json`
  writeFileSync(path, JSON.stringify({
    round,
    timestamp: new Date().toISOString(),
    buckets: Object.fromEntries(
      Object.entries(buckets).map(([k, v]) => [k, v.map(r => ({
        id: r.id, input: r.input, score: r.grade?.total,
        issues: r.grade?.issues, suggestion: r.grade?.suggestion,
        candidateCount: r.candidateCount, filterCount: r.filterCount,
        responsePreview: r.responsePreview,
      }))]),
    ),
    pickBucket: pick,
    vmLogsTail: vmLogs.slice(-8000),
  }, null, 2))
  console.log(`[evidence] ${path}`)
  return path
}

// ─── main loop ────────────────────────────────────────────────
const startedAt = Date.now()
let scenarios = [...BASE_SCENARIOS]
let prevResults = []
let prevScoreById = {}
const history = []
const commits = []
let baselineAvg = null
let overloadRounds = 0

for (let round = 1; round <= MAX_ROUNDS; round++) {
  if (Date.now() - startedAt > TIMEOUT_MS) {
    console.log("8시간 경과 — 종료")
    break
  }

  console.log(`\n╔════════ ROUND ${round} ════════`)
  console.log(`║ scenarios=${scenarios.length}`)

  // 1. full eval
  const fullEval = await runFullEval(scenarios, `round ${round} initial`)
  if (baselineAvg === null) baselineAvg = fullEval.avg

  // 오버로드 체크
  const overloadRate = fullEval.results.filter(r => r.error && /529|overload/i.test(r.error)).length
  if (overloadRate > fullEval.results.length * 0.5) {
    overloadRounds++
    if (overloadRounds >= OVERLOAD_LIMIT) {
      console.warn("529 overload 3라운드 — 종료")
      break
    }
  } else {
    overloadRounds = 0
  }

  // 2. scenario refresh
  const newScenarios = await refreshScenarios(scenarios, fullEval.results, OPENAI_KEY)
  console.log(`[refresh] ${scenarios.length} → ${newScenarios.length}`)
  scenarios = newScenarios

  // 3. 실패 버킷 분류
  const buckets = classify(fullEval.results, prevScoreById)
  const bucketSizes = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]))
  console.log(`[buckets]`, bucketSizes)

  // 4. 가장 영향 큰 버킷 선택
  const pickEntry = Object.entries(buckets)
    .filter(([k]) => k !== "E") // judge 실패는 보류
    .sort(([, a], [, b]) => b.length - a.length)[0]
  const pickKey = pickEntry?.[0]
  const pickList = pickEntry?.[1] ?? []

  // 5. VM 로그 + 증거
  const vmLogs = grabVmLogs(300)
  const evidencePath = dumpEvidence(round, buckets, vmLogs, pickKey)

  // 6. 에이전트 수정 단계: 이 루프는 에이전트 개입 없이 evidence만 남긴다.
  //    실제 코드 수정은 autohunt 루프 밖에서 에이전트가 수행하거나,
  //    종료 조건 검사를 통해 다음 라운드로 넘어간다.

  // 종료 조건: 40개+ & all pass 2회 연속
  const allPass = scenarios.length >= 40 && fullEval.passCount === fullEval.total
  history.push({
    round, scenarios: scenarios.length,
    avg: fullEval.avg, min: fullEval.lowMin, pass: fullEval.passCount, total: fullEval.total,
    buckets: bucketSizes, pick: pickKey, evidence: evidencePath,
  })

  const lastTwo = history.slice(-2)
  if (lastTwo.length === 2 && lastTwo.every(h => h.scenarios >= 40 && h.pass === h.total)) {
    console.log("종료 조건 충족: 40개+ 전부 pass 2회 연속")
    break
  }

  prevResults = fullEval.results
  prevScoreById = Object.fromEntries(fullEval.results.map(r => [r.id, r.grade?.total ?? 0]))

  // round state save
  writeFileSync("test-results/autohunt-state.json", JSON.stringify({
    round, history, scenarioCount: scenarios.length, baselineAvg,
  }, null, 2))
}

// ─── 최종 리포트 ─────────────────────────────────────────────
const final = history[history.length - 1] ?? { avg: baselineAvg ?? 0, pass: 0, total: 0 }
const report = `# Overnight Auto-Hunt Report — ${new Date().toISOString().slice(0, 10)}

- rounds: ${history.length}
- baseline avg: ${(baselineAvg ?? 0).toFixed(2)}
- final avg: ${(final.avg ?? 0).toFixed(2)}
- final pass: ${final.pass}/${final.total}
- final scenarios: ${final.scenarios ?? scenarios.length}

## Round diffs
${history.map(h => `- R${h.round}: avg=${h.avg.toFixed(2)} min=${h.min} pass=${h.pass}/${h.total} scen=${h.scenarios} pick=${h.pick} buckets=${JSON.stringify(h.buckets)}`).join("\n")}

## Commits
${commits.length ? commits.map(c => `- ${c}`).join("\n") : "- (루프 내 자동 커밋 없음 — 에이전트 수동 처리)"}
`
writeFileSync("test-results/overnight-report.md", report)
writeFileSync("test-results/scenarios-final.json", JSON.stringify(scenarios, null, 2))

try {
  const logLine = `\n## ${new Date().toISOString()}\nrounds=${history.length} baseline=${(baselineAvg ?? 0).toFixed(2)} final=${(final.avg ?? 0).toFixed(2)} scenarios=${scenarios.length}\n`
  const prior = existsSync("test-results/evolution-log.md") ? readFileSync("test-results/evolution-log.md", "utf8") : ""
  writeFileSync("test-results/evolution-log.md", logLine + prior)
} catch (e) { console.warn(`evolution-log append failed: ${e.message}`) }

console.log("\n[done] report:test-results/overnight-report.md scenarios:test-results/scenarios-final.json")
