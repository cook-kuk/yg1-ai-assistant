#!/usr/bin/env node
/**
 * qa-log 파싱 → "필터_필드_불일치" 케이스의 기대 vs 실제 필드 쌍 집계.
 * 출력: Top 10 빈도 표 (분석만, 코드 수정 없음).
 */
import { readFileSync } from "fs"

const log = readFileSync("test-results/eval-golden-qa-log.txt", "utf8")
const blocks = log.split(/^=== /m).slice(1)

// 필터 문자열을 field 리스트로 파싱: "diameterMm eq 16, lengthOfCutMm between undefined" → ["diameterMm","lengthOfCutMm"]
function parseFields(s) {
  const trimmed = (s ?? "").trim()
  if (!trimmed || trimmed === "(없음)" || trimmed === "(빈 배열)") return []
  return trimmed.split(",").map(p => p.trim().split(/\s+/)[0]).filter(Boolean)
}

const cases = []
for (const block of blocks) {
  const lines = block.split("\n")
  const idMatch = lines[0].match(/^(\S+)\s/)
  if (!idMatch) continue
  const id = idMatch[1]
  const field = (label) => {
    const line = lines.find(l => l.startsWith(label))
    return line ? line.slice(label.length).trim() : ""
  }
  const grade = field("채점:")
  if (!/필터_필드_불일치/.test(grade)) continue
  const expected = parseFields(field("기대 필터:"))
  const actual = parseFields(field("실제 필터:"))
  cases.push({ id, question: field("질문:"), expected, actual })
}

// 누락 필드 집계 (기대에 있으나 실제에 없음)
const missingCount = {}
const missingSamples = {}
// 잘못된 필드 집계 (실제에 있으나 기대에 없음)
const extraCount = {}
const extraSamples = {}

for (const c of cases) {
  const expSet = new Set(c.expected)
  const actSet = new Set(c.actual)
  for (const f of c.expected) {
    if (!actSet.has(f)) {
      missingCount[f] = (missingCount[f] ?? 0) + 1
      missingSamples[f] ??= []
      if (missingSamples[f].length < 3) missingSamples[f].push(`${c.id}: "${c.question.slice(0, 40)}"`)
    }
  }
  for (const f of c.actual) {
    if (!expSet.has(f)) {
      extraCount[f] = (extraCount[f] ?? 0) + 1
      extraSamples[f] ??= []
      if (extraSamples[f].length < 3) extraSamples[f].push(`${c.id}: "${c.question.slice(0, 40)}"`)
    }
  }
}

console.log(`\n📊 필터_필드_불일치 ${cases.length}건 분석\n`)

console.log(`═══ Top 필드 (기대했는데 시스템이 안 뽑음) ═══`)
const missRanked = Object.entries(missingCount).sort((a, b) => b[1] - a[1]).slice(0, 10)
console.log(`\n${"필드".padEnd(25)} ${"건수".padStart(5)}   샘플`)
console.log(`${"-".repeat(25)} ${"-".repeat(5)}   ${"-".repeat(40)}`)
for (const [f, n] of missRanked) {
  console.log(`${f.padEnd(25)} ${String(n).padStart(5)}   ${missingSamples[f]?.[0] ?? ""}`)
}

console.log(`\n═══ Top 필드 (시스템이 뽑았는데 기대엔 없음 = 엉뚱한 필드) ═══`)
const extraRanked = Object.entries(extraCount).sort((a, b) => b[1] - a[1]).slice(0, 10)
console.log(`\n${"필드".padEnd(25)} ${"건수".padStart(5)}   샘플`)
console.log(`${"-".repeat(25)} ${"-".repeat(5)}   ${"-".repeat(40)}`)
for (const [f, n] of extraRanked) {
  console.log(`${f.padEnd(25)} ${String(n).padStart(5)}   ${extraSamples[f]?.[0] ?? ""}`)
}

// 쌍 집계 (기대→실제 누락 쌍)
const pairCount = {}
const pairSamples = {}
for (const c of cases) {
  const actSet = new Set(c.actual)
  for (const f of c.expected) {
    if (!actSet.has(f)) {
      const actStr = c.actual.length === 0 ? "(없음)" : c.actual.join("+")
      const key = `${f} → ${actStr}`
      pairCount[key] = (pairCount[key] ?? 0) + 1
      pairSamples[key] ??= []
      if (pairSamples[key].length < 2) pairSamples[key].push(`${c.id}: "${c.question.slice(0, 40)}"`)
    }
  }
}

console.log(`\n═══ Top 10 기대→실제 쌍 ═══`)
const pairRanked = Object.entries(pairCount).sort((a, b) => b[1] - a[1]).slice(0, 10)
for (const [pair, n] of pairRanked) {
  console.log(`\n  ${pair}  → ${n}건`)
  for (const s of pairSamples[pair]) console.log(`    - ${s}`)
}

// 액션 가이드
console.log(`\n═══ 액션 분류 ═══`)
let missFullCount = 0
let wrongFieldCount = 0
for (const c of cases) {
  const expSet = new Set(c.expected)
  const actSet = new Set(c.actual)
  const allMissing = c.expected.every(f => !actSet.has(f))
  const someWrong = c.actual.some(f => !expSet.has(f))
  if (allMissing && c.actual.length === 0) missFullCount++
  else if (someWrong || !allMissing) wrongFieldCount++
}
console.log(`\n  전체 빈 배열 (시스템이 아예 안 뽑음): ${missFullCount}건 → SQL Agent 프롬프트 정교화`)
console.log(`  일부 뽑았으나 불일치 (alias/추가 필드 이슈): ${wrongFieldCount}건 → eval alias 추가 또는 프롬프트`)
