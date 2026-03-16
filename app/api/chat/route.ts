/**
 * /api/chat — YG-1 AI Chat with Tool Use Architecture
 *
 * Uses Sonnet 4.5 + Anthropic Tool Use instead of dumping all products into context.
 * Tools: search_products, get_product_detail, get_cutting_conditions, get_competitor_mapping, web_search
 */

import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { ProductRepo } from "@/lib/data/repos/product-repo"
import { EvidenceRepo } from "@/lib/data/repos/evidence-repo"
import { CompetitorRepo } from "@/lib/data/repos/competitor-repo"
import { resolveMaterialTag } from "@/lib/domain/material-resolver"
import type { CanonicalProduct } from "@/lib/types/canonical"

const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY || ""
const anthropicChatModel = process.env.ANTHROPIC_FAST_MODEL || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"
const client = anthropicApiKey ? new Anthropic({ apiKey: anthropicApiKey }) : null

// ── Build context from real data ────────────────────────────
async function buildProductContext(): Promise<string> {
  const seriesRows = await ProductRepo.getSeriesOverview(120)
  const lines: string[] = []
  for (const info of seriesRows) {
    const diaRange = info.minDiameterMm != null && info.maxDiameterMm != null
      ? `직경 ${info.minDiameterMm}~${info.maxDiameterMm}mm`
      : "직경 정보 없음"
    const matTags = info.materialTags.length > 0 ? info.materialTags.join(",") : "미분류"
    lines.push(`- ${info.seriesName} (${info.brand}): ${info.count}개 EDP, ${diaRange}, 소재그룹=[${matTags}], 코팅=${info.coating ?? "정보없음"}${info.featureText ? ` | ${info.featureText.slice(0, 80)}` : ""}`)
  }

  return lines.join("\n")
}

function buildEvidenceContext(): string {
  const chunks = EvidenceRepo.getAll()
  const seriesConditions = new Map<string, { isoGroup: string | null; toolType: string | null; condSample: string }>()

  for (const c of chunks) {
    if (!c.seriesName) continue
    if (seriesConditions.has(c.seriesName)) continue
    const conds = c.conditions
    const parts: string[] = []
    if (conds.Vc) parts.push(`Vc=${conds.Vc}`)
    if (conds.fz) parts.push(`fz=${conds.fz}`)
    if (conds.ap) parts.push(`ap=${conds.ap}`)
    if (conds.ae) parts.push(`ae=${conds.ae}`)
    seriesConditions.set(c.seriesName, {
      isoGroup: c.isoGroup,
      toolType: c.toolType,
      condSample: parts.join(", "),
    })
  }

  const lines: string[] = []
  for (const [series, info] of seriesConditions) {
    lines.push(`- ${series}: ISO=${info.isoGroup ?? "?"}, ${info.toolType ?? "?"}, ${info.condSample}`)
  }

  return lines.slice(0, 50).join("\n") // limit to 50 series for context
}

// ── ISO Material Group Knowledge ────────────────────────────
const MATERIAL_KNOWLEDGE = `
## ISO 소재 분류 (절삭공구용)
- P (파란색): 탄소강, 합금강, 공구강 — 일반 가공, 가장 넓은 범위
- M (노란색): 스테인리스강 (SUS304, SUS316 등) — 가공경화 주의, 날카로운 인선 필요
- K (빨간색): 주철, CGI — 짧은 칩, 마모 주의
- N (초록색): 알루미늄, 비철금속, 구리 — 고속 가공 가능, 구성인선 주의
- S (갈색): 내열합금, 티타늄 (Inconel, Ti-6Al-4V) — 저속, 고압 쿨란트 필수
- H (회색): 고경도강 (HRc 40~65) — CBN/세라믹 또는 특수 코팅 초경 필요
`

const COATING_KNOWLEDGE = `
## YG-1 주요 코팅 종류
- TiAlN (티타늄알루미늄질화물): 고온 내마모성, 고경도강/스테인리스 가공용, 주로 건식 가공
- AlCrN (알루미늄크롬질화물): 내열성 우수, 고속 가공 및 난삭재 적합
- TiN (티타늄질화물): 범용 코팅, 금색, 일반 강재 가공
- Y-코팅 (YG-1 자체): YG-1 독자 개발 코팅, 다양한 소재 대응
- nACo/nACRo: 나노 복합 코팅, 초고경도 가공
- DLC (Diamond-Like Carbon): 알루미늄/비철용, 낮은 마찰계수
- 무코팅 (Uncoated): 알루미늄/구리 등 비철 전용, 날카로운 인선 유지
`

