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
import { getPreferredSeriesBoost } from "@/lib/domain/preferred-series"

// ── Scoring weights ───────────────────────────────────────────
const WEIGHTS = {
  diameter: 35,       // exact diameter match is most critical
  shape: 20,          // tool shape (Square/Ball/Radius) match
  materialTag: 20,
  flutes: 10,
  operation: 10,
  coating: 5,
  completeness: 0,    // prefer more complete data (unused in cross-ref)
}

// Cross-reference weights: shape & material are most important
const WEIGHTS_CROSSREF = {
  shape: 35,
  materialTag: 30,
  diameter: 20,
  flutes: 10,
  operation: 0,
  coating: 0,
  completeness: 0,
}

const SHAPE_ALIASES: Record<string, string> = {
  square: "square", flat: "square", "flat end": "square",
  ball: "ball", "ball nose": "ball", ballnose: "ball",
  radius: "radius", "corner r": "radius", "corner radius": "radius",
  chamfer: "chamfer",
  roughing: "roughing",
  drill: "drill",
  tap: "tap",
}

function normalizeShape(s: string | null | undefined): string | null {
  if (!s) return null
  const lower = s.toLowerCase().trim()
  for (const [key, group] of Object.entries(SHAPE_ALIASES)) {
    if (lower.includes(key)) return group
  }
  return lower
}

function scoreShape(product: CanonicalProduct, targetShape: string | undefined, weight: number): number {
  if (!targetShape) return Math.round(weight * 0.5)
  const prodShape = normalizeShape(product.toolSubtype)
  const tgtShape = normalizeShape(targetShape)
  if (!prodShape || !tgtShape) return 0
  if (prodShape === tgtShape) return weight
  // Shape mismatch → strong penalty
  return -20
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
  if (ratio >= 0.75) return "exact"
  if (ratio >= 0.45) return "approximate"
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

// Runtime material tag enrichment based on coating + tool material
function enrichMaterialTags(product: CanonicalProduct): string[] {
  const tags = [...product.materialTags]
  if (tags.length >= 4) return tags // already rich

  const coating = (product.coating ?? "").toLowerCase()
  const toolMat = (product.toolMaterial ?? "").toLowerCase()
  const subtype = (product.toolSubtype ?? "").toLowerCase()

  if (coating.includes("t-coat") && toolMat.includes("carbide") && (subtype.includes("square") || subtype.includes("ball") || subtype.includes("radius"))) {
    for (const t of ["P", "M", "K", "H"]) if (!tags.includes(t)) tags.push(t)
  } else if (coating.includes("ticn") && toolMat.includes("carbide")) {
    for (const t of ["P", "M", "K"]) if (!tags.includes(t)) tags.push(t)
  } else if ((coating.includes("dlc") || coating.includes("diamond")) && toolMat.includes("carbide")) {
    if (!tags.includes("N")) tags.push("N")
  } else if (coating.includes("x-coat") && toolMat.includes("hss")) {
    for (const t of ["P", "M"]) if (!tags.includes(t)) tags.push(t)
  }

  return tags
}

export async function runMatchEngine(input: RecommendationInput, topN = 5, isCrossReference = false): Promise<ScoredProduct[]> {
  const products = await ProductRepo.search(input, [], Math.max(topN * 20, 500))

  // ── Pre-filter: hard constraints ─────────────────────────────
  let candidates = products

  // Diameter: hard cut at ±2mm if specified
  if (input.diameterMm) {
    const strict = candidates.filter(p =>
      p.diameterMm !== null && Math.abs(p.diameterMm - input.diameterMm!) <= 2
    )
    if (strict.length > 0) candidates = strict
  }

  // Cross-reference: shape hard filter — remove mismatched shapes
  if (isCrossReference && input.toolSubtype) {
    const targetShape = normalizeShape(input.toolSubtype)
    if (targetShape) {
      const shapeFiltered = candidates.filter(p => {
        const pShape = normalizeShape(p.toolSubtype)
        return !pShape || pShape === targetShape
      })
      if (shapeFiltered.length > 0) candidates = shapeFiltered
    }
  }

  // ── Score all candidates ─────────────────────────────────────
  const w = isCrossReference ? WEIGHTS_CROSSREF : WEIGHTS
  const maxScore = Object.values(w).reduce((a, b) => a + b, 0)

  const scored = await Promise.all(candidates.map(async (product) => {
    // Enrich material tags at runtime for sparse data
    const enrichedProduct = isCrossReference
      ? { ...product, materialTags: enrichMaterialTags(product) }
      : product

    const baseScore =
      scoreDiameter(enrichedProduct, input.diameterMm) +
      scoreShape(enrichedProduct, input.toolSubtype, w.shape) +
      scoreFlutes(enrichedProduct, input.flutePreference) +
      scoreMaterial(enrichedProduct, input.material) +
      scoreOperation(enrichedProduct, input.operationType) +
      scoreCoating(enrichedProduct, input.coatingPreference) +
      Math.round(enrichedProduct.dataCompletenessScore * w.completeness)

    // 박소영 피드백(2026-04-06): 관리 시리즈(data/preferred-series.json) 부스트
    const score = baseScore + getPreferredSeriesBoost(enrichedProduct.seriesName, enrichedProduct.brand)

    const status = determineMatchStatus(score, maxScore, input)
    const fields = matchedFields(product, input)

    // Enrichment
    const inventory = await InventoryRepo.getByEdpAsync(product.normalizedCode)
    const leadTimes = LeadTimeRepo.getByEdp(product.normalizedCode)
    const totalStock = await InventoryRepo.totalStockAsync(product.normalizedCode)
    const stockStatus = await InventoryRepo.stockStatusAsync(product.normalizedCode)
    const minLeadTimeDays = LeadTimeRepo.minLeadTime(product.normalizedCode)

    return {
      product,
      score,
      scoreBreakdown: null,
      matchedFields: fields,
      matchStatus: status,
      inventory,
      leadTimes,
      evidence: [],
      stockStatus,
      totalStock,
      minLeadTimeDays,
    } satisfies ScoredProduct
  }))

  // Sort: by score desc, then by source priority asc, then completeness desc, then stable tie-breaker
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.product.sourcePriority !== b.product.sourcePriority)
      return a.product.sourcePriority - b.product.sourcePriority
    if (b.product.dataCompletenessScore !== a.product.dataCompletenessScore)
      return b.product.dataCompletenessScore - a.product.dataCompletenessScore
    return (a.product.normalizedCode ?? "").localeCompare(b.product.normalizedCode ?? "")
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
