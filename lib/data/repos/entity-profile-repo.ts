import "server-only"

import { Pool } from "pg"
import { formatQueryValuesForLog, formatSqlForLog, interpolateSqlForLog } from "@/lib/data/sql-log"
import { getSharedPool } from "@/lib/data/shared-pool"

export interface SeriesProfileRecord {
  normalizedSeriesName: string
  seriesName: string | null
  primaryBrandName: string | null
  primaryDescription: string | null
  primaryFeature: string | null
  primaryToolType: string | null
  primaryProductType: string | null
  primaryApplicationShape: string | null
  primaryCuttingEdgeShape: string | null
  materialTags: string[]
  materialWorkPieceNames: string[]
  countryCodes: string[]
  edpCount: number
  fluteCounts: number[]
  coatingValues: string[]
  toolMaterialValues: string[]
  toolSubtypes: string[]
  diameterMinMm: number | null
  diameterMaxMm: number | null
  referenceIsoGroups: string[]
  referenceWorkPieceNames: string[]
  referenceHrcMin: number | null
  referenceHrcMax: number | null
}

export interface BrandProfileRecord {
  normalizedBrandName: string
  brandName: string | null
  primaryDescription: string | null
  primaryDescriptionWorkPiece: string | null
  seriesNames: string[]
  seriesCount: number
  toolTypes: string[]
  productTypes: string[]
  applicationShapeValues: string[]
  cuttingEdgeShapeValues: string[]
  materialTags: string[]
  materialWorkPieceNames: string[]
  countryCodes: string[]
  edpCount: number
  fluteCounts: number[]
  coatingValues: string[]
  toolMaterialValues: string[]
  diameterMinMm: number | null
  diameterMaxMm: number | null
  referenceIsoGroups: string[]
  referenceWorkPieceNames: string[]
  referenceHrcMin: number | null
  referenceHrcMax: number | null
}

declare global {
  // eslint-disable-next-line no-var
  var __yg1EntityProfileDbPool: Pool | undefined
}

function dbConnectionString(): string | null {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  const host = process.env.PGHOST || process.env.POSTGRES_HOST
  const port = process.env.PGPORT || process.env.POSTGRES_PORT || "5432"
  const database = process.env.PGDATABASE || process.env.POSTGRES_DB
  const user = process.env.PGUSER || process.env.POSTGRES_USER
  const password = process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD

  if (!host || !database || !user || !password) return null
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`
}

function getPool(): Pool | null {
  const connectionString = dbConnectionString()
  if (!connectionString) return null

  if (!globalThis.__yg1EntityProfileDbPool) {
    const shared = getSharedPool()
    if (shared) {
      globalThis.__yg1EntityProfileDbPool = shared
    } else {
      console.log("[entity-profile-db] creating pg pool (no shared pool)")
      globalThis.__yg1EntityProfileDbPool = new Pool({
        connectionString,
        max: 2,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      })
    }
  }

  return globalThis.__yg1EntityProfileDbPool
}

function normalizeLookupKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\s\-·∙ㆍ./(),]+/g, "")
}

function toNullableString(value: unknown): string | null {
  const trimmed = String(value ?? "").trim()
  return trimmed ? trimmed : null
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item ?? "").trim())
    .filter(Boolean)
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => toNullableNumber(item))
    .filter((item): item is number => item !== null)
}

function mapSeriesProfileRow(row: Record<string, unknown>): SeriesProfileRecord {
  return {
    normalizedSeriesName: String(row.normalized_series_name ?? ""),
    seriesName: toNullableString(row.series_name),
    primaryBrandName: toNullableString(row.primary_brand_name),
    primaryDescription: toNullableString(row.primary_description),
    primaryFeature: toNullableString(row.primary_feature),
    primaryToolType: toNullableString(row.primary_tool_type),
    primaryProductType: toNullableString(row.primary_product_type),
    primaryApplicationShape: toNullableString(row.primary_application_shape),
    primaryCuttingEdgeShape: toNullableString(row.primary_cutting_edge_shape),
    materialTags: toStringArray(row.material_tags),
    materialWorkPieceNames: toStringArray(row.material_work_piece_names),
    countryCodes: toStringArray(row.country_codes),
    edpCount: toNullableNumber(row.edp_count) ?? 0,
    fluteCounts: toNumberArray(row.flute_counts),
    coatingValues: toStringArray(row.coating_values),
    toolMaterialValues: toStringArray(row.tool_material_values),
    toolSubtypes: toStringArray(row.tool_subtypes),
    diameterMinMm: toNullableNumber(row.diameter_min_mm),
    diameterMaxMm: toNullableNumber(row.diameter_max_mm),
    referenceIsoGroups: toStringArray(row.reference_iso_groups),
    referenceWorkPieceNames: toStringArray(row.reference_work_piece_names),
    referenceHrcMin: toNullableNumber(row.reference_hrc_min),
    referenceHrcMax: toNullableNumber(row.reference_hrc_max),
  }
}

function mapBrandProfileRow(row: Record<string, unknown>): BrandProfileRecord {
  return {
    normalizedBrandName: String(row.normalized_brand_name ?? ""),
    brandName: toNullableString(row.brand_name),
    primaryDescription: toNullableString(row.primary_description),
    primaryDescriptionWorkPiece: toNullableString(row.primary_description_work_piece),
    seriesNames: toStringArray(row.series_names),
    seriesCount: toNullableNumber(row.series_count) ?? 0,
    toolTypes: toStringArray(row.tool_types),
    productTypes: toStringArray(row.product_types),
    applicationShapeValues: toStringArray(row.application_shape_values),
    cuttingEdgeShapeValues: toStringArray(row.cutting_edge_shape_values),
    materialTags: toStringArray(row.material_tags),
    materialWorkPieceNames: toStringArray(row.material_work_piece_names),
    countryCodes: toStringArray(row.country_codes),
    edpCount: toNullableNumber(row.edp_count) ?? 0,
    fluteCounts: toNumberArray(row.flute_counts),
    coatingValues: toStringArray(row.coating_values),
    toolMaterialValues: toStringArray(row.tool_material_values),
    diameterMinMm: toNullableNumber(row.diameter_min_mm),
    diameterMaxMm: toNullableNumber(row.diameter_max_mm),
    referenceIsoGroups: toStringArray(row.reference_iso_groups),
    referenceWorkPieceNames: toStringArray(row.reference_work_piece_names),
    referenceHrcMin: toNullableNumber(row.reference_hrc_min),
    referenceHrcMax: toNullableNumber(row.reference_hrc_max),
  }
}

async function findSingleSeriesProfile(name: string): Promise<SeriesProfileRecord | null> {
  const pool = getPool()
  if (!pool) return null

  const normalized = normalizeLookupKey(name)
  if (!normalized) return null

  const sql = `
    SELECT *
    FROM catalog_app.series_profile_mv
    WHERE normalized_series_name = $1
       OR EXISTS (
         SELECT 1
         FROM unnest(COALESCE(series_name_variants, ARRAY[]::text[])) AS series_row(series_name)
         WHERE regexp_replace(UPPER(BTRIM(series_row.series_name)), '[\\s\\-·∙ㆍ\\./(),]+', '', 'g') = $1
       )
    ORDER BY
      CASE WHEN normalized_series_name = $1 THEN 0 ELSE 1 END,
      edp_count DESC NULLS LAST
    LIMIT 1
  `

  try {
    const values = [normalized]
    const sqlInterpolated = interpolateSqlForLog(formatSqlForLog(sql), values)
    console.log(`[entity-profile-db] sql query="${sqlInterpolated}" params=${formatQueryValuesForLog(values)}`)
    const result = await pool.query(sql, values)
    return result.rows[0] ? mapSeriesProfileRow(result.rows[0] as Record<string, unknown>) : null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[entity-profile-db] series lookup failed name=${name}: ${message}`)
    return null
  }
}