const MACHINING_KNOWLEDGE = `
## 가공 종류별 특성
- 황삭 (Roughing): 높은 이송, 깊은 절입, 칩 배출 우선 → 4~6날, 강성 높은 공구
- 정삭 (Finishing): 낮은 이송, 얕은 절입, 면조도 우선 → 2~4날, 높은 회전수
- 중삭 (Semi-finishing): 황삭과 정삭의 중간, 밸런스 중시
- 측면 가공 (Side Milling): 공구 측면으로 절삭, 진동 주의
- 슬롯 가공 (Slotting): 100% 물림, 칩 배출 중요, 쿨란트 필수
- 프로파일 가공 (Profiling): 복잡 형상, 볼엔드밀 다용
- 페이싱 (Facing): 평면 가공, 고이송 가능
`

// ── System Prompt ────────────────────────────────────────────
async function buildSystemPrompt(): Promise<string> {
  const productCtx = await buildProductContext()
  const evidenceCtx = buildEvidenceContext()

  return `당신은 YG-1의 AI 어시스턴트입니다. YG-1은 한국의 세계적인 절삭공구 제조사입니다.

역할:
- 절삭공구 제품 추천, 절삭조건 안내, 기술 상담
- 경쟁사 제품 대체 안내
- 시스템/데이터베이스에 대한 질문 답변
- 일반적인 대화도 유연하게 대응

도구 사용 규칙:
- 제품 추천/검색이 필요하면 search_products 도구를 사용
- 특정 제품 상세 정보가 필요하면 get_product_detail 도구를 사용
- 절삭조건이 필요하면 get_cutting_conditions 도구를 사용
- 경쟁사 대체품 문의면 get_competitor_mapping 도구를 사용
- 위 도구로 데이터를 찾지 못했을 때 → web_search 도구로 웹에서 카탈로그/기술자료 검색
- 절삭공구 관련 일반 전문지식 질문 (원리, 비교, 가이드 등) → web_search 도구로 최신 정보 검색
- 웹 검색 결과를 인용할 때는 반드시 "📌 웹 검색 결과 (내부 DB 외부)" 라고 출처를 명시

절대 규칙:
1. 제품 코드, 스펙은 도구로 조회한 데이터에서만 인용 — 절대 생성하지 마라
2. 절삭조건(Vc, fz, ap, ae)은 도구로 조회한 데이터에서만 인용
3. 모르면 "확인이 필요합니다"라고 솔직하게 답변
4. 한국어로 자연스럽게 대화. 간결하고 전문적으로.
5. 추천할 때 각 제품마다 왜 추천하는지 1줄 근거를 붙여라
6. "그냥", "빨리" 같은 요청에는 즉시 추천 (도구 호출 후 바로 답변)
7. 제품을 추천/설명할 때 반드시 아래 형식의 제품 정보 블록을 포함하라 (절대 생략 금지):
   **브랜드명:** [brand 필드값] | **제품코드:** [displayCode 필드값]
   - brand 필드는 제조사가 아니라 제품 라인 브랜드명이다 (예: "ALU-POWER HPC", "DREAM DRILL-GENERAL", "V7 PLUS A", "3S MILL")
   - 예시: **브랜드명:** ALU-POWER HPC | **제품코드:** SEME610200314E
   - "YG-1"은 제조사이지 브랜드명이 아니다. brand 필드에 있는 실제 제품 브랜드명을 사용하라
8. 응답 마지막에 반드시 📋 Reference 섹션을 추가하라:
   - 내부 DB 조회 결과이면: "📋 Reference: YG-1 내부 DB (search_products/get_product_detail/get_cutting_conditions)"
   - 웹 검색 결과이면: "📋 Reference: 웹 검색 (외부 소스 — 공식 카탈로그 확인 필요)"
   - AI 일반 지식이면: "📋 Reference: AI 일반 지식 (절삭공구 전문 학습 데이터 기반, 실제 수치는 카탈로그 확인 필요)"
   - 복합 소스이면 모든 출처를 나열

═══ 대화 맥락 판단 (매우 중요) ═══
사용자의 질문이 이전 대화와 연결되는지 스마트하게 판단하라:

[연결된 질문 (Follow-up)] — 이전 맥락을 적극 활용:
- "그거 절삭조건은?", "다른 직경도 있어?", "코팅 차이가 뭐야?" 등 이전 추천 제품과 관련된 질문
- "더 싼 거 없어?", "재고는?", "대안은?" 등 이전 결과를 기반으로 한 후속 질문
- 대명사("그거", "이거", "그 제품")가 이전 추천을 가리키는 경우
→ 이전에 추천한 제품/시리즈/스펙을 기억하고, 그 맥락 위에서 답변하라.
→ 불필요하게 처음부터 다시 검색하지 마라. 이전 도구 결과가 있으면 활용.

[새로운 질문 (New Topic)] — 이전 맥락과 독립적으로 처리:
- 완전히 다른 소재/직경/가공 조건을 제시하는 경우
- "다른 거 물어볼게", "새로운 질문", "주제 바꿀게" 등 명시적 전환
- 이전 대화와 전혀 관련 없는 일반 기술 질문
→ 이전 맥락에 얽매이지 말고 새롭게 도구를 호출하여 정확하게 답변하라.

판단이 애매하면 연결된 질문으로 취급하되, 이전 맥락이 도움이 안 되면 새로 검색하라.

시스템 정보 (사용자가 물어볼 때):
- 이 시스템은 YG-1 영업 지원 AI 어시스턴트입니다
- 약 36,000개의 YG-1 절삭공구 제품 데이터를 보유
- 절삭조건 데이터는 카탈로그 기반 증거 데이터
- 제품 스코어링: 직경(40pt), 소재(20pt), 날수(15pt), 가공방식(15pt), 절삭조건(10pt), 코팅(5pt), 완성도(5pt) = 110점 만점
- 할루시네이션 방지: 모든 데이터는 DB에서만 인용, AI는 자연어 설명만 담당

${MATERIAL_KNOWLEDGE}
${COATING_KNOWLEDGE}
${MACHINING_KNOWLEDGE}`

// ── Tool Definitions ────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_products",
    description:
      "YG-1 절삭공구 제품을 검색합니다. 소재(ISO 태그), 직경, 날수, 가공방식, 코팅, 키워드 등으로 필터링. 최대 10개 결과 반환.",
    input_schema: {
      type: "object" as const,
      properties: {
        material: {
          type: "string",
          description:
            "가공 소재 (한국어/영어/ISO 태그). 예: '스테인리스', 'SUS304', 'aluminum', 'P', 'M'",
        },
        diameter_mm: {
          type: "number",
          description: "공구 직경 (mm)",
        },
        flute_count: {
          type: "number",
          description: "날수 (2, 3, 4, 5, 6 등)",
        },
        operation_type: {
          type: "string",
          description:
            "가공 방식. 예: '황삭', '정삭', 'slotting', 'side milling', '측면가공'",
        },
        coating: {
          type: "string",
          description: "코팅 종류. 예: 'TiAlN', 'DLC', '무코팅'",
        },
        keyword: {
          type: "string",
          description:
            "일반 키워드 검색 (시리즈명, 특성 등). 예: 'ALU-POWER', 'V7', '고이송'",
        },
      },
      required: [],
    },
  },
  {
    name: "get_product_detail",
    description:
      "특정 제품의 상세 정보를 조회합니다. EDP 코드 또는 시리즈명으로 검색. 모든 EDP 변형 포함.",
    input_schema: {
      type: "object" as const,
      properties: {
        product_code: {
          type: "string",
          description: "EDP 제품 코드. 예: 'CE5G60100', 'AG52340'",
        },
        series_name: {
          type: "string",
          description: "시리즈명. 예: 'ALU-POWER HPC', 'V7 Plus A', '4G Mill'",
        },
      },
      required: [],
    },
  },
  {
    name: "get_cutting_conditions",
    description:
      "절삭조건(Vc, fz, ap, ae)을 조회합니다. 카탈로그 근거 데이터 기반.",
    input_schema: {
      type: "object" as const,
      properties: {
        series_name: {
          type: "string",
          description: "시리즈명",
        },
        product_code: {
          type: "string",
          description: "EDP 제품 코드",
        },
        material: {
          type: "string",
          description: "가공 소재 (한국어/영어/ISO 태그)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_competitor_mapping",
    description:
      "경쟁사 제품에 대응하는 YG-1 대체품을 찾습니다. 경쟁사명이나 제품코드로 검색.",
    input_schema: {
      type: "object" as const,
      properties: {
        competitor_name: {
          type: "string",
          description:
            "경쟁사 이름. 예: 'Sandvik', 'Kennametal', '미쓰비시', 'OSG'",
        },
        competitor_product: {
          type: "string",
          description: "경쟁사 제품 코드",
        },
      },
      required: [],
    },
  },
  {
    name: "web_search",
    description:
      "웹 검색을 수행합니다. 내부 DB에서 제품/절삭조건을 찾지 못했을 때 카탈로그나 기술 자료를 검색하거나, 절삭공구 관련 일반 전문지식 질문에 답하기 위해 사용합니다. 검색 결과는 내부 DB 데이터가 아님을 반드시 명시해야 합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "검색어. 예: 'YG-1 ALU-POWER HPC catalog', '엔드밀 황삭 절삭조건 가이드', 'TiAlN vs AlCrN 코팅 비교'",
        },
        search_purpose: {
          type: "string",
          enum: ["product_catalog", "cutting_knowledge", "general_knowledge"],
          description:
            "검색 목적. product_catalog=내부 DB에 없는 제품/카탈로그 검색, cutting_knowledge=절삭공구 전문지식, general_knowledge=일반 기술 지식",
        },
      },
      required: ["query", "search_purpose"],
    },
  },
]

