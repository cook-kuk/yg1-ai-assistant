import "server-only"

import type { InventorySnapshot, StockStatus } from "@/lib/types/canonical"
import { Pool } from "pg"

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
    console.log("[inventory-db] creating pg pool")
    globalThis.__yg1InventoryDbPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
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
    const result = await pool.query(sql, [normalizedCode])
    console.log(`[inventory-db] query code=${normalizedCode} rows=${result.rowCount ?? 0} duration=${Date.now() - startedAt}ms`)
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
