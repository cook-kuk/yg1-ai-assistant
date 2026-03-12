import type { CanonicalProduct } from "@/lib/types/canonical"
import path from "path"
import fs from "fs"

let _cache: CanonicalProduct[] | null = null

function load(): CanonicalProduct[] {
  if (_cache) return _cache
  const fp = path.join(process.cwd(), "data", "normalized", "competitors.json")
  if (!fs.existsSync(fp)) { _cache = []; return _cache }
  _cache = JSON.parse(fs.readFileSync(fp, "utf-8")) as CanonicalProduct[]
  return _cache
}

export const CompetitorRepo = {
  getAll(): CanonicalProduct[] { return load() },

  findByCode(code: string): CanonicalProduct | null {
    const norm = code.replace(/[\s-]/g, "").toUpperCase()
    return load().find(p => p.normalizedCode === norm) ?? null
  },

  /** Find similar competitor products by diameter and flute count */
  findSimilar(diameterMm: number | null, fluteCount: number | null): CanonicalProduct[] {
    return load().filter(p => {
      if (diameterMm !== null && p.diameterMm !== null && Math.abs(p.diameterMm - diameterMm) > 1) return false
      if (fluteCount !== null && p.fluteCount !== null && p.fluteCount !== fluteCount) return false
      return true
    })
  },
}