// ── Web Search Implementation ───────────────────────────────

async function executeWebSearch(params: {
  query: string
  search_purpose: string
}): Promise<string> {
  if (!client) {
    return JSON.stringify({ found: false, message: "API 키가 설정되지 않았습니다." })
  }

  try {
    const searchQuery = params.search_purpose === "product_catalog"
      ? `YG-1 절삭공구 ${params.query} catalog specification`
      : params.query

    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514" as Parameters<typeof client.messages.create>["0"]["model"],
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 3 }],
      messages: [{
        role: "user",
        content: `다음 질문에 대해 웹 검색으로 정보를 찾아주세요. 검색 결과를 한국어로 정리해주세요.\n\n질문: ${searchQuery}\n\n중요: 찾은 정보의 출처 URL을 반드시 포함해주세요.`,
      }],
    })

    // Extract text and citations from response
    const textBlocks = resp.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    )
    const searchText = textBlocks.map((b) => b.text).join("\n")

    // Extract citations if available
    const citations: string[] = []
    for (const block of resp.content) {
      if (block.type === "text" && block.citations) {
        for (const cite of block.citations) {
          if ("url" in cite && cite.url) {
            citations.push(cite.url)
          }
        }
      }
    }

    return JSON.stringify({
      found: true,
      source: "web_search",
      search_purpose: params.search_purpose,
      content: searchText,
      citations: [...new Set(citations)].slice(0, 5),
      disclaimer: "⚠️ 이 정보는 내부 DB가 아닌 웹 검색 결과입니다. 정확한 수치는 공식 카탈로그를 확인하세요.",
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("Web search error:", msg)
    return JSON.stringify({
      found: false,
      source: "web_search",
      message: `웹 검색 중 오류: ${msg}`,
    })
  }
}

