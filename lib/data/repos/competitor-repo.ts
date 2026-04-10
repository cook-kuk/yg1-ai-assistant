import type { CanonicalProduct } from "@/lib/types/canonical"
import rawData from "@/data/competitor-products.json"

// ── Extended type with cutting conditions & YG-1 matches ─────
export interface CompetitorCuttingCondition {
  vcRange: [number, number]     // m/min
  fzRange: [number, number]     // mm/tooth
}

export interface YG1Match {
  brand: string
  series: string
  score: number
}

export interface CompetitorProduct extends CanonicalProduct {
  cuttingConditions: CompetitorCuttingCondition
  yg1Matches: YG1Match[]
}

// ── Load & index ─────────────────────────────────────────────
const ALL: CompetitorProduct[] = (rawData as unknown as CompetitorProduct[])

const byCode = new Map<string, CompetitorProduct>()
const bySeries = new Map<string, CompetitorProduct[]>()
const byBrand = new Map<string, CompetitorProduct[]>()

for (const p of ALL) {
  byCode.set(p.normalizedCode, p)
  byCode.set(p.displayCode.toUpperCase(), p)

  const seriesKey = (p.seriesName ?? "").toUpperCase()
  if (!bySeries.has(seriesKey)) bySeries.set(seriesKey, [])
  bySeries.get(seriesKey)!.push(p)

  const brandKey = p.manufacturer.toUpperCase()
  if (!byBrand.has(brandKey)) byBrand.set(brandKey, [])
  byBrand.get(brandKey)!.push(p)
}

console.log(`[competitor-repo] loaded ${ALL.length} competitor products (${byBrand.size} brands, ${bySeries.size} series)`)

// ── Repo ─────────────────────────────────────────────────────
export const CompetitorRepo = {
  getAll(): CompetitorProduct[] {
    return ALL
  },

  findByCode(code: string): CompetitorProduct | null {
    return byCode.get(code.toUpperCase().replace(/[\s-]/g, "")) ?? byCode.get(code.toUpperCase()) ?? null
  },

  findBySeries(series: string): CompetitorProduct[] {
    return bySeries.get(series.toUpperCase()) ?? []
  },

  findByBrand(brand: string): CompetitorProduct[] {
    return byBrand.get(brand.toUpperCase()) ?? []
  },

  findSimilar(diameterMm: number | null, fluteCount: number | null): CompetitorProduct[] {
    return ALL.filter(p => {
      if (diameterMm !== null && p.diameterMm !== null && Math.abs(p.diameterMm - diameterMm) > 2) return false
      if (fluteCount !== null && p.fluteCount !== null && p.fluteCount !== fluteCount) return false
      return true
    })
  },

  /** 경쟁사 코드/시리즈로 검색 → YG-1 대체품 + 가공조건 비교 */
  searchWithComparison(query: string): CompetitorProduct[] {
    const q = query.toUpperCase().trim()
    // exact code
    const exact = this.findByCode(q)
    if (exact) return [exact]
    // series match
    for (const [key, products] of bySeries) {
      if (key.includes(q) || q.includes(key)) return products
    }
    // brand match
    for (const [key, products] of byBrand) {
      if (q.includes(key)) return products
    }
    // fuzzy: any field contains query
    return ALL.filter(p =>
      p.displayCode.toUpperCase().includes(q) ||
      (p.seriesName ?? "").toUpperCase().includes(q) ||
      p.description?.toUpperCase().includes(q)
    )
  },

  /** 경쟁사 브랜드 목록 */
  getBrands(): string[] {
    return [...byBrand.keys()].sort()
  },

  /** 특정 브랜드 시리즈 목록 */
  getSeriesByBrand(brand: string): string[] {
    const products = this.findByBrand(brand)
    const series = new Set(products.map(p => p.seriesName).filter(Boolean) as string[])
    return [...series].sort()
  },
}
