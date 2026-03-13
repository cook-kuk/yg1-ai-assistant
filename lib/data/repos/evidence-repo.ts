/**
 * Evidence Repository
 * Loads evidence-chunks.json, provides query interface for cutting conditions.
 * Never generates data — only serves what build-evidence-corpus.mjs produced.
 */

import type { EvidenceChunk, EvidenceSummary } from "@/lib/types/evidence"
import path from "path"
import fs from "fs"

let _cache: EvidenceChunk[] | null = null

function loadChunks(): EvidenceChunk[] {
  if (_cache) return _cache
  const filePath = path.join(process.cwd(), "data", "normalized", "evidence-chunks.json")
  if (!fs.existsSync(filePath)) {
    console.warn("[EvidenceRepo] evidence-chunks.json not found — run: node scripts/build-evidence-corpus.mjs")
    return []
  }
  _cache = JSON.parse(fs.readFileSync(filePath, "utf-8")) as EvidenceChunk[]
  return _cache
}

export const EvidenceRepo = {
  /** All evidence chunks */
  getAll(): EvidenceChunk[] {
    return loadChunks()
  },

  /** Find evidence by exact normalized product code */
  findByProductCode(code: string): EvidenceChunk[] {
    const norm = code.replace(/[\s\-]/g, "").toUpperCase()
    return loadChunks().filter(c => c.productCode === norm)
  },

  /** Find evidence by series name (partial match) */
  findBySeriesName(series: string): EvidenceChunk[] {
    const q = series.toLowerCase()
    return loadChunks().filter(c =>
      c.seriesName?.toLowerCase().includes(q)
    )
  },

  /** Filter by combination of conditions */
  filterByConditions(opts: {
    isoGroup?: string | null
    cuttingType?: string | null
    diameterMm?: number | null
    toleranceMm?: number
  }): EvidenceChunk[] {
    let results = loadChunks()

    if (opts.isoGroup) {
      const g = opts.isoGroup.toUpperCase()
      results = results.filter(c =>
        c.isoGroup?.toUpperCase() === g ||
        c.isoGroup?.toUpperCase().includes(g)
      )
    }

    if (opts.cuttingType) {
      const ct = opts.cuttingType.toLowerCase()
      results = results.filter(c =>
        c.cuttingType?.toLowerCase().includes(ct)
      )
    }

    if (opts.diameterMm != null) {
      const tol = opts.toleranceMm ?? 0.5
      results = results.filter(c =>
        c.diameterMm != null && Math.abs(c.diameterMm - opts.diameterMm!) <= tol
      )
    }

    return results
  },

  /** Find evidence for a specific product with optional condition filters */
  findForProduct(
    productCode: string,
    opts?: { isoGroup?: string | null; cuttingType?: string | null; diameterMm?: number | null }
  ): EvidenceChunk[] {
    const norm = productCode.replace(/[\s\-]/g, "").toUpperCase()
    let results = loadChunks().filter(c => c.productCode === norm)

    if (opts?.isoGroup) {
      const g = opts.isoGroup.toUpperCase()
      const filtered = results.filter(c =>
        c.isoGroup?.toUpperCase() === g || c.isoGroup?.toUpperCase().includes(g)
      )
      if (filtered.length > 0) results = filtered
    }

    if (opts?.cuttingType) {
      const ct = opts.cuttingType.toLowerCase()
      const filtered = results.filter(c =>
        c.cuttingType?.toLowerCase().includes(ct)
      )
      if (filtered.length > 0) results = filtered
    }

    if (opts?.diameterMm != null) {
      const filtered = results.filter(c =>
        c.diameterMm != null && Math.abs(c.diameterMm - opts.diameterMm!) <= 0.5
      )
      if (filtered.length > 0) results = filtered
    }

    // Sort by confidence descending
    return results.sort((a, b) => b.confidence - a.confidence)
  },

  /** Simple text search (word-match scoring) */
  searchText(query: string, limit = 50): EvidenceChunk[] {
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1)
    if (words.length === 0) return []

    const chunks = loadChunks()
    const scored: { chunk: EvidenceChunk; score: number }[] = []

    for (const chunk of chunks) {
      let score = 0
      for (const word of words) {
        if (chunk.searchText.includes(word)) score++
      }
      if (score > 0) scored.push({ chunk, score })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit).map(s => s.chunk)
  },

  /** Build evidence summary for a product */
  buildSummary(
    productCode: string,
    opts?: { isoGroup?: string | null; cuttingType?: string | null; diameterMm?: number | null }
  ): EvidenceSummary {
    const chunks = this.findForProduct(productCode, opts)
    const best = chunks.length > 0 ? chunks[0] : null

    return {
      productCode: productCode.replace(/[\s\-]/g, "").toUpperCase(),
      seriesName: best?.seriesName ?? null,
      chunks,
      bestCondition: best?.conditions ?? null,
      bestConfidence: best?.confidence ?? 0,
      sourceCount: chunks.length,
    }
  },

  /** Stats */
  stats() {
    const all = loadChunks()
    const isoGroups = new Map<string, number>()
    for (const c of all) {
      const g = c.isoGroup || "?"
      isoGroups.set(g, (isoGroups.get(g) || 0) + 1)
    }
    return {
      total: all.length,
      withVc: all.filter(c => c.conditions.Vc).length,
      withFz: all.filter(c => c.conditions.fz).length,
      isoGroups: Object.fromEntries(isoGroups),
      uniqueProducts: new Set(all.map(c => c.productCode)).size,
    }
  },
}
