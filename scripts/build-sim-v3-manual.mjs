#!/usr/bin/env node
// Build simulator v3 manual + concepts dictionary (md/docx)
// 입력: lib/frontend/simulator/v2/edu/*.ts
// 출력: public/docs/simulator-v3-manual.md, simulator-v3-concepts.md
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const EDU_DIR = path.join(ROOT, "lib/frontend/simulator/v2/edu")
const OUT_DIR = path.join(ROOT, "public/docs")
fs.mkdirSync(OUT_DIR, { recursive: true })

// ─ 1. Edu 파일 파싱 (TS 직접 파싱 대신 정규식) ─
const CATEGORY_ORDER = [
  "speeds", "depth", "tool-shape", "material",
  "coating", "machine", "operation", "coolant",
  "result", "phenomenon", "technique",
]
const CATEGORY_LABEL = {
  speeds: "① 속도·이송 (Speeds & Feeds)",
  depth: "② 절입 깊이·치수 (Depth / Dimensions)",
  "tool-shape": "③ 공구 형상 (Tool Shape)",
  material: "④ 재질 (Material, ISO P/M/K/N/S/H)",
  coating: "⑤ 코팅 (Coating)",
  machine: "⑥ 기계·홀더 (Machine / Holder)",
  operation: "⑦ 가공 공정 (Operation)",
  coolant: "⑧ 쿨런트 (Coolant)",
  result: "⑨ 결과 지표 (Result Metrics)",
  phenomenon: "⑩ 가공 현상 (Phenomena)",
  technique: "⑪ 가공 기법 (Techniques)",
}

const files = fs.readdirSync(EDU_DIR).filter(f => f.endsWith(".ts") && !f.includes(".test"))

/** entries 배열: { id, korean, english, category, beginner, intermediate, expert, formula?, whyItMatters, realWorldExample, commonPitfall?, relatedConcepts, sourceAuthority? } */
const entries = []
for (const file of files) {
  const src = fs.readFileSync(path.join(EDU_DIR, file), "utf-8")
  // 각 entry 블록 추출
  const entryRegex = /"?([a-z][a-z0-9-]*)"?:\s*\{\s*id:\s*"([^"]+)",\s*korean:\s*"([^"]+)",\s*english:\s*"([^"]+)",\s*category:\s*"([^"]+)",\s*definition:\s*\{\s*beginner:\s*"([^"]+)",\s*intermediate:\s*"([^"]+)",\s*expert:\s*"([^"]+)",\s*\},(?:\s*formula\?\:\s*"[^"]*",)?(?:\s*formula:\s*"([^"]*)",)?\s*whyItMatters:\s*"([^"]+)",\s*realWorldExample:\s*"([^"]+)",(?:\s*commonPitfall:\s*"([^"]*)",)?\s*relatedConcepts:\s*\[([^\]]*)\],(?:\s*sourceAuthority:\s*"([^"]*)",)?/g
  let m
  while ((m = entryRegex.exec(src))) {
    entries.push({
      id: m[2],
      korean: m[3],
      english: m[4],
      category: m[5],
      beginner: m[6],
      intermediate: m[7],
      expert: m[8],
      formula: m[9] || null,
      whyItMatters: m[10],
      realWorldExample: m[11],
      commonPitfall: m[12] || null,
      relatedConcepts: m[13].split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean),
      sourceAuthority: m[14] || null,
    })
  }
}

console.log(`Parsed ${entries.length} entries from ${files.length} files`)

// ─ 2. 개념 사전 md 생성 ─
function escapeMd(s) {
  return String(s).replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

const dict = []
dict.push("# YG-1 ARIA Simulator v3 — 개념 사전")
dict.push("")
dict.push("> CNC 가공조건 시뮬레이터의 모든 용어·개념을 한국어로 정리한 사전")
dict.push("> 출처: Sandvik Coromant Handbook · Harvey Performance MAP · ASM Metals Handbook · ISO 표준 · 학술 문헌")
dict.push("")
dict.push(`**총 ${entries.length}개 entry, 3단계 난이도별 설명 (초급/중급/고급) + 공식 + 실전 예시 + 흔한 함정**`)
dict.push("")
dict.push("## 📚 목차")
dict.push("")
for (const cat of CATEGORY_ORDER) {
  const catEntries = entries.filter(e => e.category === cat)
  if (catEntries.length === 0) continue
  const anchor = CATEGORY_LABEL[cat].replace(/\s/g, "-").replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪]/g, "")
  dict.push(`- ${CATEGORY_LABEL[cat]} (${catEntries.length} entry)`)
}
dict.push("")
dict.push("---")
dict.push("")

for (const cat of CATEGORY_ORDER) {
  const catEntries = entries.filter(e => e.category === cat)
  if (catEntries.length === 0) continue

  dict.push(`## ${CATEGORY_LABEL[cat]}`)
  dict.push("")

  for (const e of catEntries) {
    dict.push(`### ${e.korean}`)
    dict.push(`*${e.english}* · id: \`${e.id}\``)
    dict.push("")
    dict.push("**초급 (Beginner)**")
    dict.push(`> ${escapeMd(e.beginner)}`)
    dict.push("")
    dict.push("**중급 (Intermediate)**")
    dict.push(`> ${escapeMd(e.intermediate)}`)
    dict.push("")
    dict.push("**고급 (Expert)**")
    dict.push(`> ${escapeMd(e.expert)}`)
    dict.push("")
    if (e.formula) {
      dict.push("**공식 / Formula**")
      dict.push("")
      dict.push("```")
      dict.push(e.formula)
      dict.push("```")
      dict.push("")
    }
    dict.push(`**왜 중요?** ${escapeMd(e.whyItMatters)}`)
    dict.push("")
    dict.push(`**실전 예시.** ${escapeMd(e.realWorldExample)}`)
    dict.push("")
    if (e.commonPitfall) {
      dict.push(`**⚠ 흔한 함정.** ${escapeMd(e.commonPitfall)}`)
      dict.push("")
    }
    if (e.relatedConcepts.length > 0) {
      dict.push(`**관련 개념:** ${e.relatedConcepts.map(r => `\`${r}\``).join(" · ")}`)
      dict.push("")
    }
    if (e.sourceAuthority) {
      dict.push(`*출처: ${e.sourceAuthority}*`)
      dict.push("")
    }
    dict.push("---")
    dict.push("")
  }
}

const dictPath = path.join(OUT_DIR, "simulator-v3-concepts.md")
fs.writeFileSync(dictPath, dict.join("\n"))
console.log(`✓ ${dictPath} (${dict.length} lines)`)
