/**
 * Product Repository
 * Uses PostgreSQL only at runtime. Local JSON fallback is intentionally disabled.
 */

import "server-only"

import type { RecommendationInput, CanonicalProduct } from "@/lib/types/canonical"
import type { AppliedFilter } from "@/lib/types/exploration"
import {
  getProductByCodeFromDatabase,
  getSeriesOverviewFromDatabase,
  queryProductsFromDatabase,
  shouldUseDatabaseSource,
  type ProductSeriesOverview,
} from "@/lib/data/repos/product-db-source"

function logDatabaseUnavailable(operation: string): void {
  console.warn(`[product-repo] ${operation} skipped: runtime JSON fallback disabled and DB source unavailable`)
}

export const ProductRepo = {
  async search(input: RecommendationInput, filters: AppliedFilter[] = [], limit?: number): Promise<CanonicalProduct[]> {
    if (!shouldUseDatabaseSource()) {
      logDatabaseUnavailable("search")
      return []
    }

    console.log(`[product-repo] search source=db filters=${filters.length} limit=${limit ?? "auto"}`)
    try {
      return await queryProductsFromDatabase({ input, filters, limit })
    } catch (error) {
      console.warn(`[product-repo] search failed: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  },

  async findByCode(code: string): Promise<CanonicalProduct | null> {
    if (!shouldUseDatabaseSource()) {
      logDatabaseUnavailable(`findByCode code=${code}`)
      return null
    }

    console.log(`[product-repo] findByCode source=db code=${code}`)
    try {
      return await getProductByCodeFromDatabase(code)
    } catch (error) {
      console.warn(`[product-repo] findByCode failed code=${code}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  },

  async findBySeries(seriesName: string, limit = 200): Promise<CanonicalProduct[]> {
    if (!shouldUseDatabaseSource()) {
      logDatabaseUnavailable(`findBySeries series=${seriesName}`)
      return []
    }

    console.log(`[product-repo] findBySeries source=db series=${seriesName} limit=${limit}`)
    try {
      return await queryProductsFromDatabase({ seriesName, limit })
    } catch (error) {
      console.warn(
        `[product-repo] findBySeries failed series=${seriesName}: ${error instanceof Error ? error.message : String(error)}`
      )
      return []
    }
  },

  async getSeriesOverview(limit = 120): Promise<ProductSeriesOverview[]> {
    if (!shouldUseDatabaseSource()) {
      logDatabaseUnavailable("getSeriesOverview")
      return []
    }

    console.log(`[product-repo] getSeriesOverview source=db limit=${limit}`)
    try {
      return await getSeriesOverviewFromDatabase(limit)
    } catch (error) {
      console.warn(`[product-repo] getSeriesOverview failed: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  },
}
