import { searchKnowledgeFallback } from "@/lib/recommendation/infrastructure/knowledge/knowledge-fallback"
const r = searchKnowledgeFallback({ material: "초내열합금", toolSubtype: "Corner_Radius", diameterMm: 10 } as any, [])
const sa = r.filter(x => (x.product.brand||"").toLowerCase().includes("super alloy"))
console.log("SUPER ALLOY 브랜드 매칭:", sa.length)
for (const x of sa) console.log(" ", x.product.seriesName, "|", x.product.brand, "|", x.product.toolSubtype)
console.log("전체 hits:", r.length, "/ first 10:", r.slice(0,10).map(x=>x.product.seriesName).join(","))
