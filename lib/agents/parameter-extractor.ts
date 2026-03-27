/**
 * Parameter Extraction Agent — Haiku
 *
 * Extracts structured parameters from user messages.
 * Deterministic patterns first, Haiku LLM for complex expressions.
 */

import { resolveModel, type LLMProvider } from "@/lib/llm/provider"
import type { ExplorationSessionState } from "@/lib/types/exploration"
import type { ExtractedParameters } from "./types"

const PARAMETER_EXTRACTOR_MODEL = resolveModel("haiku", "parameter-extractor")

/**
 * Extract parameters from user message.
 * Uses deterministic patterns — only calls Haiku if patterns fail but message seems parameter-rich.
 */
export async function extractParameters(
  message: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<ExtractedParameters> {
  const clean = message.trim().toLowerCase()
  const params: ExtractedParameters = { modelUsed: PARAMETER_EXTRACTOR_MODEL }

  // ── Deterministic extraction ──────────────────────────────

  // "(15개)" chip count suffix removal, "— label" removal
  const chipClean = clean.replace(/\s*\(\d+개\)\s*$/, "").replace(/\s*—\s*.+$/, "").trim()

  // Flute count (validated: 1~20)
  const fluteMatch = clean.match(/(\d+)\s*날/)
  if (fluteMatch) {
    const f = parseInt(fluteMatch[1])
    if (f >= 1 && f <= 20) params.fluteCount = f
  }

  // Diameter (validated: 0.1mm ~ 200mm)
  const diamMatch = clean.match(/([\d.]+)\s*mm/)
  if (diamMatch) {
    const d = parseFloat(diamMatch[1])
    if (d > 0 && d <= 200) params.diameterMm = d
  }

  // Coating
  const coatingMap: Record<string, string> = {
    "altin": "AlTiN", "tialn": "TiAlN", "dlc": "DLC",
    "무코팅": "Uncoated", "y-코팅": "Y-Coating", "y코팅": "Y-Coating", "ticn": "TiCN",
  }
  for (const [key, val] of Object.entries(coatingMap)) {
    if (clean.includes(key)) { params.coating = val; break }
  }

  // Tool subtype
  const subtypeMap: Record<string, string> = {
    "square": "Square", "스퀘어": "Square",
    "ball": "Ball", "볼": "Ball",
    "radius": "Radius", "라디우스": "Radius",
    "하이피드": "High-Feed", "high-feed": "High-Feed", "high feed": "High-Feed",
    "황삭": "Roughing", "roughing": "Roughing",
    "테이퍼": "Taper", "taper": "Taper",
  }
  for (const [key, val] of Object.entries(subtypeMap)) {
    if (chipClean.includes(key) || clean.includes(key)) { params.toolSubtype = val; break }
  }

  // Series name
  const seriesMatch = clean.match(/(ce\d+[a-z]*\d*|gnx\d+|sem[a-z]*\d+|e\d+[a-z]\d+)/i)
  if (seriesMatch) params.seriesName = seriesMatch[1].toUpperCase()

  // Product code (more specific)
  const productCodeMatch = clean.match(/^([a-z]{2,4}\d{4,}[a-z]*\d*)/i)
  if (productCodeMatch) params.productCode = productCodeMatch[1].toUpperCase()

  // Comparison targets
  const compareTargets: string[] = []
  const numMatches = clean.matchAll(/(\d+)\s*번/g)
  for (const m of numMatches) compareTargets.push(`${m[1]}번`)
  if (compareTargets.length > 0) params.comparisonTargets = compareTargets

  // Raw value (cleaned chip text)
  params.rawValue = chipClean

  // ── If nothing was extracted deterministically, try Haiku ──
  const hasAnything = params.fluteCount || params.diameterMm || params.coating ||
    params.toolSubtype || params.seriesName || params.productCode
  if (!hasAnything && provider.available() && clean.length > 2) {
    try {
      const haikuResult = await extractWithHaiku(message, sessionState, provider)
      return { ...params, ...haikuResult, modelUsed: PARAMETER_EXTRACTOR_MODEL }
    } catch (e) {
      console.warn("[param-extractor] Haiku extraction failed:", e)
    }
  }

  return params
}

async function extractWithHaiku(
  message: string,
  sessionState: ExplorationSessionState | null,
  provider: LLMProvider
): Promise<Partial<ExtractedParameters>> {
  const lastField = sessionState?.lastAskedField ?? "unknown"

  const systemPrompt = `You extract cutting tool parameters from Korean user messages.
The system just asked about field: "${lastField}".
Extract any relevant values. Respond with JSON only.
{"fluteCount": null, "coating": null, "toolSubtype": null, "seriesName": null, "diameterMm": null, "material": null, "rawValue": "the cleaned value"}`

  const raw = await provider.complete(
    systemPrompt,
    [{ role: "user", content: message }],
    1500,
    PARAMETER_EXTRACTOR_MODEL,
    "parameter-extractor"
  )

  try {
    const parsed = JSON.parse(raw.trim().replace(/```json\n?|\n?```/g, ""))
    const result: Partial<ExtractedParameters> = {}
    if (parsed.fluteCount && Number(parsed.fluteCount) >= 1 && Number(parsed.fluteCount) <= 20) {
      result.fluteCount = Number(parsed.fluteCount)
    }
    if (parsed.coating) result.coating = parsed.coating
    if (parsed.toolSubtype) result.toolSubtype = parsed.toolSubtype
    if (parsed.seriesName) result.seriesName = parsed.seriesName
    if (parsed.diameterMm && Number(parsed.diameterMm) > 0 && Number(parsed.diameterMm) <= 200) {
      result.diameterMm = Number(parsed.diameterMm)
    }
    if (parsed.material) result.material = parsed.material
    if (parsed.rawValue) result.rawValue = parsed.rawValue
    return result
  } catch {
    return {}
  }
}
