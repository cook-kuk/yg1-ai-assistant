import fs from "node:fs"
import path from "node:path"
import { MATERIAL_MAPPING_ROWS } from "./material-mapping.generated"

export type MaterialAliasMatch = {
  raw: string
  canonicalFamily: string | null
  lv1Iso: string | null
  lv2Category: string | null
  lv3Category?: string | null
  matchedAlias: string | null
  sourceColumn: string | null
  confidence: number
}

export type MaterialKnowledgeEntry = {
  canonicalFamily: string | null
  lv1Iso: string | null
  lv2Category: string | null
  lv3Category?: string | null
  materialDescription: string | null
  compositionHeatTreatment: string | null
  aliases: string[]
  strengthSignals: string[]
  brandHints: string[]
  seriesHints: string[]
}

type MaterialMappingCsvRow = {
  LV1_ISO?: string
  LV2_Category?: string
  LV3_Category?: string
  Material_Description?: string
  Composition_Heat_Treatment?: string
  Material_No?: string
  JIS?: string
  DIN?: string
  AISI_ASTM_SAE?: string
  BS?: string
  EN?: string
  AFNOR?: string
  SS?: string
  UNI?: string
  UNE_IHA?: string
  UNS?: string
  GOST?: string
  GB?: string
}

type MaterialAliasEntry = {
  normalizedAlias: string
  rawAlias: string
  sourceColumn: string
  canonicalFamily: string | null
  lv1Iso: string | null
  lv2Category: string | null
  lv3Category: string | null
  confidence: number
}

type BrandAffinityRow = {
  brand: string
  materialKey: string
  ratingScore: number
  notes: string
}

type SeriesStatusRow = {
  seriesName: string
  brandName: string
  edpCount: number
  materialTags: string[]
  workPieceNames: string[]
  workPieceStatuses: Array<{
    tag_name?: string
    work_piece_name?: string
    material_rating?: string
    material_rating_score?: number
  }>
}

type MaterialMappingCache = {
  materialPath: string | null
  brandAffinityPath: string | null
  seriesProfilePath: string | null
  rows: MaterialMappingCsvRow[]
  aliasIndex: Map<string, MaterialAliasEntry[]>
  aliasEntries: MaterialAliasEntry[]
  knowledgeEntries: MaterialKnowledgeEntry[]
  knowledgeByFamily: Map<string, MaterialKnowledgeEntry>
  familyVariants: Map<string, string[]>
  familyByIso: Map<string, string>
  brandAffinityRows: BrandAffinityRow[]
  seriesStatusRows: SeriesStatusRow[]
}

const MATERIAL_MAPPING_FILENAME = "material_mapping_lv1_lv2_lv3.csv"
const REPO_MATERIAL_MAPPING_CSV_PATH = path.join("data", "assets", MATERIAL_MAPPING_FILENAME)
const LEGACY_MATERIAL_MAPPING_CSV_PATH = "C:/Users/kuksh/Downloads/material_mapping_lv1_lv2_lv3.csv"
const BUNDLED_MATERIAL_MAPPING_SOURCE = "bundled:material-mapping.generated.ts"
const BRAND_AFFINITY_FILENAME = "public__brand_material_affinity.csv"
const SERIES_PROFILE_FILENAME = "catalog_app__series_profile_mv.csv"

const MATERIAL_MAPPING_ALIAS_COLUMNS: Array<keyof MaterialMappingCsvRow> = [
  "Material_No",
  "JIS",
  "DIN",
  "AISI_ASTM_SAE",
  "BS",
  "EN",
  "AFNOR",
  "SS",
  "UNI",
  "UNE_IHA",
  "UNS",
  "GOST",
  "GB",
]

const SPEC_PREFIXES: Partial<Record<keyof MaterialMappingCsvRow, string[]>> = {
  Material_No: ["material no", "material number", "material_no"],
  JIS: ["jis"],
  DIN: ["din"],
  AISI_ASTM_SAE: ["aisi", "astm", "sae"],
  BS: ["bs"],
  EN: ["en"],
  AFNOR: ["afnor"],
  SS: ["ss"],
  UNI: ["uni"],
  UNE_IHA: ["une", "iha"],
  UNS: ["uns"],
  GOST: ["gost"],
  GB: ["gb"],
}

