/**
 * Match Engine
 * Filters and scores products against recommendation input.
 * NEVER generates values — only scores real data.
 */

import type { CanonicalProduct, RecommendationInput, MatchStatus, ScoredProduct } from "@/lib/types/canonical"
import { ProductRepo } from "@/lib/data/repos/product-repo"
import { InventoryRepo } from "@/lib/data/repos/inventory-repo"
import { LeadTimeRepo } from "@/lib/data/repos/lead-time-repo"
import { resolveMaterialTag } from "@/lib/domain/material-resolver"
import { getAppShapesForOperation } from "@/lib/domain/operation-resolver"

// ── Scoring weights ───────────────────────────────────────────
const WEIGHTS = {
  diameter: 40,       // exact diameter match is most critical
  flutes: 15,
  materialTag: 20,
  operation: 15,
  coating: 5,
  completeness: 5,    // prefer more complete data
}

function scoreDiameter(product: CanonicalProduct, targetMm: number | undefined): number {
  if (!targetMm) return 10 // no preference, neutral
  if (product.diameterMm === null) return 0
  const diff = Math.abs(product.diameterMm - targetMm)
  if (diff === 0) return WEIGHTS.diameter
  if (diff <= 0.1) return Math.round(WEIGHTS.diameter * 0.9)
  if (diff <= 0.5) return Math.round(WEIGHTS.diameter * 0.6)
  if (diff <= 1.0) return Math.round(WEIGHTS.diameter * 0.3)
  return 0
}

function scoreFlutes(product: CanonicalProduct, pref: number | undefined): number {
  if (!pref) return Math.round(WEIGHTS.flutes * 0.5) // no preference
  if (product.fluteCount === null) return 0
  return product.fluteCount === pref ? WEIGHTS.flutes : 0
}

function scoreMaterial(product: CanonicalProduct, materialInput: string | undefined): number {
  if (!materialInput) return Math.round(WEIGHTS.materialTag * 0.5)
  const tag = resolveMaterialTag(materialInput)
  if (!tag) return Math.round(WEIGHTS.materialTag * 0.3)
  if (product.materialTags.includes(tag)) return WEIGHTS.materialTag
  return 0
}

function scoreOperation(product: CanonicalProduct, operationInput: string | undefined): number {
  if (!operationInput) return Math.round(WEIGHTS.operation * 0.5)
  const targetShapes = getAppShapesForOperation(operationInput)
  if (!targetShapes.length) return Math.round(WEIGHTS.operation * 0.3)
  const matches = product.applicationShapes.filter(s => targetShapes.includes(s))
  if (matches.length === 0) return 0
  const ratio = matches.length / targetShapes.length
  return Math.round(WEIGHTS.operation * Math.min(ratio, 1))
}

function scoreCoating(product: CanonicalProduct, pref: string | undefined): number {
  if (!pref) return Math.round(WEIGHTS.coating * 0.5)
  if (!product.coating) return 0
  return product.coating.toLowerCase().includes(pref.toLowerCase()) ? WEIGHTS.coating : 0
}

function determineMatchStatus(score: number, maxScore: number, input: RecommendationInput): MatchStatus {
  const ratio = score / maxScore
  if (ratio >= 0.85) return "exact"
  if (ratio >= 0.5) return "approximate"
  return "none"
}

function matchedFields(product: CanonicalProduct, input: RecommendationInput): string[] {
  const fields: string[] = []
  const matTag = input.material ? resolveMaterialTag(input.material) : null
  const opShapes = input.operationType ? getAppShapesForOperation(input.operationType) : []

  if (input.diameterMm && product.diameterMm !== null && Math.abs(product.diameterMm - input.diameterMm) <= 0.1)
    fields.push(`직경 ${product.diameterMm}mm 일치`)
  if (input.flutePreference && product.fluteCount === input.flutePreference)
    fields.push(`${product.fluteCount}날 일치`)
  if (matTag && product.materialTags.includes(matTag))
    fields.push(`소재 ${matTag}군 적합`)
  if (opShapes.length && product.applicationShapes.some(s => opShapes.includes(s)))
    fields.push(`가공 방식 적합`)
  if (input.coatingPreference && product.coating?.toLowerCase().includes(input.coatingPreference.toLowerCase()))
    fields.push(`코팅 ${product.coating} 일치`)
  return fields
}

export function runMatchEngine(input: RecommendationInput, topN = 5): ScoredProduct[] {
  const products = ProductRepo.getAll()

  // ── Pre-filter: hard constraints ─────────────────────────────
  let candidates = products

  // Diameter: hard cut at ±2mm if specified
  if (input.diameterMm) {
    const strict = candidates.filter(p =>
      p.diameterMm !== null && Math.abs(p.diameterMm - input.diameterMm!) <= 2
    )
    // If strict filter has results, use it; otherwise keep all
    if (strict.length > 0) candidates = strict
  }

  // ── Score all candidates ─────────────────────────────────────
  const maxScore = Object.values(WEIGHTS).reduce((a, b) => a + b, 0) + 10 // +10 for diameter neutral

  const scored = candidates.map(product => {
    const score =
      scoreDiameter(product, input.diameterMm) +
      scoreFlutes(product, input.flutePreference) +
      scoreMaterial(product, input.material) +
      scoreOperation(product, input.operationType) +
      scoreCoating(product, input.coatingPreference) +
      Math.round(product.dataCompletenessScore * WEIGHTS.completeness)

    const status = determineMatchStatus(score, maxScore, input)
    const fields = matchedFields(product, input)

    // Enrichment
    const inventory = InventoryRepo.getByEdp(product.normalizedCode)
    const leadTimes = LeadTimeRepo.getByEdp(product.normalizedCode)
    const totalStock = InventoryRepo.totalStock(product.normalizedCode)
    const stockStatus = InventoryRepo.stockStatus(product.normalizedCode)
    const minLeadTimeDays = LeadTimeRepo.minLeadTime(product.normalizedCode)

    return {
      product,
      score,
      matchedFields: fields,
      matchStatus: status,
      inventory,
      leadTimes,
      evidence: [],
      stockStatus,
      totalStock,
      minLeadTimeDays,
    } satisfies ScoredProduct
  })

  // Sort: by score desc, then by source priority asc, then completeness desc
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.product.sourcePriority !== b.product.sourcePriority)
      return a.product.sourcePriority - b.product.sourcePriority
    return b.product.dataCompletenessScore - a.product.dataCompletenessScore
  })

  // Return top-N, but only if score is meaningful (> 0)
  return scored.filter(s => s.score > 0).slice(0, topN)
}

export function classifyResults(scored: ScoredProduct[]): {
  primary: ScoredProduct | null
  alternatives: ScoredProduct[]
  status: MatchStatus
} {
  if (!scored.length) return { primary: null, alternatives: [], status: "none" }

  const primary = scored[0]
  const alternatives = scored.slice(1, 4) // max 3 alternatives

  return {
    primary,
    alternatives,
    status: primary.matchStatus,
  }
}