// ── Tool Implementation ─────────────────────────────────────

function slimProduct(p: CanonicalProduct) {
  return {
    displayCode: p.displayCode,
    seriesName: p.seriesName,
    brand: p.brand,
    diameterMm: p.diameterMm,
    fluteCount: p.fluteCount,
    coating: p.coating,
    materialTags: p.materialTags,
    featureText: p.featureText,
    toolType: p.toolType,
    toolSubtype: p.toolSubtype,
    applicationShapes: p.applicationShapes,
  }
}

function executeSearchProducts(params: {
  material?: string
  diameter_mm?: number
  flute_count?: number
  operation_type?: string
  coating?: string
  keyword?: string
}): string {
  let results = ProductRepo.getAll()

  // Filter by material tag
  if (params.material) {
    const tag = resolveMaterialTag(params.material)
    if (tag) {
      const filtered = results.filter((p) => p.materialTags.includes(tag))
      if (filtered.length > 0) results = filtered
    }
  }

  // Filter by diameter
  if (params.diameter_mm != null) {
    const tol = params.diameter_mm <= 3 ? 0.2 : params.diameter_mm <= 10 ? 0.5 : 1.0
    const filtered = results.filter(
      (p) =>
        p.diameterMm !== null &&
        Math.abs(p.diameterMm - params.diameter_mm!) <= tol
    )
    if (filtered.length > 0) results = filtered
  }

  // Filter by flute count
  if (params.flute_count != null) {
    const filtered = results.filter((p) => p.fluteCount === params.flute_count)
    if (filtered.length > 0) results = filtered
  }

  // Filter by operation type
  if (params.operation_type) {
    const q = params.operation_type.toLowerCase()
    const filtered = results.filter((p) =>
      p.applicationShapes.some((s) => s.toLowerCase().includes(q)) ||
      (p.featureText?.toLowerCase().includes(q) ?? false)
    )
    if (filtered.length > 0) results = filtered
  }

  // Filter by coating
  if (params.coating) {
    const q = params.coating.toLowerCase()
    const filtered = results.filter(
      (p) => p.coating?.toLowerCase().includes(q) ?? false
    )
    if (filtered.length > 0) results = filtered
  }

  // Filter by keyword (series name, feature text, display code)
  if (params.keyword) {
    const q = params.keyword.toLowerCase()
    const filtered = results.filter(
      (p) =>
        (p.seriesName?.toLowerCase().includes(q) ?? false) ||
        (p.featureText?.toLowerCase().includes(q) ?? false) ||
        p.displayCode.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false)
    )
    if (filtered.length > 0) results = filtered
  }

  // Deduplicate by series (pick one representative per series)
  const seriesSeen = new Map<string, CanonicalProduct>()
  for (const p of results) {
    const key = p.seriesName ?? p.displayCode
    if (!seriesSeen.has(key)) {
      seriesSeen.set(key, p)
    }
  }
  const deduped = [...seriesSeen.values()]

  // Return top 10
  const top = deduped.slice(0, 10)

  if (top.length === 0) {
    return JSON.stringify({
      count: 0,
      products: [],
      message: "내부 DB에서 검색 조건에 맞는 제품을 찾지 못했습니다. web_search 도구로 웹에서 카탈로그를 검색해보세요.",
    })
  }

  return JSON.stringify({
    count: top.length,
    totalMatched: results.length,
    products: top.map(slimProduct),
  })
}

