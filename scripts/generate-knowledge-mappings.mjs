#!/usr/bin/env node
/**
 * Knowledge → KG Mapping Generator
 *
 * Reads knowledge/all_series_knowledge.json and produces
 * data/generated/knowledge-mappings.json with canonical mappings
 * for tool subtypes, coatings, and materials.
 *
 * Usage: node scripts/generate-knowledge-mappings.mjs
 */

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const KNOWLEDGE_FILE = path.join(ROOT, "knowledge", "all_series_knowledge.json")
const TERMINOLOGY_FILE = path.join(ROOT, "knowledge", "terminology", "cutting_tool_terminology_en_ko.json")
const OUTPUT_DIR = path.join(ROOT, "data", "generated")
const OUTPUT_FILE = path.join(OUTPUT_DIR, "knowledge-mappings.json")

// ═══════════════════════════════════════════════════════════════
// Canonical Mapping Rules (keyword-based, ordered by specificity)
// ═══════════════════════════════════════════════════════════════

// Tool subtype: ordered from most specific to least
const SUBTYPE_RULES = [
  { canonical: "Corner Radius", keywords: ["corner radius", "corner rounding"] },
  { canonical: "Ball", keywords: ["ball", "볼"] },
  { canonical: "Roughing", keywords: ["roughing", "rough", "wave cut", "chip splitter", "chipbreaker", "chip breaker"] },
  { canonical: "Taper", keywords: ["taper", "dovetail"] },
  { canonical: "Chamfer", keywords: ["chamfer", "chamfering", "deburring", "countersink"] },
  { canonical: "High-Feed", keywords: ["high feed", "high-feed", "highfeed", "hpc"] },
  { canonical: "Drill", keywords: ["drill", "spotting", "center drill", "sm-point", "sv-point", "jobber", "deep hole", "flat bottom", "coolant hole", "coolant holes", "non-stop", "split point", "parabolic", "silver & deming"] },
  { canonical: "Tap", keywords: ["tap", "thread", "forming tap", "fluteless", "synchro", "spiral flute", "spiral point", "straight flute", "bottoming", "plug style", "pipe", "forming", "nut"] },
  { canonical: "Reamer", keywords: ["reamer"] },
  { canonical: "Insert", keywords: ["insert"] },
  { canonical: "Holder", keywords: ["holder", "arbor", "chuck", "collet", "adapter", "spanner", "quick change", "keyless"] },
  { canonical: "Shell", keywords: ["shell end", "shell mill", "shell normal", "shell roughing", "face mill", "side and face", "woodruff", "t-slot"] },
  { canonical: "Miniature", keywords: ["miniature"] },
  { canonical: "Square", keywords: ["square", "flat shank", "flat,", "flat /", "/ flat", "plane", "keyway", "slotting", "side cutting", "staggered", "multiple helix", "multi flute", "multi-flute", "helix", "stub", "regular", "standard", "long length", "short length", "extra long", "extended", "general", "plain", "double end", "center cut"] },
  { canonical: "Radius", keywords: ["radius"] },
]

// Coating: priority order for multi-coating values
const COATING_RULES = [
  { canonical: "Diamond", keywords: ["diamond"] },
  { canonical: "DLC", keywords: ["dlc"] },
  { canonical: "AlCrN", keywords: ["alcrn", "y-coat", "y coat", "y코팅"] },
  { canonical: "AlTiN", keywords: ["altin", "aitin"] },
  { canonical: "TiAlN", keywords: ["tialn", "x-coat", "x coat", "x코팅", "tank-power", "titanox", "tylon"] },
  { canonical: "TiCN", keywords: ["ticn", "c-coat", "c coat"] },
  { canonical: "TiN", keywords: ["tin coating", "tin tip", "tin,", "tin /", "/ tin", "gold-p", "gold coloring", "coloring"] },
  { canonical: "Z-Coating", keywords: ["z-coat", "z coat"] },
  { canonical: "XC-Coating", keywords: ["xc-coat", "xc coat"] },
  { canonical: "RCH-Coating", keywords: ["rch-coat", "rch coat"] },
  { canonical: "Hardslick", keywords: ["hardslick"] },
  { canonical: "Steam Oxide", keywords: ["steam", "homo", "vap", "oxide", "nitr"] },
  { canonical: "Uncoated", keywords: ["uncoated", "bright", "non-coat", "noncoat", "plain", "무코팅"] },
  { canonical: "Blue-Coating", keywords: ["blue"] },
  { canonical: "H-Coating", keywords: ["h-coat"] },
  { canonical: "Gold-Coating", keywords: ["gold"] },
]