const FAMILY_SIGNAL_PATTERNS: Array<{ family: string; signal: string; pattern: RegExp }> = [
  { family: "Stainless", signal: "stainless", pattern: /\bstainless(?:\s+steel)?s?\b/i },
  { family: "Titanium", signal: "titanium", pattern: /\btitanium\b/i },
  { family: "Inconel", signal: "super alloy", pattern: /\b(?:inconel|super[\s-]?alloy|nickel[\s-]?based|heat[\s-]?resistant)\b/i },
  { family: "Aluminum", signal: "aluminum", pattern: /\balumin(?:um|ium)|non[\s-]?ferrous\b/i },
  { family: "Copper", signal: "copper", pattern: /\b(?:copper|brass|bronze)\b/i },
  { family: "Cast Iron", signal: "cast iron", pattern: /\bcast[\s-]?iron\b/i },
  { family: "Prehardened Steel", signal: "prehardened", pattern: /\bpre[\s-]?harden(?:ed)?\b/i },
  { family: "Hardened Steel", signal: "hardened", pattern: /\b(?:harden(?:ed|ing)?|tool steel|hrc\s*\d+)\b/i },
  { family: "Alloy Steel", signal: "alloy steel", pattern: /\b(?:alloy steel|low[\s-]?alloy(?:ed)?|high[\s-]?alloy(?:ed)?)\b/i },
  { family: "Carbon Steel", signal: "carbon steel", pattern: /\b(?:carbon steel|non[\s-]?alloyed steel|structural steel)\b/i },
]

const HEAT_TREATMENT_PATTERNS: Array<{ signal: string; pattern: RegExp }> = [
  { signal: "annealed", pattern: /\bannealed\b/i },
  { signal: "quenched & tempered", pattern: /\bquenched\b.*\btempered\b/i },
  { signal: "solution treated", pattern: /\bsolution(?:ed)?\s+treat(?:ed|ment)?\b/i },
  { signal: "age hardened", pattern: /\bage[\s-]?harden(?:ed|ing)?\b/i },
  { signal: "cast", pattern: /\bcast\b/i },
]

const CATALOG_FAMILY_NAME_MAP = new Map<string, string>([
  ["stainless", "Stainless Steels"],
  ["stainlesssteels", "Stainless Steels"],
  ["carbonsteel", "Carbon Steels"],
  ["carbonsteels", "Carbon Steels"],
  ["alloysteel", "Alloy Steels"],
  ["alloysteels", "Alloy Steels"],
  ["prehardenedsteel", "Prehardened Steels"],
  ["prehardenedsteels", "Prehardened Steels"],
  ["hardenedsteel", "Hardened Steels"],
  ["hardenedsteels", "Hardened Steels"],
  ["castiron", "Cast Iron"],
  ["aluminum", "Aluminum"],
  ["copper", "Copper"],
  ["titanium", "Titanium"],
  ["inconel", "Inconel"],
])

let materialMappingCache: MaterialMappingCache | null = null
let materialMappingPathOverride: string | null = null
let brandAffinityPathOverride: string | null = null
let seriesProfilePathOverride: string | null = null

function toNonEmptyString(value: string | undefined): string | null {
  const trimmed = String(value ?? "").trim()
  return trimmed ? trimmed : null
}

function normalizeAliasToken(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u3131-\u318e\uac00-\ud7a3]+/g, "")
}

function normalizeReadableText(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = normalizeReadableText(value ?? "")
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

function normalizeFamilyKey(value: string | null | undefined): string {
  return normalizeAliasToken(String(value ?? ""))
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentCell = ""
  let inQuotes = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    const next = content[index + 1]

    if (inQuotes) {
      if (char === "\"") {
        if (next === "\"") {
          currentCell += "\""
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        currentCell += char
      }
      continue
    }

    if (char === "\"") {
      inQuotes = true
      continue
    }

    if (char === ",") {
      currentRow.push(currentCell)
      currentCell = ""
      continue
    }

    if (char === "\r") {
      continue
    }

    if (char === "\n") {
      currentRow.push(currentCell)
      rows.push(currentRow)
      currentRow = []
      currentCell = ""
      continue
    }

    currentCell += char
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell)
    rows.push(currentRow)
  }

  return rows
}

function parseCsvFile(filePath: string | null): Record<string, string>[] {
  if (!filePath || !fs.existsSync(filePath)) return []
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"))
  if (rows.length === 0) return []

  const headers = rows[0].map(header => header.trim())
  return rows
    .slice(1)
    .filter(row => row.some(cell => cell.trim().length > 0))
    .map(row => {
      const record: Record<string, string> = {}
      for (let index = 0; index < headers.length; index += 1) {
        record[headers[index]] = row[index] ?? ""
      }
      return record
    })
}

function parseJsonCell<T>(value: string | undefined, fallback: T): T {
  const trimmed = String(value ?? "").trim()
  if (!trimmed) return fallback

  try {
    return JSON.parse(trimmed) as T
  } catch {
    return fallback
  }
}

function splitAliasValue(value: string | undefined): string[] {
  const text = String(value ?? "").trim()
  if (!text || text === "-") return []
  return text
    .split(/\s*(?:,|;|\/|\||\n)\s*/g)
    .map(part => part.trim())
    .filter(Boolean)
}

