/**
 * Material Alias Resolver
 * Maps user input (Korean/English/ISO) → internal ISO tag (P/M/K/N/S/H)
 * Source of truth: data/normalized/material-taxonomy.json
 */

import type { MaterialTaxonomy } from "@/lib/types/canonical"
import path from "path"
import fs from "fs"

let _taxonomy: MaterialTaxonomy[] | null = null

function load(): MaterialTaxonomy[] {
  if (_taxonomy) return _taxonomy
  const fp = path.join(process.cwd(), "data", "normalized", "material-taxonomy.json")
  if (!fs.existsSync(fp)) return []
  _taxonomy = JSON.parse(fs.readFileSync(fp, "utf-8")) as MaterialTaxonomy[]
  return _taxonomy
}

// Additional runtime aliases for common Korean input patterns
const EXTRA_ALIASES: Record<string, string> = {
  // P group
  "탄소강": "P", "일반강": "P", "합금강": "P", "구조강": "P",
  "carbon": "P", "mild steel": "P", "sm45c": "P", "s45c": "P",
  "프리하든": "P", "prehardened": "P", "nap": "P",
  // M group
  "스테인리스": "M", "스테인레스": "M", "스텐": "M", "sts": "M",
  "sus": "M", "스텐리스": "M", "stainless": "M", "sts316": "M",
  "sts304": "M", "sus304": "M", "sus316": "M",
  // K group
  "주철": "K", "cast iron": "K", "gc": "K", "회주철": "K",
  "구상흑연주철": "K", "fc": "K",
  // N group
  "알루미늄": "N", "알루": "N", "al": "N", "aluminium": "N",
  "비철": "N", "구리": "N", "동": "N", "황동": "N", "copper": "N",
  "그라파이트": "N", "graphite": "N", "cfrp": "N", "아크릴": "N",
  // S group
  "티타늄": "S", "티타": "S", "ti": "S", "titanium": "S",
  "인코넬": "S", "inconel": "S", "hastelloy": "S", "하스텔로이": "S",
  "내열합금": "S", "heat resistant": "S", "superalloy": "S",
  // H group
  "고경도": "H", "경화강": "H", "hardened": "H", "hrc": "H",
  "담금질": "H", "die steel": "H", "금형강": "H",
}

export function resolveMaterialTag(input: string): string | null {
  if (!input) return null
  const lower = input.toLowerCase().trim()

  // Direct ISO tag input
  if (/^[PMKNSH]$/i.test(lower)) return lower.toUpperCase()

  // Extra aliases (fast lookup)
  for (const [alias, tag] of Object.entries(EXTRA_ALIASES)) {
    if (lower.includes(alias.toLowerCase())) return tag
  }

  // Taxonomy from normalized data
  const taxonomy = load()
  for (const mat of taxonomy) {
    for (const alias of mat.aliases) {
      if (alias && lower.includes(alias.toLowerCase())) {
        return mat.tag
      }
    }
    // Check display names
    if (mat.displayNameKo && lower.includes(mat.displayNameKo.toLowerCase())) return mat.tag
    if (mat.displayNameEn && lower.includes(mat.displayNameEn.toLowerCase())) return mat.tag
  }

  return null
}

export function getMaterialDisplay(tag: string): { ko: string; en: string } {
  const taxonomy = load()
  const mat = taxonomy.find(m => m.tag === tag)
  if (!mat) return { ko: tag, en: tag }
  return { ko: mat.displayNameKo, en: mat.displayNameEn }
}

export function getAllTags(): string[] {
  return load().map(m => m.tag)
}
