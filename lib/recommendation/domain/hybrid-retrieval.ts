/**
 * Hybrid Retrieval Engine
 *
 * 4-stage pipeline:
 *   1. Structured Filter — ProductRepo filters (diameter, material, flutes, operation)
 *   2. Score & Rank — existing match engine weighted scoring
 *   3. Evidence Retrieval — attach cutting conditions from EvidenceRepo
 *   4. Enrichment — compute evidence scores, build summaries
 *
 * Never generates data. All values from normalized JSON.
 */

import type {
  AppliedFilter,
  EvidenceChunk,
  EvidenceSummary,
  MatchStatus,
  RecommendationInput,
  ScoreBreakdown,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"
import {
  EvidenceRepo,
  InventoryRepo,
  LeadTimeRepo,
  ProductRepo,
} from "@/lib/recommendation/infrastructure/repositories/recommendation-repositories"
import { ENABLE_POST_SQL_CANDIDATE_FILTERS } from "@/lib/feature-flags"
import { resolveMaterialTag } from "@/lib/recommendation/domain/material-resolver"
import { getAppShapesForOperation } from "@/lib/recommendation/domain/operation-resolver"

// ── Result type ──────────────────────────────────────────────
export interface HybridResult {
  candidates: ScoredProduct[]
  evidenceMap: Map<string, EvidenceSummary>
  totalConsidered: number
  filtersApplied: AppliedFilter[]
}

// ── Scoring weights (same as match-engine.ts) ────────────────
const WEIGHTS = {
  diameter: 40,
  flutes: 15,
  materialTag: 20,
  operation: 15,
  coating: 5,
  completeness: 5,
  evidence: 10,  // bonus for having cutting condition evidence
}

function flattenActiveFilters(filters: AppliedFilter[]): AppliedFilter[] {
  const lastMaterialIndex = filters.reduce((lastIndex, filter, index) => (
    filter.field === "material" ? index : lastIndex
  ), -1)

  return filters.flatMap((filter, index) => {
    if (
      (filter.field === "workPieceName" || filter.field === "edpBrandName" || filter.field === "edpSeriesName") &&
      lastMaterialIndex !== -1 &&
      index < lastMaterialIndex
    ) {
      return []
    }

    const sideFilters = ((filter as unknown as { _sideFilters?: AppliedFilter[] })._sideFilters ?? [])
      .filter(sideFilter => !(
        lastMaterialIndex !== -1 &&
        (sideFilter.field === "edpBrandName" || sideFilter.field === "edpSeriesName") &&
        index < lastMaterialIndex
      ))

    return [filter, ...sideFilters]
  })
}

function formatProductEdpList(products: Array<{ displayCode: string; normalizedCode: string }>, maxItems = 50): string {
  const codes = products
    .map(product => product.displayCode || product.normalizedCode)
    .filter(Boolean)
  const visible = codes.slice(0, maxItems)
  const remainder = codes.length - visible.length
  return remainder > 0 ? `${visible.join(",")},...(+${remainder})` : visible.join(",")
}

function formatScoredEdpList(candidates: ScoredProduct[], maxItems = 50): string {
  return formatProductEdpList(
    candidates.map(candidate => ({
      displayCode: candidate.product.displayCode,
      normalizedCode: candidate.product.normalizedCode,
    })),
    maxItems
  )
}

// ── Main Entry Point ─────────────────────────────────────────
export async function runHybridRetrieval(
  input: RecommendationInput,
  filters: AppliedFilter[],
  topN = 0
): Promise<HybridResult> {
  const startedAt = Date.now()

  // ── Stage 1: Structured Filter ─────────────────────────────
  const fetchStartedAt = Date.now()
  let candidates = await ProductRepo.search(input, filters, topN > 0 ? Math.max(topN * 20, 500) : undefined)
  const fetchMs = Date.now() - fetchStartedAt
  const appliedFilters: AppliedFilter[] = []
  const totalConsidered = candidates.length

  if (ENABLE_POST_SQL_CANDIDATE_FILTERS) {
    // Hard filter: diameter ±2mm if specified
    if (input.diameterMm) {
      const strict = candidates.filter(p =>
        p.diameterMm !== null && Math.abs(p.diameterMm - input.diameterMm!) <= 2
      )
      if (strict.length > 0) {
        candidates = strict
        appliedFilters.push({
          field: "diameterMm",
          op: "range",
          value: `${input.diameterMm}mm ±2mm`,
          rawValue: input.diameterMm,
          appliedAt: 0,
        })
      }
    }
  }

  // Soft filter: material tag(s) — supports comma-separated multi-select (e.g. "알루미늄,스테인리스")
  const materialTags: string[] = []
  if (input.material) {
    const parts = input.material.split(",").map(s => s.trim()).filter(Boolean)
    for (const part of parts) {
      const tag = resolveMaterialTag(part)
      if (tag && !materialTags.includes(tag)) materialTags.push(tag)
    }
  }
  const materialTag = materialTags.length > 0 ? materialTags[0] : null  // primary tag for backward compat

  if (ENABLE_POST_SQL_CANDIDATE_FILTERS) {
    // Hard filter: material — only keep products that support at least one requested material
    if (materialTags.length > 0) {
      const matFiltered = candidates.filter(p =>
        materialTags.some(tag => p.materialTags.includes(tag))
      )
      if (matFiltered.length > 0) {
        candidates = matFiltered
        appliedFilters.push({
          field: "materialTag",
          op: "in",
          value: materialTags.join(",") + "군",
          rawValue: materialTags.join(","),
          appliedAt: 0,
        })
      }
      // If no products match the material, keep all but scoring will penalize
    }
  }

  if (ENABLE_POST_SQL_CANDIDATE_FILTERS) {
    // Apply narrowing filters from conversation — STRICT mode
    // Once a filter is selected, it MUST be enforced. No silent skipping.
    // The zero-candidate guard is in route.ts BEFORE the filter reaches here.
    for (const filter of flattenActiveFilters(filters)) {
      const before = candidates.length
      let filtered: typeof candidates | null = null

      switch (filter.field) {
        case "fluteCount": {
          const n = typeof filter.rawValue === "number" ? filter.rawValue : parseInt(String(filter.rawValue))
          if (!isNaN(n)) {
            filtered = candidates.filter(p => p.fluteCount === n)
          }
          break
        }
        case "coating": {
          const q = String(filter.rawValue).toLowerCase()
          filtered = candidates.filter(p => p.coating?.toLowerCase().includes(q))
          break
        }
        case "materialTag": {
          const tag = String(filter.rawValue).toUpperCase()
          filtered = candidates.filter(p => p.materialTags.includes(tag))
          break
        }
        case "toolSubtype": {
          const q = String(filter.rawValue).toLowerCase()
          filtered = candidates.filter(p => p.toolSubtype?.toLowerCase().includes(q))
          break
        }
        case "seriesName": {
          const q = String(filter.rawValue).toLowerCase()
          filtered = candidates.filter(p => p.seriesName?.toLowerCase().includes(q))
          break
        }
        // ── Extended product fields ──
        case "toolMaterial": {
          const q = String(filter.rawValue).toLowerCase()
          filtered = candidates.filter(p => p.toolMaterial?.toLowerCase().includes(q))
          break
        }
        case "toolType": {
          const q = String(filter.rawValue).toLowerCase()
          filtered = candidates.filter(p => p.toolType?.toLowerCase().includes(q))
          break
        }
        case "brand": {
          const q = String(filter.rawValue).toLowerCase()
          filtered = candidates.filter(p => p.brand?.toLowerCase().includes(q))
          break
        }
        case "edpBrandName":
          // Already constrained at DB/view query stage using edp_brand_name.
          // Keep as an applied filter for traceability, but don't re-filter on mapped product.brand.
          break
        case "edpSeriesName":
          // Already constrained at DB/view query stage using edp_series_name.
          // Keep as an applied filter for traceability, but don't re-filter again in memory.
          break
        case "coolantHole": {
          const want = String(filter.rawValue).toLowerCase() === "true" || String(filter.rawValue) === "yes"
          filtered = candidates.filter(p => p.coolantHole === want)
          break
        }
        case "shankDiameterMm": {
          const n = typeof filter.rawValue === "number" ? filter.rawValue : parseFloat(String(filter.rawValue))
          if (!isNaN(n)) filtered = candidates.filter(p => p.shankDiameterMm != null && Math.abs(p.shankDiameterMm - n) <= 0.5)
          break
        }
        case "lengthOfCutMm": {
          const n = typeof filter.rawValue === "number" ? filter.rawValue : parseFloat(String(filter.rawValue))
          if (!isNaN(n)) filtered = candidates.filter(p => p.lengthOfCutMm != null && Math.abs(p.lengthOfCutMm - n) <= 2)
          break
        }
        case "overallLengthMm": {
          const n = typeof filter.rawValue === "number" ? filter.rawValue : parseFloat(String(filter.rawValue))
          if (!isNaN(n)) filtered = candidates.filter(p => p.overallLengthMm != null && Math.abs(p.overallLengthMm - n) <= 5)
          break
        }
        case "helixAngleDeg": {
          const n = typeof filter.rawValue === "number" ? filter.rawValue : parseFloat(String(filter.rawValue))
          if (!isNaN(n)) filtered = candidates.filter(p => p.helixAngleDeg != null && Math.abs(p.helixAngleDeg - n) <= 2)
          break
        }
        // stockStatus is computed post-scoring (on ScoredProduct), not on CanonicalProduct.
        // It's applied as a post-filter after scoring in the runtime layer.
      }

      if (filtered !== null) {
        // STRICT: always apply the filter. If 0 results, keep 0 — route.ts guards this upstream.
        candidates = filtered
        appliedFilters.push(filter)
        console.log(`[hybrid:filter] ${filter.field}=${filter.value}: ${before} → ${filtered.length} candidates`)
      } else {
        appliedFilters.push(filter)
      }
    }
  } else {
    console.log("[hybrid:filter] post-sql candidate filters disabled by ENABLE_POST_SQL_CANDIDATE_FILTERS=false")
  }
  const filterMs = Date.now() - startedAt - fetchMs
  console.log(
    `[hybrid:stage] stage=post_filter count=${candidates.length} edps=${formatProductEdpList(candidates)}`
  )

  // ── Stage 2: Score & Rank ──────────────────────────────────
  const scoreStartedAt = Date.now()
  const appShapes = input.operationType ? getAppShapesForOperation(input.operationType) : []

  const scored: ScoredProduct[] = candidates.map(product => {
    // ── Compute each scoring dimension with explanations ────
    let diamScore = 0
    let diamDetail = ""
    if (!input.diameterMm) {
      diamScore = 10
      diamDetail = "직경 미지정 (기본 10pt)"
    } else if (product.diameterMm !== null) {
      const diff = Math.abs(product.diameterMm - input.diameterMm)
      if (diff === 0) { diamScore = WEIGHTS.diameter; diamDetail = `φ${product.diameterMm}mm 정확 일치` }
      else if (diff <= 0.1) { diamScore = Math.round(WEIGHTS.diameter * 0.9); diamDetail = `φ${product.diameterMm}mm (오차 ${diff.toFixed(1)}mm)` }
      else if (diff <= 0.5) { diamScore = Math.round(WEIGHTS.diameter * 0.6); diamDetail = `φ${product.diameterMm}mm (오차 ${diff.toFixed(1)}mm)` }
      else if (diff <= 1.0) { diamScore = Math.round(WEIGHTS.diameter * 0.3); diamDetail = `φ${product.diameterMm}mm (오차 ${diff.toFixed(1)}mm, 근사)` }
      else { diamDetail = `φ${product.diameterMm}mm (오차 ${diff.toFixed(1)}mm, 범위 초과)` }
    } else {
      diamDetail = "직경 정보 없음"
    }

    let fluteScore = 0
    let fluteDetail = ""
    if (!input.flutePreference) {
      fluteScore = Math.round(WEIGHTS.flutes * 0.5)
      fluteDetail = "날 수 미지정 (기본 50%)"
    } else if (product.fluteCount === input.flutePreference) {
      fluteScore = WEIGHTS.flutes
      fluteDetail = `${product.fluteCount}날 일치`
    } else {
      fluteDetail = product.fluteCount != null ? `${product.fluteCount}날 (요청: ${input.flutePreference}날)` : "날 수 정보 없음"
    }

    let matScore = 0
    let matDetail = ""
    if (materialTags.length === 0) {
      matScore = Math.round(WEIGHTS.materialTag * 0.5)
      matDetail = "소재 미지정 (기본 50%)"
    } else {
      // Check if product supports ANY of the requested material tags
      const matchedMats = materialTags.filter(tag => product.materialTags.includes(tag))
      if (matchedMats.length > 0) {
        // Score proportional to how many requested materials are matched
        const ratio = matchedMats.length / materialTags.length
        matScore = Math.round(WEIGHTS.materialTag * Math.max(ratio, 0.7)) // at least 70% if any match
        matDetail = matchedMats.length === materialTags.length
          ? `${matchedMats.join(",")}군 모두 적합`
          : `${matchedMats.join(",")}군 적합 (${materialTags.length}개 중 ${matchedMats.length}개)`
      } else {
        // Penalty for explicit material mismatch: -10 points instead of 0
        matScore = -10
        matDetail = `${materialTags.join(",")}군 미지원 (지원: ${product.materialTags.join(", ") || "없음"})`
      }
    }

    let opScore = 0
    let opDetail = ""
    if (!appShapes.length) {
      opScore = Math.round(WEIGHTS.operation * 0.5)
      opDetail = "가공방식 미지정 (기본 50%)"
    } else {
      const matches = product.applicationShapes.filter(s => appShapes.includes(s))
      if (matches.length > 0) {
        const r = matches.length / appShapes.length
        opScore = Math.round(WEIGHTS.operation * Math.min(r, 1))
        opDetail = `가공 적합 (${matches.join(", ")})`
      } else {
        opDetail = `가공방식 불일치 (제품: ${product.applicationShapes.join(", ") || "없음"})`
      }
    }

    let coatScore = 0
    let coatDetail = ""
    if (!input.coatingPreference) {
      coatScore = Math.round(WEIGHTS.coating * 0.5)
      coatDetail = "코팅 미지정 (기본 50%)"
    } else if (product.coating?.toLowerCase().includes(input.coatingPreference.toLowerCase())) {
      coatScore = WEIGHTS.coating
      coatDetail = `${product.coating} 일치`
    } else {
      coatDetail = product.coating ? `${product.coating} (요청: ${input.coatingPreference})` : "코팅 정보 없음"
    }

    const compScore = Math.round(product.dataCompletenessScore * WEIGHTS.completeness)
    const compDetail = `데이터 완성도 ${Math.round(product.dataCompletenessScore * 100)}%`

    const score = diamScore + fluteScore + matScore + opScore + coatScore + compScore
    const maxScore = Object.values(WEIGHTS).reduce((a, b) => a + b, 0)
    const ratio = score / maxScore
    const matchStatus: MatchStatus = ratio >= 0.75 ? "exact" : ratio >= 0.45 ? "approximate" : "none"

    const scoreBreakdown: ScoreBreakdown = {
      diameter: { score: diamScore, max: WEIGHTS.diameter, detail: diamDetail },
      flutes: { score: fluteScore, max: WEIGHTS.flutes, detail: fluteDetail },
      materialTag: { score: matScore, max: WEIGHTS.materialTag, detail: matDetail },
      operation: { score: opScore, max: WEIGHTS.operation, detail: opDetail },
      coating: { score: coatScore, max: WEIGHTS.coating, detail: coatDetail },
      completeness: { score: compScore, max: WEIGHTS.completeness, detail: compDetail },
      evidence: { score: 0, max: WEIGHTS.evidence, detail: "증거 미매칭" },
      total: score,
      maxTotal: maxScore,
      matchPct: Math.round(ratio * 100),
    }

    // Matched fields
    const matchedFields: string[] = []
    if (input.diameterMm && product.diameterMm !== null && Math.abs(product.diameterMm - input.diameterMm) <= 0.1)
      matchedFields.push(`직경 ${product.diameterMm}mm 일치`)
    if (input.flutePreference && product.fluteCount === input.flutePreference)
      matchedFields.push(`${product.fluteCount}날 일치`)
    if (materialTags.length > 0 && materialTags.some(tag => product.materialTags.includes(tag)))
      matchedFields.push(`소재 ${materialTags.filter(t => product.materialTags.includes(t)).join(",")}군 적합`)
    if (appShapes.length && product.applicationShapes.some(s => appShapes.includes(s)))
      matchedFields.push(`가공 방식 적합`)
    if (input.coatingPreference && product.coating?.toLowerCase().includes(input.coatingPreference.toLowerCase()))
      matchedFields.push(`코팅 ${product.coating} 일치`)

    return {
      product,
      score,
      scoreBreakdown,
      matchedFields,
      matchStatus,
      inventory: [],
      leadTimes: [],
      evidence: [],
      stockStatus: "unknown",
      totalStock: null,
      minLeadTimeDays: null,
    } satisfies ScoredProduct
  })

  // Sort: score desc → priority asc → completeness desc
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.product.sourcePriority !== b.product.sourcePriority)
      return a.product.sourcePriority - b.product.sourcePriority
    return b.product.dataCompletenessScore - a.product.dataCompletenessScore
  })
  console.log(
    `[hybrid:stage] stage=ranked count=${scored.length} edps=${formatScoredEdpList(scored)}`
  )

  // Take top-N with no minimum score threshold for the initial candidate list.
  const minScoreThreshold = 0
  const qualifiedCandidates = scored.filter(s => s.score >= minScoreThreshold)

  // ── Dedupe by product code (no series cap — show all matched products) ──
  const productCodesSeen = new Set<string>()
  const diverseCandidates = qualifiedCandidates.filter(c => {
    if (productCodesSeen.has(c.product.normalizedCode)) return false
    productCodesSeen.add(c.product.normalizedCode)
    return true
  })

  const topCandidates = topN > 0
    ? diverseCandidates.slice(0, topN)
    : diverseCandidates
  console.log(
    `[hybrid:stage] stage=final count=${topCandidates.length} edps=${formatScoredEdpList(topCandidates)}`
  )

  // Enrich top candidates with inventory + lead time (deferred for performance)
  await Promise.all(
    topCandidates.slice(0, 100).map(async (c) => {
      const inv = await InventoryRepo.getEnrichedAsync(c.product.normalizedCode)
      c.inventory = inv.snapshots
      c.totalStock = inv.totalStock
      c.stockStatus = inv.stockStatus
      c.leadTimes = LeadTimeRepo.getByEdp(c.product.normalizedCode)
      c.minLeadTimeDays = LeadTimeRepo.minLeadTime(c.product.normalizedCode)
    })
  )

  // ── Stage 3: Evidence Retrieval (parallelized) ─────────────
  const evidenceMap = new Map<string, EvidenceSummary>()

  const evidenceEntries = await Promise.all(
    topCandidates.map(async (candidate) => {
      const summary = await EvidenceRepo.buildSummary(
        candidate.product.normalizedCode,
        {
          seriesName: candidate.product.seriesName,
          isoGroup: materialTag,
          cuttingType: input.operationType ? mapOperationToCuttingType(input.operationType) : null,
          diameterMm: candidate.product.diameterMm ?? input.diameterMm,
        }
      )
      return { code: candidate.product.normalizedCode, summary }
    })
  )
  for (const { code, summary } of evidenceEntries) {
    if (summary.chunks.length > 0) {
      evidenceMap.set(code, summary)
    }
  }

  // ── Stage 4: Evidence Score Boost ──────────────────────────
  for (const candidate of topCandidates) {
    if (evidenceMap.has(candidate.product.normalizedCode)) {
      const summary = evidenceMap.get(candidate.product.normalizedCode)!
      const evBoost = Math.round(WEIGHTS.evidence * summary.bestConfidence)
      candidate.score += evBoost
      candidate.matchedFields.push(`절삭조건 ${summary.sourceCount}건 보유`)
      // Update breakdown
      if (candidate.scoreBreakdown) {
        candidate.scoreBreakdown.evidence = {
          score: evBoost,
          max: WEIGHTS.evidence,
          detail: `절삭조건 ${summary.sourceCount}건 (신뢰도 ${Math.round(summary.bestConfidence * 100)}%)`,
        }
        candidate.scoreBreakdown.total = candidate.score
        candidate.scoreBreakdown.matchPct = Math.round((candidate.score / candidate.scoreBreakdown.maxTotal) * 100)
      }
    }
  }

  // Re-sort after evidence boost
  topCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.product.sourcePriority !== b.product.sourcePriority)
      return a.product.sourcePriority - b.product.sourcePriority
    return b.product.dataCompletenessScore - a.product.dataCompletenessScore
  })

  const scoreAndEvidenceMs = Date.now() - scoreStartedAt

  console.log(
    `[recommend] hybrid timings: total=${Date.now() - startedAt}ms fetch=${fetchMs}ms filter=${filterMs}ms score_evidence=${scoreAndEvidenceMs}ms considered=${totalConsidered} final=${topCandidates.length}`
  )

  return {
    candidates: topCandidates,
    evidenceMap,
    totalConsidered,
    filtersApplied: appliedFilters,
  }
}

// ── Helper: Map Korean operation to cutting type in evidence ──
function mapOperationToCuttingType(operation: string): string | null {
  const lower = operation.toLowerCase()
  if (lower.includes("슬롯") || lower.includes("slot")) return "Slotting"
  if (lower.includes("측면") || lower.includes("side")) return "Side Cutting"
  if (lower.includes("정삭") || lower.includes("finish")) return "Finishing"
  if (lower.includes("황삭") || lower.includes("rough")) return "Roughing"
  if (lower.includes("고이송") || lower.includes("high feed")) return "High Feed"
  return null
}

// ── Classify results (like match-engine but for hybrid) ──────
export function classifyHybridResults(result: HybridResult): {
  primary: ScoredProduct | null
  alternatives: ScoredProduct[]
  status: MatchStatus
} {
  const { candidates } = result
  if (!candidates.length) return { primary: null, alternatives: [], status: "none" }

  const primary = candidates[0]
  const alternatives = candidates.slice(1, 10)

  return {
    primary,
    alternatives,
    status: primary.matchStatus,
  }
}