// Material: keyword → canonical workPieceName
const MATERIAL_RULES = [
  { canonical: "Aluminum", keywords: ["알루미늄", "알미늄", "aluminum", "aluminium", "비철", "non-ferrous", "nonferrous", "non ferrous", "アルミ"] },
  { canonical: "Stainless Steels", keywords: ["스테인리스", "스테인레스", "스텐", "stainless", "sus", "sts", "inox", "ステンレス"] },
  { canonical: "Carbon Steels", keywords: ["탄소강", "일반강", "비합금강", "저탄소강", "중탄소강", "고탄소강", "carbon steel", "low carbon", "medium carbon"] },
  { canonical: "Alloy Steels", keywords: ["합금강", "공구강", "구조용강", "고합금", "저합금", "다이캐스팅", "다이케스팅", "단조", "alloy steel", "tool steel", "die steel", "금형강"] },
  { canonical: "Cast Iron", keywords: ["주철", "주물", "cast iron", "가단", "구상흑연", "회주철", "합금주철"] },
  { canonical: "Copper", keywords: ["구리", "동합금", "황동", "청동", "copper", "brass", "bronze"] },
  { canonical: "Titanium", keywords: ["티타늄", "titanium", "순수 티타늄", "티타늄강"] },
  { canonical: "Inconel", keywords: ["인코넬", "inconel", "내열합금", "내열강", "초내열", "니켈", "nickel", "hastelloy", "하스텔로이", "코발트 기반"] },
  { canonical: "Hardened Steels", keywords: ["경화강", "열처리강", "열처리 강", "고경도", "hardened", "hrc"] },
  { canonical: "Prehardened Steels", keywords: ["프리하든", "조질강", "prehardened"] },
  { canonical: "Cast Steel", keywords: ["주강", "cast steel"] },
  { canonical: "Graphite", keywords: ["흑연", "graphite", "그라파이트"] },
  { canonical: "FRP", keywords: ["frp", "cfrp", "gfrp", "섬유강화", "복합재", "탄소섬유", "아크릴", "플라스틱", "열가소", "열경화"] },
]

// ═══════════════════════════════════════════════════════════════
// Matching Functions
// ═══════════════════════════════════════════════════════════════

function matchSubtype(raw) {
  const lower = raw.toLowerCase()
  for (const rule of SUBTYPE_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) return rule.canonical
  }
  // Fallback: flute-based descriptions without clear shape → Square (most common)
  if (/\d\s*flute/i.test(raw) || /\d날/.test(raw)) return "Square"
  return null
}

function matchCoating(raw) {
  const lower = raw.toLowerCase()
  // Try each coating in priority order
  for (const rule of COATING_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) return rule.canonical
  }
  // Special case: bare "TiN" (not part of TiAlN/TiCN)
  if (/\btin\b/i.test(raw) && !lower.includes("tialn") && !lower.includes("ticn") && !lower.includes("altin")) {
    return "TiN"
  }
  // "TiAIN" is a common typo for "TiAlN" (capital I instead of lowercase l)
  if (/tiain/i.test(raw)) return "TiAlN"
  // Generic "new coating", "special coating", "coating" → skip (not mappable)
  // "PM60", "DH100", "YH" → proprietary, not mappable to standard
  return null
}

