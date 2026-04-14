import { classifyQueryTarget } from "../lib/recommendation/domain/context/query-target-classifier.ts"

const msgs = [
  "스테인리스 10mm 4날 쓸건데 괜찮은 거 있을까",
  "알루미늄 10mm 쓸건데 괜찮은 거 있을까",
  "10mm 4날 쓸건데 괜찮은 거 있을까",
  "스테인리스가 뭐야",
]
for (const m of msgs) {
  const r = classifyQueryTarget(m, null, null)
  console.log(JSON.stringify({ msg: m, type: r.type, entities: r.entities }))
}
