import fs from "node:fs"
import path from "node:path"

export interface KnowledgeOfficeEntry {
  name: string
  address: string
  tel: string
}

const KNOWLEDGE_FILE = "YG1_Knowledge_Base_FINAL.md"

let cachedKnowledgeText: string | null | undefined
let cachedSalesOffices: KnowledgeOfficeEntry[] | undefined

function readKnowledgeText(): string | null {
  if (cachedKnowledgeText !== undefined) return cachedKnowledgeText

  const filePath = path.join(process.cwd(), KNOWLEDGE_FILE)
  try {
    cachedKnowledgeText = fs.readFileSync(filePath, "utf8")
  } catch {
    cachedKnowledgeText = null
  }

  return cachedKnowledgeText
}

function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map(cell => cell.trim())
}

export function extractSalesOfficesFromMarkdown(markdown: string): KnowledgeOfficeEntry[] {
  const entries = markdown
    .split(/\r?\n/)
    .filter(line => line.trim().startsWith("|") && line.includes("영업소"))
    .map(parseTableRow)
    .filter(cells => cells.length >= 3)
    .map(([name, address, tel]) => ({ name, address, tel }))
    .filter(entry => entry.name.endsWith("영업소") && /\d{2,4}-\d{3,4}-\d{4}/.test(entry.tel))

  const deduped = new Map<string, KnowledgeOfficeEntry>()
  for (const entry of entries) {
    deduped.set(entry.name, entry)
  }

  return [...deduped.values()]
}

export function getSalesOfficesFromMarkdown(): KnowledgeOfficeEntry[] {
  if (cachedSalesOffices) return cachedSalesOffices

  const markdown = readKnowledgeText()
  cachedSalesOffices = markdown ? extractSalesOfficesFromMarkdown(markdown) : []
  return cachedSalesOffices
}

function normalizeOfficeQuery(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()]/g, "")
}

export function findSalesOfficeFromMarkdown(query: string): KnowledgeOfficeEntry | null {
  const normalizedQuery = normalizeOfficeQuery(query)
  for (const office of getSalesOfficesFromMarkdown()) {
    const variants = [
      office.name,
      office.name.replace(/영업소$/u, ""),
    ]
      .map(normalizeOfficeQuery)
      .filter(Boolean)

    if (variants.some(variant => normalizedQuery.includes(variant))) {
      return office
    }
  }

  return null
}
