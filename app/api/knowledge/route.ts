import { NextResponse } from "next/server"

// Static imports — bundled at build time, works on Vercel standalone
import qaData from "@/knowledge/qa/product_knowledge_qa.json"
import featureData from "@/knowledge/qa/feature_to_product_qa.json"
import termData from "@/knowledge/terminology/cutting_tool_terminology_en_ko.json"

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

const qaItems = qaData as QAItem[]
const featureItems = featureData as QAItem[]
const termItems = termData as TermItem[]

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const tab = searchParams.get("tab") || "qa"
    const q = (searchParams.get("q") || "").toLowerCase().trim()
    const cat = searchParams.get("category") || ""
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")))

    if (tab === "terminology") {
      const filtered = q
        ? termItems.filter(t => t.en.toLowerCase().includes(q) || t.ko.includes(q))
        : termItems
      return NextResponse.json({
        items: filtered,
        total: filtered.length,
      })
    }

    if (tab === "feature") {
      let filtered: QAItem[] = featureItems
      if (q) {
        filtered = filtered.filter(
          i => i.question.toLowerCase().includes(q) || i.feature_value?.toLowerCase().includes(q)
        )
      }
      if (cat) {
        filtered = filtered.filter(i => i.feature_key === cat)
      }
      const keys: Record<string, number> = {}
      featureItems.forEach(i => { keys[i.feature_key || ""] = (keys[i.feature_key || ""] || 0) + 1 })
      return NextResponse.json({
        items: filtered.slice((page - 1) * limit, page * limit),
        total: filtered.length,
        featureKeys: keys,
        page,
        limit,
      })
    }

    // Default: qa
    let filtered: QAItem[] = qaItems
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
    qaItems.forEach(i => { categories[i.category] = (categories[i.category] || 0) + 1 })

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
