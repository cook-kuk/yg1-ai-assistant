import type { AppliedFilter } from "@/lib/recommendation/domain/types"

import { buildAppliedFilterFromValue } from "./filter-field-registry"

export function normalizeRuntimeAppliedFilter(
  filter: AppliedFilter,
  appliedAt = filter.appliedAt ?? 0,
): AppliedFilter {
  if (filter.op === "skip" || filter.op === "between") {
    return { ...filter, appliedAt }
  }

  const rawValue = filter.rawValue ?? filter.value
  const opOverride =
    filter.op === "neq" || filter.op === "exclude"
      ? "neq"
      : filter.op === "gte" || filter.op === "lte"
        ? filter.op
        : undefined

  const normalized = buildAppliedFilterFromValue(filter.field, rawValue, appliedAt, opOverride)
  return normalized ? { ...normalized, appliedAt } : { ...filter, appliedAt }
}