function executeGetProductDetail(params: {
  product_code?: string
  series_name?: string
}): string {
  let products: CanonicalProduct[] = []

  if (params.product_code) {
    const found = ProductRepo.findByCode(params.product_code)
    if (found) {
      // Also get all variants in the same series
      if (found.seriesName) {
        products = ProductRepo.findBySeries(found.seriesName)
      } else {
        products = [found]
      }
    }
  }

  if (products.length === 0 && params.series_name) {
    products = ProductRepo.findBySeries(params.series_name)
  }

  if (products.length === 0) {
    return JSON.stringify({
      found: false,
      message: "내부 DB에서 해당 제품을 찾지 못했습니다. web_search 도구로 웹에서 검색해보세요.",
    })
  }

  // Return full details for the series, with EDP variants
  const representative = products[0]
  const variants = products.map((p) => ({
    displayCode: p.displayCode,
    diameterMm: p.diameterMm,
    fluteCount: p.fluteCount,
    coating: p.coating,
    lengthOfCutMm: p.lengthOfCutMm,
    overallLengthMm: p.overallLengthMm,
    shankDiameterMm: p.shankDiameterMm,
  }))

  return JSON.stringify({
    found: true,
    seriesName: representative.seriesName,
    brand: representative.brand,
    toolType: representative.toolType,
    toolSubtype: representative.toolSubtype,
    materialTags: representative.materialTags,
    applicationShapes: representative.applicationShapes,
    featureText: representative.featureText,
    coating: representative.coating,
    coolantHole: representative.coolantHole,
    variantCount: variants.length,
    variants: variants.slice(0, 20), // limit to 20 variants
  })
}

function executeGetCuttingConditions(params: {
  series_name?: string
  product_code?: string
  material?: string
}): string {
  const isoGroup = params.material ? resolveMaterialTag(params.material) : null

  // Try by product code first
  if (params.product_code) {
    const chunks = EvidenceRepo.findForProduct(params.product_code, {
      isoGroup,
    })
    if (chunks.length > 0) {
      return JSON.stringify({
        found: true,
        source: "product_code",
        productCode: params.product_code,
        conditions: chunks.slice(0, 5).map((c) => ({
          isoGroup: c.isoGroup,
          cuttingType: c.cuttingType,
          diameterMm: c.diameterMm,
          Vc: c.conditions.Vc,
          fz: c.conditions.fz,
          ap: c.conditions.ap,
          ae: c.conditions.ae,
          n: c.conditions.n,
          vf: c.conditions.vf,
          confidence: c.confidence,
          sourceFile: c.sourceFile,
        })),
      })
    }
  }

  // Try by series name
  if (params.series_name) {
    const chunks = EvidenceRepo.findBySeriesName(params.series_name)
    let filtered = chunks
    if (isoGroup) {
      const isoFiltered = chunks.filter(
        (c) => c.isoGroup?.toUpperCase() === isoGroup.toUpperCase()
      )
      if (isoFiltered.length > 0) filtered = isoFiltered
    }
    filtered.sort((a, b) => b.confidence - a.confidence)

    if (filtered.length > 0) {
      return JSON.stringify({
        found: true,
        source: "series_name",
        seriesName: params.series_name,
        conditions: filtered.slice(0, 5).map((c) => ({
          isoGroup: c.isoGroup,
          cuttingType: c.cuttingType,
          diameterMm: c.diameterMm,
          Vc: c.conditions.Vc,
          fz: c.conditions.fz,
          ap: c.conditions.ap,
          ae: c.conditions.ae,
          n: c.conditions.n,
          vf: c.conditions.vf,
          confidence: c.confidence,
          sourceFile: c.sourceFile,
        })),
      })
    }
  }

  // Fallback: search by material ISO group if nothing else matched
  if (isoGroup) {
    const chunks = EvidenceRepo.filterByConditions({ isoGroup })
    if (chunks.length > 0) {
      chunks.sort((a, b) => b.confidence - a.confidence)
      return JSON.stringify({
        found: true,
        source: "material_filter",
        isoGroup,
        note: "특정 제품/시리즈를 지정하지 않아 해당 소재 그룹의 일반적인 절삭조건 샘플입니다.",
        conditions: chunks.slice(0, 5).map((c) => ({
          seriesName: c.seriesName,
          productCode: c.productCode,
          isoGroup: c.isoGroup,
          cuttingType: c.cuttingType,
          diameterMm: c.diameterMm,
          Vc: c.conditions.Vc,
          fz: c.conditions.fz,
          ap: c.conditions.ap,
          ae: c.conditions.ae,
          confidence: c.confidence,
        })),
      })
    }
  }

  return JSON.stringify({
    found: false,
    message: "내부 DB에서 해당 조건의 절삭조건 데이터를 찾지 못했습니다. web_search 도구로 웹에서 카탈로그 절삭조건을 검색해보세요.",
  })
}

