import { NextResponse } from "next/server"
import { readFileSync } from "fs"
import { join } from "path"

interface QAItem {
  question: string
  answer: string
  series?: string
  brand?: string
  category: string
  feature_key?: string
  feature_value?: string
  matched_count?: number
}

interface TermItem {
  en: string
  ko: string
}

let qaCache: QAItem[] | null = null
let featureCache: QAItem[] | null = null
let termCache: TermItem[] | null = null

function loadQA(): QAItem[] {
  if (qaCache) return qaCache
  const raw = readFileSync(join(process.cwd(), "knowledge/qa/product_knowledge_qa.json"), "utf-8")
  qaCache = JSON.parse(raw)
  return qaCache!
}

function loadFeature(): QAItem[] {
  if (featureCache) return featureCache
  const raw = readFileSync(join(process.cwd(), "knowledge/qa/feature_to_product_qa.json"), "utf-8")
  featureCache = JSON.parse(raw)
  return featureCache!
}

function loadTerminology(): TermItem[] {
  if (termCache) return termCache
  const raw = readFileSync(join(process.cwd(), "knowledge/terminology/cutting_tool_terminology_en_ko.json"), "utf-8")
  termCache = JSON.parse(raw)
  return termCache!
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const tab = searchParams.get("tab") || "qa"
    const q = (searchParams.get("q") || "").toLowerCase().trim()
    const cat = searchParams.get("category") || ""
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")))

    if (tab === "terminology") {
      const terms = loadTerminology()
      const filtered = q
        ? terms.filter(t => t.en.toLowerCase().includes(q) || t.ko.includes(q))
        : terms
      return NextResponse.json({
        items: filtered,
        total: filtered.length,
      })
    }

    if (tab === "feature") {
      const items = loadFeature()
      let filtered = items
      if (q) {
        filtered = filtered.filter(
          i => i.question.toLowerCase().includes(q) || i.feature_value?.toLowerCase().includes(q)
        )
      }
      if (cat) {
        filtered = filtered.filter(i => i.feature_key === cat)
      }
      const keys: Record<string, number> = {}
      items.forEach(i => { keys[i.feature_key || ""] = (keys[i.feature_key || ""] || 0) + 1 })
      return NextResponse.json({
        items: filtered.slice((page - 1) * limit, page * limit),
        total: filtered.length,
        featureKeys: keys,
        page,
        limit,
      })
    }

    // Default: qa
    const items = loadQA()
    let filtered = items
    if (q) {
      filtered = filtered.filter(
        i =>
          i.question.toLowerCase().includes(q) ||
          i.series?.toLowerCase().includes(q) ||
          i.brand?.toLowerCase().includes(q)
      )
    }
    if (cat) {
      filtered = filtered.filter(i => i.category === cat)
    }

    const categories: Record<string, number> = {}
    items.forEach(i => { categories[i.category] = (categories[i.category] || 0) + 1 })

    return NextResponse.json({
      items: filtered.slice((page - 1) * limit, page * limit),
      total: filtered.length,
      categories,
      page,
      limit,
    })
  } catch (error) {
    return NextResponse.json({ error: "Failed to load knowledge data" }, { status: 500 })
  }
}
