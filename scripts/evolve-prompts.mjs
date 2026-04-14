#!/usr/bin/env node
/**
 * scripts/evolve-prompts.mjs
 *
 * 자기진화 프롬프트 루프 (Vanna 2.0 ARIA evolution).
 *
 *   1. baseline 결과 (가장 최근 test-results/eval-*.json) 로드
 *   2. 점수 < 18 인 케이스 중 상위 4개 추출
 *   3. LLM 에 "후보 프롬프트 파일 + 실패 케이스" 전달 → patch 1개 제안
 *      (file/before/after/why JSON)
 *   4. patch 적용 → company main 임시 commit + push → ssh yg1vm 배포
 *   5. eval-judge.mjs 재실행 → 평균 비교
 *   6. ↓ 면 git revert + 재배포, ↑ 면 다음 라운드
 *   7. --target 평균 도달 또는 --rounds 소진 시 종료
 *
 * Usage:
 *   node scripts/evolve-prompts.mjs --rounds 3 --target 22 [--fresh-baseline] [--dry-run]
 *
 * 안전장치:
 *   - --rounds 라운드 상한
 *   - --target 평균 도달 시 early stop
 *   - 평균 ↓ 시 즉시 stop + rollback
 *   - 20분 wall clock 타임아웃
 *   - --dry-run: 변이 적용/배포 안 함, 제안만 출력
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs"
import { execSync } from "child_process"

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const OPENAI_KEY = process.env.OPENAI_API_KEY
if (!OPENAI_KEY) { console.error("OPENAI_API_KEY 필요"); process.exit(1) }

const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : def
}
const ROUNDS = parseInt(opt("--rounds", "3"))
const TARGET = parseFloat(opt("--target", "22"))
const FRESH = args.includes("--fresh-baseline")
const DRY = args.includes("--dry-run")
const TIMEOUT_MS = 20 * 60 * 1000
const startTs = Date.now()

const PROMPT_TARGETS = [
  "lib/recommendation/infrastructure/agents/orchestrator.ts",
  "lib/recommendation/infrastructure/engines/serve-engine-general-chat.ts",
  "lib/recommendation/infrastructure/llm/prompt-builder.ts",
  "lib/recommendation/core/sql-agent.ts",
]

function checkTimeout() {
  if (Date.now() - startTs > TIMEOUT_MS) {
    console.error("⏱️  20분 타임아웃 — 중단")
    process.exit(2)
  }
}

function sh(cmd) {
  console.log(`$ ${cmd}`)
  execSync(cmd, { stdio: "inherit" })
}

function loadLatestEval() {
  const files = readdirSync("test-results").filter(f => f.startsWith("eval-") && f.endsWith(".json")).sort().reverse()
  if (!files.length) return null
  return { name: files[0], data: JSON.parse(readFileSync(`test-results/${files[0]}`, "utf8")) }
}

function avgOf(results) {
  const totals = results.map(r => r.grade?.total ?? 0).filter(t => t > 0)
  return totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0
}

function summarizeCase(r) {
  return `[${r.id}] (${r.grade?.total ?? "?"}/25) "${r.input}"
  filters: ${JSON.stringify(r.appliedFilters ?? [])}
  response: ${(r.responsePreview ?? "").slice(0, 200)}
  issues: ${JSON.stringify(r.grade?.issues ?? [])}
  suggestion: ${r.grade?.suggestion ?? ""}`
}

async function callOpenAI(sys, user) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      max_tokens: 4000,
      temperature: 0.2,
    }),
  })
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ""
}

function extractPatch(text) {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error("LLM 응답에 JSON 없음")
  return JSON.parse(m[0])
}

async function suggestPatch(lows) {
  const fileSnippets = PROMPT_TARGETS.map(p => {
    if (!existsSync(p)) return null
    const content = readFileSync(p, "utf8")
    return `=== ${p} (${content.length} bytes) ===\n${content.slice(0, 6000)}`
  }).filter(Boolean).join("\n\n")

  const sys = `당신은 LLM 시스템 프롬프트 최적화 전문가.
실패 케이스(eval-judge 점수 낮음) 들의 공통 패턴을 잡는 patch 1개를 제안하라.

응답은 반드시 JSON 1개:
{"file":"<lib/...경로>","before":"<교체 대상 정확한 substring>","after":"<교체 후 텍스트>","why":"<왜 이 변경이 점수를 올리는지 1줄>"}

규칙:
- before 는 파일 안에 정확히 1번만 등장하는 substring (탭/줄바꿈 포함 그대로)
- before/after 는 각 600자 이내 권장
- 코드 구조/의존성 변경 금지 — 프롬프트 텍스트만 수정
- "기계적 확인 질문 패턴" 같이 케이스의 공통 패턴을 잡는 변경 우선`
  const user = `# 후보 프롬프트 파일\n${fileSnippets}\n\n# 실패 케이스\n${lows.map(summarizeCase).join("\n\n")}`
  const text = await callOpenAI(sys, user)
  return extractPatch(text)
}

function applyPatch(p) {
  const content = readFileSync(p.file, "utf8")
  const idx = content.indexOf(p.before)
  if (idx < 0) throw new Error(`patch.before not found in ${p.file}`)
  if (content.indexOf(p.before, idx + p.before.length) >= 0) throw new Error(`patch.before ambiguous in ${p.file}`)
  writeFileSync(p.file, content.slice(0, idx) + p.after + content.slice(idx + p.before.length))
}

function deployToServer(commitMsg) {
  if (DRY) { console.log("[dry-run] skip deploy"); return }
  sh(`git add -A`)
  sh(`git commit -m ${JSON.stringify(commitMsg)} --no-verify`)
  sh(`git push company main`)
  sh(`ssh yg1vm "cd /home/csp/yg1-ai-catalog-dev && git pull && sudo docker compose build && sudo docker compose up -d"`)
}

function rollbackDeploy() {
  if (DRY) { console.log("[dry-run] skip rollback"); return }
  sh(`git revert --no-edit HEAD`)
  sh(`git push company main`)
  sh(`ssh yg1vm "cd /home/csp/yg1-ai-catalog-dev && git pull && sudo docker compose build && sudo docker compose up -d"`)
}

function runEvalJudge() {
  if (DRY) { console.log("[dry-run] skip eval-judge"); return loadLatestEval() }
  sh(`node scripts/eval-judge.mjs`)
  return loadLatestEval()
}

function scoresOf(results) {
  return Object.fromEntries(results.map(r => [r.id, r.grade?.total ?? 0]))
}

function printHistory(history) {
  console.log("\n" + "═".repeat(80))
  console.log("📊 라운드별 점수 변화")
  console.log("═".repeat(80))
  const ids = Object.keys(history[0].scores).sort()
  console.log(["round", ...ids, "avg", "label"].join("\t"))
  for (const h of history) {
    console.log([`R${h.round}`, ...ids.map(id => h.scores[id] ?? "-"), h.avg.toFixed(2), h.label.slice(0, 40)].join("\t"))
  }
}

;(async () => {
  console.log(`\n🌱 evolve-prompts: rounds=${ROUNDS}, target=${TARGET}${DRY ? " [DRY-RUN]" : ""}\n`)

  let baseline
  if (FRESH) {
    console.log("Fresh baseline 측정...")
    baseline = runEvalJudge()
  } else {
    baseline = loadLatestEval()
    if (!baseline) { console.error("test-results/eval-*.json 없음. --fresh-baseline 사용."); process.exit(1) }
    console.log(`Baseline 재사용: ${baseline.name}`)
  }
  let curAvg = avgOf(baseline.data.results)
  let curResults = baseline.data.results
  let bestAvg = curAvg
  console.log(`Round 0 avg = ${curAvg.toFixed(2)}/25`)

  const history = [{ round: 0, label: "baseline", avg: curAvg, scores: scoresOf(curResults) }]

  for (let round = 1; round <= ROUNDS; round++) {
    checkTimeout()
    if (curAvg >= TARGET) { console.log(`✅ target ${TARGET} 도달 — early stop`); break }

    const lows = curResults
      .filter(r => (r.grade?.total ?? 25) < 18)
      .sort((a, b) => (a.grade?.total ?? 0) - (b.grade?.total ?? 0))
      .slice(0, 4)
    if (!lows.length) { console.log("저점 케이스 없음 — 종료"); break }

    console.log(`\n=== Round ${round} ===`)
    console.log(`저점 케이스: ${lows.map(r => `${r.id}(${r.grade?.total})`).join(", ")}`)

    let patch
    try {
      patch = await suggestPatch(lows)
      console.log(`patch: ${patch.file}\n  why: ${patch.why}`)
      console.log(`  before(${patch.before.length}c): ${patch.before.slice(0, 120).replace(/\n/g, " ⏎ ")}...`)
      console.log(`  after (${patch.after.length}c): ${patch.after.slice(0, 120).replace(/\n/g, " ⏎ ")}...`)
    } catch (e) { console.error(`patch 제안 실패: ${e.message}`); break }

    try { applyPatch(patch) }
    catch (e) { console.error(`patch 적용 실패: ${e.message}`); break }

    deployToServer(`evolve(round ${round}): ${patch.why}`.slice(0, 100))
    checkTimeout()

    const newEval = runEvalJudge()
    const newAvg = avgOf(newEval.data.results)
    const delta = newAvg - curAvg
    console.log(`Round ${round} avg = ${newAvg.toFixed(2)}/25 (Δ${delta >= 0 ? "+" : ""}${delta.toFixed(2)})`)
    history.push({ round, label: patch.why, avg: newAvg, scores: scoresOf(newEval.data.results) })

    if (newAvg < bestAvg) {
      console.log(`📉 평균 하락 — rollback`)
      rollbackDeploy()
      break
    }
    bestAvg = Math.max(bestAvg, newAvg)
    curAvg = newAvg
    curResults = newEval.data.results
  }

  printHistory(history)
})().catch(e => { console.error("FATAL:", e); process.exit(1) })
