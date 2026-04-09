import "server-only"

import type { InventorySnapshot, StockStatus } from "@/lib/types/canonical"
import { Pool } from "pg"
import { getSharedPool } from "@/lib/data/shared-pool"

declare global {
  // eslint-disable-next-line no-var
  var __yg1InventoryDbPool: Pool | undefined
}

function normalizeCode(value: string | null | undefined): string {
  return String(value ?? "").toUpperCase().replace(/[\s-]/g, "").trim()
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
  return !!dbConnectionString()
}

function logDatabaseUnavailable(operation: string): void {
  console.warn(`[inventory-repo] ${operation} skipped: runtime JSON fallback disabled and DB source unavailable`)
}

function getPool(): Pool | null {
  const connectionString = dbConnectionString()
  if (!connectionString) return null
  if (!globalThis.__yg1InventoryDbPool) {
    // Use shared pool
    const shared = getSharedPool()
    if (shared) {
      globalThis.__yg1InventoryDbPool = shared
    } else {
      console.log("[inventory-db] creating pg pool (no shared pool)")
      globalThis.__yg1InventoryDbPool = new Pool({
        connectionString,
        max: 3,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      })
    }
  }
  return globalThis.__yg1InventoryDbPool
}

async function getByEdpFromDatabase(normalizedCode: string): Promise<InventorySnapshot[]> {
  const pool = getPool()
  if (!pool) return []

  const sql = `
    SELECT
      edp,
      normalized_edp,
      description,
      spec,
      warehouse_or_region,
      quantity,
      snapshot_date,
      price,
      currency,
      unit,
      source_file
    FROM catalog_app.inventory_snapshot
    WHERE REPLACE(REPLACE(UPPER(COALESCE(normalized_edp, edp, '')), ' ', ''), '-', '') = $1
    ORDER BY snapshot_date DESC NULLS LAST, warehouse_or_region ASC
  `

  const startedAt = Date.now()
  try {
    const values = [normalizedCode]
    const result = await pool.query(sql, values)
    return result.rows.map(row => ({
      edp: row.edp,
      normalizedEdp: normalizeCode(row.normalized_edp ?? row.edp),
      description: row.description ?? null,
      spec: row.spec ?? null,
      warehouseOrRegion: row.warehouse_or_region ?? "",
      quantity: row.quantity == null ? null : Number(row.quantity),
      snapshotDate: row.snapshot_date ? String(row.snapshot_date).slice(0, 10) : null,
      price: row.price == null ? null : Number(row.price),
      currency: row.currency ?? null,
      unit: row.unit ?? null,
      sourceFile: row.source_file ?? "inventory_snapshot",
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[inventory-db] query failed code=${normalizedCode} message=${message}`)
    return []
  }
}

function totalFromSnapshots(snaps: InventorySnapshot[]): number | null {
  if (!snaps.length) return null
  let total = 0
  let hasAny = false
  for (const s of snaps) {
    if (s.quantity !== null) {
      total += s.quantity
      hasAny = true
    }
  }
  return hasAny ? total : null
}

function statusFromSnapshots(snaps: InventorySnapshot[]): StockStatus {
  const total = totalFromSnapshots(snaps)
  if (total === null) return "unknown"
  if (total > 10) return "instock"
  if (total > 0) return "limited"
  return "outofstock"
}

export interface InventoryEnriched {
  snapshots: InventorySnapshot[]
  totalStock: number | null
  stockStatus: StockStatus
}

export const InventoryRepo = {
  getByEdp(normalizedCode: string): InventorySnapshot[] {
    logDatabaseUnavailable(`getByEdp code=${normalizedCode}`)
    return []
  },

  async getByEdpAsync(normalizedCode: string): Promise<InventorySnapshot[]> {
    const normalized = normalizeCode(normalizedCode)
    if (!shouldUseDatabaseSource()) {
      logDatabaseUnavailable(`getByEdpAsync code=${normalized}`)
      return []
    }
    return getByEdpFromDatabase(normalized)
  },

  /** Fetch snapshots once, derive totalStock + stockStatus from the same result. */
  async getEnrichedAsync(normalizedCode: string): Promise<InventoryEnriched> {
    const snapshots = await this.getByEdpAsync(normalizedCode)
    const totalStock = totalFromSnapshots(snapshots)
    const stockStatus = statusFromSnapshots(snapshots)
    return { snapshots, totalStock, stockStatus }
  },

  /**
   * 배치 버전: N개 code 를 단일 쿼리(= ANY($1))로 가져와 code→enriched 맵 반환.
   * hybrid-retrieval 의 topCandidates enrichment 에서 N+1 RTT 를 제거하기 위해
   * 사용. DB 미구성 시 빈 Map 을 돌려준다.
   */
  async getEnrichedBatchAsync(
    normalizedCodes: readonly string[]
  ): Promise<Map<string, InventoryEnriched>> {
    const out = new Map<string, InventoryEnriched>()
    if (normalizedCodes.length === 0) return out

    // 입력 코드 → 정규화 키 매핑을 보존 (caller 가 원본 키로 lookup 할 수 있도록).
    const inputToKey = new Map<string, string>()
    for (const raw of normalizedCodes) {
      const key = normalizeCode(raw)
      if (key) inputToKey.set(raw, key)
    }
    const uniqueKeys = Array.from(new Set(inputToKey.values()))
    if (uniqueKeys.length === 0) return out

    if (!shouldUseDatabaseSource()) {
      logDatabaseUnavailable(`getEnrichedBatchAsync size=${uniqueKeys.length}`)
      // DB 미구성이어도 caller 가 빈 enriched 를 얻도록 기본값으로 채워준다.
      const empty: InventoryEnriched = { snapshots: [], totalStock: null, stockStatus: "unknown" }
      for (const raw of inputToKey.keys()) out.set(raw, empty)
      return out
    }

    const pool = getPool()
    if (!pool) return out

    const sql = `
      SELECT
        edp,
        normalized_edp,
        description,
        spec,
        warehouse_or_region,
        quantity,
        snapshot_date,
        price,
        currency,
        unit,
        source_file,
        REPLACE(REPLACE(UPPER(COALESCE(normalized_edp, edp, '')), ' ', ''), '-', '') AS match_key
      FROM catalog_app.inventory_snapshot
      WHERE REPLACE(REPLACE(UPPER(COALESCE(normalized_edp, edp, '')), ' ', ''), '-', '') = ANY($1)
      ORDER BY snapshot_date DESC NULLS LAST, warehouse_or_region ASC
    `

    try {
      const result = await pool.query(sql, [uniqueKeys])
      const grouped = new Map<string, InventorySnapshot[]>()
      for (const row of result.rows) {
        const key = String(row.match_key ?? "")
        const snap: InventorySnapshot = {
          edp: row.edp,
          normalizedEdp: normalizeCode(row.normalized_edp ?? row.edp),
          description: row.description ?? null,
          spec: row.spec ?? null,
          warehouseOrRegion: row.warehouse_or_region ?? "",
          quantity: row.quantity == null ? null : Number(row.quantity),
          snapshotDate: row.snapshot_date ? String(row.snapshot_date).slice(0, 10) : null,
          price: row.price == null ? null : Number(row.price),
          currency: row.currency ?? null,
          unit: row.unit ?? null,
          sourceFile: row.source_file ?? "inventory_snapshot",
        }
        const arr = grouped.get(key)
        if (arr) arr.push(snap)
        else grouped.set(key, [snap])
      }
      // 원본 입력 코드 키로 되돌려준다 (동일 정규화 키 여러 입력도 같은 결과 공유).
      for (const [rawInput, key] of inputToKey.entries()) {
        const snaps = grouped.get(key) ?? []
        out.set(rawInput, {
          snapshots: snaps,
          totalStock: totalFromSnapshots(snaps),
          stockStatus: statusFromSnapshots(snaps),
        })
      }
      return out
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[inventory-db] batch query failed size=${uniqueKeys.length} message=${message}`)
      // 실패 시에도 caller 가 undefined lookup 을 피하도록 빈 기본값으로 채움.
      const empty: InventoryEnriched = { snapshots: [], totalStock: null, stockStatus: "unknown" }
      for (const raw of inputToKey.keys()) {
        if (!out.has(raw)) out.set(raw, empty)
      }
      return out
    }
  },

  totalStock(normalizedCode: string): number | null {
    logDatabaseUnavailable(`totalStock code=${normalizedCode}`)
    return null
  },

  async totalStockAsync(normalizedCode: string): Promise<number | null> {
    return totalFromSnapshots(await this.getByEdpAsync(normalizedCode))
  },

  stockStatus(normalizedCode: string): StockStatus {
    logDatabaseUnavailable(`stockStatus code=${normalizedCode}`)
    return "unknown"
  },

  async stockStatusAsync(normalizedCode: string): Promise<StockStatus> {
    return statusFromSnapshots(await this.getByEdpAsync(normalizedCode))
  },

  availableWarehouses(normalizedCode: string): InventorySnapshot[] {
    logDatabaseUnavailable(`availableWarehouses code=${normalizedCode}`)
    return []
  },

  async availableWarehousesAsync(normalizedCode: string): Promise<InventorySnapshot[]> {
    return (await this.getByEdpAsync(normalizedCode)).filter(s => s.quantity !== null && s.quantity > 0)
  },

  price(normalizedCode: string): { price: number; currency: string } | null {
    logDatabaseUnavailable(`price code=${normalizedCode}`)
    return null
  },
}
