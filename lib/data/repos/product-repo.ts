/**
 * Product Repository
 * Prefers PostgreSQL at request time, but falls back to local normalized JSON
 * so the recommendation flow still works in environments without DB settings.
 */

import "server-only"

import fs from "node:fs"
import path from "node:path"

import type { RecommendationInput, CanonicalProduct } from "@/lib/types/canonical"
import type { AppliedFilter } from "@/lib/types/exploration"
import { resolveMaterialTag } from "@/lib/domain/material-resolver"
import { getAppShapesForOperation } from "@/lib/domain/operation-resolver"
import {
  getProductByCodeFromDatabase,
  getSeriesOverviewFromDatabase,
  queryProductsFromDatabase,
  shouldUseDatabaseSource,
  type ProductSeriesOverview,
} from "@/lib/data/repos/product-db-source"

let _cache: CanonicalProduct[] | null = null
let _byCode: Map<string, CanonicalProduct> | null = null
let _bySeries: Map<string, CanonicalProduct[]> | null = null

function loadJsonProducts(): {
  products: CanonicalProduct[]
  byCode: Map<string, CanonicalProduct>
  bySeries: Map<string, CanonicalProduct[]>
} {
  if (_cache && _byCode && _bySeries) {
    return { products: _cache, byCode: _byCode, bySeries: _bySeries }
  }

  const fp = path.join(process.cwd(), "data", "normalized", "products.json")
  if (!fs.existsSync(fp)) {
    _cache = []
    _byCode = new Map()
    _bySeries = new Map()
    return { products: _cache, byCode: _byCode, bySeries: _bySeries }
  }

  _cache = JSON.parse(fs.readFileSync(fp, "utf-8")) as CanonicalProduct[]
  _byCode = new Map()
  _bySeries = new Map()

  for (const product of _cache) {
    _byCode.set(normalizeCode(product.normalizedCode || product.displayCode), product)
    const seriesKey = normalizeText(product.seriesName)
    if (seriesKey) {
      if (!_bySeries.has(seriesKey)) _bySeries.set(seriesKey, [])
      _bySeries.get(seriesKey)!.push(product)
    }
  }

  return { products: _cache, byCode: _byCode, bySeries: _bySeries }
}

function normalizeCode(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase().replace(/[\s-]/g, "").trim()
}

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().trim()
}