function resolveCandidatePath(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const trimmed = String(candidate ?? "").trim()
    if (!trimmed) continue
    if (fs.existsSync(trimmed)) return trimmed
  }
  return null
}

function resolveMaterialMappingCsvOverridePath(): string | null {
  return resolveCandidatePath([
    materialMappingPathOverride,
    process.env.MATERIAL_MAPPING_CSV_PATH,
    LEGACY_MATERIAL_MAPPING_CSV_PATH,
  ])
}

function resolveRepoMaterialMappingCsvPath(): string | null {
  return resolveCandidatePath([
    REPO_MATERIAL_MAPPING_CSV_PATH,
    path.join("data", "domain-knowledge", "sources", MATERIAL_MAPPING_FILENAME),
    path.join(process.cwd(), "knowledge", MATERIAL_MAPPING_FILENAME),
    path.join(process.cwd(), MATERIAL_MAPPING_FILENAME),
  ])
}

function loadBundledMaterialMappingRows(): MaterialMappingCsvRow[] {
  return (MATERIAL_MAPPING_ROWS as ReadonlyArray<Record<string, string>>)
    .map(row => ({ ...row })) as MaterialMappingCsvRow[]
}

function loadMaterialMappingRowsWithSource(): { materialPath: string | null; rows: MaterialMappingCsvRow[] } {
  const overridePath = resolveMaterialMappingCsvOverridePath()
  if (overridePath) {
    return {
      materialPath: overridePath,
      rows: parseCsvFile(overridePath) as MaterialMappingCsvRow[],
    }
  }

  const bundledRows = loadBundledMaterialMappingRows()
  if (bundledRows.length > 0) {
    return {
      materialPath: BUNDLED_MATERIAL_MAPPING_SOURCE,
      rows: bundledRows,
    }
  }

  const repoPath = resolveRepoMaterialMappingCsvPath()
  return {
    materialPath: repoPath,
    rows: parseCsvFile(repoPath) as MaterialMappingCsvRow[],
  }
}

function resolveMaterialMappingSourceId(): string | null {
  const overridePath = resolveMaterialMappingCsvOverridePath()
  if (overridePath) return overridePath
  if (MATERIAL_MAPPING_ROWS.length > 0) return BUNDLED_MATERIAL_MAPPING_SOURCE
  return resolveRepoMaterialMappingCsvPath()
}

function resolveBrandAffinityCsvPath(): string | null {
  return resolveCandidatePath([
    brandAffinityPathOverride,
    process.env.MATERIAL_BRAND_AFFINITY_CSV_PATH,
    path.join(process.cwd(), "db_export", BRAND_AFFINITY_FILENAME),
  ])
}

function resolveSeriesProfileCsvPath(): string | null {
  return resolveCandidatePath([
    seriesProfilePathOverride,
    process.env.MATERIAL_SERIES_PROFILE_CSV_PATH,
    path.join(process.cwd(), "db_export", SERIES_PROFILE_FILENAME),
  ])
}

function inferCanonicalFamily(row: MaterialMappingCsvRow): string | null {
  const lv1Iso = toNonEmptyString(row.LV1_ISO)?.toUpperCase() ?? null
  const lv2Category = toNonEmptyString(row.LV2_Category) ?? ""
  const description = toNonEmptyString(row.Material_Description) ?? ""
  const composition = toNonEmptyString(row.Composition_Heat_Treatment) ?? ""
  const combined = `${lv2Category} ${description} ${composition}`.trim()

  for (const signal of FAMILY_SIGNAL_PATTERNS) {
    if (signal.pattern.test(combined)) return signal.family
  }

  if (lv1Iso === "M") return "Stainless"
  if (lv1Iso === "K") return "Cast Iron"
  if (lv1Iso === "S") return "Inconel"
  if (lv1Iso === "H") return "Hardened Steel"
  if (lv1Iso === "P") return "Carbon Steel"
  return null
}

function buildStrengthSignals(row: MaterialMappingCsvRow): string[] {
  const combined = `${row.LV2_Category ?? ""} ${row.Material_Description ?? ""} ${row.Composition_Heat_Treatment ?? ""}`
  const signals = new Set<string>()

  for (const signal of FAMILY_SIGNAL_PATTERNS) {
    if (signal.pattern.test(combined)) signals.add(signal.signal)
  }
  for (const signal of HEAT_TREATMENT_PATTERNS) {
    if (signal.pattern.test(combined)) signals.add(signal.signal)
  }

  return [...signals]
}

function buildAliasVariants(alias: string, sourceColumn: keyof MaterialMappingCsvRow): string[] {
  const base = normalizeReadableText(alias)
  if (!base || base === "-") return []
  const variants = new Set<string>([base])
  const prefixes = SPEC_PREFIXES[sourceColumn] ?? []
  for (const prefix of prefixes) {
    variants.add(`${prefix} ${base}`)
  }
  return [...variants]
}

