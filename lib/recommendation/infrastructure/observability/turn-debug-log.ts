/**
 * Turn Debug Log — 구조화된 한 턴 요약.
 *
 * 목표: 개발자가 한 턴을 **로그 한 줄**로 이해할 수 있도록 한다.
 *  · routing(어느 tier/reason) · pipeline(어떤 stage 가 실제로 실행됐고
 *  얼마나 걸렸는지) · llm(providerModel/effort/요약) · resultType 등.
 *
 * reasoningSummary 는 CoT 원문 금지 — 내부 디버깅용 메타/요약만 허용.
 * prod 에서는 ENABLE_VERBOSE_LLM_DEBUG=false 로 민감 필드를 drop.
 */

import {
  ENABLE_VERBOSE_LLM_DEBUG,
  ENABLE_TURN_DEBUG_LOG,
  type ModelTier,
  type ReasoningTier,
} from "@/lib/recommendation/infrastructure/config/llm-config"

export interface TurnDebugRouting {
  reasoningTier: ReasoningTier
  modelTier: ModelTier
  shortCircuit: boolean
  shortCircuitType?: string | null
  reasons: string[]
}

export interface TurnDebugPipeline {
  stages: string[]
  durationsMs: Record<string, number>
}

export interface TurnDebugLlm {
  providerModel?: string
  appliedLegacyTier?: string
  appliedReasoningEffort?: string
  reasoningSummary?: string | null
  usage?: unknown
}

export interface TurnDebugEntry {
  turnId: string
  userInput: string
  routing: TurnDebugRouting
  pipeline: TurnDebugPipeline
  llm?: TurnDebugLlm
  tools?: string[]
  resultType?: string
  candidateCount?: number
  sessionDelta?: Record<string, unknown>
  elapsedMs?: number
}

function redactForProd(entry: TurnDebugEntry): TurnDebugEntry {
  if (ENABLE_VERBOSE_LLM_DEBUG) return entry
  const { llm, ...rest } = entry
  const safeLlm = llm
    ? {
        providerModel: llm.providerModel,
        appliedLegacyTier: llm.appliedLegacyTier,
        appliedReasoningEffort: llm.appliedReasoningEffort,
        // reasoningSummary 와 usage 는 prod 에서 숨김
      }
    : undefined
  return { ...rest, llm: safeLlm, userInput: (entry.userInput ?? "").slice(0, 80) }
}

export function logTurnDebug(entry: TurnDebugEntry): void {
  if (!ENABLE_TURN_DEBUG_LOG) return
  const safe = redactForProd(entry)
  try {
    // 단일 라인 JSON — 로그 수집기가 쉽게 파싱할 수 있도록.
    console.log(`[turn-debug] ${JSON.stringify(safe)}`)
  } catch {
    /* JSON 직렬화 실패 시 조용히 스킵 */
  }
}

export function makeTurnId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
