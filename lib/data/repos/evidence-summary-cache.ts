/**
 * Evidence Summary Cache
 *
 * Lazily memoized aggregation on top of EvidenceRepo.getAll().
 * Builds per-series × per-ISO condition ranges (Vc / RPM / fz / Feed / ap / ae)
 * so downstream consumers (LLM prompt pack, filter registry) can:
 *   - look up a series' recommended condition ranges
 *   - discover which series satisfy a numeric condition (e.g. RPM ≥ 5000)
 * without re-scanning 13k+ chunks on every request.
 */

import { EvidenceRepo } from "./evidence-repo"
import type { ConditionRange, EvidenceChunk } from "@/lib/types/evidence"

export type ConditionField = "vc" | "rpm" | "fz" | "feed" | "ap" | "ae"

export interface SeriesIsoAggregate {
  seriesName: string
  normalizedSeries: string
  isoGroup: string
  vc: ConditionRange | null
  rpm: ConditionRange | null
  fz: ConditionRange | null
  feed: ConditionRange | null
  ap: ConditionRange | null
  ae: ConditionRange | null
  count: number
}

export interface SeriesSummary {
  seriesName: string
  normalizedSeries: string
  byIso: Map<string, SeriesIsoAggregate>
}

export interface ConditionFilter {
  field: ConditionField
  op: "gte" | "lte" | "eq" | "between"
  value: number
  value2?: number
  isoGroup?: string | null
}

declare global {
  // eslint-disable-next-line no-var
  var __yg1EvidenceSummaryPromise: Promise<Map<string, SeriesSummary>> | undefined
}

function normalizeCode(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[\s-]/g, "").trim()
}

function parseLeadingNumber(value: string | null | undefined): number | null {
  if (!value) return null
  const match = String(value).match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const n = Number.parseFloat(match[0])
  return Number.isFinite(n) ? n : null
}

function aggregateRange(values: (string | null | undefined)[]): ConditionRange | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let count = 0
  for (const v of values) {
    const n = parseLeadingNumber(v)
    if (n == null || n <= 0) continue
    if (n < min) min = n
    if (n > max) max = n
    count++
  }
  if (count === 0) return null
  return { min, max, count }
}

function matchCondition(agg: SeriesIsoAggregate, f: ConditionFilter): boolean {
  const r = agg[f.field]
  if (!r) return false
  switch (f.op) {
    case "gte":
      return r.max >= f.value
    case "lte":
      return r.min <= f.value
    case "eq":
      return r.min <= f.value && r.max >= f.value
    case "between": {
      const hi = f.value2 ?? f.value
      const lo = Math.min(f.value, hi)
      const up = Math.max(f.value, hi)
      return r.min <= up && r.max >= lo
    }
  }
}

function formatRange(r: ConditionRange): string {
  return r.min === r.max ? `${r.min}` : `${r.min}~${r.max}`
}

async function buildIndex(): Promise<Map<string, SeriesSummary>> {
  const chunks = await EvidenceRepo.getAll()
  const map = new Map<string, SeriesSummary>()
  const byKey = new Map<string, EvidenceChunk[]>()

  for (const c of chunks) {
    const name = c.seriesName?.trim()
    if (!name) continue
    const norm = normalizeCode(name)
    const iso = (c.isoGroup ?? "").toUpperCase() || "?"
    const key = `${norm}|${iso}`
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(c)
    if (!map.has(norm)) {
      map.set(norm, { seriesName: name, normalizedSeries: norm, byIso: new Map() })
    }
  }

  for (const [key, list] of byKey) {
    const sep = key.indexOf("|")
    const norm = key.slice(0, sep)
    const iso = key.slice(sep + 1)
    const summary = map.get(norm)
    if (!summary) continue
    summary.byIso.set(iso, {
      seriesName: summary.seriesName,
      normalizedSeries: norm,
      isoGroup: iso,
      vc: aggregateRange(list.map(c => c.conditions.Vc)),
      rpm: aggregateRange(list.map(c => c.conditions.n)),
      fz: aggregateRange(list.map(c => c.conditions.fz)),
      feed: aggregateRange(list.map(c => c.conditions.vf)),
      ap: aggregateRange(list.map(c => c.conditions.ap)),
      ae: aggregateRange(list.map(c => c.conditions.ae)),
      count: list.length,
    })
  }

  console.log(`[evidence-summary] indexed series=${map.size} chunks=${chunks.length}`)
  return map
}

export async function getEvidenceSummaryIndex(): Promise<Map<string, SeriesSummary>> {
  if (!globalThis.__yg1EvidenceSummaryPromise) {
    globalThis.__yg1EvidenceSummaryPromise = buildIndex()
  }
  return globalThis.__yg1EvidenceSummaryPromise
}

export async function getSeriesSummary(seriesName: string): Promise<SeriesIsoAggregate[]> {
  const idx = await getEvidenceSummaryIndex()
  const norm = normalizeCode(seriesName)
  const s = idx.get(norm)
  if (!s) return []
  return Array.from(s.byIso.values()).sort((a, b) => a.isoGroup.localeCompare(b.isoGroup))
}

export async function filterSeriesByCondition(f: ConditionFilter): Promise<string[]> {
  const idx = await getEvidenceSummaryIndex()
  const iso = f.isoGroup ? f.isoGroup.toUpperCase() : null
  const result: string[] = []
  for (const summary of idx.values()) {
    const aggregates = iso
      ? (summary.byIso.has(iso) ? [summary.byIso.get(iso)!] : [])
      : Array.from(summary.byIso.values())
    if (aggregates.some(agg => matchCondition(agg, f))) {
      result.push(summary.seriesName)
    }
  }
  return result
}

/**
 * Compact line-per-series summary for LLM prompt injection.
 * Shape: "GNX98 P:{RPM 1800~51500 Vc 32~360 fz 0.010~0.080} M:{...}"
 * Only writes non-null fields; omits series with no numeric data.
 */
export async function buildCompactSummaryForPrompt(opts?: {
  seriesFilter?: string[]
  maxSeries?: number
  fields?: ConditionField[]
}): Promise<string> {
  const idx = await getEvidenceSummaryIndex()
  const fields = opts?.fields ?? (["rpm", "vc", "fz", "feed"] as ConditionField[])
  const fieldLabels: Record<ConditionField, string> = {
    vc: "Vc",
    rpm: "RPM",
    fz: "fz",
    feed: "Feed",
    ap: "ap",
    ae: "ae",
  }
  const filterSet = opts?.seriesFilter
    ? new Set(opts.seriesFilter.map(normalizeCode))
    : null
  const entries = Array.from(idx.values())
    .filter(s => (filterSet ? filterSet.has(s.normalizedSeries) : true))
    .sort((a, b) => a.seriesName.localeCompare(b.seriesName))
  const sliced = opts?.maxSeries ? entries.slice(0, opts.maxSeries) : entries

  const lines: string[] = []
  for (const s of sliced) {
    const segs: string[] = []
    const isos = Array.from(s.byIso.entries()).sort(([a], [b]) => a.localeCompare(b))
    for (const [iso, agg] of isos) {
      const parts: string[] = []
      for (const f of fields) {
        const r = agg[f]
        if (r) parts.push(`${fieldLabels[f]} ${formatRange(r)}`)
      }
      if (parts.length > 0) segs.push(`${iso}:{${parts.join(" ")}}`)
    }
    if (segs.length > 0) lines.push(`${s.seriesName} ${segs.join(" ")}`)
  }
  return lines.join("\n")
}

export function __resetEvidenceSummaryCacheForTests(): void {
  globalThis.__yg1EvidenceSummaryPromise = undefined
}
