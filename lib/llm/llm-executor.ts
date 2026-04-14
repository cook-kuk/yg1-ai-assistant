/**
 * LLM Executor — thin wrapper over the existing LLMProvider abstraction.
 *
 * 목적:
 *  - 신규 경로(complexity-router → session-guard → orchestrator 진입)는
 *    {reasoningTier, modelTier} 로만 말하고, legacy tier(haiku/sonnet/opus)는
 *    이 파일 안에서만 번역한다.
 *  - provider.ts 는 건드리지 않는다 (backward compatible).
 *  - 기존 호출부는 그대로 둔다 — 이 executor 를 타는 것은 신규 경로뿐.
 *
 * 경계:
 *  - model/provider 선택의 최종 권한은 여전히 provider.ts 의 resolveModel()
 *    + getProviderForAgent() 에 있다. executor 는 "어느 tier 를 쓸지"만 말한다.
 *  - reasoning summary 는 공개용 CoT 원문이 아니다 — 디버그용 요약에만 쓴다.
 */

import { getProviderForAgent, resolveModel, type AgentName, type LLMMessage, type LLMTool } from "@/lib/llm/provider"
import {
  mapModelTierToLegacy,
  mapReasoningTierToEffort,
  type ModelTier,
  type ReasoningTier,
} from "@/lib/recommendation/infrastructure/config/llm-config"

export type { ModelTier, ReasoningTier }

export interface LlmExecutionOptions {
  agentName?: AgentName
  reasoningTier: ReasoningTier
  modelTier: ModelTier
  systemPrompt?: string
  /** 단일 prompt 호출용. messages 가 있으면 messages 가 우선. */
  userInput?: string
  messages?: LLMMessage[]
  tools?: LLMTool[]
  maxTokens?: number
  metadata?: Record<string, unknown>
  enableReasoningSummary?: boolean
}

export interface LlmExecutionResult {
  text: string
  reasoningSummary?: string | null
  providerModel: string
  modelTier: ModelTier
  reasoningTier: ReasoningTier
  appliedLegacyTier: string
  appliedReasoningEffort: string
  usage?: unknown
  raw?: unknown
}

function buildMessages(opts: LlmExecutionOptions): LLMMessage[] {
  if (opts.messages && opts.messages.length > 0) return opts.messages
  if (opts.userInput) return [{ role: "user", content: opts.userInput }]
  return []
}

/** 신규 얇은 진입점. provider.complete() 로 위임하되 tier 번역만 담당. */
export async function executeLlm(opts: LlmExecutionOptions): Promise<LlmExecutionResult> {
  const legacyTier = mapModelTierToLegacy(opts.modelTier)
  const appliedReasoningEffort = mapReasoningTierToEffort(opts.reasoningTier)
  const provider = getProviderForAgent(opts.agentName)
  const providerModel = resolveModel(legacyTier, opts.agentName)
  const messages = buildMessages(opts)

  if (!provider.available() || messages.length === 0) {
    return {
      text: "",
      reasoningSummary: null,
      providerModel,
      modelTier: opts.modelTier,
      reasoningTier: opts.reasoningTier,
      appliedLegacyTier: legacyTier,
      appliedReasoningEffort,
    }
  }

  const systemPrompt = opts.systemPrompt ?? ""
  const maxTokens = opts.maxTokens ?? (opts.reasoningTier === "deep" ? 2000 : opts.reasoningTier === "normal" ? 1500 : 600)

  const text = await provider.complete(
    systemPrompt,
    messages,
    maxTokens,
    legacyTier,
    opts.agentName,
  )

  return {
    text,
    reasoningSummary: null,
    providerModel,
    modelTier: opts.modelTier,
    reasoningTier: opts.reasoningTier,
    appliedLegacyTier: legacyTier,
    appliedReasoningEffort,
  }
}

/** tool-use 경로. 기존 completeWithTools 로 위임. */
export async function executeLlmWithTools(opts: LlmExecutionOptions & { tools: LLMTool[] }): Promise<LlmExecutionResult & { toolUse: { toolName: string; input: Record<string, unknown> } | null }> {
  const legacyTier = mapModelTierToLegacy(opts.modelTier)
  const appliedReasoningEffort = mapReasoningTierToEffort(opts.reasoningTier)
  const provider = getProviderForAgent(opts.agentName)
  const providerModel = resolveModel(legacyTier, opts.agentName)
  const messages = buildMessages(opts)
  const maxTokens = opts.maxTokens ?? (opts.reasoningTier === "deep" ? 2000 : 1500)

  if (!provider.available() || messages.length === 0) {
    return {
      text: "",
      toolUse: null,
      reasoningSummary: null,
      providerModel,
      modelTier: opts.modelTier,
      reasoningTier: opts.reasoningTier,
      appliedLegacyTier: legacyTier,
      appliedReasoningEffort,
    }
  }

  const result = await provider.completeWithTools(
    opts.systemPrompt ?? "",
    messages,
    opts.tools,
    maxTokens,
    legacyTier,
    opts.agentName,
  )

  return {
    text: result.text ?? "",
    toolUse: result.toolUse,
    reasoningSummary: null,
    providerModel,
    modelTier: opts.modelTier,
    reasoningTier: opts.reasoningTier,
    appliedLegacyTier: legacyTier,
    appliedReasoningEffort,
  }
}
