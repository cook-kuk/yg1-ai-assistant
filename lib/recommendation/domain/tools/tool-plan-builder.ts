/**
 * Tool Plan Builder — Plans multiple tool calls for a single user question.
 *
 * Uses query target classification to determine which tools are needed.
 * Deterministic. No LLM calls.
 */

import type { QueryTarget } from "../context/query-target-classifier"
import type { ToolPlan, PlannedToolCall, AnswerTopic } from "./tool-types"

/**
 * Build a multi-tool plan based on the classified query target and context.
 */
export function buildToolPlan(
  queryTarget: QueryTarget,
  context: {
    hasCurrentCandidates: boolean
    candidateCount: number
    hasRecommendation: boolean
    hasComparison: boolean
    hasCuttingConditions: boolean
    appliedFilters: Array<{ field: string; value: string }>
  }
): ToolPlan {
  const calls: PlannedToolCall[] = []
  let priority = 0
  const nextPriority = () => ++priority

  const answerTopic = mapQueryTargetToAnswerTopic(queryTarget.type)

  switch (queryTarget.type) {
    case "series_comparison": {
      // Compare two series: need series lookup for each + comparison
      for (const entity of queryTarget.entities) {
        calls.push({
          tool: "series_lookup",
          purpose: `시리즈 "${entity}" 정보 조회`,
          priority: nextPriority(),
          required: true,
          inputSummary: { seriesName: entity },
        })
      }
      calls.push({
        tool: "comparison",
        purpose: `${queryTarget.entities.join(" vs ")} 비교`,
        priority: nextPriority(),
        required: true,
        inputSummary: { targets: queryTarget.entities },
      })
      break
    }

    case "brand_comparison": {
      for (const entity of queryTarget.entities) {
        calls.push({
          tool: "brand_lookup",
          purpose: `브랜드 "${entity}" 정보 조회`,
          priority: nextPriority(),
          required: true,
          inputSummary: { brandName: entity },
        })
      }
      calls.push({
        tool: "comparison",
        purpose: `${queryTarget.entities.join(" vs ")} 비교`,
        priority: nextPriority(),
        required: true,
        inputSummary: { targets: queryTarget.entities },
      })
      break
    }

    case "product_comparison": {
      calls.push({
        tool: "comparison",
        purpose: "제품 비교",
        priority: nextPriority(),
        required: true,
        inputSummary: { targets: queryTarget.entities },
      })
      break
    }

    case "series_info": {
      for (const entity of queryTarget.entities) {
        calls.push({
          tool: "series_lookup",
          purpose: `시리즈 "${entity}" 정보`,
          priority: nextPriority(),
          required: true,
          inputSummary: { seriesName: entity },
        })
      }
      // Also check inventory if we have the series
      if (queryTarget.entities.length === 1) {
        calls.push({
          tool: "inventory_lookup",
          purpose: "재고 현황 확인",
          priority: nextPriority(),
          required: false,
          inputSummary: { seriesName: queryTarget.entities[0] },
        })
      }
      break
    }

    case "brand_info": {
      for (const entity of queryTarget.entities) {
        calls.push({
          tool: "brand_lookup",
          purpose: `브랜드 "${entity}" 정보`,
          priority: nextPriority(),
          required: true,
          inputSummary: { brandName: entity },
        })
      }
      break
    }

    case "product_info": {
      calls.push({
        tool: "product_lookup",
        purpose: "제품 상세 정보",
        priority: nextPriority(),
        required: true,
        inputSummary: { productCodes: queryTarget.entities },
      })
      break
    }

    case "field_count": {
      calls.push({
        tool: "count_aggregation",
        purpose: "필드 분포/개수 조회",
        priority: nextPriority(),
        required: true,
        inputSummary: { fromCurrentCandidates: context.hasCurrentCandidates },
      })
      break
    }

    case "field_explanation": {
      calls.push({
        tool: "field_distribution",
        purpose: "필드 데이터 분포 조회",
        priority: nextPriority(),
        required: false,
        inputSummary: { fromCurrentCandidates: true },
      })
      calls.push({
        tool: "explanation",
        purpose: "필드 설명 생성",
        priority: nextPriority(),
        required: true,
        inputSummary: {},
      })
      break
    }

    case "active_field_query": {
      calls.push({
        tool: "field_distribution",
        purpose: "현재 필드 분포 조회",
        priority: nextPriority(),
        required: false,
        inputSummary: { fromCurrentCandidates: true },
      })
      calls.push({
        tool: "explanation",
        purpose: "현재 필드 설명",
        priority: nextPriority(),
        required: true,
        inputSummary: {},
      })
      break
    }

    default: {
      // General question — single explanation tool
      calls.push({
        tool: "explanation",
        purpose: "일반 답변 생성",
        priority: nextPriority(),
        required: true,
        inputSummary: {},
      })
      break
    }
  }

  return {
    answerTopic,
    searchScopeConstraints: Object.fromEntries(
      context.appliedFilters.map(f => [f.field, f.value])
    ),
    targetEntities: queryTarget.entities,
    plannedCalls: calls,
  }
}

function mapQueryTargetToAnswerTopic(type: string): AnswerTopic {
  const map: Record<string, AnswerTopic> = {
    series_comparison: "series_comparison",
    brand_comparison: "brand_comparison",
    product_comparison: "product_comparison",
    series_info: "series_info",
    brand_info: "brand_info",
    product_info: "spec_query",
    field_count: "count_query",
    field_explanation: "field_explanation",
    active_field_query: "field_explanation",
    general_question: "general",
  }
  return map[type] ?? "general"
}

/**
 * Check if a tool plan requires search/retrieval beyond current state.
 */
export function planRequiresSearch(plan: ToolPlan): boolean {
  const searchTools = new Set(["candidate_search", "series_lookup", "brand_lookup", "product_lookup", "comparison", "inventory_lookup", "cutting_condition_lookup"])
  return plan.plannedCalls.some(c => searchTools.has(c.tool) && c.required)
}