function buildAliasEntries(rows: MaterialMappingCsvRow[]): { aliasIndex: Map<string, MaterialAliasEntry[]>; aliasEntries: MaterialAliasEntry[] } {
  const aliasIndex = new Map<string, MaterialAliasEntry[]>()
  const aliasEntries: MaterialAliasEntry[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    const canonicalFamily = inferCanonicalFamily(row)
    const lv1Iso = toNonEmptyString(row.LV1_ISO)?.toUpperCase() ?? null
    const lv2Category = toNonEmptyString(row.LV2_Category)
    const lv3Category = toNonEmptyString(row.LV3_Category)

    for (const column of MATERIAL_MAPPING_ALIAS_COLUMNS) {
      const aliases = splitAliasValue(row[column])
      for (const alias of aliases) {
        for (const variant of buildAliasVariants(alias, column)) {
          const normalizedAlias = normalizeAliasToken(variant)
          if (!normalizedAlias) continue

          const dedupeKey = [
            normalizedAlias,
            sourceColumnKey(column),
            normalizeFamilyKey(canonicalFamily),
            lv1Iso ?? "",
            normalizeAliasToken(lv2Category ?? ""),
          ].join("|")
          if (seen.has(dedupeKey)) continue
          seen.add(dedupeKey)

          const entry: MaterialAliasEntry = {
            normalizedAlias,
            rawAlias: variant,
            sourceColumn: sourceColumnKey(column),
            canonicalFamily,
            lv1Iso,
            lv2Category,
            lv3Category,
            confidence: prefixesBackedConfidence(sourceColumnKey(column)),
          }

          const bucket = aliasIndex.get(normalizedAlias)
          if (bucket) bucket.push(entry)
          else aliasIndex.set(normalizedAlias, [entry])
          aliasEntries.push(entry)
        }
      }
    }
  }

  aliasEntries.sort((left, right) => {
    if (right.normalizedAlias.length !== left.normalizedAlias.length) {
      return right.normalizedAlias.length - left.normalizedAlias.length
    }
    return right.confidence - left.confidence
  })

  return { aliasIndex, aliasEntries }
}

function prefixesBackedConfidence(sourceColumn: string): number {
  if (sourceColumn === "Material_No") return 0.99
  if (sourceColumn === "AISI_ASTM_SAE") return 0.98
  if (sourceColumn === "JIS" || sourceColumn === "DIN" || sourceColumn === "EN") return 0.97
  return 0.95
}

function sourceColumnKey(column: keyof MaterialMappingCsvRow): string {
  return String(column)
}

function selectBestAliasMatch(candidates: MaterialAliasEntry[], raw: string, confidenceFloor = 0): MaterialAliasMatch | null {
  if (candidates.length === 0) return null

  const families = uniqueStrings(candidates.map(candidate => candidate.canonicalFamily))
  const lv1Values = uniqueStrings(candidates.map(candidate => candidate.lv1Iso))
  if (families.length > 1 || lv1Values.length > 1) return null

  const best = [...candidates].sort((left, right) => {
    if (right.confidence !== left.confidence) return right.confidence - left.confidence
    return right.normalizedAlias.length - left.normalizedAlias.length
  })[0]
  if (!best || best.confidence < confidenceFloor) return null

  return {
    raw,
    canonicalFamily: best.canonicalFamily,
    lv1Iso: best.lv1Iso,
    lv2Category: best.lv2Category,
    lv3Category: best.lv3Category,
    matchedAlias: best.rawAlias,
    sourceColumn: best.sourceColumn,
    confidence: best.confidence,
  }
}

function lookupExactAlias(raw: string, cache: MaterialMappingCache): MaterialAliasMatch | null {
  const normalized = normalizeAliasToken(raw)
  if (!normalized) return null
  const exact = cache.aliasIndex.get(normalized)
  if (!exact) return null
  return selectBestAliasMatch(exact, raw, 0.8)
}

function lookupAliasInFreeText(raw: string, cache: MaterialMappingCache): MaterialAliasMatch | null {
  const normalizedRaw = normalizeAliasToken(raw)
  if (!normalizedRaw) return null

  for (const entry of cache.aliasEntries) {
    if (entry.normalizedAlias.length < 4) continue
    if (!normalizedRaw.includes(entry.normalizedAlias)) continue
    const bucket = cache.aliasIndex.get(entry.normalizedAlias) ?? [entry]
    const matched = selectBestAliasMatch(bucket, raw, Math.min(entry.confidence, 0.8))
    if (!matched) continue
    return {
      ...matched,
      confidence: Math.min(matched.confidence, 0.88),
    }
  }

  return null
}

