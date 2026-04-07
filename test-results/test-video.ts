import { findVideosForProduct } from "@/lib/data/video-mapping"

const cases = [
  { name: "WIDE-CUT E5E88 (cross-link 버그)", series: "E5E88", brand: "WIDE-CUT" },
  { name: "ALU-CUT E5E83", series: "E5E83", brand: "ALU-CUT" },
  { name: "정상: E-FORCE 브랜드", series: "ABC", brand: "E-FORCE" },
  { name: "정상: ALU-POWER", series: "GMA1", brand: "ALU-POWER" },
  { name: "정상: V7 PLUS", series: "V7 PLUS", brand: "V7 PLUS" },
]
for (const c of cases) {
  const r = findVideosForProduct(c.series, null, c.brand, "ko")
  console.log(`[${c.name}] (${c.brand}/${c.series}) → ${r.length}건`)
  for (const v of r.slice(0, 3)) console.log(`  - ${v.title}`)
}
