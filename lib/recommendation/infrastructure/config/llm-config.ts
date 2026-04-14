/**
 * LLM Execution Config (SSOT for the new llm-executor layer)
 *
 * 새 얇은 executor 레이어(lib/llm/llm-executor.ts)가 사용하는 설정.
 * provider.ts / AGENT_TIER / resolveModel 는 건드리지 않고,
 * mini/full + light/normal/deep 매핑만 이 파일에 모은다.
 *
 * legacy tier(haiku/sonnet/opus) 네이밍은 현재 프로젝트 이력상 그대로 둔다
 * (memory: project_agent_naming_refactor_todo) — 외부에서 mini/full 로
 * 말하더라도 내부에서는 기존 legacy tier 로 번역만 한다.
 */

import type { ModelTier as LegacyModelTier, ReasoningEffort } from "@/lib/llm/provider"

function envStr(name: string, defaultValue: string): string {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return defaultValue
  return raw
}

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === "") return defaultValue
  const v = raw.toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

// ── Public types ─────────────────────────────────────────────
/** 새 외부 명칭. 기존 legacy tier 와는 독립 개념. */
export type ModelTier = "mini" | "full"
export type ReasoningTier = "light" | "normal" | "deep"

// ── Tier ↔ legacy tier 매핑 ─────────────────────────────────
// 이 매핑을 호출부 곳곳에 흩뿌리지 않기 위해 mapper 만 export.
const MINI_LEGACY_TIER: LegacyModelTier = (envStr("LLM_MINI_LEGACY_TIER", "haiku") as LegacyModelTier)
const FULL_LEGACY_TIER: LegacyModelTier = (envStr("LLM_FULL_LEGACY_TIER", "sonnet") as LegacyModelTier)

export function mapModelTierToLegacy(tier: ModelTier): LegacyModelTier {
  return tier === "mini" ? MINI_LEGACY_TIER : FULL_LEGACY_TIER
}

// ── reasoning tier ↔ effort 매핑 ─────────────────────────────
const EFFORT_LIGHT: ReasoningEffort  = (envStr("LLM_REASONING_LIGHT",  "minimal") as ReasoningEffort)
const EFFORT_NORMAL: ReasoningEffort = (envStr("LLM_REASONING_NORMAL", "medium")  as ReasoningEffort)
const EFFORT_DEEP: ReasoningEffort   = (envStr("LLM_REASONING_DEEP",   "high")    as ReasoningEffort)

export function mapReasoningTierToEffort(tier: ReasoningTier): ReasoningEffort {
  switch (tier) {
    case "light":  return EFFORT_LIGHT
    case "normal": return EFFORT_NORMAL
    case "deep":   return EFFORT_DEEP
  }
}

// ── Router 기본값 (complexity-router 가 새 override 없이 호출될 때) ─
export const DEFAULT_MODEL_TIER_LIGHT:  ModelTier = (envStr("LLM_DEFAULT_MODEL_LIGHT",  "mini") as ModelTier)
export const DEFAULT_MODEL_TIER_NORMAL: ModelTier = (envStr("LLM_DEFAULT_MODEL_NORMAL", "full") as ModelTier)
export const DEFAULT_MODEL_TIER_DEEP:   ModelTier = (envStr("LLM_DEFAULT_MODEL_DEEP",   "full") as ModelTier)

// ── Observability / debug flags ──────────────────────────────
export const ENABLE_REASONING_SUMMARY  = envBool("LLM_ENABLE_REASONING_SUMMARY", false)
export const ENABLE_VERBOSE_LLM_DEBUG  = envBool("LLM_ENABLE_VERBOSE_DEBUG", process.env.NODE_ENV !== "production")
export const ENABLE_TURN_DEBUG_LOG     = envBool("LLM_ENABLE_TURN_DEBUG_LOG", process.env.NODE_ENV !== "production")
