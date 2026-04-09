/**
 * Phase E.5 — Merge KGSpecPatch into QuerySpec
 *
 * KG §9 (knowledge-graph.ts) detects sort / tolerance / similarity intents
 * from Korean phrases ("직경 작은 순", "10mm 근처", "이 제품이랑 비슷한")
 * and emits a partial `KGSpecPatch`. The runtime stashes the patch on
 * session state; this helper merges it into the planner-built QuerySpec
 * immediately before compileProductQuery is invoked (or before
 * querySpecToAppliedFilters fans it out to the legacy filter pipeline).
 *
 * Semantics:
 *   - sort / similarTo: patch wins if present.
 *   - toleranceConstraints: for each patch entry, find a spec.constraints
 *     entry with the same field. If found, copy `tolerance` /
 *     `toleranceRatio` onto it. If not, push the patch constraint as new.
 *
 * Defensive guards (defense-in-depth — upstream should already sanitize):
 *   - Drop `sort` whose field is not in getSortableFields().
 *   - Drop `similarTo` whose referenceProductId is falsy, "__current__",
 *     or otherwise unresolved.
 *
 * Returns a NEW QuerySpec — does not mutate input.
 */

import type { QuerySpec, QueryConstraint } from "./query-spec"
import type { KGSpecPatch } from "./knowledge-graph"
import { getSortableFields } from "./query-spec-manifest"

export function mergeKgPatchIntoSpec(
  spec: QuerySpec,
  patch: KGSpecPatch | null | undefined,
): QuerySpec {
  if (!patch) return spec

  const next: QuerySpec = {
    ...spec,
    constraints: spec.constraints.map(c => ({ ...c })),
  }

  // ── sort ────────────────────────────────────────────────
  if (patch.sort) {
    const sortable = new Set(getSortableFields())
    if (sortable.has(patch.sort.field)) {
      next.sort = patch.sort
    } else {
      console.warn(
        `[kg-merge] dropping non-sortable sort field: ${patch.sort.field}`,
      )
    }
  }

  // ── similarTo ───────────────────────────────────────────
  if (patch.similarTo) {
    const refId = patch.similarTo.referenceProductId
    const unresolved =
      !refId ||
      refId === "__current__" ||
      typeof refId !== "string" ||
      refId.trim().length === 0
    if (!unresolved) {
      next.similarTo = patch.similarTo
    } else {
      console.warn(
        `[kg-merge] dropping similarTo with unresolved referenceProductId: ${String(refId)}`,
      )
    }
  }

  // ── toleranceConstraints ────────────────────────────────
  if (patch.toleranceConstraints && patch.toleranceConstraints.length > 0) {
    for (const tc of patch.toleranceConstraints) {
      const idx = next.constraints.findIndex(c => c.field === tc.field)
      if (idx >= 0) {
        const existing = next.constraints[idx]
        next.constraints[idx] = {
          ...existing,
          tolerance: tc.tolerance ?? existing.tolerance,
          toleranceRatio: tc.toleranceRatio ?? existing.toleranceRatio,
        }
      } else {
        next.constraints.push({ ...tc } as QueryConstraint)
      }
    }
  }

  return next
}

/**
 * Consume-once extract: reads `kgSpecPatch` from the given session state,
 * clears it (so subsequent turns don't re-apply a stale patch), and returns
 * it. Returns undefined if not present. Uses `any` because session-state
 * typing is ambient in serve-engine-runtime.
 */
export function consumeKgSpecPatch(sessionState: unknown): KGSpecPatch | undefined {
  if (!sessionState || typeof sessionState !== "object") return undefined
  const ss = sessionState as { kgSpecPatch?: KGSpecPatch }
  const patch = ss.kgSpecPatch
  if (patch) {
    delete ss.kgSpecPatch
  }
  return patch
}
