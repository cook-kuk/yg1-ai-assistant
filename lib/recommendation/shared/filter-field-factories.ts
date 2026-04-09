/**
 * Filter field definition factories.
 *
 * These factories collapse the boilerplate for the repetitive shapes of
 * `FilterFieldDefinition` (number range, boolean) so that adding a new
 * catalog column requires touching ~5 lines in the registry instead of
 * hand-rolling a ~30-line entry.
 *
 * NOTE on cycles: to avoid a circular import with filter-field-registry
 * (which owns the low-level helper implementations), the factories do not
 * import helpers directly. Instead, the registry calls `createFilterFieldFactories`
 * once with its helper bundle and uses the returned `makeNumberRangeFieldDef` /
 * `makeBooleanFieldDef` inside the `FILTER_FIELD_DEFINITIONS` object literal.
 *
 * Adding a new numeric column now takes ~5 lines:
 *   rakeAngleDeg: makeNumberRangeFieldDef({
 *     field: "rakeAngleDeg", label: "레이크각", unit: "°",
 *     dbColumns: ["milling_rake_angle"], tolerance: 1,
 *   }),
 */
import type { AppliedFilter, RecommendationInput } from "@/lib/recommendation/domain/types"

// Local re-declaration of the public shape — the real interface is owned by
// filter-field-registry.ts and the structural type here must stay in sync.
type FilterValueKind = "string" | "number" | "boolean"
type FilterMatchPolicy = "strict_identifier" | "fuzzy" | "llm_assisted"
type FilterRecord = Record<string, unknown> | { product?: Record<string, unknown> }
type DbClauseBuilder = (filter: AppliedFilter, next: (value: unknown) => string) => string | null

export interface FactoryFilterFieldDefinition {
  field: string
  label?: string
  queryAliases?: string[]
  kind: FilterValueKind
  matchPolicy?: FilterMatchPolicy
  op: "eq" | "includes" | "range"
  canonicalField?: string
  unit?: string
  canonicalizeRawValue?: (rawValue: string | number | boolean) => string | number | boolean | null
  setInput?: (input: RecommendationInput, filter: AppliedFilter) => RecommendationInput
  clearInput?: (input: RecommendationInput) => RecommendationInput
  extractValues?: (record: FilterRecord) => Array<string | number | boolean>
  matches?: (record: FilterRecord, filter: AppliedFilter) => boolean | null
  buildDbClause?: DbClauseBuilder
}

export interface FilterFieldFactoryHelpers {
  firstFilterNumberValue: (filter: AppliedFilter) => number | undefined
  firstFilterBooleanValue: (filter: AppliedFilter) => boolean | undefined
  extractPrimitiveValues: (record: FilterRecord, key: string) => Array<string | number | boolean>
  numericMatch: (record: FilterRecord, filter: AppliedFilter, key: string, tolerance?: number) => boolean
  booleanMatch: (record: FilterRecord, filter: AppliedFilter, key: string) => boolean
  buildNumericEqualityClause: (
    columns: string[],
    filter: AppliedFilter,
    next: (value: unknown) => string,
    tolerance?: number
  ) => string | null
  buildBooleanStringClause: (columns: string[], filter: AppliedFilter) => string | null
}

export interface NumberRangeFieldOptions {
  field: string
  label?: string
  queryAliases?: string[]
  unit?: string
  dbColumns: string[]
  tolerance?: number
  /** Which key on RecommendationInput to write to. Default = field. */
  inputKey?: string
  /** Which key on records to read for in-memory matching. Default = field. */
  recordKey?: string
  /** Optional value canonicalizer (e.g. strip Korean diameter aliases). */
  canonicalizeRawValue?: (rawValue: string | number | boolean) => string | number | boolean | null
}

export interface BooleanFieldOptions {
  field: string
  label?: string
  queryAliases?: string[]
  dbColumns: string[]
  inputKey?: string
  recordKey?: string
}

export interface FilterFieldFactories {
  makeNumberRangeFieldDef: (opts: NumberRangeFieldOptions) => FactoryFilterFieldDefinition
  makeBooleanFieldDef: (opts: BooleanFieldOptions) => FactoryFilterFieldDefinition
}

export function createFilterFieldFactories(H: FilterFieldFactoryHelpers): FilterFieldFactories {
  function makeNumberRangeFieldDef(opts: NumberRangeFieldOptions): FactoryFilterFieldDefinition {
    const {
      field,
      label,
      queryAliases,
      unit,
      dbColumns,
      tolerance = 0.0001,
      inputKey,
      recordKey = field,
      canonicalizeRawValue,
    } = opts
    const key = inputKey ?? field

    return {
      field,
      label,
      queryAliases,
      kind: "number",
      op: "eq",
      unit,
      canonicalizeRawValue,
      setInput: (input, filter) => ({
        ...input,
        [key]: H.firstFilterNumberValue(filter),
      }) as RecommendationInput,
      clearInput: input => ({
        ...input,
        [key]: undefined,
      }) as RecommendationInput,
      extractValues: record => H.extractPrimitiveValues(record, recordKey),
      matches: (record, filter) => H.numericMatch(record, filter, recordKey, tolerance),
      buildDbClause: (filter, next) => H.buildNumericEqualityClause(dbColumns, filter, next, tolerance),
    }
  }

  function makeBooleanFieldDef(opts: BooleanFieldOptions): FactoryFilterFieldDefinition {
    const { field, label, queryAliases, dbColumns, inputKey, recordKey = field } = opts
    const key = inputKey ?? field

    return {
      field,
      label,
      queryAliases,
      kind: "boolean",
      op: "eq",
      setInput: (input, filter) => ({
        ...input,
        [key]: H.firstFilterBooleanValue(filter),
      }) as RecommendationInput,
      clearInput: input => ({
        ...input,
        [key]: undefined,
      }) as RecommendationInput,
      extractValues: record => H.extractPrimitiveValues(record, recordKey),
      matches: (record, filter) => H.booleanMatch(record, filter, recordKey),
      buildDbClause: filter => H.buildBooleanStringClause(dbColumns, filter),
    }
  }

  return { makeNumberRangeFieldDef, makeBooleanFieldDef }
}
