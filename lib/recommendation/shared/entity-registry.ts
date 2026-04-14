import seriesKnowledgeRaw from "@/data/series-knowledge.json"
import { getDbSchemaSync } from "@/lib/recommendation/core/sql-agent-schema-cache"
import {
  normalizeIdentifierLookupKey,
  stripIdentifierDescriptorSuffix,
  tokenizeIdentifierWords,
  IDENTIFIER_DESCRIPTOR_STOPWORDS,
} from "@/lib/recommendation/shared/canonical-values"

export type RegistryEntityField = "brand" | "series"

type SeriesKnowledgeEntry = {
  brand?: string
  series?: string
}

type KnownEntityRegistry = {
  aliasToCanonical: Map<string, string>
  canonicalValues: string[]
}

type EntityRegistryCache = {
  schemaVersion: number
  brand: KnownEntityRegistry
  series: KnownEntityRegistry
}

const seriesKnowledge = seriesKnowledgeRaw as SeriesKnowledgeEntry[]

let entityRegistryCache: EntityRegistryCache | null = null

function shouldRetainAlias(rawValue: string): boolean {
  const raw = String(rawValue ?? "").trim()
  if (!raw) return false

  const normalized = normalizeIdentifierLookupKey(raw)
  if (!normalized) return false
  if (normalized.length >= 4) return true
  if (/\d/.test(normalized)) return true
  if (/[+\-/.&\s]/.test(raw)) return true
  return false
}

function addAliasValue(
  aliases: Map<string, string>,
  canonicalValues: Map<string, string>,
  canonicalValue: string,
  rawAlias: string | null | undefined,
): void {
  const canonical = String(canonicalValue ?? "").trim()
  const alias = String(rawAlias ?? "").trim()
  if (!canonical || !alias || !shouldRetainAlias(alias)) return

  const canonicalKey = normalizeIdentifierLookupKey(canonical)
  const aliasKey = normalizeIdentifierLookupKey(alias)
  if (!canonicalKey || !aliasKey) return

  if (!canonicalValues.has(canonicalKey)) {
    canonicalValues.set(canonicalKey, canonical)
  }
  if (!aliases.has(aliasKey)) {
    aliases.set(aliasKey, canonicalValues.get(canonicalKey) ?? canonical)
  }
}

function buildRegistry(entries: Array<{ canonical: string; aliases: string[] }>): KnownEntityRegistry {
  const aliasToCanonical = new Map<string, string>()
  const canonicalValues = new Map<string, string>()

  for (const entry of entries) {
    addAliasValue(aliasToCanonical, canonicalValues, entry.canonical, entry.canonical)
    for (const alias of entry.aliases) {
      addAliasValue(aliasToCanonical, canonicalValues, entry.canonical, alias)
    }
  }

  return {
    aliasToCanonical,
    canonicalValues: [...canonicalValues.values()],
  }
}

function buildEntityRegistry(): EntityRegistryCache {
  const schema = getDbSchemaSync()
  const brandEntries = new Map<string, Set<string>>()
  const seriesEntries = new Map<string, Set<string>>()

  const ensureEntry = (target: Map<string, Set<string>>, canonicalValue: string): Set<string> => {
    const canonical = String(canonicalValue ?? "").trim()
    if (!canonical) return new Set<string>()
    const key = normalizeIdentifierLookupKey(canonical)
    const existing = target.get(key)
    if (existing) return existing
    const created = new Set<string>([canonical])
    target.set(key, created)
    return created
  }

  for (const entry of seriesKnowledge) {
    const brand = String(entry.brand ?? "").trim()
    const series = String(entry.series ?? "").trim()

    if (brand) {
      ensureEntry(brandEntries, brand).add(brand)
      ensureEntry(brandEntries, brand).add(stripIdentifierDescriptorSuffix(brand))
    }

    if (series) {
      ensureEntry(seriesEntries, series).add(series)
      ensureEntry(seriesEntries, series).add(stripIdentifierDescriptorSuffix(series))
    }
  }

  for (const brand of schema?.brands ?? []) {
    const entry = ensureEntry(brandEntries, brand)
    entry.add(brand)
    entry.add(stripIdentifierDescriptorSuffix(brand))
  }

  const brandRegistry = buildRegistry(
    [...brandEntries.values()].map(aliases => {
      const values = [...aliases].filter(Boolean)
      return { canonical: values[0] ?? "", aliases: values }
    }),
  )

  const seriesRegistry = buildRegistry(
    [...seriesEntries.values()].map(aliases => {
      const values = [...aliases].filter(Boolean)
      return { canonical: values[0] ?? "", aliases: values }
    }),
  )

  return {
    schemaVersion: schema?.loadedAt ?? 0,
    brand: brandRegistry,
    series: seriesRegistry,
  }
}

