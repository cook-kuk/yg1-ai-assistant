/**
 * Product Repository
 * Reads products directly from PostgreSQL at request time.
 * No preload cache; recommendation queries fetch filtered candidates from DB.
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

function assertDatabaseSource(): void {
  if (!shouldUseDatabaseSource()) {
    throw new Error("ProductRepo is configured for PostgreSQL, but DB connection settings are missing")
  }
}

export const ProductRepo = {
  async search(input: RecommendationInput, filters: AppliedFilter[] = [], limit?: number): Promise<CanonicalProduct[]> {
    assertDatabaseSource()
    return queryProductsFromDatabase({ input, filters, limit })
  },

  async findByCode(code: string): Promise<CanonicalProduct | null> {
    assertDatabaseSource()
    return getProductByCodeFromDatabase(code)
  },

  async findBySeries(seriesName: string, limit = 200): Promise<CanonicalProduct[]> {
    assertDatabaseSource()
    return queryProductsFromDatabase({ seriesName, limit })
  },

  async getSeriesOverview(limit = 120): Promise<ProductSeriesOverview[]> {
    assertDatabaseSource()
    return getSeriesOverviewFromDatabase(limit)
  },
}
