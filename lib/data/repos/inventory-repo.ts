import type { InventorySnapshot, StockStatus } from "@/lib/types/canonical"
import path from "path"
import fs from "fs"

let _cache: InventorySnapshot[] | null = null
let _byEdp: Map<string, InventorySnapshot[]> | null = null

function load() {
  if (_cache) return { cache: _cache, byEdp: _byEdp! }
  const fp = path.join(process.cwd(), "data", "normalized", "inventory.json")
  if (!fs.existsSync(fp)) { _cache = []; _byEdp = new Map(); return { cache: _cache, byEdp: _byEdp } }
  _cache = JSON.parse(fs.readFileSync(fp, "utf-8")) as InventorySnapshot[]
  _byEdp = new Map()
  for (const snap of _cache) {
    const key = snap.normalizedEdp
    if (!_byEdp.has(key)) _byEdp.set(key, [])
    _byEdp.get(key)!.push(snap)
  }
  return { cache: _cache, byEdp: _byEdp }
}

export const InventoryRepo = {
  /** Get all inventory snapshots for a normalized EDP code */
  getByEdp(normalizedCode: string): InventorySnapshot[] {
    const { byEdp } = load()
    return byEdp.get(normalizedCode) ?? []
  },

  /** Total stock across all warehouses */
  totalStock(normalizedCode: string): number | null {
    const snaps = this.getByEdp(normalizedCode)
    if (!snaps.length) return null
    let total = 0
    let hasAny = false
    for (const s of snaps) {
      if (s.quantity !== null) { total += s.quantity; hasAny = true }
    }
    return hasAny ? total : null
  },

  /** Stock status based on total quantity */
  stockStatus(normalizedCode: string): StockStatus {
    const total = this.totalStock(normalizedCode)
    if (total === null) return "unknown"
    if (total > 10) return "instock"
    if (total > 0) return "limited"
    return "outofstock"
  },

  /** Warehouses with positive stock */
  availableWarehouses(normalizedCode: string): InventorySnapshot[] {
    return this.getByEdp(normalizedCode).filter(s => s.quantity !== null && s.quantity > 0)
  },

  /** Price from any snapshot (first non-null) */
  price(normalizedCode: string): { price: number; currency: string } | null {
    const snaps = this.getByEdp(normalizedCode)
    const withPrice = snaps.find(s => s.price !== null && s.price > 0)
    if (!withPrice) return null
    return { price: withPrice.price!, currency: withPrice.currency ?? "KRW" }
  },
}
