import { NextRequest, NextResponse } from "next/server"
import { CompetitorRepo } from "@/lib/data/repos/competitor-repo"
import type { CompetitorProduct } from "@/lib/data/repos/competitor-repo"

/**
 * GET /api/competitor?q=AE-VMS&brand=OSG&diameter=10
 *
 * 경쟁사 제품 검색 + YG-1 대체품 매칭 + 가공조건 비교 시뮬레이션
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get("q") ?? ""
  const brand = searchParams.get("brand")
  const diameter = searchParams.get("diameter")
  const iso = searchParams.get("iso")

  try {
    let results: CompetitorProduct[]

    if (q) {
      results = CompetitorRepo.searchWithComparison(q)
    } else if (brand) {
      results = CompetitorRepo.findByBrand(brand)
    } else {
      results = CompetitorRepo.getAll()
    }

    // Filter by diameter
    if (diameter) {
      const d = parseFloat(diameter)
      results = results.filter(p => p.diameterMm !== null && Math.abs(p.diameterMm - d) <= 1)
    }

    // Filter by ISO group
    if (iso) {
      results = results.filter(p => p.materialTags.includes(iso.toUpperCase()))
    }

    // Load YG-1 cutting conditions for comparison
    const { EvidenceRepo } = await import("@/lib/data/repos/evidence-repo")

    const enriched = await Promise.all(results.slice(0, 20).map(async (comp) => {
      const yg1Comparisons = await Promise.all(
        comp.yg1Matches.slice(0, 3).map(async (match) => {
          const evidence = await EvidenceRepo.findBySeriesName(match.series, {
            isoGroup: comp.materialTags[0] || undefined,
          })

          // Get Vc/fz from YG-1 evidence
          const vcValues = evidence
            .map(e => parseFloat(e.conditions?.Vc ?? "0"))
            .filter(v => v > 0)
          const fzValues = evidence
            .map(e => parseFloat(e.conditions?.fz ?? "0"))
            .filter(v => v > 0)

          // Diameter-filtered evidence
          const diaFiltered = comp.diameterMm
            ? evidence.filter(e =>
                e.diameterMm !== null && Math.abs(e.diameterMm - comp.diameterMm!) <= 1
              )
            : evidence

          const diaVc = diaFiltered
            .map(e => parseFloat(e.conditions?.Vc ?? "0"))
            .filter(v => v > 0)
          const diaFz = diaFiltered
            .map(e => parseFloat(e.conditions?.fz ?? "0"))
            .filter(v => v > 0)

          return {
            ...match,
            yg1Conditions: vcValues.length > 0 ? {
              vcRange: [Math.min(...vcValues), Math.max(...vcValues)],
              fzRange: fzValues.length > 0 ? [Math.min(...fzValues), Math.max(...fzValues)] : null,
              dataPoints: evidence.length,
            } : null,
            yg1ConditionsDiameterFiltered: diaVc.length > 0 ? {
              vcRange: [Math.min(...diaVc), Math.max(...diaVc)],
              fzRange: diaFz.length > 0 ? [Math.min(...diaFz), Math.max(...diaFz)] : null,
              dataPoints: diaFiltered.length,
            } : null,
          }
        })
      )

      return {
        competitor: {
          brand: comp.manufacturer,
          code: comp.displayCode,
          series: comp.seriesName,
          diameter: comp.diameterMm,
          flutes: comp.fluteCount,
          coating: comp.coating,
          iso: comp.materialTags,
          shape: comp.toolSubtype,
          conditions: comp.cuttingConditions,
        },
        yg1Alternatives: yg1Comparisons,
      }
    }))

    return NextResponse.json({
      query: { q, brand, diameter, iso },
      count: enriched.length,
      totalAvailable: results.length,
      brands: CompetitorRepo.getBrands(),
      results: enriched,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
