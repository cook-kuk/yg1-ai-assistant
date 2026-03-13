#!/usr/bin/env node
/**
 * build-evidence-corpus.mjs
 *
 * Reads raw CSV files (yg1_4G_mill_extracted.csv, yg1_alu_cut_extracted.csv)
 * and produces data/normalized/evidence-chunks.json
 *
 * Each row becomes one EvidenceChunk with cutting condition data.
 * ~5,200 chunks total.
 */

import { readFileSync, writeFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createHash } from "crypto"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")

// ── CSV Parser (handles quoted fields with commas) ──────────
function parseCSV(text) {
  const lines = []
  let current = ""
  let inQuote = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuote = !inQuote
      }
    } else if (ch === "," && !inQuote) {
      lines.push(current)
      current = ""
    } else if ((ch === "\n" || ch === "\r") && !inQuote) {
      if (ch === "\r" && text[i + 1] === "\n") i++ // skip \r\n
      lines.push(current)
      current = ""
      // Mark row boundary
      lines.push("\n")
    } else {
      current += ch
    }
  }
  if (current) lines.push(current)

  // Split into rows by newline markers
  const rows = []
  let row = []
  for (const token of lines) {
    if (token === "\n") {
      if (row.length > 0) rows.push(row)
      row = []
    } else {
      row.push(token.trim())
    }
  }
  if (row.length > 0) rows.push(row)

  return rows
}

function parseCSVFile(filePath) {
  const text = readFileSync(filePath, "utf-8")
  const rows = parseCSV(text)
  if (rows.length < 2) return []

  const headers = rows[0].map(h => h.trim())
  const data = []

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (row.length < 5) continue // skip empty/malformed rows

    const obj = {}
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = j < row.length ? row[j] : ""
    }
    data.push(obj)
  }

  return data
}

// ── Normalize product code ──────────────────────────────────
function normalizeCode(code) {
  if (!code) return ""
  return code.toUpperCase().replace(/[\s\-]/g, "").trim()
}

// ── Parse numeric value from string ─────────────────────────
function parseNum(val) {
  if (!val || val === "") return null
  const n = parseFloat(val)
  return isNaN(n) ? null : n
}

// ── Generate stable hash ID ─────────────────────────────────
function makeId(source, code, iso, cuttingType, diameter) {
  const key = `${source}|${code}|${iso}|${cuttingType}|${diameter}`
  return "ev-" + createHash("md5").update(key).digest("hex").slice(0, 12)
}

// ── Build search text for lexical matching ──────────────────
function buildSearchText(row, sourceLabel) {
  const parts = [
    row.product_code,
    row.series_name,
    row.product_name,
    row.tool_type,
    row.tool_subtype,
    row.cutting_type,
    row.iso_group,
    row.coating,
    row.tool_material,
    row.material_targets_raw,
    row.iso_detail_reason,
    row.page_title,
    sourceLabel,
  ].filter(Boolean)
  return parts.join(" ").toLowerCase()
}

// ── Main ────────────────────────────────────────────────────
function main() {
  const files = [
    {
      path: resolve(ROOT, "data/raw/yg1_4G_mill_extracted.csv"),
      sourceLabel: "yg1_4G_mill",
    },
    {
      path: resolve(ROOT, "data/raw/yg1_alu_cut_extracted.csv"),
      sourceLabel: "yg1_alu_cut",
    },
  ]

  const chunks = []
  const seen = new Set()

  for (const { path: filePath, sourceLabel } of files) {
    console.log(`Reading: ${filePath}`)
    let rows
    try {
      rows = parseCSVFile(filePath)
    } catch (e) {
      console.error(`  Failed to read: ${e.message}`)
      continue
    }
    console.log(`  Parsed ${rows.length} rows`)

    for (const row of rows) {
      const productCode = normalizeCode(row.product_code)
      if (!productCode) continue

      const isoGroup = (row.iso_group || "").trim().toUpperCase() || null
      const cuttingType = (row.cutting_type || "").trim() || null
      const diameterMm = parseNum(row.cutting_diameter_mm)
      const confidence = parseNum(row.confidence) ?? 0.5

      const id = makeId(sourceLabel, productCode, isoGroup, cuttingType, diameterMm)

      // Deduplicate
      if (seen.has(id)) continue
      seen.add(id)

      const chunk = {
        id,
        productCode,
        seriesName: (row.series_name || "").trim() || null,
        toolType: (row.tool_type || "").trim() || null,
        toolSubtype: (row.tool_subtype || "").trim() || null,
        cuttingType,
        isoGroup,
        diameterMm,
        conditions: {
          Vc: (row.Vc || "").trim() || null,
          n: (row.n || "").trim() || null,
          fz: (row.fz || "").trim() || null,
          vf: (row.vf || "").trim() || null,
          ap: (row.ap || "").trim() || null,
          ae: (row.ae || "").trim() || null,
        },
        coating: (row.coating || "").trim() || null,
        toolMaterial: (row.tool_material || "").trim() || null,
        fluteCount: parseNum(row.flute_count),
        helixAngle: parseNum(row.helix_angle_deg),
        confidence,
        sourceFile: sourceLabel,
        pdfFile: (row.pdf_file || "").trim() || null,
        referencePages: (row.reference_pages || "").trim() || null,
        pageTitle: (row.page_title || "").trim() || null,
        searchText: buildSearchText(row, sourceLabel),
      }

      chunks.push(chunk)
    }
  }

  console.log(`\nTotal evidence chunks: ${chunks.length}`)
  console.log(`  Unique IDs: ${seen.size}`)

  // Stats
  const withVc = chunks.filter(c => c.conditions.Vc).length
  const withFz = chunks.filter(c => c.conditions.fz).length
  const isoGroups = new Map()
  for (const c of chunks) {
    const g = c.isoGroup || "?"
    isoGroups.set(g, (isoGroups.get(g) || 0) + 1)
  }
  console.log(`  With Vc: ${withVc}`)
  console.log(`  With fz: ${withFz}`)
  console.log(`  ISO groups: ${[...isoGroups.entries()].map(([k, v]) => `${k}:${v}`).join(", ")}`)

  // Write output
  const outPath = resolve(ROOT, "data/normalized/evidence-chunks.json")
  writeFileSync(outPath, JSON.stringify(chunks, null, 2), "utf-8")
  console.log(`\nWritten to: ${outPath}`)
}

main()
