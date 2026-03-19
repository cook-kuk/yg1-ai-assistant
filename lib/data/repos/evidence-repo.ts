/**
 * Evidence Repository
 * Loads cutting conditions from PostgreSQL raw_catalog.cutting_condition_table
 * and falls back to evidence-chunks.json when DB is unavailable.
 */

import type { EvidenceChunk, EvidenceSummary } from "@/lib/types/evidence"
import path from "path"
import fs from "fs"
import { randomBytes } from "node:crypto"
import { Pool, type QueryResultRow } from "pg"
import { ProductRepo } from "@/lib/data/repos/product-repo"

interface RawEvidenceRow extends QueryResultRow {
  _row_num: string | null
  application_shape: string | null
  series_name: string | null
  tag_name: string | null
  hardness_min_hrc: string | null
  hardness_max_hrc: string | null
  work_piece_name: string | null
  diameter_mm: string | null
  radial_depth_of_cut: string | null
  axial_depth_of_cut: string | null
  feed_rate: string | null
  feed_per_tooth: string | null
  spindle_speed: string | null
  cutting_speed: string | null
}

declare global {
  // eslint-disable-next-line no-var
  var __yg1EvidenceDbPool: Pool | undefined
  // eslint-disable-next-line no-var
  var __yg1EvidenceDbConfigLogged: boolean | undefined
  // eslint-disable-next-line no-var
  var __yg1EvidenceChunksPromise: Promise<EvidenceChunk[]> | undefined
}

let _jsonCache: EvidenceChunk[] | null = null

function cleanText(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeCode(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[\s-]/g, "").trim()
}