function matchMaterial(raw) {
  const lower = raw.toLowerCase()
  for (const rule of MATERIAL_RULES) {
    if (rule.keywords.some(k => lower.includes(k))) return rule.canonical
  }
  // ISO group fallback
  if (/^iso\s*p\b/i.test(raw) || /P:\s/.test(raw)) return "Carbon Steels"
  if (/^iso\s*m\b/i.test(raw) || /M:\s/.test(raw)) return "Stainless Steels"
  if (/^iso\s*k\b/i.test(raw) || /K:\s/.test(raw)) return "Cast Iron"
  if (/^iso\s*n\b/i.test(raw) || /N:\s/.test(raw)) return "Aluminum"
  if (/^iso\s*s\b/i.test(raw) || /S:\s/.test(raw)) return "Titanium"
  if (/^iso\s*h\b/i.test(raw) || /H:\s/.test(raw)) return "Hardened Steels"
  return null
}

// ═══════════════════════════════════════════════════════════════
// Main Generator
// ═══════════════════════════════════════════════════════════════

function generateMappings() {
  console.log("[generate-mappings] Reading knowledge data...")
  const series = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, "utf-8"))
  console.log(`[generate-mappings] ${series.length} series loaded`)

  // Collect unique raw values
  const rawSubtypes = new Set()
  const rawCoatings = new Set()
  const rawMaterials = new Set()

  for (const s of series) {
    if (s.tool_subtype) rawSubtypes.add(s.tool_subtype)
    if (s.coating) rawCoatings.add(s.coating)
    for (const m of (s.target_materials || [])) rawMaterials.add(m)
  }

  console.log(`[generate-mappings] Unique: ${rawSubtypes.size} subtypes, ${rawCoatings.size} coatings, ${rawMaterials.size} materials`)

  // Build maps
  const subtypeMap = {}
  let subtypeUnmapped = 0
  for (const raw of rawSubtypes) {
    const canonical = matchSubtype(raw)
    if (canonical) {
      subtypeMap[raw] = canonical
    } else {
      subtypeUnmapped++
    }
  }

  const coatingMap = {}
  let coatingUnmapped = 0
  for (const raw of rawCoatings) {
    const canonical = matchCoating(raw)
    if (canonical) {
      coatingMap[raw] = canonical
    } else {
      coatingUnmapped++
    }
  }

  const materialMap = {}
  let materialUnmapped = 0
  for (const raw of rawMaterials) {
    const canonical = matchMaterial(raw)
    if (canonical) {
      materialMap[raw] = canonical
    } else {
      materialUnmapped++
    }
  }

  // Build extended aliases: canonical → [lowercased alias strings]
  const subtypeAliases = {}
  for (const [raw, canonical] of Object.entries(subtypeMap)) {
    if (!subtypeAliases[canonical]) subtypeAliases[canonical] = new Set()
    // Add the raw value lowercased
    subtypeAliases[canonical].add(raw.toLowerCase())
    // Add meaningful sub-tokens (3+ chars, not stop words)
    const tokens = raw.toLowerCase().split(/[\s/,()]+/).filter(t => t.length >= 3)
    const stopTokens = new Set(["and", "with", "for", "the", "type", "style", "length", "regular", "standard", "general", "purpose"])
    for (const t of tokens) {
      if (!stopTokens.has(t)) subtypeAliases[canonical].add(t)
    }
  }

  const coatingAliases = {}
  for (const [raw, canonical] of Object.entries(coatingMap)) {
    if (!coatingAliases[canonical]) coatingAliases[canonical] = new Set()
    coatingAliases[canonical].add(raw.toLowerCase())
    // Split multi-coating and add segments
    const segments = raw.split(/[/,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
    for (const seg of segments) {
      if (seg.length >= 2) coatingAliases[canonical].add(seg)
    }
  }

  const materialAliases = {}
  for (const [raw, canonical] of Object.entries(materialMap)) {
    if (!materialAliases[canonical]) materialAliases[canonical] = new Set()
    materialAliases[canonical].add(raw.toLowerCase())
  }

  // Load terminology for extra aliases
  if (fs.existsSync(TERMINOLOGY_FILE)) {
    const terminology = JSON.parse(fs.readFileSync(TERMINOLOGY_FILE, "utf-8"))
    for (const { en, ko } of terminology) {
      const enLower = en.toLowerCase()
      const koLower = ko.toLowerCase()
      // Check if EN term maps to a known canonical subtype
      for (const rule of SUBTYPE_RULES) {
        if (rule.keywords.some(k => enLower.includes(k))) {
          if (!subtypeAliases[rule.canonical]) subtypeAliases[rule.canonical] = new Set()
          subtypeAliases[rule.canonical].add(enLower)
          if (koLower !== enLower) subtypeAliases[rule.canonical].add(koLower)
          break
        }
      }
      // Check coating
      for (const rule of COATING_RULES) {
        if (rule.keywords.some(k => enLower.includes(k))) {
          if (!coatingAliases[rule.canonical]) coatingAliases[rule.canonical] = new Set()
          coatingAliases[rule.canonical].add(enLower)
          if (koLower !== enLower) coatingAliases[rule.canonical].add(koLower)
          break
        }
      }
      // Check material
      for (const rule of MATERIAL_RULES) {
        if (rule.keywords.some(k => enLower.includes(k) || koLower.includes(k))) {
          if (!materialAliases[rule.canonical]) materialAliases[rule.canonical] = new Set()
          materialAliases[rule.canonical].add(enLower)
          if (koLower !== enLower) materialAliases[rule.canonical].add(koLower)
          break
        }
      }
    }
  }

  // Convert Sets to sorted arrays
  const toArrays = (obj) => {
    const result = {}
    for (const [k, v] of Object.entries(obj)) {
      result[k] = [...v].sort()
    }
    return result
  }

  const output = {
    generatedAt: new Date().toISOString(),
    sourceFile: "knowledge/all_series_knowledge.json",
    subtypeMap,
    coatingMap,
    materialMap,
    extendedAliases: {
      toolSubtype: toArrays(subtypeAliases),
      coating: toArrays(coatingAliases),
      workPieceName: toArrays(materialAliases),
    },
    stats: {
      totalSeries: series.length,
      subtypesTotal: rawSubtypes.size,
      subtypesMapped: Object.keys(subtypeMap).length,
      subtypesUnmapped: subtypeUnmapped,
      coatingsTotal: rawCoatings.size,
      coatingsMapped: Object.keys(coatingMap).length,
      coatingsUnmapped: coatingUnmapped,
      materialsTotal: rawMaterials.size,
      materialsMapped: Object.keys(materialMap).length,
      materialsUnmapped: materialUnmapped,
      aliasCount: {
        toolSubtype: Object.values(subtypeAliases).reduce((s, v) => s + v.size, 0),
        coating: Object.values(coatingAliases).reduce((s, v) => s + v.size, 0),
        workPieceName: Object.values(materialAliases).reduce((s, v) => s + v.size, 0),
      },
    },
  }

  // Write output
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf-8")

  console.log("\n[generate-mappings] ✅ Done!")
  console.log(`  Output: ${OUTPUT_FILE}`)
  console.log(`  Subtypes: ${output.stats.subtypesMapped}/${output.stats.subtypesTotal} mapped (${output.stats.subtypesUnmapped} unmapped)`)
  console.log(`  Coatings: ${output.stats.coatingsMapped}/${output.stats.coatingsTotal} mapped (${output.stats.coatingsUnmapped} unmapped)`)
  console.log(`  Materials: ${output.stats.materialsMapped}/${output.stats.materialsTotal} mapped (${output.stats.materialsUnmapped} unmapped)`)
  console.log(`  Aliases: subtype=${output.stats.aliasCount.toolSubtype}, coating=${output.stats.aliasCount.coating}, material=${output.stats.aliasCount.workPieceName}`)

  // Print unmapped values for debugging
  if (subtypeUnmapped > 0) {
    console.log(`\n  Unmapped subtypes:`)
    for (const raw of rawSubtypes) {
      if (!subtypeMap[raw]) console.log(`    - "${raw}"`)
    }
  }
  if (coatingUnmapped > 0) {
    console.log(`\n  Unmapped coatings:`)
    for (const raw of rawCoatings) {
      if (!coatingMap[raw]) console.log(`    - "${raw}"`)
    }
  }
  if (materialUnmapped > 0) {
    console.log(`\n  Unmapped materials (first 20):`)
    let count = 0
    for (const raw of rawMaterials) {
      if (!materialMap[raw] && count < 20) { console.log(`    - "${raw}"`); count++ }
    }
  }
}

generateMappings()