function getEntityRegistryCache(): EntityRegistryCache {
  const schemaVersion = getDbSchemaSync()?.loadedAt ?? 0
  if (!entityRegistryCache || entityRegistryCache.schemaVersion !== schemaVersion) {
    entityRegistryCache = buildEntityRegistry()
  }
  return entityRegistryCache
}

function collectPhraseCandidates(text: string, maxTokens = 5): string[] {
  const tokens = Array.from(String(text ?? "").matchAll(/[A-Za-z0-9][A-Za-z0-9&.+/-]*/g)).map(match => match[0])
  const candidates = new Set<string>()

  for (let index = 0; index < tokens.length; index += 1) {
    let phrase = ""
    for (let width = 0; width < maxTokens && index + width < tokens.length; width += 1) {
      phrase = phrase ? `${phrase} ${tokens[index + width]}` : tokens[index + width]
      candidates.add(phrase)
    }
  }

  return [...candidates]
}

function dedupeCanonicalValues(values: string[]): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []

  for (const value of values) {
    const key = normalizeIdentifierLookupKey(value)
    if (!key || seen.has(key)) continue
    if (deduped.some(existing => normalizeIdentifierLookupKey(existing).includes(key))) continue
    seen.add(key)
    deduped.push(value)
  }

  return deduped
}

function isUppercaseIdentifierStyle(value: string): boolean {
  const lettersOnly = String(value ?? "").replace(/[^A-Za-z]+/g, "")
  return lettersOnly.length > 0 && lettersOnly === lettersOnly.toUpperCase()
}

function shouldPreserveMatchedInput(rawValue: string, canonicalValue: string): boolean {
  if (!rawValue || !canonicalValue) return false
  if (normalizeIdentifierLookupKey(rawValue) !== normalizeIdentifierLookupKey(canonicalValue)) return false
  return isUppercaseIdentifierStyle(rawValue)
}

export function getKnownEntityValues(field: RegistryEntityField): string[] {
  return getEntityRegistryCache()[field].canonicalValues
}

export function canonicalizeKnownEntityValue(field: RegistryEntityField, rawValue: string | null | undefined): string | null {
  const trimmed = String(rawValue ?? "").trim()
  if (!trimmed) return null

  const registry = getEntityRegistryCache()[field]
  const exact = registry.aliasToCanonical.get(normalizeIdentifierLookupKey(trimmed))
  if (exact) return shouldPreserveMatchedInput(trimmed, exact) ? trimmed : exact

  const stripped = stripIdentifierDescriptorSuffix(trimmed)
  const strippedExact = registry.aliasToCanonical.get(normalizeIdentifierLookupKey(stripped))
  if (strippedExact) return shouldPreserveMatchedInput(stripped, strippedExact) ? stripped : strippedExact

  if (field === "brand") {
    const rawTokens = tokenizeIdentifierWords(trimmed)
    for (const brand of registry.canonicalValues) {
      const brandTokens = tokenizeIdentifierWords(brand)
      if (brandTokens.length === 0 || brandTokens.length >= rawTokens.length) continue
      if (!brandTokens.every((token, index) => rawTokens[index] === token)) continue
      const suffixTokens = rawTokens.slice(brandTokens.length)
      if (suffixTokens.length > 0 && suffixTokens.every(token => IDENTIFIER_DESCRIPTOR_STOPWORDS.has(token))) {
        return brand
      }
    }
  }

  return stripped || trimmed
}

export function findKnownEntityMentions(field: RegistryEntityField, text: string): string[] {
  const registry = getEntityRegistryCache()[field]
  const candidates = collectPhraseCandidates(text)
  const hits: Array<{ value: string; score: number }> = []

  for (const candidate of candidates) {
    const normalized = normalizeIdentifierLookupKey(candidate)
    if (!normalized) continue
    const value = registry.aliasToCanonical.get(normalized)
    if (!value) continue
    hits.push({ value, score: normalized.length })
  }

  return dedupeCanonicalValues(
    hits
      .sort((left, right) => right.score - left.score || left.value.localeCompare(right.value))
      .map(hit => hit.value),
  )
}

export function isKnownEntityValue(field: RegistryEntityField, rawValue: string | null | undefined): boolean {
  const canonical = canonicalizeKnownEntityValue(field, rawValue)
  if (!canonical) return false
  return getEntityRegistryCache()[field].aliasToCanonical.has(normalizeIdentifierLookupKey(canonical))
}

export function _resetEntityRegistryForTest(): void {
  entityRegistryCache = null
}
