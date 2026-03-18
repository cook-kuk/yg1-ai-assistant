/**
 * Material Alias Resolver
 * Runtime file loading is disabled, so the canonical ISO material map lives in code.
 */

import type { MaterialTaxonomy } from "@/lib/types/canonical"

const MATERIAL_TAXONOMY: MaterialTaxonomy[] = [
  {
    tag: "P",
    displayNameKo: "강",
    displayNameEn: "Steel",
    aliases: ["강", "탄소강", "일반강", "합금강", "구조강", "carbon", "steel", "mild steel", "sm45c", "s45c", "prehardened", "nap"],
    rawNamesByLocale: {},
  },
  {
    tag: "M",
    displayNameKo: "스테인리스",
    displayNameEn: "Stainless Steels",
    aliases: ["스테인리스", "스테인레스", "스텐", "sts", "sus", "stainless", "inox", "sus304", "sus316", "sts304", "sts316"],
    rawNamesByLocale: {},
  },
  {
    tag: "K",
    displayNameKo: "주철",
    displayNameEn: "Cast Iron",
    aliases: ["주철", "cast iron", "gc", "fc", "회주철", "회색주철", "구상흑연주철"],
    rawNamesByLocale: {},
  },
  {
    tag: "N",
    displayNameKo: "비철",
    displayNameEn: "Non-Ferrous",
    aliases: ["알루미늄", "알루", "al", "alu", "aluminium", "aluminum", "비철", "구리", "동", "황동", "copper", "graphite", "cfrp", "아크릴"],
    rawNamesByLocale: {},
  },
  {
    tag: "S",
    displayNameKo: "내열합금",
    displayNameEn: "Heat Resistant Alloys",
    aliases: ["티타늄", "티타", "ti", "titanium", "인코넬", "inconel", "hastelloy", "하스텔로이", "내열합금", "heat resistant", "superalloy"],
    rawNamesByLocale: {},
  },
  {
    tag: "H",
    displayNameKo: "고경도강",
    displayNameEn: "Hardened Steels",
    aliases: ["고경도", "고경도강", "경화강", "담금질", "담금질강", "hardened", "hard steel", "hrc", "die steel", "금형강"],
    rawNamesByLocale: {},
  },
]

// Additional runtime aliases for common Korean input patterns
const EXTRA_ALIASES: Record<string, string> = {
  "탄소강": "P", "일반강": "P", "합금강": "P", "구조강": "P",
  "carbon": "P", "mild steel": "P", "sm45c": "P", "s45c": "P",
  "프리하든": "P", "prehardened": "P", "nap": "P",
  "스테인리스": "M", "스테인레스": "M", "스텐": "M", "sts": "M",
  "sus": "M", "스텐리스": "M", "stainless": "M", "sts316": "M",
  "sts304": "M", "sus304": "M", "sus316": "M",
  "주철": "K", "cast iron": "K", "gc": "K", "회주철": "K",
  "구상흑연주철": "K", "fc": "K",
  "알루미늄": "N", "알루": "N", "al": "N", "aluminium": "N",
  "aluminum": "N", "비철": "N", "구리": "N", "동": "N", "황동": "N", "copper": "N",
  "그라파이트": "N", "graphite": "N", "cfrp": "N", "아크릴": "N",
  "티타늄": "S", "티타": "S", "ti": "S", "titanium": "S",
  "인코넬": "S", "inconel": "S", "hastelloy": "S", "하스텔로이": "S",
  "내열합금": "S", "heat resistant": "S", "superalloy": "S",
  "고경도": "H", "경화강": "H", "hardened": "H", "hrc": "H",
  "담금질": "H", "die steel": "H", "금형강": "H",
}

export function resolveMaterialTag(input: string): string | null {
  if (!input) return null
  const lower = input.toLowerCase().trim()

  if (/^[PMKNSH]$/i.test(lower)) return lower.toUpperCase()

  for (const [alias, tag] of Object.entries(EXTRA_ALIASES)) {
    if (lower.includes(alias.toLowerCase())) return tag
  }

  for (const material of MATERIAL_TAXONOMY) {
    for (const alias of material.aliases) {
      if (alias && lower.includes(alias.toLowerCase())) return material.tag
    }
    if (material.displayNameKo && lower.includes(material.displayNameKo.toLowerCase())) return material.tag
    if (material.displayNameEn && lower.includes(material.displayNameEn.toLowerCase())) return material.tag
  }

  return null
}

export function getMaterialDisplay(tag: string): { ko: string; en: string } {
  const material = MATERIAL_TAXONOMY.find(entry => entry.tag === tag)
  if (!material) return { ko: tag, en: tag }
  return { ko: material.displayNameKo, en: material.displayNameEn }
}

export function getAllTags(): string[] {
  return MATERIAL_TAXONOMY.map(material => material.tag)
}
