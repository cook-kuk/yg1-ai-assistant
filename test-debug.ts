import { canonicalizeToolSubtype, stripKoreanParticles } from "@/lib/recommendation/shared/patterns"

const test1 = "코너레디우스"
const test2 = "코너레디우스만"
const test3 = "공구 형상을 코너레디우스만 보여줘"

console.log(`Input: "${test1}"`)
console.log(`Normalized: "${test1.trim().toLowerCase().replace(/[()\s_-]+/g, "")}"`)
console.log(`Result: ${canonicalizeToolSubtype(test1)}`)

console.log(`\nInput: "${test2}"`)
const stripped2 = stripKoreanParticles(test2.trim()).toLowerCase().replace(/[()\s_-]+/g, "")
console.log(`Normalized: "${stripped2}"`)
console.log(`Result: ${canonicalizeToolSubtype(test2)}`)

console.log(`\nInput: "${test3}"`)
console.log(`Result: ${canonicalizeToolSubtype(test3)}`)

// Test the KG extraction
import { extractEntities } from "@/lib/recommendation/core/knowledge-graph"
console.log(`\nExtract entities from "${test3}":`)
console.log(extractEntities(test3))
