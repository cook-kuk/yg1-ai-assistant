/**
 * Phase G — Dual-path executor for QuerySpec features (sort / similarTo /
 * tolerance) that the legacy AppliedFilter[] path cannot represent.
 *
 * The legacy path (serve-engine-runtime → v2 orchestrator → ProductRepo.search
 * → buildProductDataQuery) uses AppliedFilter[] which has no slot for sort or
 * similarTo, and only picks up tolerance via expandToleranceConstraint inside
 * query-spec-to-filters.ts.
 *
 * This module:
 *   1. `specNeedsCompiler(spec)` — predicate: returns true only when the spec
 *      carries features the legacy path silently drops. Tolerance is handled
 *      on the legacy path (expandToleranceConstraint → `between`), so it is
 *      NOT in the trigger set. Only sort + similarTo flip the dual path.
 *   2. `executeSpecViaCompiler(spec)` — compiles the spec via
 *      compileProductQuery and executes against the real DB pool using the
 *      same pg infrastructure as ProductRepo.search. Returns CanonicalProduct[]
 *      in SQL-ordered order (ORDER BY / similarity CTE).
 *
 * Scoring semantics: sort/similarity modes bypass hybrid rerank intentionally.
 * The user asked for a deterministic order (smallest diameter, closest match
 * to reference spec) and the recommender's intelligence would override it.
 * Stock enrichment and other per-row decoration still happens downstream on
 * the CanonicalProduct[] — those are row-wise, not order-wise.
 */

import type { QuerySpec } from "./query-spec"
import { compileProductQuery, type CompiledQuery } from "./compile-product-query"
import { executeCompiledProductQuery } from "@/lib/data/repos/product-db-source"
import type { CanonicalProduct } from "@/lib/types/canonical"

export interface SpecExecutorResult {
  products: CanonicalProduct[]
  compiled: CompiledQuery
  rowCount: number
  mode: "sort" | "similarity" | "tolerance" | "plain"
}

/**
 * Returns true when the spec carries features the legacy AppliedFilter[] path
 * silently drops (sort, similarTo). Tolerance is NOT included because
 * `expandToleranceConstraint` rewrites eq+tolerance → between on the legacy
 * path inside `querySpecToAppliedFilters`, so tolerance already reaches SQL.
 */
export function specNeedsCompiler(spec: QuerySpec | null | undefined): boolean {
  if (!spec) return false
  if (spec.sort) return true
  if (spec.similarTo) return true
  return false
}

export function classifySpecMode(spec: QuerySpec): SpecExecutorResult["mode"] {
  if (spec.similarTo) return "similarity"
  if (spec.sort) return "sort"
  if (spec.constraints.some(c => c.tolerance != null || c.toleranceRatio != null)) return "tolerance"
  return "plain"
}

/**
 * Compile + execute a QuerySpec against the product DB. The caller is
 * responsible for deciding whether to replace / merge the result into the
 * downstream searchPayload. Failures are propagated — caller catches and
 * falls back to the legacy path.
 */
export async function executeSpecViaCompiler(
  spec: QuerySpec,
  strategy: string = "strict",
): Promise<SpecExecutorResult> {
  const compiled = compileProductQuery(spec, strategy)
  const { products, rowCount } = await executeCompiledProductQuery(
    compiled.sql,
    compiled.params,
    "executeSpecViaCompiler",
  )
  return {
    products,
    compiled,
    rowCount,
    mode: classifySpecMode(spec),
  }
}
