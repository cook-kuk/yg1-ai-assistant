#!/usr/bin/env node
/**
 * build-cutting-conditions-from-merged.mjs
 *
 * Reads merged_all_clean.csv (연구소 통합 절삭조건 데이터) and emits
 * data/normalized/evidence-chunks.json — the JSON fallback consumed by
 * lib/data/repos/evidence-repo.ts when DB is unavailable AND the merge
 * layer (DB primary, JSON supplements non-overlapping rows).
 *
 * Source CSV header (18,929 rows, ISO P/M/K/N/S/H ≈ 16,903):
 *   brand, series, flute_count, tool_angle_deg, tool_shape, cutting_type,
 *   iso, hardness_hrc, workpiece, 인선_mm, 유효길이_mm, Vc, Fz, RPM, Feed,
 *   Ap, Ae, n, pdf_file, page, source_catalog
 *
 * Override CSV path via MERGED_CSV env or first CLI arg.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { createHash } from "crypto"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "..")

const DEFAULT_CSV =
  "C:/Users/kuksh/OneDrive/Desktop/Project/yg1-ai-catalog-pdf/merged_all_clean.csv"
const CSV_PATH = process.argv[2] || process.env.MERGED_CSV || DEFAULT_CSV
const OUT_PATH = resolve(ROOT, "data/normalized/evidence-chunks.json")

const ISO_ALLOWED = new Set(["P", "M", "K", "N", "S", "H"])

// ── CSV parser (quoted fields, CRLF) ─────────────────────────
function parseCSV(text) {
  // strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows = []
  let row = []
  let cur = ""
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQ = !inQ
      }
    } else if (ch === "," && !inQ) {
      row.push(cur)
      cur = ""
    } else if ((ch === "\n" || ch === "\r") && !inQ) {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(cur)
      rows.push(row)
      row = []
      cur = ""
    } else {
      cur += ch
    }
  }
  if (cur || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

function normalizeCode(v) {
  return (v ?? "").toString().toUpperCase().replace(/[\s-]/g, "").trim()
}

function cleanText(v) {
  if (v == null) return null
  const t = String(v).trim()
  return t ? t : null
}

function parseNum(v) {
  const t = cleanText(v)
  if (!t) return null
  const n = Number.parseFloat(t)
  return Number.isFinite(n) ? n : null
}

function makeId(source, code, iso, cuttingType, diameter, workpiece, hardness) {
  const key = `${source}|${code}|${iso}|${cuttingType}|${diameter}|${workpiece}|${hardness}`
  return "ev-" + createHash("md5").update(key).digest("hex").slice(0, 12)
}

function buildSearchText(row, sourceLabel) {
  return [
    row.seriesName,
    row.productCode,
    row.toolType,
    row.cuttingType,
    row.isoGroup,
    row.pageTitle, // workpiece
    row.conditions.Vc,
    row.conditions.fz,
    row.conditions.ap,
    row.conditions.ae,
    sourceLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function main() {
  if (!existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`)
    process.exit(1)
  }
  console.log(`Reading: ${CSV_PATH}`)
  const text = readFileSync(CSV_PATH, "utf-8")
  const rows = parseCSV(text)
  if (rows.length < 2) {
    console.error("CSV has no data rows")
    process.exit(1)
  }
  const headers = rows[0].map(h => h.trim())
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]))
  console.log(`  Headers: ${headers.length}`)
  console.log(`  Raw rows: ${rows.length - 1}`)

  const chunks = []
  const seen = new Set()
  let skippedIso = 0
  let skippedNoSeries = 0

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length < 3) continue
    const get = (k) => (idx[k] != null ? r[idx[k]] : undefined)

    const iso = (get("iso") || "").trim().toUpperCase()
    if (!ISO_ALLOWED.has(iso)) {
      skippedIso++
      continue
    }
    const seriesRaw = (get("series") || "").trim()
    if (!seriesRaw) {
      skippedNoSeries++
      continue
    }

    const seriesName = seriesRaw.replace(/\s+/g, " ").toUpperCase()
    const productCode = normalizeCode(seriesRaw)
    const diameterMm = parseNum(get("인선_mm"))
    const cuttingType = cleanText(get("cutting_type")) || cleanText(get("tool_shape"))
    const workpiece = cleanText(get("workpiece"))
    const hardness = cleanText(get("hardness_hrc"))

    const id = makeId(
      "merged_all_clean",
      productCode,
      iso,
      cuttingType || "",
      diameterMm ?? "",
      workpiece || "",
      hardness || ""
    )
    if (seen.has(id)) continue
    seen.add(id)

    const chunk = {
      id,
      productCode,
      seriesName,
      toolType: cleanText(get("tool_shape")),
      toolSubtype: null,
      cuttingType,
      isoGroup: iso,
      diameterMm,
      conditions: {
        Vc: cleanText(get("Vc")),
        n: cleanText(get("RPM")) || cleanText(get("n")),
        fz: cleanText(get("Fz")),
        vf: cleanText(get("Feed")),
        ap: cleanText(get("Ap")),
        ae: cleanText(get("Ae")),
      },
      coating: null,
      toolMaterial: null,
      fluteCount: parseNum(get("flute_count")),
      helixAngle: parseNum(get("tool_angle_deg")),
      confidence: 0.9,
      sourceFile: "merged_all_clean",
      pdfFile: cleanText(get("pdf_file")),
      referencePages: cleanText(get("page")),
      pageTitle: workpiece, // workpiece name lives here (matches EvidenceRepo convention)
      searchText: "",
    }
    chunk.searchText = buildSearchText(chunk, "merged_all_clean")
    chunks.push(chunk)
  }

  // Stats
  const withVc = chunks.filter(c => c.conditions.Vc).length
  const withFz = chunks.filter(c => c.conditions.fz).length
  const isoMap = new Map()
  const seriesSet = new Set()
  for (const c of chunks) {
    isoMap.set(c.isoGroup, (isoMap.get(c.isoGroup) || 0) + 1)
    if (c.seriesName) seriesSet.add(c.seriesName)
  }

  console.log(`\nChunks produced: ${chunks.length}`)
  console.log(`  Skipped (iso not P/M/K/N/S/H): ${skippedIso}`)
  console.log(`  Skipped (no series): ${skippedNoSeries}`)
  console.log(`  Unique series: ${seriesSet.size}`)
  console.log(`  With Vc: ${withVc}`)
  console.log(`  With Fz: ${withFz}`)
  console.log(`  ISO groups: ${[...isoMap.entries()].map(([k, v]) => `${k}:${v}`).join(", ")}`)

  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(chunks), "utf-8")
  console.log(`\nWritten: ${OUT_PATH} (${(JSON.stringify(chunks).length / 1024 / 1024).toFixed(2)} MB)`)
}

main()
