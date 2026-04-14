/**
 * Pattern Mining — Candidate Miner
 *
 * 로그를 분석해서 KG 승격 후보를 자동 생성.
 * 오프라인 배치 전용 — 서버 런타임에서 호출하지 말 것.
 *
 * 두 가지 miner:
 * 1. Pattern Candidate Miner: planner만 잡고 production이 놓치는 반복 패턴
 * 2. Alias Candidate Miner: 하이픈/띄어쓰기/대소문자 변형
 */

import { readAllLogs } from "./logger"
import { addCandidate } from "./review-queue"
import type {
  PatternMiningLog,
  PatternMiningConstraint,
  PatternCandidate,
  AliasCandidate,
  CandidateType,
  RiskLevel,
} from "./types"

// ── Config ──────────────────────────────────────────────────

import { PATTERN_MINING_CONFIG } from "@/lib/recommendation/infrastructure/config/planner-config"

/** 최소 지지 수 — 이 이상 반복돼야 후보 생성 */
const MIN_SUPPORT_COUNT = PATTERN_MINING_CONFIG.minSupportCount
/** 최소 planner 일관성 — 같은 field+op+value로 해석한 비율 */
const MIN_CONSISTENCY = PATTERN_MINING_CONFIG.minConsistency
/** KG 승격 금지 op 목록 */
const NON_PROMOTABLE_OPS = new Set(["gte", "lte", "between"])
/** 숫자 성격 필드 — alias 후보에서 제외 */
const NUMERIC_FIELDS = new Set(["diameterMm", "fluteCount", "shankDiameterMm", "lengthOfCutMm", "overallLengthMm", "helixAngleDeg"])
/** range ops — groupKey에서 value 무시 */
const RANGE_OPS = new Set(["gte", "lte", "between"])

// ── Pattern Candidate Miner ─────────────────────────────────

interface GroupedPattern {
  groupKey: string
  field: string
  op: string
  value: string
  inputs: string[]
  plannerWins: number
  total: number
}

/**
 * 로그에서 "planner만 잡고 production이 놓치는" 반복 패턴을 찾아 후보를 생성.
 */
export async function minePatternCandidates(): Promise<PatternCandidate[]> {
  const logs = await readAllLogs()
  if (logs.length === 0) return []

  // Step 1: planner가 잡았고 production이 놓친 로그만 필터
  const plannerOnlyLogs = logs.filter(log =>
    log.planner.constraints.length > 0
    && !log.production.handled
    && log.decision.winner !== "production"
  )

  // Step 2: planner constraint 기준으로 그룹핑
  // range ops는 value 무시 → 같은 field:op끼리 묶어서 support 집계
  const groups = new Map<string, GroupedPattern>()
  for (const log of plannerOnlyLogs) {
    for (const c of log.planner.constraints) {
      const key = RANGE_OPS.has(c.op)
        ? `${c.field}:${c.op}`
        : `${c.field}:${c.op}:${String(c.value).toLowerCase()}`
      const existing = groups.get(key)
      if (existing) {
        existing.inputs.push(log.normalizedText)
        existing.plannerWins++
        existing.total++
      } else {
        groups.set(key, {
          groupKey: key,
          field: c.field,
          op: c.op,
          value: String(c.value),
          inputs: [log.normalizedText],
          plannerWins: 1,
          total: 1,
        })
      }
    }
  }

  // Step 3: 전체 로그에서 같은 constraint가 production에서도 잡힌 경우 total 업데이트
  for (const log of logs) {
    if (log.production.handled) {
      for (const c of log.production.constraints) {
        const key = RANGE_OPS.has(c.op)
          ? `${c.field}:${c.op}`
          : `${c.field}:${c.op}:${String(c.value).toLowerCase()}`
        const group = groups.get(key)
        if (group) group.total++
      }
    }
  }

  // Step 4: 기준 충족하는 것만 후보로 변환
  const candidates: PatternCandidate[] = []
  for (const [, group] of groups) {
    if (group.plannerWins < MIN_SUPPORT_COUNT) continue

    const consistency = group.plannerWins / group.total
    if (consistency < MIN_CONSISTENCY) continue

    // 승격 금지 op 체크
    if (NON_PROMOTABLE_OPS.has(group.op)) {
      candidates.push(buildCandidate(group, "do-not-promote", consistency))
      continue
    }

    // 긴 문장(20자+) 비율이 높으면 승격 부적합
    const longInputRatio = group.inputs.filter(i => i.length > 20).length / group.inputs.length
    if (longInputRatio > 0.7) {
      candidates.push(buildCandidate(group, "do-not-promote", consistency))
      continue
    }

    candidates.push(buildCandidate(group, "regex-pattern", consistency))
  }

  return candidates
}

function buildCandidate(
  group: GroupedPattern,
  type: CandidateType,
  consistency: number,
): PatternCandidate {
  const uniqueInputs = [...new Set(group.inputs)].slice(0, 10)
  const risk: RiskLevel = consistency > 0.95 ? "low" : consistency > 0.85 ? "medium" : "high"

  return {
    id: `pat_${group.field}_${hashStr(group.groupKey)}`,
    candidateType: type,
    targetField: group.field,
    targetValueExamples: [group.value],
    supportCount: group.plannerWins,
    confidence: consistency,
    risk,
    exampleInputs: uniqueInputs,
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  }
}