function parseNumber(value: string | null | undefined): number | null {
  const cleaned = cleanText(value)
  if (!cleaned) return null
  const parsed = Number.parseFloat(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

function createFallbackId(): string {
  return randomBytes(8).toString("hex")
}

function buildSearchText(chunk: EvidenceChunk, workPieceName: string | null): string {
  return [
    chunk.productCode,
    chunk.seriesName,
    chunk.toolType,
    chunk.toolSubtype,
    chunk.cuttingType,
    chunk.isoGroup,
    workPieceName,
    chunk.conditions.Vc,
    chunk.conditions.fz,
    chunk.conditions.ap,
    chunk.conditions.ae,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function mapRowToEvidenceChunk(row: RawEvidenceRow): EvidenceChunk {
  const seriesName = cleanText(row.series_name)
  const workPieceName = cleanText(row.work_piece_name)
  const chunk: EvidenceChunk = {
    id: `raw-cutting:${row._row_num ?? createFallbackId()}`,
    productCode: normalizeCode(seriesName),
    seriesName,
    toolType: null,
    toolSubtype: null,
    cuttingType: cleanText(row.application_shape),
    isoGroup: cleanText(row.tag_name)?.toUpperCase() ?? null,
    diameterMm: parseNumber(row.diameter_mm),
    conditions: {
      Vc: cleanText(row.cutting_speed),
      n: cleanText(row.spindle_speed),
      fz: cleanText(row.feed_per_tooth),
      vf: cleanText(row.feed_rate),
      ap: cleanText(row.axial_depth_of_cut),
      ae: cleanText(row.radial_depth_of_cut),
    },
    coating: null,
    toolMaterial: null,
    fluteCount: null,
    helixAngle: null,
    confidence: 0.9,
    sourceFile: "cutting_condition_table",
    pdfFile: null,
    referencePages: null,
    pageTitle: workPieceName,
    searchText: "",
  }

  chunk.searchText = buildSearchText(chunk, workPieceName)
  return chunk
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

function shouldUseDatabaseSource(): boolean {
  return process.env.EVIDENCE_REPO_SOURCE?.toLowerCase() !== "json" && !!dbConnectionString()
}

function redactConnectionString(connectionString: string): string {
  try {
    const parsed = new URL(connectionString)
    const username = parsed.username ? decodeURIComponent(parsed.username) : ""
    const password = parsed.password ? ":****" : ""
    const auth = username ? `${username}${password}@` : ""
    return `${parsed.protocol}//${auth}${parsed.host}${parsed.pathname}`
  } catch {
    return "<invalid-connection-string>"
  }
}

function logDatabaseConfigOnce(connectionString: string): void {
  if (globalThis.__yg1EvidenceDbConfigLogged) return
  globalThis.__yg1EvidenceDbConfigLogged = true
  console.log(
    `[evidence-db] source=postgres enabled=true connection=${redactConnectionString(connectionString)}`
  )
}

function getPool(): Pool {
  const connectionString = dbConnectionString()
  if (!connectionString) {
    throw new Error("Evidence DB source requested but connection settings are missing")
  }

  logDatabaseConfigOnce(connectionString)

  if (!globalThis.__yg1EvidenceDbPool) {
    console.log("[evidence-db] creating pg pool")
    globalThis.__yg1EvidenceDbPool = new Pool({
      connectionString,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  }

  return globalThis.__yg1EvidenceDbPool
}

function loadChunksFromJson(): EvidenceChunk[] {
  if (_jsonCache) return _jsonCache
  const filePath = path.join(process.cwd(), "data", "normalized", "evidence-chunks.json")
  if (!fs.existsSync(filePath)) {
    console.warn("[EvidenceRepo] evidence-chunks.json not found — run: node scripts/build-evidence-corpus.mjs")
    _jsonCache = []
    return _jsonCache
  }
  _jsonCache = JSON.parse(fs.readFileSync(filePath, "utf-8")) as EvidenceChunk[]
  return _jsonCache
}

async function loadChunks(): Promise<EvidenceChunk[]> {
  if (!shouldUseDatabaseSource()) return loadChunksFromJson()

  if (!globalThis.__yg1EvidenceChunksPromise) {
    globalThis.__yg1EvidenceChunksPromise = (async () => {
      try {
        const result = await getPool().query<RawEvidenceRow>(`
          SELECT
            _row_num,
            application_shape,
            series_name,
            tag_name,
            hardness_min_hrc,
            hardness_max_hrc,
            work_piece_name,
            diameter_mm,
            radial_depth_of_cut,
            axial_depth_of_cut,
            feed_rate,
            feed_per_tooth,
            spindle_speed,
            cutting_speed
          FROM raw_catalog.cutting_condition_table
          ORDER BY _row_num ASC
        `)
        const mapped = result.rows.map(mapRowToEvidenceChunk)
        console.log(`[evidence-db] loaded rows=${mapped.length}`)
        return mapped
      } catch (error) {
        console.warn(
          `[evidence-db] query failed, falling back to JSON evidence: ${error instanceof Error ? error.message : String(error)}`
        )
        return loadChunksFromJson()
      }
    })()
  }

  return globalThis.__yg1EvidenceChunksPromise
}

function filterBySeries(chunks: EvidenceChunk[], series: string): EvidenceChunk[] {
  const normalized = normalizeCode(series)
  const exact = chunks.filter(chunk => normalizeCode(chunk.seriesName) === normalized)
  if (exact.length > 0) return exact

  const lower = series.trim().toLowerCase()
  return chunks.filter(chunk => chunk.seriesName?.toLowerCase().includes(lower))
}

function applyEvidenceFilters(
  chunks: EvidenceChunk[],
  opts?: { isoGroup?: string | null; cuttingType?: string | null; diameterMm?: number | null; toleranceMm?: number }
): EvidenceChunk[] {
  let results = [...chunks]

  if (opts?.isoGroup) {
    const g = opts.isoGroup.toUpperCase()
    const filtered = results.filter(chunk =>
      chunk.isoGroup?.toUpperCase() === g || chunk.isoGroup?.toUpperCase().includes(g)
    )
    if (filtered.length > 0) results = filtered
  }

  if (opts?.cuttingType) {
    const ct = opts.cuttingType.toLowerCase()
    const filtered = results.filter(chunk => chunk.cuttingType?.toLowerCase().includes(ct))
    if (filtered.length > 0) results = filtered
  }

  if (opts?.diameterMm != null) {
    const tolerance = opts.toleranceMm ?? 0.5
    const filtered = results.filter(chunk =>
      chunk.diameterMm != null && Math.abs(chunk.diameterMm - opts.diameterMm!) <= tolerance
    )
    if (filtered.length > 0) results = filtered
  }

  return results.sort((a, b) => b.confidence - a.confidence)
}

async function resolveProductEvidenceContext(
  productCode: string,
  opts?: {
    seriesName?: string | null
    isoGroup?: string | null
    cuttingType?: string | null
    diameterMm?: number | null
    toleranceMm?: number
  }
): Promise<{
  seriesName?: string | null
  isoGroup?: string | null
  cuttingType?: string | null
  diameterMm?: number | null
  toleranceMm?: number
}> {
  if (opts?.seriesName && opts?.diameterMm != null) return opts

  const product = await ProductRepo.findByCode(productCode)
  if (!product) return opts ?? {}

  return {
    ...opts,
    seriesName: opts?.seriesName ?? product.seriesName,
    diameterMm: opts?.diameterMm ?? product.diameterMm,
  }
}

export const EvidenceRepo = {
  async getAll(): Promise<EvidenceChunk[]> {
    return await loadChunks()
  },

  async findByProductCode(code: string): Promise<EvidenceChunk[]> {
    const norm = normalizeCode(code)
    const chunks = await loadChunks()
    return chunks.filter(chunk => chunk.productCode === norm)
  },

  async findBySeriesName(
    series: string,
    opts?: { isoGroup?: string | null; cuttingType?: string | null; diameterMm?: number | null; toleranceMm?: number }
  ): Promise<EvidenceChunk[]> {
    const chunks = await loadChunks()
    return applyEvidenceFilters(filterBySeries(chunks, series), opts)
  },

  async filterByConditions(opts: {
    isoGroup?: string | null
    cuttingType?: string | null
    diameterMm?: number | null
    toleranceMm?: number
  }): Promise<EvidenceChunk[]> {
    const chunks = await loadChunks()
    return applyEvidenceFilters(chunks, opts)
  },

  async findForProduct(
    productCode: string,
    opts?: {
      seriesName?: string | null
      isoGroup?: string | null
      cuttingType?: string | null
      diameterMm?: number | null
      toleranceMm?: number
    }
  ): Promise<EvidenceChunk[]> {
    const resolvedOpts = await resolveProductEvidenceContext(productCode, opts)

    if (resolvedOpts.seriesName) {
      const bySeries = await this.findBySeriesName(resolvedOpts.seriesName, resolvedOpts)
      console.log(
        `[evidence-db] product_lookup code=${productCode} series=${resolvedOpts.seriesName ?? "-"} diameter=${resolvedOpts.diameterMm ?? "-"} matched=${bySeries.length}`
      )
      return bySeries
    }

    const direct = await this.findByProductCode(productCode)
    const filtered = applyEvidenceFilters(direct, resolvedOpts)
    console.log(
      `[evidence-db] product_lookup code=${productCode} series=- diameter=${resolvedOpts.diameterMm ?? "-"} matched=${filtered.length}`
    )
    return filtered
  },

  async searchText(query: string, limit = 50): Promise<EvidenceChunk[]> {
    const words = query.toLowerCase().split(/\s+/).filter(word => word.length > 1)
    if (words.length === 0) return []

    const chunks = await loadChunks()
    const scored: { chunk: EvidenceChunk; score: number }[] = []

    for (const chunk of chunks) {
      let score = 0
      for (const word of words) {
        if (chunk.searchText.includes(word)) score++
      }
      if (score > 0) scored.push({ chunk, score })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map(item => item.chunk)
  },

  async buildSummary(
    productCode: string,
    opts?: {
      seriesName?: string | null
      isoGroup?: string | null
      cuttingType?: string | null
      diameterMm?: number | null
      toleranceMm?: number
    }
  ): Promise<EvidenceSummary> {
    const chunks = await this.findForProduct(productCode, opts)
    const best = chunks.length > 0 ? chunks[0] : null

    return {
      productCode: normalizeCode(productCode),
      seriesName: best?.seriesName ?? opts?.seriesName ?? null,
      chunks,
      bestCondition: best?.conditions ?? null,
      bestConfidence: best?.confidence ?? 0,
      sourceCount: chunks.length,
    }
  },

  async stats() {
    const all = await loadChunks()
    const isoGroups = new Map<string, number>()
    for (const chunk of all) {
      const group = chunk.isoGroup || "?"
      isoGroups.set(group, (isoGroups.get(group) || 0) + 1)
    }
    return {
      total: all.length,
      withVc: all.filter(chunk => chunk.conditions.Vc).length,
      withFz: all.filter(chunk => chunk.conditions.fz).length,
      isoGroups: Object.fromEntries(isoGroups),
      uniqueProducts: new Set(all.map(chunk => chunk.productCode)).size,
    }
  },
}