function inferFamilyFromDescription(raw: string, cache: MaterialMappingCache): MaterialAliasMatch | null {
  const text = normalizeReadableText(raw)
  if (!text) return null

  const hits = FAMILY_SIGNAL_PATTERNS
    .filter(signal => signal.pattern.test(text))
    .map(signal => signal.family)

  const uniqueFamilies = uniqueStrings(hits)
  if (uniqueFamilies.length !== 1) return null

  const familyKey = normalizeFamilyKey(uniqueFamilies[0])
  const knowledge = cache.knowledgeByFamily.get(familyKey)
  if (!knowledge || !knowledge.canonicalFamily) return null

  return {
    raw,
    canonicalFamily: knowledge.canonicalFamily,
    lv1Iso: knowledge.lv1Iso,
    lv2Category: knowledge.lv2Category,
    lv3Category: knowledge.lv3Category,
    matchedAlias: null,
    sourceColumn: "Material_Description",
    confidence: 0.58,
  }
}

function buildFamilyVariants(rows: MaterialMappingCsvRow[]): Map<string, string[]> {
  const variants = new Map<string, Set<string>>()

  for (const row of rows) {
    const family = inferCanonicalFamily(row)
    if (!family) continue
    const familyKey = normalizeFamilyKey(family)
    const bucket = variants.get(familyKey) ?? new Set<string>()
    bucket.add(family)
    if (row.LV2_Category) bucket.add(row.LV2_Category)
    if (row.LV3_Category) bucket.add(row.LV3_Category)
    variants.set(familyKey, bucket)
  }

  return new Map([...variants.entries()].map(([key, value]) => [key, uniqueStrings([...value])]))
}

