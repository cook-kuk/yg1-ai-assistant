import { findHallucinatedSeries, isKnownSeriesName } from "@/lib/recommendation/infrastructure/knowledge/series-validator"

const cases = [
  {
    name: "한지희 케이스 — 3S MILL 환각",
    text: "탄소강 가공용 초경엔드밀은 3S MILL 시리즈가 가장 적합합니다.",
  },
  {
    name: "이동건 케이스 — 환각 + 정상 혼합",
    text: "S소재 가공에는 SUPER ALLOY는 없고 3S MILL 제품을 추천드립니다. X-POWER도 검토해보세요.",
  },
  {
    name: "정상 응답 — 모두 카탈로그 시리즈",
    text: "초내열합금 가공에는 EMH77, EMH78, EMH79 (Super Alloy 브랜드) 또는 TitaNox-POWER 시리즈를 추천합니다.",
  },
  {
    name: "TITANOX (NN→N 표기 오류)",
    text: "TITANOX 시리즈는 티타늄 가공에 적합합니다.",
  },
  {
    name: "정상 — V7 PLUS",
    text: "V7 PLUS 시리즈는 범용 4날 엔드밀입니다.",
  },
  {
    name: "환각 — XYZ-9000",
    text: "신제품 XYZ-9000 시리즈를 추천드립니다.",
  },
]

for (const c of cases) {
  const hits = findHallucinatedSeries(c.text)
  console.log(`\n[${c.name}]`)
  console.log(`  text: ${c.text}`)
  if (hits.length === 0) console.log(`  ✓ 환각 없음`)
  else for (const h of hits) console.log(`  ⚠️  환각: "${h.raw}" (norm=${h.normalized})`)
}

console.log("\n=== isKnownSeriesName ===")
for (const n of ["SUPER ALLOY", "TITANNOX", "TITANOX", "V7 PLUS", "EMH77", "3S MILL", "X-POWER", "XYZ-9000"]) {
  console.log(`  ${n.padEnd(15)} → ${isKnownSeriesName(n)}`)
}