function executeGetCompetitorMapping(params: {
  competitor_name?: string
  competitor_product?: string
}): string {
  let competitors = CompetitorRepo.getAll()

  if (params.competitor_product) {
    // Try exact code match first
    const found = CompetitorRepo.findByCode(params.competitor_product)
    if (found) {
      // Find YG-1 alternatives with similar specs
      const alternatives = ProductRepo.getAll().filter((p) => {
        let match = true
        if (found.diameterMm !== null && p.diameterMm !== null) {
          match = match && Math.abs(p.diameterMm - found.diameterMm) <= 1
        }
        if (found.fluteCount !== null && p.fluteCount !== null) {
          match = match && p.fluteCount === found.fluteCount
        }
        return match
      })

      // Deduplicate by series
      const seriesSeen = new Set<string>()
      const deduped = alternatives.filter((p) => {
        const key = p.seriesName ?? p.displayCode
        if (seriesSeen.has(key)) return false
        seriesSeen.add(key)
        return true
      })

      return JSON.stringify({
        found: true,
        competitorProduct: {
          displayCode: found.displayCode,
          manufacturer: found.manufacturer,
          brand: found.brand,
          diameterMm: found.diameterMm,
          fluteCount: found.fluteCount,
          coating: found.coating,
          materialTags: found.materialTags,
        },
        yg1Alternatives: deduped.slice(0, 5).map(slimProduct),
      })
    }
  }

  if (params.competitor_name) {
    const q = params.competitor_name.toLowerCase()
    const filtered = competitors.filter(
      (p) =>
        p.manufacturer?.toLowerCase().includes(q) ||
        p.brand?.toLowerCase().includes(q)
    )

    if (filtered.length > 0) {
      // Deduplicate by series
      const seriesSeen = new Set<string>()
      const deduped = filtered.filter((p) => {
        const key = p.seriesName ?? p.displayCode
        if (seriesSeen.has(key)) return false
        seriesSeen.add(key)
        return true
      })

      return JSON.stringify({
        found: true,
        competitorName: params.competitor_name,
        competitorProducts: deduped.slice(0, 10).map((p) => ({
          displayCode: p.displayCode,
          seriesName: p.seriesName,
          diameterMm: p.diameterMm,
          fluteCount: p.fluteCount,
          coating: p.coating,
          materialTags: p.materialTags,
        })),
        note: "위 경쟁사 제품과 유사한 YG-1 제품을 찾으려면 search_products 도구로 같은 스펙(직경, 날수, 소재)을 검색하세요.",
      })
    }
  }

  return JSON.stringify({
    found: false,
    message: "내부 DB에서 해당 경쟁사 제품 정보를 찾지 못했습니다. web_search 도구로 웹에서 검색해보세요.",
    availableCompetitors: [
      ...new Set(competitors.map((p) => p.manufacturer).filter(Boolean)),
    ].slice(0, 10),
  })
}

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  try {
    switch (toolName) {
      case "search_products":
        return executeSearchProducts(
          toolInput as Parameters<typeof executeSearchProducts>[0]
        )
      case "get_product_detail":
        return executeGetProductDetail(
          toolInput as Parameters<typeof executeGetProductDetail>[0]
        )
      case "get_cutting_conditions":
        return executeGetCuttingConditions(
          toolInput as Parameters<typeof executeGetCuttingConditions>[0]
        )
      case "get_competitor_mapping":
        return executeGetCompetitorMapping(
          toolInput as Parameters<typeof executeGetCompetitorMapping>[0]
        )
      case "web_search":
        return await executeWebSearch(
          toolInput as Parameters<typeof executeWebSearch>[0]
        )
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Tool ${toolName} error:`, msg)
    return JSON.stringify({ error: msg })
  }
}

// ── Intent Detection from Tool Usage ────────────────────────

type ChatIntent =
  | "product_recommendation"
  | "product_lookup"
  | "cutting_condition"
  | "coating_material_qa"
  | "cross_reference"
  | "web_search"
  | "general"

function inferIntent(toolsUsed: string[]): ChatIntent {
  if (toolsUsed.includes("get_competitor_mapping")) return "cross_reference"
  if (toolsUsed.includes("get_cutting_conditions")) return "cutting_condition"
  if (toolsUsed.includes("get_product_detail")) return "product_lookup"
  if (toolsUsed.includes("search_products")) return "product_recommendation"
  if (toolsUsed.includes("web_search")) return "web_search"
  return "general"
}

// ── Extract Product References from Tool Results ────────────

function extractReferences(toolResults: { name: string; result: string }[]): string[] | null {
  const refs = new Set<string>()
  for (const tr of toolResults) {
    try {
      const data = JSON.parse(tr.result)
      if (data.products) {
        for (const p of data.products) {
          if (p.seriesName) refs.add(p.seriesName)
          else if (p.displayCode) refs.add(p.displayCode)
        }
      }
      if (data.seriesName) refs.add(data.seriesName)
      if (data.yg1Alternatives) {
        for (const p of data.yg1Alternatives) {
          if (p.seriesName) refs.add(p.seriesName)
        }
      }
    } catch {
      // ignore parse errors
    }
  }
  return refs.size > 0 ? [...refs] : null
}

// ── Mock Chat Response (fallback when no API key) ───────────

export interface ChatMessage {
  role: "user" | "ai" | "system"
  text: string
}

export interface LLMResponse {
  intent: ChatIntent
  text: string
  purpose?: string
  chips?: string[] | null
  extractedField?: {
    label: string
    value: string
    confidence: "high" | "medium" | "low"
    step: number
  } | null
  isComplete: boolean
  recommendationIds?: string[] | null
  references?: string[] | null
}

function mockChatResponse(messages: ChatMessage[]): LLMResponse {
  const lastUserInput =
    [...messages].reverse().find((m) => m.role === "user")?.text || ""
  const lower = lastUserInput.toLowerCase()

  if (/안녕|하이|hello|hi/i.test(lower)) {
    return {
      intent: "general",
      text: "안녕하세요! YG-1 AI 어시스턴트입니다. 절삭공구 추천, 코팅 설명, 가공 조건 문의 등 무엇이든 물어보세요!",
      chips: ["제품 추천 받기", "코팅 종류 알려줘", "알루미늄 가공 팁", "시리즈 검색"],
      isComplete: false,
    }
  }
  if (/코팅|tialn|alcrn|tin|dlc/i.test(lower)) {
    return {
      intent: "coating_material_qa",
      text: "YG-1의 주요 코팅으로는 TiAlN(고온 내마모), AlCrN(내열), Y-코팅(자체 개발), DLC(비철용) 등이 있습니다. 어떤 코팅이 궁금하신가요?",
      chips: ["TiAlN 상세", "알루미늄용 코팅", "스테인리스용 코팅", "코팅 비교"],
      isComplete: false,
    }
  }
  if (/조건|vc|fz|이송|회전/i.test(lower)) {
    return {
      intent: "cutting_condition",
      text: "절삭조건을 안내해드리려면 제품(시리즈)과 소재를 알려주세요. 카탈로그 데이터 기반으로 정확한 조건을 알려드립니다.",
      chips: ["SUS304 황삭", "알루미늄 고속", "탄소강 정삭"],
      isComplete: false,
    }
  }

  return {
    intent: "product_recommendation",
    text: "추가 정보가 필요합니다. 소재, 가공 조건 또는 직경을 알려주세요.",
    chips: ["스테인리스", "알루미늄", "탄소강", "고경도강"],
    extractedField: null,
    isComplete: false,
    recommendationIds: null,
  }
}

// ── Main API Handler ────────────────────────────────────────

export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const { messages } = (await req.json()) as {
      messages: ChatMessage[]
      mode?: string
    }

    if (!client) {
      console.warn("Anthropic API key not set. Using mock chat response.")
      return NextResponse.json(mockChatResponse(messages))
    }

    // Convert to Claude API format
    const apiMessages: Anthropic.MessageParam[] = messages
      .filter((m) => m.role === "user" || m.role === "ai")
      .map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.text,
      }))
      .filter((_, i, arr) => !(i === 0 && arr[0].role === "assistant"))

    const systemPrompt = await buildSystemPrompt()

    const response = await client.messages.create({
      model: anthropicChatModel,
      max_tokens: 1500,
      system: systemPrompt,
      messages: apiMessages,
    })

    const content = response.content[0]
    if (content.type !== "text") {
      throw new Error("Unexpected response type")
    }

    if (apiMessages.length === 0) {
      return NextResponse.json({
        intent: "general",
        text: "안녕하세요! YG-1 AI 어시스턴트입니다. 무엇을 도와드릴까요?",
        chips: ["제품 추천", "절삭조건 문의", "코팅 비교"],
        isComplete: false,
      } as LLMResponse)
    }

    // ── Tool Use Loop ──────────────────────────────────────
    let currentMessages = [...apiMessages]
    const toolsUsed: string[] = []
    const toolResults: { name: string; result: string }[] = []
    const MAX_TOOL_ROUNDS = 5

    let response = await client.messages.create({
      model: "claude-sonnet-4-20250514" as Parameters<typeof client.messages.create>[0]["model"],
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: currentMessages,
    })

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Check if there are tool_use blocks
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ContentBlock & { type: "tool_use" } =>
          block.type === "tool_use"
      )

      if (toolUseBlocks.length === 0) break // No more tool calls, done

      // Execute each tool call
      const toolResultMessages: Anthropic.ToolResultBlockParam[] = []

      for (const toolBlock of toolUseBlocks) {
        const result = await executeTool(
          toolBlock.name,
          toolBlock.input as Record<string, unknown>
        )
        toolsUsed.push(toolBlock.name)
        toolResults.push({ name: toolBlock.name, result })
        toolResultMessages.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: result,
        })
      }

      // Send tool results back to LLM
      currentMessages = [
        ...currentMessages,
        { role: "assistant" as const, content: response.content },
        { role: "user" as const, content: toolResultMessages },
      ]

      response = await client.messages.create({
        model: "claude-sonnet-4-20250514" as Parameters<typeof client.messages.create>[0]["model"],
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: currentMessages,
      })

      // If stop_reason is "end_turn", we're done
      if (response.stop_reason === "end_turn") break
    }

    // ── Extract Final Text Response ────────────────────────
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text"
    )
    const responseText =
      textBlocks.map((b) => b.text).join("\n") ||
      "죄송합니다, 응답을 생성하지 못했습니다."

    // ── Build Response ─────────────────────────────────────
    const intent = inferIntent(toolsUsed)
    const references = extractReferences(toolResults)

    // Try to extract chips from the response (look for suggested actions)
    let chips: string[] | null = null
    // Simple heuristic: if LLM included bullet points at the end suggesting actions
    const chipPatterns = responseText.match(
      /(?:추가 질문|다른 질문|더 궁금|참고로|도움이 되셨|다음과 같은).*$/m
    )
    if (!chipPatterns) {
      // Generate default chips based on intent
      switch (intent) {
        case "product_recommendation":
          chips = ["절삭조건도 알려줘", "다른 직경은?", "경쟁사 비교"]
          break
        case "product_lookup":
          chips = ["절삭조건 보기", "유사 제품 더 보기", "재고 확인"]
          break
        case "cutting_condition":
          chips = ["다른 소재 조건", "제품 상세 보기", "추천 더 받기"]
          break
        case "cross_reference":
          chips = ["상세 스펙 비교", "절삭조건 보기", "다른 대체품"]
          break
        case "web_search":
          chips = ["내부 DB에서 검색", "더 자세히 알려줘", "관련 제품 추천"]
          break
        default:
          chips = ["제품 추천", "절삭조건 문의", "코팅 비교"]
      }
    }

    const result: LLMResponse = {
      intent,
      text: responseText,
      chips,
      extractedField: null,
      isComplete: intent === "general" ? false : true,
      recommendationIds: null,
      references,
    }

    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Chat API error:", msg)
    return NextResponse.json(
      { error: "AI 응답을 가져오는데 실패했습니다", detail: msg },
      { status: 500 }
    )
  }
}
