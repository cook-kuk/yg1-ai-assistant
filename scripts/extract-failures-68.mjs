#!/usr/bin/env node
/**
 * qa-log.txt 파싱 → 빈 배열 추출 실패 + 명확 키워드 케이스 추출.
 * 출력: test-results/extraction-failures-68.txt
 */
import { readFileSync, writeFileSync } from "fs"

const KEYWORDS = ["외경", "직경", "날장", "생크", "전장", "코너", "헬릭스", "날수", "테이퍼", "절삭", "피치"]
const log = readFileSync("test-results/eval-golden-qa-log.txt", "utf8")

const cases = []
const blocks = log.split(/^=== /m).slice(1)
for (const block of blocks) {
  const lines = block.split("\n")
  const idMatch = lines[0].match(/^(\S+)\s/)
  if (!idMatch) continue
  const id = idMatch[1]
  const field = (label) => {
    const line = lines.find(l => l.startsWith(label))
    return line ? line.slice(label.length).trim() : ""
  }
  cases.push({
    id,
    question: field("질문:"),
    expected: field("기대 필터:"),
    actual: field("실제 필터:"),
    grade: field("채점:"),
    response: field("응답 텍스트:"),
  })
}

const matched = cases.filter(c =>
  c.actual === "(없음)"
  && KEYWORDS.some(k => c.question.includes(k))
)

// ═══ 패턴 분류 (명확한 우선순위) ═══
function classify(c) {
  const q = c.question
  const r = c.response
  const tags = []

  // 1) stock 거부 응답
  if (/기준이 넓어서|바로 필터로 확정하기 어렵/.test(r)) tags.push("LLM_거부_응답")

  // 2) 필드별
  if (/생크|shank/i.test(q)) tags.push("FIELD_생크")
  if (/코너|corner/i.test(q)) tags.push("FIELD_코너")
  if (/테이퍼|taper/i.test(q)) tags.push("FIELD_테이퍼")
  if (/헬릭스|helix/i.test(q)) tags.push("FIELD_헬릭스")
  if (/피치|pitch/i.test(q)) tags.push("FIELD_피치")
  if (/절삭\s?길이|날장|lengthOfCut/i.test(q)) tags.push("FIELD_날장")
  if (/전장|overall/i.test(q)) tags.push("FIELD_전장")
  if (/외경|직경|diameter|지름/i.test(q) && !/생크|shank/i.test(q)) tags.push("FIELD_직경")
  if (/날수|flute|\d+\s*날\b/i.test(q)) tags.push("FIELD_날수")

  // 3) op 유형
  if (/사이|에서.*까지|~/.test(q)) tags.push("OP_between")
  if (/이상|넘|초과|\bgte\b|보다\s?큰/i.test(q)) tags.push("OP_이상_초과")
  if (/이하|미만|못\s?미치|아래|보다\s?작/i.test(q)) tags.push("OP_이하_미만")
  if (/정확히|\beq\b/i.test(q)) tags.push("OP_정확히")

  return tags
}

const byTag = {}
const samplesByTag = {}
for (const c of matched) {
  const tags = classify(c)
  c._tags = tags
  for (const t of tags) {
    byTag[t] = (byTag[t] ?? 0) + 1
    samplesByTag[t] ??= []
    if (samplesByTag[t].length < 3) samplesByTag[t].push(`${c.id}: "${c.question.slice(0, 50)}" (기대 ${c.expected})`)
  }
}

const out = []
out.push(`# 추출 실패 (빈배열 + 명확 키워드) ${matched.length}건`)
out.push(`# 키워드: ${KEYWORDS.join(", ")}`)
out.push(`# 생성: ${new Date().toISOString()}`)
out.push("")
for (const c of matched) {
  out.push(`=== ${c.id} ===`)
  out.push(`질문: ${c.question}`)
  out.push(`기대: ${c.expected}`)
  out.push(`실제: (빈 배열)`)
  out.push(`응답: ${c.response}`)
  out.push(`태그: ${c._tags.join(", ")}`)
  out.push(``)
}

// Top 3 실제 원인 패턴
out.push(`\n═══ 실패 패턴 Top (전체) ═══`)
const ranked = Object.entries(byTag).sort((a, b) => b[1] - a[1])
for (const [tag, n] of ranked) {
  const pct = ((n / matched.length) * 100).toFixed(0)
  out.push(`\n▶ ${tag}: ${n}건 (${pct}%)`)
  for (const s of samplesByTag[tag]) out.push(`  - ${s}`)
}

// 근본 원인 Top 3 분석
out.push(`\n\n═══ 근본 원인 Top 3 ═══`)
out.push(`\n1. LLM 거부 응답 (stock "기준이 넓어서..."): ${byTag["LLM_거부_응답"] ?? 0}건`)
out.push(`   → 숫자+단위가 명확한데도 SCR 프롬프트가 "ambiguous"로 판정하고 질문으로 우회.`)
out.push(`   → 예: "외경 10mm 이상 12mm 이하" — 필드/op/값 다 명확한데도 거부.`)
out.push(`\n2. 복합 수치 범위 (between/이상-이하): ${(byTag["OP_between"] ?? 0) + (byTag["OP_이상_초과"] ?? 0) + (byTag["OP_이하_미만"] ?? 0)}건`)
out.push(`   → "A에서 B 사이", "X 이상 Y 이하" 등 2-번호 범위 파싱이 단일 추출 로직에 못 붙음.`)
out.push(`\n3. 특수 필드 (생크/코너/테이퍼/헬릭스/피치): ${(byTag["FIELD_생크"] ?? 0) + (byTag["FIELD_코너"] ?? 0) + (byTag["FIELD_테이퍼"] ?? 0) + (byTag["FIELD_헬릭스"] ?? 0) + (byTag["FIELD_피치"] ?? 0)}건`)
out.push(`   → 직경/날수 외의 필드는 deterministic-scr에 cue 등록이 부족한 듯.`)

writeFileSync("test-results/extraction-failures-68.txt", out.join("\n"))
console.log(`\n📄 저장: test-results/extraction-failures-68.txt`)
console.log(`   매칭: ${matched.length}건\n`)
console.log(`▶ 태그 Top 10:`)
for (const [t, n] of ranked.slice(0, 10)) console.log(`   ${t}: ${n}건`)
