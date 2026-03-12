import type { LeadTimeRecord } from "@/lib/types/canonical"
import path from "path"
import fs from "fs"

let _cache: LeadTimeRecord[] | null = null
let _byEdp: Map<string, LeadTimeRecord[]> | null = null

function load() {
  if (_cache) return { cache: _cache, byEdp: _byEdp! }
  const fp = path.join(process.cwd(), "data", "normalized", "lead-times.json")
  if (!fs.existsSync(fp)) { _cache = []; _byEdp = new Map(); return { cache: _cache, byEdp: _byEdp } }
  _cache = JSON.parse(fs.readFileSync(fp, "utf-8")) as LeadTimeRecord[]
  _byEdp = new Map()
  for (const rec of _cache) {
    if (!_byEdp.has(rec.normalizedEdp)) _byEdp.set(rec.normalizedEdp, [])
    _byEdp.get(rec.normalizedEdp)!.push(rec)
  }
  return { cache: _cache, byEdp: _byEdp }
}

export const LeadTimeRepo = {
  getByEdp(normalizedCode: string): LeadTimeRecord[] {
    const { byEdp } = load()
    return byEdp.get(normalizedCode) ?? []
  },

  minLeadTime(normalizedCode: string): number | null {
    const recs = this.getByEdp(normalizedCode)
    const valid = recs.map(r => r.leadTimeDays).filter((d): d is number => d !== null)
    return valid.length ? Math.min(...valid) : null
  },

  maxLeadTime(normalizedCode: string): number | null {
    const recs = this.getByEdp(normalizedCode)
    const valid = recs.map(r => r.leadTimeDays).filter((d): d is number => d !== null)
    return valid.length ? Math.max(...valid) : null
  },

  /** Representative lead time (median plant or global min) */
  representative(normalizedCode: string): number | null {
    return this.minLeadTime(normalizedCode)
  },
}