function buildFamilyIsoIndex(entries: MaterialKnowledgeEntry[]): Map<string, string> {
  const isoToFamilyCounts = new Map<string, Map<string, number>>()

  for (const entry of entries) {
    if (!entry.canonicalFamily || !entry.lv1Iso) continue
    const iso = entry.lv1Iso.toUpperCase()
    const family = entry.canonicalFamily
    const bucket = isoToFamilyCounts.get(iso) ?? new Map<string, number>()
    bucket.set(family, (bucket.get(family) ?? 0) + 1)
    isoToFamilyCounts.set(iso, bucket)
  }

  const familyByIso = new Map<string, string>()
  for (const [iso, familyCounts] of isoToFamilyCounts.entries()) {
    const bestFamily = [...familyCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null
    if (bestFamily) familyByIso.set(iso, bestFamily)
  }

  return familyByIso
}

function loadBrandAffinityRows(filePath: string | null): BrandAffinityRow[] {
  return parseCsvFile(filePath)
    .map(row => ({
      brand: normalizeReadableText(row.brand),
      materialKey: normalizeReadableText(row.material_key).toUpperCase(),
      ratingScore: Number(row.rating_score ?? 0) || 0,
      notes: normalizeReadableText(row.notes),
    }))
    .filter(row => row.brand && row.materialKey)
}

function loadSeriesStatusRows(filePath: string | null): SeriesStatusRow[] {
  return parseCsvFile(filePath)
    .map(row => ({
      seriesName: normalizeReadableText(row.series_name),
      brandName: normalizeReadableText(row.primary_brand_name),
      edpCount: Number(row.edp_count ?? 0) || 0,
      materialTags: parseJsonCell<string[]>(row.material_tags, [])
        .map(value => normalizeReadableText(value).toUpperCase())
        .filter(Boolean),
      workPieceNames: parseJsonCell<string[]>(row.material_work_piece_names, [])
        .map(value => normalizeReadableText(value))
        .filter(Boolean),
      workPieceStatuses: parseJsonCell<Array<{
        tag_name?: string
        work_piece_name?: string
        material_rating?: string
        material_rating_score?: number
      }>>(row.work_piece_statuses, []),
    }))
    .filter(row => row.seriesName && row.brandName)
}

function gatherBrandHintsForFamily(
  cache: MaterialMappingCache,
  family: string,
  lv1Iso: string | null,
  variants: string[],
): { brandHints: string[]; seriesHints: string[] } {
  const variantKeys = new Set(variants.map(variant => normalizeFamilyKey(variant)))
  const brandScores = new Map<string, number>()
  const seriesScores = new Map<string, number>()

  if (lv1Iso) {
    for (const row of cache.brandAffinityRows) {
      if (row.materialKey !== lv1Iso) continue
      const baseScore = row.ratingScore > 0 ? row.ratingScore : 0.25
      brandScores.set(row.brand, Math.max(brandScores.get(row.brand) ?? 0, baseScore + (row.notes ? 0.05 : 0)))
    }
  }

  for (const row of cache.seriesStatusRows) {
    let score = 0
    if (lv1Iso && row.materialTags.includes(lv1Iso)) score += 1.5

    for (const workPieceName of row.workPieceNames) {
      if (variantKeys.has(normalizeFamilyKey(workPieceName))) score += 2.5
    }

    for (const status of row.workPieceStatuses) {
      const tag = normalizeReadableText(status.tag_name ?? "").toUpperCase()
      const workPieceName = normalizeReadableText(status.work_piece_name ?? "")
      const rating = normalizeReadableText(status.material_rating ?? "").toUpperCase()
      const ratingScore = Number(status.material_rating_score ?? 0) || 0

      if (lv1Iso && tag === lv1Iso) score += 0.75
      if (workPieceName && variantKeys.has(normalizeFamilyKey(workPieceName))) score += 2
      if (rating === "EXCELLENT") score += 1.5
      else if (rating === "GOOD") score += 1
      score += Math.min(ratingScore, 3) * 0.2
    }

    if (score <= 0) continue
    score += Math.min(row.edpCount, 200) / 200
    brandScores.set(row.brandName, Math.max(brandScores.get(row.brandName) ?? 0, score))
    seriesScores.set(row.seriesName, Math.max(seriesScores.get(row.seriesName) ?? 0, score))
  }

  const brandHints = [...brandScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([brand]) => brand)
  const seriesHints = [...seriesScores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([series]) => series)

  return { brandHints, seriesHints }
}

function buildKnowledgeEntries(rows: MaterialMappingCsvRow[], cache: Pick<MaterialMappingCache, "brandAffinityRows" | "seriesStatusRows">): {
  entries: MaterialKnowledgeEntry[]
  knowledgeByFamily: Map<string, MaterialKnowledgeEntry>
} {
  const grouped = new Map<string, {
    canonicalFamily: string
    lv1Iso: string | null
    lv2Counts: Map<string, number>
    lv3Counts: Map<string, number>
    descriptions: string[]
    compositions: string[]
    aliases: Set<string>
    strengthSignals: Set<string>
  }>()

  for (const row of rows) {
    const canonicalFamily = inferCanonicalFamily(row)
    if (!canonicalFamily) continue
    const familyKey = normalizeFamilyKey(canonicalFamily)
    const bucket = grouped.get(familyKey) ?? {
      canonicalFamily,
      lv1Iso: toNonEmptyString(row.LV1_ISO)?.toUpperCase() ?? null,
      lv2Counts: new Map<string, number>(),
      lv3Counts: new Map<string, number>(),
      descriptions: [],
      compositions: [],
      aliases: new Set<string>(),
      strengthSignals: new Set<string>(),
    }

    if (row.LV2_Category) {
      bucket.lv2Counts.set(row.LV2_Category, (bucket.lv2Counts.get(row.LV2_Category) ?? 0) + 1)
    }
    if (row.LV3_Category) {
      bucket.lv3Counts.set(row.LV3_Category, (bucket.lv3Counts.get(row.LV3_Category) ?? 0) + 1)
    }
    if (row.Material_Description) bucket.descriptions.push(row.Material_Description)
    if (row.Composition_Heat_Treatment) bucket.compositions.push(row.Composition_Heat_Treatment)
    for (const signal of buildStrengthSignals(row)) bucket.strengthSignals.add(signal)
    for (const column of MATERIAL_MAPPING_ALIAS_COLUMNS) {
      for (const alias of splitAliasValue(row[column])) {
        const normalized = normalizeReadableText(alias)
        if (normalized) bucket.aliases.add(normalized)
      }
    }

    grouped.set(familyKey, bucket)
  }

  const familyVariants = buildFamilyVariants(rows)
  const fullCache = {
    brandAffinityRows: cache.brandAffinityRows,
    seriesStatusRows: cache.seriesStatusRows,
    rows,
    aliasIndex: new Map<string, MaterialAliasEntry[]>(),
    aliasEntries: [],
    familyVariants,
    familyByIso: new Map<string, string>(),
    knowledgeEntries: [],
    knowledgeByFamily: new Map<string, MaterialKnowledgeEntry>(),
    materialPath: null,
    brandAffinityPath: null,
    seriesProfilePath: null,
  } satisfies MaterialMappingCache

  const entries = [...grouped.entries()]
    .map(([familyKey, group]): MaterialKnowledgeEntry => {
      const lv2Category = [...group.lv2Counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
      const lv3Category = [...group.lv3Counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
      const variants = familyVariants.get(familyKey) ?? [group.canonicalFamily]
      const hints = gatherBrandHintsForFamily(fullCache, group.canonicalFamily, group.lv1Iso, variants)

      return {
        canonicalFamily: group.canonicalFamily,
        lv1Iso: group.lv1Iso,
        lv2Category,
        lv3Category,
        materialDescription: uniqueStrings(group.descriptions).slice(0, 3).join("; ") || null,
        compositionHeatTreatment: uniqueStrings(group.compositions).slice(0, 3).join("; ") || null,
        aliases: uniqueStrings([...group.aliases]).sort((left, right) => right.length - left.length),
        strengthSignals: uniqueStrings([...group.strengthSignals]),
        brandHints: hints.brandHints,
        seriesHints: hints.seriesHints,
      }
    })
    .sort((left, right) => left.canonicalFamily?.localeCompare(right.canonicalFamily ?? "") ?? 0)

  const knowledgeByFamily = new Map(entries
    .filter(entry => entry.canonicalFamily)
    .map(entry => [normalizeFamilyKey(entry.canonicalFamily), entry] as const))

  return { entries, knowledgeByFamily }
}

function resolveFamilyFromIsoTag(iso: string | null | undefined, cache: MaterialMappingCache): string | null {
  const normalizedIso = normalizeReadableText(iso ?? "").toUpperCase()
  if (!normalizedIso) return null
  return cache.familyByIso.get(normalizedIso) ?? null
}

export function resolveMaterialFamilyName(raw: string): string | null {
  const match = lookupMaterialFamily(raw)
  if (match?.canonicalFamily) return match.canonicalFamily
  if (match?.lv1Iso) {
    return resolveFamilyFromIsoTag(match.lv1Iso, getMaterialMappingCache())
  }
  return null
}

export function resolveCatalogMaterialFamilyName(raw: string): string | null {
  const family = resolveMaterialFamilyName(raw)
  if (!family) return null
  return CATALOG_FAMILY_NAME_MAP.get(normalizeFamilyKey(family)) ?? family
}

export function resolveMaterialIsoTagForFamily(raw: string): string | null {
  const text = normalizeReadableText(raw)
  if (!text) return null

  const cache = getMaterialMappingCache()
  const family = resolveMaterialFamilyName(text) ?? text
  const knowledge = cache.knowledgeByFamily.get(normalizeFamilyKey(family))
  if (knowledge?.lv1Iso) return knowledge.lv1Iso

  const inferredMatch = lookupMaterialFamily(text)
  if (inferredMatch?.lv1Iso) return inferredMatch.lv1Iso

  return null
}

function buildMaterialMappingCache(): MaterialMappingCache {
  const { materialPath, rows } = loadMaterialMappingRowsWithSource()
  const brandAffinityPath = resolveBrandAffinityCsvPath()
  const seriesProfilePath = resolveSeriesProfileCsvPath()
  const brandAffinityRows = loadBrandAffinityRows(brandAffinityPath)
  const seriesStatusRows = loadSeriesStatusRows(seriesProfilePath)
  const { aliasIndex, aliasEntries } = buildAliasEntries(rows)
  const { entries: knowledgeEntries, knowledgeByFamily } = buildKnowledgeEntries(rows, {
    brandAffinityRows,
    seriesStatusRows,
  })
  const familyVariants = buildFamilyVariants(rows)
  const familyByIso = buildFamilyIsoIndex(knowledgeEntries)

  return {
    materialPath,
    brandAffinityPath,
    seriesProfilePath,
    rows,
    aliasIndex,
    aliasEntries,
    knowledgeEntries,
    knowledgeByFamily,
    familyVariants,
    familyByIso,
    brandAffinityRows,
    seriesStatusRows,
  }
}

function getMaterialMappingCache(): MaterialMappingCache {
  const materialPath = resolveMaterialMappingSourceId()
  const brandAffinityPath = resolveBrandAffinityCsvPath()
  const seriesProfilePath = resolveSeriesProfileCsvPath()

  if (
    materialMappingCache
    && materialMappingCache.materialPath === materialPath
    && materialMappingCache.brandAffinityPath === brandAffinityPath
    && materialMappingCache.seriesProfilePath === seriesProfilePath
  ) {
    return materialMappingCache
  }

  materialMappingCache = buildMaterialMappingCache()
  return materialMappingCache
}

export function loadMaterialMappingCsv(): MaterialMappingCsvRow[] {
  return [...getMaterialMappingCache().rows]
}

export function lookupMaterialFamily(raw: string): MaterialAliasMatch | null {
  const text = normalizeReadableText(raw)
  if (!text) return null

  const cache = getMaterialMappingCache()
  return (
    lookupExactAlias(text, cache)
    ?? lookupAliasInFreeText(text, cache)
    ?? inferFamilyFromDescription(text, cache)
  )
}

export function normalizeMaterialAlias(raw: string): MaterialAliasMatch {
  return lookupMaterialFamily(raw) ?? {
    raw,
    canonicalFamily: null,
    lv1Iso: null,
    lv2Category: null,
    lv3Category: null,
    matchedAlias: null,
    sourceColumn: null,
    confidence: 0,
  }
}

export function buildMaterialKnowledgeIndex(): MaterialKnowledgeEntry[] {
  return [...getMaterialMappingCache().knowledgeEntries]
}

export function buildMaterialPromptHints(limit = 6): string {
  const entries = buildMaterialKnowledgeIndex()
    .filter(entry => entry.canonicalFamily && entry.lv1Iso)
    .sort((left, right) => {
      const aliasDelta = (right.aliases.length - left.aliases.length)
      if (aliasDelta !== 0) return aliasDelta
      return (left.canonicalFamily ?? "").localeCompare(right.canonicalFamily ?? "")
    })
    .slice(0, Math.max(1, limit))

  return entries
    .map(entry => {
      const aliasSample = entry.aliases.slice(0, 4).join(", ")
      const signalSample = entry.strengthSignals.slice(0, 3).join(", ")
      const brandSample = entry.brandHints.slice(0, 3).join(", ")
      const seriesSample = entry.seriesHints.slice(0, 3).join(", ")
      return [
        `- ${entry.canonicalFamily} | ISO ${entry.lv1Iso} | LV2 ${entry.lv2Category ?? "unknown"}`,
        aliasSample ? `aliases: ${aliasSample}` : null,
        signalSample ? `signals: ${signalSample}` : null,
        brandSample ? `brand hints: ${brandSample}` : null,
        seriesSample ? `series hints: ${seriesSample}` : null,
      ].filter(Boolean).join(" | ")
    })
    .join("\n")
}

export function buildScopedMaterialPromptHints(raw: string, limit = 4): string {
  const match = lookupMaterialFamily(raw)
  const familyName = match?.canonicalFamily ?? (match?.lv1Iso ? resolveFamilyFromIsoTag(match.lv1Iso, getMaterialMappingCache()) : null)
  const hints = findBrandSeriesHintsForMaterial(raw)
  const lines: string[] = []

  if (familyName) {
    lines.push(
      [
        `detected family: ${familyName}`,
        match?.lv1Iso ? `ISO ${match.lv1Iso}` : null,
        match?.lv2Category ? `LV2 ${match.lv2Category}` : null,
        match?.matchedAlias ? `alias ${match.matchedAlias}` : null,
        match?.sourceColumn ? `source ${match.sourceColumn}` : null,
        `confidence ${(match?.confidence ?? 0).toFixed(2)}`,
      ].filter(Boolean).join(" | ")
    )
  }

  if (hints.brandHints.length > 0 || hints.seriesHints.length > 0) {
    lines.push(
      [
        hints.brandHints.length > 0 ? `brand hints: ${hints.brandHints.slice(0, limit).join(", ")}` : null,
        hints.seriesHints.length > 0 ? `series hints: ${hints.seriesHints.slice(0, limit).join(", ")}` : null,
        `hint confidence ${hints.confidence.toFixed(2)}`,
      ].filter(Boolean).join(" | ")
    )
  }

  if (lines.length === 0) {
    const generic = buildMaterialPromptHints(limit)
    return generic ? generic.split("\n").slice(0, limit).join("\n") : ""
  }

  return lines.join("\n")
}

export function findBrandSeriesHintsForMaterial(raw: string): {
  brandHints: string[]
  seriesHints: string[]
  confidence: number
} {
  const cache = getMaterialMappingCache()
  const match = lookupMaterialFamily(raw)
  const family = match?.canonicalFamily ?? (match?.lv1Iso ? resolveFamilyFromIsoTag(match.lv1Iso, cache) : null)
  if (!family) {
    return { brandHints: [], seriesHints: [], confidence: 0 }
  }

  const variants = cache.familyVariants.get(normalizeFamilyKey(family)) ?? [family]
  const hints = gatherBrandHintsForFamily(cache, family, match?.lv1Iso ?? resolveMaterialIsoTagForFamily(family), variants)
  const confidence = Math.min(
    0.98,
    Math.max(
      0,
      (match?.confidence ?? 0.45) * (
        hints.brandHints.length > 0 || hints.seriesHints.length > 0
          ? 1
          : 0.6
      ),
    ),
  )

  return {
    brandHints: hints.brandHints,
    seriesHints: hints.seriesHints,
    confidence,
  }
}

export function _resetMaterialMappingCacheForTest(): void {
  materialMappingCache = null
  materialMappingPathOverride = null
  brandAffinityPathOverride = null
  seriesProfilePathOverride = null
}

export function _setMaterialMappingTestPaths(paths: {
  materialPath?: string | null
  brandAffinityPath?: string | null
  seriesProfilePath?: string | null
}): void {
  materialMappingPathOverride = paths.materialPath ?? null
  brandAffinityPathOverride = paths.brandAffinityPath ?? null
  seriesProfilePathOverride = paths.seriesProfilePath ?? null
  materialMappingCache = null
}
