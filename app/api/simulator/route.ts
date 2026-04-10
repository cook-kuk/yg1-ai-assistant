import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const series = searchParams.get("series")
  const diameter = searchParams.get("diameter")
  const material = searchParams.get("material") // ISO group
  const workpiece = searchParams.get("workpiece")
  const hardness = searchParams.get("hardness")
  const cuttingType = searchParams.get("cuttingType")
  const toolShape = searchParams.get("toolShape")

  if (!series) {
    return NextResponse.json({ error: "series parameter required" }, { status: 400 })
  }

  try {
    const { EvidenceRepo } = await import("@/lib/data/repos/evidence-repo")

    // Load all chunks for this series (no filter) to compute facets
    const allForSeries = await EvidenceRepo.findBySeriesName(series)

    // Build facets — Harvey-MAP cascading dropdowns
    const facets = buildFacets(allForSeries, { material, workpiece, hardness, cuttingType, toolShape })

    // Apply user-selected filters
    const filtered = await EvidenceRepo.findBySeriesName(series, {
      isoGroup: material || undefined,
      workpiece: workpiece || undefined,
      hardnessHrc: hardness || undefined,
      cuttingType: cuttingType || undefined,
      toolShape: toolShape || undefined,
    })

    // Diameter narrowing (closest if exact miss)
    let final = filtered
    if (diameter) {
      const d = parseFloat(diameter)
      const exact = filtered.filter(c => c.diameterMm === d)
      if (exact.length > 0) {
        final = exact
      } else if (filtered.length > 0) {
        const sorted = [...filtered].sort((a, b) =>
          Math.abs((a.diameterMm ?? 0) - d) - Math.abs((b.diameterMm ?? 0) - d)
        )
        final = sorted.slice(0, 5)
      }
    }

    const conditions = final.slice(0, 20).map(c => ({
      seriesName: c.seriesName,
      isoGroup: c.isoGroup,
      cuttingType: c.cuttingType,
      toolShape: c.toolShape ?? null,
      workpiece: c.workpiece ?? c.pageTitle ?? null,
      hardnessHrc: c.hardnessHrc ?? null,
      diameterMm: c.diameterMm,
      Vc: c.conditions.Vc,
      fz: c.conditions.fz,
      ap: c.conditions.ap,
      ae: c.conditions.ae,
      n: c.conditions.n,
      vf: c.conditions.vf,
      confidence: c.confidence,
    }))

    const vcValues = conditions.map(c => parseFloat(c.Vc ?? "0")).filter(v => v > 0)
    const fzValues = conditions.map(c => parseFloat(c.fz ?? "0")).filter(v => v > 0)

    return NextResponse.json({
      found: conditions.length > 0,
      count: conditions.length,
      series,
      diameter: diameter ? parseFloat(diameter) : null,
      material,
      workpiece,
      hardness,
      cuttingType,
      toolShape,
      conditions,
      facets,
      ranges: vcValues.length > 0 ? {
        VcMin: Math.min(...vcValues),
        VcMax: Math.max(...vcValues),
        fzMin: fzValues.length > 0 ? Math.min(...fzValues) : 0,
        fzMax: fzValues.length > 0 ? Math.max(...fzValues) : 0,
      } : null,
      interpolated: diameter ? !filtered.some(c => c.diameterMm === parseFloat(diameter)) : false,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface FacetSelection {
  material: string | null
  workpiece: string | null
  hardness: string | null
  cuttingType: string | null
  toolShape: string | null
}

interface ChunkLike {
  isoGroup?: string | null
  workpiece?: string | null
  pageTitle?: string | null
  hardnessHrc?: string | null
  cuttingType?: string | null
  toolShape?: string | null
}

function buildFacets(chunks: ChunkLike[], sel: FacetSelection) {
  // Cascading: each facet shows options available given prior selections.
  const norm = (v: string | null | undefined) => (v ?? "").trim()

  const isoGroups = uniqueSorted(chunks.map(c => norm(c.isoGroup)).filter(Boolean))

  const afterIso = sel.material
    ? chunks.filter(c => norm(c.isoGroup).toUpperCase() === sel.material!.toUpperCase())
    : chunks
  const workpieces = uniqueSorted(
    afterIso.map(c => norm(c.workpiece) || norm(c.pageTitle)).filter(Boolean)
  )

  const afterWp = sel.workpiece
    ? afterIso.filter(c =>
        (norm(c.workpiece) || norm(c.pageTitle)).toLowerCase().includes(sel.workpiece!.toLowerCase())
      )
    : afterIso
  const hardnesses = uniqueSorted(afterWp.map(c => norm(c.hardnessHrc)).filter(Boolean))

  const afterHd = sel.hardness
    ? afterWp.filter(c => norm(c.hardnessHrc).replace(/\s+/g, "") === sel.hardness!.replace(/\s+/g, ""))
    : afterWp
  const cuttingTypes = uniqueSorted(afterHd.map(c => norm(c.cuttingType)).filter(Boolean))

  const afterCt = sel.cuttingType
    ? afterHd.filter(c => norm(c.cuttingType).toLowerCase().includes(sel.cuttingType!.toLowerCase()))
    : afterHd
  const toolShapes = uniqueSorted(
    afterCt.map(c => norm(c.toolShape) || norm(c.cuttingType)).filter(Boolean)
  )

  return { isoGroups, workpieces, hardnesses, cuttingTypes, toolShapes }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "ko"))
}