async function findSingleBrandProfile(name: string): Promise<BrandProfileRecord | null> {
  const pool = getPool()
  if (!pool) return null

  const normalized = normalizeLookupKey(name)
  if (!normalized) return null

  const sql = `
    SELECT *
    FROM catalog_app.brand_profile_mv
    WHERE normalized_brand_name = $1
       OR EXISTS (
         SELECT 1
         FROM unnest(COALESCE(brand_name_variants, ARRAY[]::text[])) AS brand_row(brand_name)
         WHERE regexp_replace(UPPER(BTRIM(brand_row.brand_name)), '[\\s\\-·∙ㆍ\\./(),]+', '', 'g') = $1
       )
    ORDER BY
      CASE WHEN normalized_brand_name = $1 THEN 0 ELSE 1 END,
      series_count DESC NULLS LAST,
      edp_count DESC NULLS LAST
    LIMIT 1
  `

  try {
    const values = [normalized]
    const sqlInterpolated = interpolateSqlForLog(formatSqlForLog(sql), values)
    console.log(`[entity-profile-db] sql query="${sqlInterpolated}" params=${formatQueryValuesForLog(values)}`)
    const result = await pool.query(sql, values)
    return result.rows[0] ? mapBrandProfileRow(result.rows[0] as Record<string, unknown>) : null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[entity-profile-db] brand lookup failed name=${name}: ${message}`)
    return null
  }
}

export const EntityProfileRepo = {
  async findSeriesProfiles(names: string[]): Promise<SeriesProfileRecord[]> {
    const uniqueNames = Array.from(new Set(names.map(name => name.trim()).filter(Boolean)))
    if (uniqueNames.length === 0) return []

    const rows = await Promise.all(uniqueNames.map(name => findSingleSeriesProfile(name)))
    return rows.filter((row): row is SeriesProfileRecord => row !== null)
  },

  async findBrandProfiles(names: string[]): Promise<BrandProfileRecord[]> {
    const uniqueNames = Array.from(new Set(names.map(name => name.trim()).filter(Boolean)))
    if (uniqueNames.length === 0) return []

    const rows = await Promise.all(uniqueNames.map(name => findSingleBrandProfile(name)))
    return rows.filter((row): row is BrandProfileRecord => row !== null)
  },
}
