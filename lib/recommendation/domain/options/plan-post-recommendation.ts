/**
 * Post-Recommendation Option Planning — Options after recommendation is shown.
 *
 * Generates dynamic options based on top candidates: product details,
 * comparisons, narrowing by coating/flute/series, stock-aware actions, etc.
 */

import type { SmartOption, OptionPlannerContext } from "./types"
import { nextOptionId } from "./planner-utils"

// ════════════════════════════════════════════════════════════════
// POST-RECOMMENDATION OPTIONS (after recommendation)
// ════════════════════════════════════════════════════════════════

export function planPostRecommendationOptions(ctx: OptionPlannerContext): SmartOption[] {
  const options: SmartOption[] = []
  const top = ctx.topCandidates ?? []
  const displayed = ctx.displayedProducts ?? []
  const artifacts = ctx.visibleArtifacts
  const skippedFields = new Set(ctx.appliedFilters.filter(filter => filter.op === "skip").map(filter => filter.field))

  // ── UI-artifact-aware: if comparison is already visible, skip compare option ──
  // ── If cutting conditions already shown, skip cutting conditions option ──

  // ── 후보 데이터 기반 동적 옵션 ──
  const primaryCode = top[0]?.displayCode

  // 1. 제품 상세 (1순위 제품코드 포함)
  if (primaryCode) {
    options.push({
      id: nextOptionId("explore"),
      family: "explore",
      label: `${primaryCode} 상세 정보`,
      subtitle: "추천 제품 상세",
      reason: "추천 근거 + 스펙 확인",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 0.9,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "explain_recommendation" }],
      },
    })
  }

  // 2. 상위 비교 (후보 + 비교 UI 없을 때)
  if (top.length >= 2 && !artifacts?.hasComparison) {
    options.push({
      id: nextOptionId("compare"),
      family: "compare",
      label: `상위 ${Math.min(top.length, 3)}개 비교`,
      subtitle: top.slice(0, 3).map(c => c.displayCode).join(" vs "),
      reason: "상위 후보 비교",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: top.length >= 3,
      priorityScore: 0.6,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "compare" }],
      },
    })
  }

  // 3. Narrow/change coating (dynamic based on variety)
  const coatingSet = new Set(top.map(c => c.coating).filter(Boolean))
  if (!skippedFields.has("coating") && coatingSet.size >= 2) {
    const coatingProjected = Math.max(1, Math.round(top.length / coatingSet.size))
    options.push({
      id: nextOptionId("narrowing"),
      family: "narrowing",
      label: `코팅으로 좁히기 (${[...coatingSet].slice(0, 3).join("/")})`,
      subtitle: `현재 ${coatingSet.size}종`,
      field: "coating",
      reason: "코팅 기준 추가 필터링",
      projectedCount: coatingProjected,
      projectedDelta: -(top.length - coatingProjected),
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.7,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "narrow_coating" }],
      },
    })
  } else if (!skippedFields.has("coating") && top[0]?.coating) {
    options.push({
      id: nextOptionId("explore"),
      family: "explore",
      label: "다른 코팅 옵션 보기",
      subtitle: `현재: ${top[0].coating}`,
      field: "coating",
      reason: "코팅 변경 탐색",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.7,
      plan: {
        type: "replace_filter",
        patches: [{ op: "remove", field: "coating" }],
      },
    })
  }

  // 4. Narrow by flute count (if multiple flute counts exist)
  const fluteCounts = new Set(top.map(c => c.fluteCount).filter(Boolean))
  if (fluteCounts.size >= 2) {
    const fluteLabels = [...fluteCounts].sort((a, b) => (a ?? 0) - (b ?? 0)).map(f => `${f}날`).join("/")
    const fluteProjected = Math.max(1, Math.round(top.length / fluteCounts.size))
    options.push({
      id: nextOptionId("narrowing"),
      family: "narrowing",
      label: `날수로 좁히기 (${fluteLabels})`,
      subtitle: `현재 ${fluteCounts.size}종`,
      field: "fluteCount",
      reason: "날수 기준 추가 필터링",
      projectedCount: fluteProjected,
      projectedDelta: -(top.length - fluteProjected),
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 0.85,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "narrow_flute" }],
      },
    })
  }

  // 4b. Series comparison (when multiple series exist)
  const seriesSet = new Set(top.map(c => c.seriesName).filter(Boolean))
  if (seriesSet.size >= 2) {
    options.push({
      id: nextOptionId("explore"),
      family: "explore",
      label: `시리즈 차이 설명해줘 (${[...seriesSet].slice(0, 2).join(" vs ")})`,
      subtitle: `${seriesSet.size}개 시리즈`,
      field: "seriesName",
      reason: "시리즈별 특성 비교",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.6,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "series_explain" }],
      },
    })
  }

  // 4c. 직경 변경 (현재 직경 표시)
  if (top[0]?.diameterMm) {
    options.push({
      id: nextOptionId("explore"),
      family: "explore",
      label: `φ${top[0].diameterMm}mm 외 다른 직경`,
      subtitle: `현재: ${top[0].diameterMm}mm`,
      field: "diameterMm",
      reason: "직경 변경 탐색",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.85,
      plan: {
        type: "replace_filter",
        patches: [{ op: "remove", field: "diameterMm" }],
      },
    })
  }

  // 6. Previous step (if filters exist)
  if (ctx.appliedFilters.length > 0) {
    options.push({
      id: nextOptionId("action"),
      family: "action",
      label: "⟵ 이전 단계로 돌아가기",
      reason: "이전 필터 단계로 복귀",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.65,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "undo" }],
      },
    })
  }

  // 7. Stock-aware options from displayedProducts
  const primaryProduct = displayed[0]
  if (primaryProduct?.stockStatus === "outofstock") {
    options.push({
      id: nextOptionId("action"),
      family: "action",
      label: "재고 있는 대안 보기",
      subtitle: `${primaryProduct.displayCode} 재고 없음`,
      field: "stockStatus",
      reason: "재고 있는 제품으로 대안 탐색",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: true,
      priorityScore: 0.3,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "stockStatus", value: "instock" }],
      },
    })
  } else if (primaryProduct?.stockStatus === "limited") {
    options.push({
      id: nextOptionId("action"),
      family: "action",
      label: "재고 상세 확인",
      subtitle: `${primaryProduct.displayCode} 재고 제한적`,
      reason: "재고 상세 정보 확인",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.55,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "inventory_detail" }],
      },
    })
  }

  // 8. Material-specific tips (when material is known and multiple products exist)
  const material = ctx.resolvedInput?.material as string | undefined
  if (material && top.length >= 2) {
    options.push({
      id: nextOptionId("explore"),
      family: "explore",
      label: `${material} 가공 팁 보기`,
      subtitle: "소재별 최적 조건",
      field: "material",
      reason: "소재 특성에 맞는 가공 조건 안내",
      projectedCount: null,
      projectedDelta: null,
      preservesContext: true,
      destructive: false,
      recommended: false,
      priorityScore: 0.5,
      plan: {
        type: "apply_filter",
        patches: [{ op: "add", field: "_action", value: "material_tip" }],
      },
    })
  }

  // 9. Reset (always available, ranked last)
  options.push({
    id: nextOptionId("reset"),
    family: "reset",
    label: "처음부터 다시",
    reason: "전체 초기화",
    projectedCount: null,
    projectedDelta: null,
    preservesContext: false,
    destructive: true,
    recommended: false,
    priorityScore: 0.05,
    plan: {
      type: "reset_session",
      patches: [],
    },
  })

  return options
}
