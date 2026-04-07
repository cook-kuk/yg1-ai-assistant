/**
 * Pattern Mining — Type Definitions
 *
 * 로그 수집 → 후보 생성 → 승인 큐 → registry 반영 파이프라인의 공통 타입.
 * Production 동작에 영향 없음 — trace/report 전용.
 */

// ── Mining Log ──────────────────────────────────────────────

export interface PatternMiningConstraint {
  field: string
  op: string
  value: unknown
}

export interface PatternMiningLog {
  /** 사용자 원문 */
  userText: string
  /** 정규화된 텍스트 (소문자, 공백 trim) */
  normalizedText: string
  /** KG / SQL Agent production 결과 */
  production: {
    source: "kg" | "sql-agent" | "negation" | "scr" | "none"
    constraints: PatternMiningConstraint[]
    handled: boolean
  }
  /** QuerySpec Planner 결과 */
  planner: {
    constraints: PatternMiningConstraint[]
    navigation: string
    intent: string
    confidence: number
    reasoning?: string
  }
  /** Decision Layer 결과 */
  decision: {
    winner: "production" | "planner" | "none"
    plannerScore: number
    productionScore: number
    margin: number
    reason: string
    applied: boolean
  }
  /** 최종 적용된 필터 */
  final: {
    constraints: PatternMiningConstraint[]
  }
  timestamp: string
  /** 동일 패턴 집계용 키: normalizedText의 해시 또는 field+op 조합 */
  groupKey: string
}

// ── Candidate ───────────────────────────────────────────────

export type CandidateType =
  | "regex-pattern"
  | "alias"
  | "entity-synonym"
  | "do-not-promote"

export type RiskLevel = "low" | "medium" | "high"

export interface PatternCandidate {
  id: string
  candidateType: CandidateType
  /** regex 패턴 (regex-pattern인 경우) */
  pattern?: string
  /** 대상 필드 */
  targetField: string
  /** 대상 값 예시 */
  targetValueExamples: string[]
  /** 이 패턴을 지지하는 로그 수 */
  supportCount: number
  /** planner 일관성 기반 신뢰도 0~1 */
  confidence: number
  /** false positive 위험도 */
  risk: RiskLevel
  /** 실제 사용자 입력 예시 */
  exampleInputs: string[]
  /** 생성 시점 */
  createdAt: string
  /** 마지막 지지 로그 시점 */
  lastSeenAt: string
}

export interface AliasCandidate {
  id: string
  candidateType: "alias"
  /** 정규 표현 */
  canonical: string
  /** 변형 후보들 */
  aliases: string[]
  /** 대상 필드 */
  targetField: string
  supportCount: number
  confidence: number
  exampleInputs: string[]
  createdAt: string
  lastSeenAt: string
}

// ── Review Queue ────────────────────────────────────────────

export interface ReviewQueue {
  pending: Array<PatternCandidate | AliasCandidate>
  approved: Array<PatternCandidate | AliasCandidate>
  rejected: Array<PatternCandidate | AliasCandidate>
  lastUpdated: string
}

// ── Approved Registry ───────────────────────────────────────

export interface RegistryEntry {
  id: string
  type: "compound-pattern" | "alias-expansion" | "entity-synonym"
  field: string
  /** regex (compound-pattern인 경우) */
  pattern?: string
  /** alias 목록 (alias-expansion인 경우) */
  aliases?: string[]
  /** 정규 값 */
  canonical: string
  approvedAt: string
  source: string // candidate id
}

export interface PatternRegistry {
  version: number
  entries: RegistryEntry[]
  lastUpdated: string
}
