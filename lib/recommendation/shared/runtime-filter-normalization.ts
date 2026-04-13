import type { AppliedFilter } from "@/lib/recommendation/domain/types"

import { buildAppliedFilterFromValue } from "./filter-field-registry"
import { resolveCatalogMaterialFamilyName, resolveMaterialFamilyName } from "./material-mapping"

export function normalizeRuntimeAppliedFilter(
  filter: AppliedFilter,
  appliedAt = filter.appliedAt ?? 0,
): AppliedFilter {
  if (filter.op === "skip" || filter.op === "between") {
    return { ...filter, appliedAt }
  }

  const rawValue = filter.rawValue ?? filter.value
  const opOverride =
    filter.field === "workPieceName" && filter.op !== "neq" && filter.op !== "exclude"
      ? "eq"
      : filter.op === "neq" || filter.op === "exclude"
      ? "neq"
      : filter.op === "gte" || filter.op === "lte"
        ? filter.op
        : undefined

  const normalized = buildAppliedFilterFromValue(filter.field, rawValue, appliedAt, opOverride)
  if (!normalized) return { ...filter, appliedAt }

  if ((filter.field === "workPieceName" || filter.field === "material") && typeof rawValue === "string") {
    const canonicalFamily = filter.field === "workPieceName"
      ? resolveCatalogMaterialFamilyName(rawValue)
      : resolveMaterialFamilyName(rawValue)
    if (canonicalFamily) {
      const canonicalOpOverride = filter.field === "workPieceName" && filter.op !== "neq" && filter.op !== "exclude"
        ? "eq"
        : opOverride
      const canonicalized = buildAppliedFilterFromValue(
        filter.field,
        canonicalFamily,
        appliedAt,
        canonicalOpOverride,
      )
      if (canonicalized) {
        return { ...canonicalized, appliedAt }
      }
    }
  }

  if (
    filter.field === "brand"
    && typeof filter.rawValue === "string"
    && typeof normalized.value === "string"
    && normalized.value !== filter.rawValue
  ) {
    return {
      ...normalized,
      rawValue: filter.rawValue,
      appliedAt,
    }
  }

  return { ...normalized, appliedAt }
}
