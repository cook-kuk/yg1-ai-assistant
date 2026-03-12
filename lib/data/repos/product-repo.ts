/**
 * Product Repository
 * Loads normalized products.json at startup, provides query interface.
 * Never generates data — only serves what normalization script produced.
 */

import type { CanonicalProduct } from "@/lib/types/canonical"
import path from "path"
import fs from "fs"

let _cache: CanonicalProduct[] | null = null

function loadProducts(): CanonicalProduct[] {
  if (_cache) return _cache
  const filePath = path.join(process.cwd(), "data", "normalized", "products.json")
  if (!fs.existsSync(filePath)) {
    console.warn("[ProductRepo] products.json not found — run: node scripts/normalize-sample-data.mjs")
    return []
  }
  _cache = JSON.parse(fs.readFileSync(filePath, "utf-8")) as CanonicalProduct[]
  return _cache
}

export const ProductRepo = {
  /** All YG-1 products (priority 1 + 2) */
  getAll(): CanonicalProduct[] {
    return loadProducts().filter(p => p.manufacturer === "YG-1")
  },

  /** Primary Smart Catalog products only (priority 1) */
  getPrimary(): CanonicalProduct[] {
    return loadProducts().filter(p => p.sourcePriority === 1)
  },

  /** Find by exact normalized EDP code */
  findByCode(code: string): CanonicalProduct | null {
    const norm = code.replace(/[\s-]/g, "").toUpperCase()
    return loadProducts().find(p => p.normalizedCode === norm) ?? null
  },

  /** Find by series name */
  findBySeries(seriesName: string): CanonicalProduct[] {
    const q = seriesName.toLowerCase()
    return loadProducts().filter(p => p.seriesName?.toLowerCase().includes(q))
  },

  /** Filter by diameter range (±tolerance mm) */
  filterByDiameter(targetMm: number, toleranceMm = 0.5): CanonicalProduct[] {
    return loadProducts().filter(p => {
      if (p.diameterMm === null) return false
      return Math.abs(p.diameterMm - targetMm) <= toleranceMm
    })
  },

  /** Filter by flute count */
  filterByFlutes(count: number): CanonicalProduct[] {
    return loadProducts().filter(p => p.fluteCount === count)
  },

  /** Filter by material tag (ISO group: P, M, K, N, S, H) */
  filterByMaterialTag(tag: string): CanonicalProduct[] {
    return loadProducts().filter(p => p.materialTags.includes(tag))
  },

  /** Filter by application shape keyword */
  filterByOperation(keyword: string): CanonicalProduct[] {
    const q = keyword.toLowerCase()
    return loadProducts().filter(p =>
      p.applicationShapes.some(s => s.toLowerCase().includes(q))
    )
  },

  /** Get unique series names */
  getSeriesNames(): string[] {
    const names = new Set(loadProducts().map(p => p.seriesName).filter(Boolean) as string[])
    return [...names].sort()
  },

  /** Get unique diameter values */
  getDiameters(): number[] {
    const diams = new Set(
      loadProducts()
        .map(p => p.diameterMm)
        .filter((d): d is number => d !== null)
    )
    return [...diams].sort((a, b) => a - b)
  },

  /** Stats */
  stats() {
    const all = loadProducts()
    return {
      total: all.length,
      smartCatalog: all.filter(p => p.sourcePriority === 1).length,
      csv: all.filter(p => p.sourcePriority === 2).length,
      withInventory: 0, // enriched at query time
    }
  },
}
