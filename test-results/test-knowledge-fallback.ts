import { searchKnowledgeFallback } from "@/lib/recommendation/infrastructure/knowledge/knowledge-fallback"

const cases = [
  { name: "초내열합금 + 라디우스 + d10", input: { material: "초내열합금", toolSubtype: "Corner_Radius", diameterMm: 10 } },
  { name: "Inconel + d10", input: { material: "Inconel", diameterMm: 10 } },
  { name: "탄소강 + 초경엔드밀", input: { material: "탄소강", toolType: "End Mill" } },
  { name: "알루미늄 + 램핑", input: { material: "알루미늄", queryText: "ramping" } },
  { name: "스테인리스 + d8", input: { material: "스테인리스", diameterMm: 8 } },
]

for (const c of cases) {
  const t0 = Date.now()
  const r = searchKnowledgeFallback(c.input as any, [])
  const ms = Date.now() - t0
  console.log(`\n[${c.name}] (${ms}ms) → ${r.length} hits`)
  for (const sp of r.slice(0, 5)) {
    console.log(`  ${sp.product.seriesName} | ${sp.product.brand} | ${sp.product.toolType}/${sp.product.toolSubtype} | ISO=${sp.product.materialTags.join(",")}`)
  }
}