// ── Alias Candidate Miner ───────────────────────────────────

/**
 * 같은 field+value로 해석되지만 다른 표기를 쓰는 입력을 찾아
 * alias 후보를 생성. 문자열 변형 중심 (하이픈/공백/대소문자).
 */
export async function mineAliasCandidates(): Promise<AliasCandidate[]> {
  const logs = await readAllLogs()
  if (logs.length === 0) return []

  // field+value별로 다양한 원문 표현 수집
  const valueInputs = new Map<string, { field: string; canonical: string; inputs: Set<string> }>()

  for (const log of logs) {
    const constraints = log.planner.constraints.length > 0
      ? log.planner.constraints
      : log.production.constraints

    for (const c of constraints) {
      // 숫자 필드는 alias 후보 대상 아님
      if (NUMERIC_FIELDS.has(c.field)) continue
      const key = `${c.field}:${String(c.value).toLowerCase()}`
      const existing = valueInputs.get(key)
      if (existing) {
        existing.inputs.add(log.normalizedText)
      } else {
        valueInputs.set(key, {
          field: c.field,
          canonical: String(c.value),
          inputs: new Set([log.normalizedText]),
        })
      }
    }
  }

  // 각 canonical에 대해 변형 그룹 찾기
  const candidates: AliasCandidate[] = []
  for (const [, group] of valueInputs) {
    if (group.inputs.size < 2) continue

    // 입력에서 canonical과 유사한 토큰 추출
    const canonicalNorm = normalizeForAlias(group.canonical)
    const aliasSet = new Set<string>()

    for (const input of group.inputs) {
      const tokens = input.split(/[\s,]+/)
      for (const token of tokens) {
        const tokenNorm = normalizeForAlias(token)
        if (tokenNorm === canonicalNorm) continue
        if (tokenNorm.length < 2) continue
        // edit distance 또는 포함 관계 체크
        if (isAliasVariant(canonicalNorm, tokenNorm)) {
          aliasSet.add(token)
        }
      }
    }

    if (aliasSet.size === 0) continue

    candidates.push({
      id: `alias_${group.field}_${hashStr(group.canonical)}`,
      candidateType: "alias",
      canonical: group.canonical,
      aliases: [...aliasSet].slice(0, 10),
      targetField: group.field,
      supportCount: group.inputs.size,
      confidence: Math.min(0.95, 0.7 + group.inputs.size * 0.02),
      exampleInputs: [...group.inputs].slice(0, 5),
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    })
  }

  return candidates
}

// ── Helpers ─────────────────────────────────────────────────

function normalizeForAlias(s: string): string {
  return s.toLowerCase().replace(/[-\s_.]/g, "")
}

function isAliasVariant(a: string, b: string): boolean {
  // 하이픈/공백 제거 후 같으면 alias
  if (a === b) return true
  // 한쪽이 다른쪽을 포함 (3자 이상)
  if (a.length >= 3 && b.length >= 3) {
    if (a.includes(b) || b.includes(a)) return true
  }
  // 간단한 edit distance (1 이하)
  if (Math.abs(a.length - b.length) <= 1) {
    let diff = 0
    const maxLen = Math.max(a.length, b.length)
    for (let i = 0; i < maxLen; i++) {
      if (a[i] !== b[i]) diff++
      if (diff > 1) return false
    }
    return true
  }
  return false
}

function hashStr(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36).slice(0, 8)
}

// ── Run All ─────────────────────────────────────────────────

/**
 * 전체 마이닝 실행: pattern + alias 후보 생성 → review queue에 추가.
 * CLI에서 실행: npx tsx lib/recommendation/core/pattern-mining/candidate-miner.ts
 */
export async function runMining(): Promise<{
  patterns: PatternCandidate[]
  aliases: AliasCandidate[]
  queueResults: Array<{ id: string; added: boolean; reason: string }>
}> {
  const patterns = await minePatternCandidates()
  const aliases = await mineAliasCandidates()

  const queueResults: Array<{ id: string; added: boolean; reason: string }> = []
  for (const c of [...patterns, ...aliases]) {
    const result = await addCandidate(c)
    queueResults.push({ id: c.id, ...result })
  }

  return { patterns, aliases, queueResults }
}

// CLI entrypoint
if (require.main === module) {
  runMining().then(result => {
    console.log(`\n=== Pattern Mining Results ===`)
    console.log(`Patterns: ${result.patterns.length}`)
    console.log(`Aliases: ${result.aliases.length}`)
    console.log(`Queue updates: ${result.queueResults.length}`)
    for (const r of result.queueResults) {
      console.log(`  ${r.id}: ${r.added ? "ADDED" : r.reason}`)
    }
    console.log(`\nPattern candidates:`)
    for (const p of result.patterns) {
      console.log(`  [${p.candidateType}] ${p.targetField}=${p.targetValueExamples[0]} support=${p.supportCount} conf=${p.confidence.toFixed(2)} risk=${p.risk}`)
      console.log(`    examples: ${p.exampleInputs.slice(0, 3).join(" | ")}`)
    }
    console.log(`\nAlias candidates:`)
    for (const a of result.aliases) {
      console.log(`  ${a.canonical} → [${a.aliases.join(", ")}] (${a.targetField}) support=${a.supportCount}`)
    }
  }).catch(e => {
    console.error("Mining failed:", e)
    process.exit(1)
  })
}