function productSearchText(product: CanonicalProduct): string {
  return [
    product.displayCode,
    product.normalizedCode,
    product.seriesName,
    product.productName,
    product.description,
    product.toolType,
    product.toolSubtype,
    product.brand,
    product.featureText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function matchesMaterial(product: CanonicalProduct, input: RecommendationInput): boolean {
  if (!input.material) return true
  const tags = input.material
    .split(",")
    .map(part => resolveMaterialTag(part.trim()))
    .filter((tag): tag is string => Boolean(tag))

  if (tags.length === 0) return true
  return tags.some(tag => product.materialTags.includes(tag))
}

function matchesOperation(product: CanonicalProduct, input: RecommendationInput): boolean {
  if (!input.operationType) return true
  const shapes = getAppShapesForOperation(input.operationType)
  if (shapes.length === 0) return true
  return shapes.some(shape => product.applicationShapes.includes(shape))
}

function matchesToolQuery(product: CanonicalProduct, input: RecommendationInput): boolean {
  const query = normalizeText(input.toolType || input.toolSubtype)
  if (!query) return true

  const text = productSearchText(product)
  const tokens = query.split(/[\s,/]+/).filter(token => token.length > 1)
  if (tokens.length === 0) return true

  return tokens.every(token => text.includes(token))
}

function applyConversationFilter(products: CanonicalProduct[], filter: AppliedFilter): CanonicalProduct[] {
  switch (filter.field) {
    case "diameterMm": {
      const n = typeof filter.rawValue === "number" ? filter.rawValue : Number.parseFloat(String(filter.rawValue))
      if (!Number.isFinite(n)) return products
      if (filter.op === "range") {
        return products.filter(product => product.diameterMm != null && Math.abs(product.diameterMm - n) <= 2)
      }
      return products.filter(product => product.diameterMm != null && Math.abs(product.diameterMm - n) <= 0.1)
    }
    case "fluteCount": {
      const n = typeof filter.rawValue === "number" ? filter.rawValue : Number.parseInt(String(filter.rawValue), 10)
      return Number.isFinite(n) ? products.filter(product => product.fluteCount === n) : products
    }
    case "coating": {
      const q = normalizeText(String(filter.rawValue))
      return q ? products.filter(product => normalizeText(product.coating).includes(q)) : products
    }
    case "materialTag": {
      const tag = String(filter.rawValue).toUpperCase()
      return tag ? products.filter(product => product.materialTags.includes(tag)) : products
    }
    case "toolSubtype": {
      const q = normalizeText(String(filter.rawValue))
      return q ? products.filter(product => normalizeText(product.toolSubtype).includes(q)) : products
    }
    case "seriesName": {
      const q = normalizeText(String(filter.rawValue))
      return q ? products.filter(product => normalizeText(product.seriesName).includes(q)) : products
    }
    default:
      return products
  }
}

function scoreProductForInput(product: CanonicalProduct, input: RecommendationInput): number {
  let score = 0

  if (input.diameterMm != null && product.diameterMm != null) {
    const diff = Math.abs(product.diameterMm - input.diameterMm)
    if (diff === 0) score += 40
    else if (diff <= 0.1) score += 32
    else if (diff <= 0.5) score += 20
    else if (diff <= 2) score += 8
  }

  if (input.flutePreference != null && product.fluteCount === input.flutePreference) score += 12
  if (matchesMaterial(product, input)) score += 18
  if (matchesOperation(product, input)) score += 14
  if (matchesToolQuery(product, input)) score += 16

  if (input.coatingPreference && normalizeText(product.coating).includes(normalizeText(input.coatingPreference))) {
    score += 6
  }

  score += Math.max(0, 6 - product.sourcePriority)
  score += Math.round((product.dataCompletenessScore ?? 0) * 5)

  return score
}

function searchLocalProducts(
  input: RecommendationInput,
  filters: AppliedFilter[] = [],
  limit?: number
): CanonicalProduct[] {
  const { products } = loadJsonProducts()

  let filtered = products.filter(product => {
    if (input.manufacturerScope !== "include-competitor" && normalizeText(product.manufacturer) !== "yg-1") {
      return false
    }

    if (input.region && input.region !== "ALL") {
      const region = normalizeText(product.region)
      if (region && region !== normalizeText(input.region)) return false
    }

    if (input.diameterMm != null && product.diameterMm != null && Math.abs(product.diameterMm - input.diameterMm) > 2) {
      return false
    }

    if (input.flutePreference != null && product.fluteCount != null && product.fluteCount !== input.flutePreference) {
      return false
    }

    if (!matchesMaterial(product, input)) return false
    if (!matchesOperation(product, input)) return false
    if (!matchesToolQuery(product, input)) return false

    if (input.coatingPreference) {
      const coatingQuery = normalizeText(input.coatingPreference)
      if (coatingQuery && !normalizeText(product.coating).includes(coatingQuery)) return false
    }

    return true
  })

  for (const filter of filters) {
    filtered = applyConversationFilter(filtered, filter)
  }

  filtered = filtered
    .map(product => ({ product, rankScore: scoreProductForInput(product, input) }))
    .sort((a, b) =>
      b.rankScore - a.rankScore ||
      a.product.sourcePriority - b.product.sourcePriority ||
      b.product.dataCompletenessScore - a.product.dataCompletenessScore ||
      a.product.displayCode.localeCompare(b.product.displayCode)
    )
    .map(entry => entry.product)

  return typeof limit === "number" ? filtered.slice(0, limit) : filtered
}

export const ProductRepo = {
  async search(input: RecommendationInput, filters: AppliedFilter[] = [], limit?: number): Promise<CanonicalProduct[]> {
    if (shouldUseDatabaseSource()) {
      console.log(`[product-repo] search source=db filters=${filters.length} limit=${limit ?? "auto"}`)
      return queryProductsFromDatabase({ input, filters, limit })
    }

    console.log(`[product-repo] search source=json filters=${filters.length} limit=${limit ?? "auto"}`)
    return searchLocalProducts(input, filters, limit)
  },

  async findByCode(code: string): Promise<CanonicalProduct | null> {
    if (shouldUseDatabaseSource()) {
      console.log(`[product-repo] findByCode source=db code=${code}`)
      return getProductByCodeFromDatabase(code)
    }

    console.log(`[product-repo] findByCode source=json code=${code}`)
    const { byCode } = loadJsonProducts()
    return byCode.get(normalizeCode(code)) ?? null
  },

  async findBySeries(seriesName: string, limit = 200): Promise<CanonicalProduct[]> {
    if (shouldUseDatabaseSource()) {
      console.log(`[product-repo] findBySeries source=db series=${seriesName} limit=${limit}`)
      return queryProductsFromDatabase({ seriesName, limit })
    }

    console.log(`[product-repo] findBySeries source=json series=${seriesName} limit=${limit}`)
    const { bySeries } = loadJsonProducts()
    return (bySeries.get(normalizeText(seriesName)) ?? [])
      .slice()
      .sort((a, b) => a.displayCode.localeCompare(b.displayCode))
      .slice(0, limit)
  },

  async getSeriesOverview(limit = 120): Promise<ProductSeriesOverview[]> {
    if (shouldUseDatabaseSource()) {
      console.log(`[product-repo] getSeriesOverview source=db limit=${limit}`)
      return getSeriesOverviewFromDatabase(limit)
    }

    console.log(`[product-repo] getSeriesOverview source=json limit=${limit}`)
    const { products } = loadJsonProducts()
    const grouped = new Map<string, CanonicalProduct[]>()

    for (const product of products) {
      const key = normalizeText(product.seriesName)
      if (!key) continue
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push(product)
    }

    return [...grouped.entries()]
      .map(([, items]) => {
        const diameters = items
          .map(item => item.diameterMm)
          .filter((value): value is number => value != null)
        const materialTags = [...new Set(items.flatMap(item => item.materialTags))].sort()
        const first = items[0]
        return {
          seriesName: first.seriesName ?? "",
          count: items.length,
          minDiameterMm: diameters.length > 0 ? Math.min(...diameters) : null,
          maxDiameterMm: diameters.length > 0 ? Math.max(...diameters) : null,
          materialTags,
          coating: first.coating ?? null,
          featureText: first.featureText ?? null,
          brand: first.brand,
        }
      })
      .sort((a, b) => b.count - a.count || a.seriesName.localeCompare(b.seriesName))
      .slice(0, limit)
  },
}
