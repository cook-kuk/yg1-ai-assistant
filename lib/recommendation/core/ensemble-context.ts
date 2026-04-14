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
  const lines: string[] = []
  lines.push(`═══ 앙상블 컨텍스트 (4 단서 병렬 수집) ═══`)
  lines.push(`메시지: "${ctx.userMessage}"`)
  lines.push(`현재: 후보 ${ctx.candidateCount}개, 적용 필터 ${ctx.appliedFilterCount}개`)

  if (ctx.kg) {
    lines.push(``)
    lines.push(`[KG 판단] ${ctx.kg.source} (conf=${ctx.kg.confidence.toFixed(2)}): ${ctx.kg.reason}`)
  }

  if (ctx.toolMemory.length > 0) {
    lines.push(``)
    lines.push(`[Tool Memory — 과거 성공 사례 (pg_trgm 유사도)]`)
    for (const hit of ctx.toolMemory) {
      const filterStr = summarizeFilters(hit.filters)
      lines.push(`- sim=${hit.similarity.toFixed(2)} [${hit.tier}] "${hit.question}" → {${filterStr}} (후보 ${hit.candidateCount}개, 히트 ${hit.hitCount}회)`)
    }
    const hasHigh = ctx.toolMemory.some(h => h.tier === "high")
    if (hasHigh) {
      lines.push(`  → high tier 는 오타/약어 회복에 강함. 필터 네이밍을 과거 성공 케이스에 맞춰라.`)
    }
  }

  if (ctx.fewShots.length > 0) {
    lines.push(``)
    lines.push(`[Few-Shot (피드백 풀 + 골든셋 유사도 상위)]`)
    lines.push(buildFewShotText(ctx.fewShots))
  }

  if (ctx.cacheHit) {
    lines.push(``)
    lines.push(`[Semantic Cache — 정확 히트한 유사 쿼리의 결정]`)
    lines.push(`actions=${JSON.stringify(ctx.cacheHit.actions).slice(0, 300)}`)
  }

  lines.push(``)
  lines.push(`위 단서를 종합해서 최종 필터를 결정하세요.`)
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
