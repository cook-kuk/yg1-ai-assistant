import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const series = searchParams.get("series")
  const diameter = searchParams.get("diameter")
  const material = searchParams.get("material")

  if (!series) {
    return NextResponse.json({ error: "series parameter required" }, { status: 400 })
  }

  try {
    const { EvidenceRepo } = await import("@/lib/data/repos/evidence-repo")
    const chunks = await EvidenceRepo.findBySeriesName(series, {
      isoGroup: material || undefined,
    })

    // Filter by diameter if provided
    let filtered = chunks
    if (diameter) {
      const d = parseFloat(diameter)
      filtered = chunks.filter(c => c.diameterMm === d)
      // Fallback: nearest diameter in same series
      if (filtered.length === 0 && chunks.length > 0) {
        const sorted = [...chunks].sort((a, b) =>
          Math.abs((a.diameterMm ?? 0) - d) - Math.abs((b.diameterMm ?? 0) - d)
        )
        filtered = sorted.slice(0, 3)
      }
    }

    const conditions = filtered.slice(0, 10).map(c => ({
      seriesName: c.seriesName,
      isoGroup: c.isoGroup,
      cuttingType: c.cuttingType,
      diameterMm: c.diameterMm,
      Vc: c.conditions.Vc,
      fz: c.conditions.fz,
      ap: c.conditions.ap,
      ae: c.conditions.ae,
      n: c.conditions.n,
      vf: c.conditions.vf,
      confidence: c.confidence,
    }))

    // Extract numeric ranges for sliders
    const vcValues = conditions.map(c => parseFloat(c.Vc ?? "0")).filter(v => v > 0)
    const fzValues = conditions.map(c => parseFloat(c.fz ?? "0")).filter(v => v > 0)

    return NextResponse.json({
      found: conditions.length > 0,
      count: conditions.length,
      series,
      diameter: diameter ? parseFloat(diameter) : null,
      material,
      conditions,
      ranges: vcValues.length > 0 ? {
        VcMin: Math.min(...vcValues),
        VcMax: Math.max(...vcValues),
        fzMin: Math.min(...fzValues),
        fzMax: Math.max(...fzValues),
      } : null,
      interpolated: filtered.length === 0 && chunks.length > 0,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
