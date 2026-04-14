/**
 * Ensemble Context — Vanna 2.0 앙상블 스타일 단서 수집.
 *
 * SQL Agent/tool-use router 에 넘기기 전에 네 가지 단서를 병렬 수집해서
 * 하나의 컨텍스트 블록으로 묶어준다. LLM 은 모든 단서를 보고 최종 결정.
 *
 *   1. KG — 결정론적 도메인 판단 (skip/back/negation/sort 등)
 *   2. Tool Memory — 과거 성공 SQL 의 pg_trgm 유사도 매칭 (오타/약어 회복)
 *   3. Semantic Cache — 정확 히트 시 LLM 호출 자체를 건너뛰는 단축
 *   4. Adaptive Few-Shot — 피드백 풀 + 골든셋에서 유사도 상위 예시
 *
 * 중요: 이 모듈은 분류기가 아니다. 단서를 모아 프롬프트에 주입할 뿐.
 * 최종 판단은 downstream LLM 이 한다.
 */

import type { AppliedFilter } from "@/lib/recommendation/domain/types"
import type { ExplorationSessionState } from "@/lib/types/exploration"
import { tryKGDecision, type KGDecisionResult } from "./knowledge-graph"
import { lookupCache, type CachedResult } from "./semantic-cache"
import { searchToolMemory, type ToolMemoryHit } from "./tool-memory"
import { selectFewShots, buildFewShotText, type FewShotExample } from "./adaptive-few-shot"

export interface EnsembleContext {
  userMessage: string
  candidateCount: number
  appliedFilterCount: number
  kg: KGDecisionResult | null
  cacheHit: CachedResult | null
  toolMemory: ToolMemoryHit[]
  fewShots: FewShotExample[]
}

export async function gatherEnsembleContext(
  userMessage: string,
  sessionState: ExplorationSessionState | null,
  appliedFilters: AppliedFilter[],
): Promise<EnsembleContext> {
  const [kgResult, cacheHit, toolMemory, fewShots] = await Promise.all([
    Promise.resolve(safeKg(userMessage, sessionState)),
    Promise.resolve(safeCache(userMessage, appliedFilters)),
    safeToolMemory(userMessage),
    Promise.resolve(safeFewShots(userMessage)),
  ])

  return {
    userMessage,
    candidateCount: sessionState?.candidateCount ?? 0,
    appliedFilterCount: appliedFilters.length,
    kg: kgResult,
    cacheHit,
    toolMemory,
    fewShots,
  }
}

function safeKg(userMessage: string, sessionState: ExplorationSessionState | null): KGDecisionResult | null {
  try {
    const r = tryKGDecision(userMessage, sessionState)
    return r.decision || r.specPatch ? r : null
  } catch { return null }
}

function safeCache(userMessage: string, appliedFilters: AppliedFilter[]): CachedResult | null {
  try { return lookupCache(userMessage, appliedFilters) } catch { return null }
}

async function safeToolMemory(userMessage: string): Promise<ToolMemoryHit[]> {
  try { return await searchToolMemory(userMessage) } catch { return [] }
}

function safeFewShots(userMessage: string): FewShotExample[] {
  try { return selectFewShots(userMessage, 4) } catch { return [] }
}

export function formatEnsembleForPrompt(ctx: EnsembleContext): string {
  // 히트가 하나도 없으면 아무것도 주입하지 않음 (LLM 혼란 방지).
  // "매칭 없음" 같은 부정형 텍스트도 금지 — 있는 단서만 쓴다.
  const hasKg = !!ctx.kg
  const hasToolMem = ctx.toolMemory.length > 0
  const hasFewShots = ctx.fewShots.length > 0
  const hasCache = !!ctx.cacheHit
  if (!hasKg && !hasToolMem && !hasFewShots && !hasCache) return ""

  const lines: string[] = []
  lines.push(`═══ 앙상블 단서 (있는 것만) ═══`)

  if (hasKg && ctx.kg) {
    lines.push(`[KG] ${ctx.kg.source} (conf=${ctx.kg.confidence.toFixed(2)}): ${ctx.kg.reason}`)
  }

  if (hasToolMem) {
    lines.push(`[Tool Memory — 과거 성공 사례]`)
    for (const hit of ctx.toolMemory) {
      const filterStr = summarizeFilters(hit.filters)
      lines.push(`- sim=${hit.similarity.toFixed(2)} [${hit.tier}] "${hit.question}" → {${filterStr}}`)
    }
    if (ctx.toolMemory.some(h => h.tier === "high")) {
      lines.push(`  → high tier: 오타/약어 회복. 필터 네이밍 일관성 유지.`)
    }
  }

  if (hasFewShots) {
    lines.push(`[Few-Shot]`)
    lines.push(buildFewShotText(ctx.fewShots))
  }

  if (hasCache) {
    lines.push(`[Semantic Cache hit] actions=${JSON.stringify(ctx.cacheHit!.actions).slice(0, 300)}`)
  }

  return lines.join("\n")
}

function summarizeFilters(filters: unknown): string {
  if (!Array.isArray(filters)) return ""
  return filters
    .map(f => {
      if (!f || typeof f !== "object") return ""
      const obj = f as { field?: string; value?: unknown; op?: string }
      const op = obj.op && obj.op !== "eq" ? `${obj.op}:` : ""
      return obj.field ? `${obj.field}=${op}${String(obj.value ?? "")}` : ""
    })
    .filter(Boolean)
    .join(", ")
}
