import Anthropic from "@anthropic-ai/sdk"

import { createAnthropicMessageWithLogging } from "@/lib/chat/infrastructure/llm/chat-llm"
import { resolveMaterialTag } from "@/lib/chat/domain/material-resolver"
import { logRuntimeError } from "@/lib/chat/infrastructure/runtime/chat-runtime-log"
import {
  CompetitorRepo,
  EvidenceRepo,
  ProductRepo,
} from "@/lib/chat/infrastructure/repositories/chat-repositories"
import type { AppliedFilter, CanonicalProduct, RecommendationInput } from "@/lib/chat/domain/types"
import { resolveYG1Query, resolveYG1QuerySemantic, buildNotFoundResponse } from "@/lib/knowledge/knowledge-router"
import { getProvider } from "@/lib/llm/provider"
import {
  canonicalizeCountryValue,
  canonicalizeToolSubtypeValue,
} from "@/lib/recommendation/shared/canonical-values"

export const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_products",
    description:
      "YG-1 절삭공구 제품을 검색합니다. 기본 10개 반환. 사용자가 '더 보여줘', '전체 보기' 요청하면 show_all=true로 전체 반환.",
    input_schema: {
      type: "object" as const,
      properties: {
        material: {
          type: "string",
          description:
            "가공 소재 (한국어/영어/ISO 태그). 예: '스테인리스', 'SUS304', 'aluminum', 'P', 'M'",
        },
        tool_type: {
          type: "string",
          description: "공구 타입. 예: 'endmill', 'drill', 'tap', 'reamer'. 사용자가 '드릴', '엔드밀', '탭' 등 명시한 경우에만.",
        },
        tool_subtype: {
          type: "string",
          description: "공구 형상. 예: 'square', 'ball', 'radius', 'roughing', 'chamfer', 'taper'. 사용자가 명시한 경우에만.",
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
        country: {
          type: "string",
          description: "국가/시장 (ISO alpha-3 또는 한글). 사용자가 '국내제품', '국산', '한국'을 명시한 경우 'KOR'. '미국' → 'USA' 등.",
        },
        tool_material: {
          type: "string",
          description: "공구 본체 재질. 'carbide' (초경/카바이드) 또는 'hss' (하이스/고속도강). 사용자가 명시한 경우에만.",
        },
        show_all: {
          type: "boolean",
          description: "true면 전체 결과 반환 (사용자가 '더 보여줘', '전체 보기', '나머지도' 요청 시). 기본 false.",
        },
        offset: {
          type: "number",
          description: "결과 시작 위치 (페이징용). 기본 0.",
        },
      },
      required: [],
    },
  },
  {
    name: "search_product_by_edp",
    description:
      "EDP 제품 코드로 YG-1 절삭공구를 정확 조회합니다. 정확한 제품 1건과 같은 시리즈의 EDP 변형들을 함께 반환합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        edp_code: {
          type: "string",
          description: "EDP 제품 코드. 공백/하이픈이 있어도 됨. 예: 'CE5G60100', 'AG52340'",
        },
      },
      required: ["edp_code"],
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
    name: "query_yg1_knowledge",
    description:
      "YG-1 회사 정보를 조회합니다. 3단계 지식 시스템: 1) 내부 KB (빠른 응답) 2) 웹 검색 필요 시 안내 3) 없음 처리. 공장/사업장 위치·전화번호, 매출·재무·주주, 경쟁사·시장, 설립·연혁, 직원, CEO, 순위 등 회사 관련 질문에 사용.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "YG-1 회사 관련 질문. 예: '익산공장 어디야?', '매출 얼마?', '2대주주 누구?'",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "find_yg1_alternative",
    description: "YG-1 제품의 대체품을 찾습니다. 같은 직경/형상/소재의 다른 YG-1 제품을 검색합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        product_code: {
          type: "string",
          description: "원본 YG-1 제품 코드 (EDP). 예: 'CG3S4510045'",
        },
        reason: {
          type: "string",
          description: "대체 이유. 예: '재고 없음', '단종', '비용 절감'",
        },
      },
      required: ["product_code"],
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

interface ChatToolRuntimeDeps {
  anthropicChatModel: string
  client: Anthropic | null
  route: string
}

async function executeQueryYG1Knowledge(params: { query: string }): Promise<string> {
  // STEP 1: 키워드 검색 (0ms, 무비용)
  const keywordResult = resolveYG1Query(params.query)

  if (keywordResult.source === "internal_kb") {
    return JSON.stringify({
      found: true,
      source: "internal_kb",
      answer: keywordResult.answer,
      badge: "✓ YG-1 공식 정보",
    })
  }

  // STEP 2: 시맨틱 검색 (Haiku, 패러프레이즈 캐치)
  try {
    const provider = getProvider()
    const semanticResult = await resolveYG1QuerySemantic(params.query, provider)

    if (semanticResult.source === "internal_kb") {
      return JSON.stringify({
        found: true,
        source: "internal_kb_semantic",
        answer: semanticResult.answer,
        badge: "✓ YG-1 공식 정보 (시맨틱)",
      })
    }
  } catch {
    // 시맨틱 검색 실패 시 웹 검색으로 폴백
  }

  // STEP 3: 둘 다 실패 → 웹 검색 안내
  return JSON.stringify({
    found: false,
    source: "needs_web_search",
    message: `내부 KB에 "${params.query}" 관련 정보가 없습니다. web_search 도구로 "YG-1 ${params.query}"를 검색해보세요.`,
    suggestedQuery: `YG-1 와이지원 ${params.query}`,
  })
}

async function executeWebSearch(
  params: {
    query: string
    search_purpose: string
  },
  deps: ChatToolRuntimeDeps
): Promise<string> {
  if (!deps.client) {
    return JSON.stringify({ found: false, message: "API 키가 설정되지 않았습니다." })
  }

  try {
    const searchQuery = params.search_purpose === "product_catalog"
      ? `YG-1 절삭공구 ${params.query} catalog specification`
      : params.query

    const resp = await createAnthropicMessageWithLogging({
      client: deps.client,
      route: deps.route,
      operation: "web_search",
      request: {
        model: deps.anthropicChatModel as Parameters<typeof deps.client.messages.create>[0]["model"],
        max_tokens: 1500,
        tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 3 }],
        messages: [{
          role: "user",
          content: `다음 질문에 대해 웹 검색으로 정보를 찾아주세요. 검색 결과를 한국어로 정리해주세요.\n\n질문: ${searchQuery}\n\n중요: 찾은 정보의 출처 URL을 반드시 포함해주세요.`,
        }],
      },
    })

    const textBlocks = resp.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text"
    )
    const searchText = textBlocks.map(block => block.text).join("\n")

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
    await logRuntimeError({
      category: "error",
      event: "chat.web_search.error",
      error: err,
      context: {
        route: deps.route,
        params,
      },
    })
    return JSON.stringify({
      found: false,
      source: "web_search",
      message: `웹 검색 중 오류: ${msg}`,
    })
  }
}

function slimProduct(product: CanonicalProduct) {
  return {
    displayCode: product.displayCode,
    seriesName: product.seriesName,
    brand: product.brand,
    diameterMm: product.diameterMm,
    fluteCount: product.fluteCount,
    coating: product.coating,
    materialTags: product.materialTags,
    featureText: product.featureText,
    toolType: product.toolType,
    toolSubtype: product.toolSubtype,
    toolMaterial: product.toolMaterial,
    applicationShapes: product.applicationShapes,
    description: product.description,
    seriesIconUrl: product.seriesIconUrl,
    shankDiameterMm: product.shankDiameterMm,
    lengthOfCutMm: product.lengthOfCutMm,
    overallLengthMm: product.overallLengthMm,
    helixAngleDeg: product.helixAngleDeg,
  }
}

function matchesKeyword(product: CanonicalProduct, keyword: string): boolean {
  const q = keyword.toLowerCase()
  return (
    (product.seriesName?.toLowerCase().includes(q) ?? false) ||
    (product.featureText?.toLowerCase().includes(q) ?? false) ||
    (product.description?.toLowerCase().includes(q) ?? false) ||
    product.displayCode.toLowerCase().includes(q) ||
    (product.brand?.toLowerCase().includes(q) ?? false)
  )
}

function normalizeProductCode(code: string | null | undefined): string {
  return (code ?? "").replace(/[\s-]/g, "").toUpperCase()
}

function dedupeProductsBySeries(products: CanonicalProduct[]): CanonicalProduct[] {
  const seriesSeen = new Map<string, CanonicalProduct>()
  for (const product of products) {
    const key = product.seriesName ?? product.displayCode
    if (!seriesSeen.has(key)) {
      seriesSeen.set(key, product)
    }
  }
  return [...seriesSeen.values()]
}

// ── Tool type / subtype canonical resolver ──
const TOOL_TYPE_MAP: Record<string, string> = {
  drill: "Holemaking", endmill: "Milling", tap: "Threading", reamer: "Holemaking",
  "드릴": "Holemaking", "엔드밀": "Milling", "탭": "Threading", "리머": "Holemaking",
}
const TOOL_SUBTYPE_CANON: Record<string, string> = {
  square: "Square", ball: "Ball", radius: "Radius", roughing: "Roughing",
  chamfer: "Chamfer", taper: "Taper",
  "스퀘어": "Square", "볼": "Ball", "코너r": "Radius", "황삭": "Roughing",
}

function resolveToolType(raw: string | undefined): string | null {
  if (!raw) return null
  return TOOL_TYPE_MAP[raw.toLowerCase()] ?? null
}
function resolveToolSubtype(raw: string | undefined): string | null {
  if (!raw) return null
  return canonicalizeToolSubtypeValue(raw)
}

function resolveCountry(raw: string | undefined): string | null {
  if (!raw) return null
  const canonical = canonicalizeCountryValue(raw)
  return typeof canonical === "string" ? canonical : null
}

function buildProductSearchOptions(params: {
  material?: string
  diameter_mm?: number
  flute_count?: number
  operation_type?: string
  coating?: string
  keyword?: string
  tool_type?: string
  tool_subtype?: string
  country?: string
  tool_material?: string
}): { input: RecommendationInput; filters: AppliedFilter[] } {
  const input: RecommendationInput = {
    manufacturerScope: "yg1-only",
    locale: "ko",
  }

  if (params.material) input.material = params.material
  if (params.diameter_mm != null) input.diameterMm = params.diameter_mm
  if (params.operation_type) input.operationType = params.operation_type

  const country = resolveCountry(params.country)
  if (country && country !== "ALL") input.country = country
  if (params.tool_material) input.toolMaterial = params.tool_material

  // tool_type → edp_root_category mapping
  const rootCategory = resolveToolType(params.tool_type)
  if (rootCategory) input.toolType = rootCategory

  const filters: AppliedFilter[] = []
  if (params.flute_count != null) {
    filters.push({
      field: "fluteCount",
      op: "eq",
      value: `${params.flute_count}날`,
      rawValue: params.flute_count,
      appliedAt: 0,
    })
  }
  if (params.coating) {
    filters.push({
      field: "coating",
      op: "includes",
      value: params.coating,
      rawValue: params.coating,
      appliedAt: 0,
    })
  }

  return { input, filters }
}

async function executeSearchProducts(params: {
  material?: string
  diameter_mm?: number
  flute_count?: number
  operation_type?: string
  coating?: string
  keyword?: string
  tool_type?: string
  tool_subtype?: string
  country?: string
  tool_material?: string
  show_all?: boolean
  offset?: number
}): Promise<string> {
  const { input, filters } = buildProductSearchOptions(params)
  let results = await ProductRepo.search(input, filters, 200)
  const canonSubtype = resolveToolSubtype(params.tool_subtype)

  // ── Hard filter: tool_material (carbide vs HSS) ──
  if (params.tool_material) {
    const wanted = params.tool_material.toLowerCase()
    const filtered = results.filter(p => {
      const tm = (p.toolMaterial ?? "").toLowerCase()
      if (!tm) return false
      if (wanted === "carbide") return tm.includes("carbide") || tm.includes("초경") || tm.includes("cemented")
      if (wanted === "hss") return tm.includes("hss") || tm.includes("high speed") || tm.includes("하이스") || tm.includes("고속도")
      return tm.includes(wanted)
    })
    if (filtered.length > 0) results = filtered
  }

  // ── Hard filter 1: material ──
  if (params.material) {
    const tag = resolveMaterialTag(params.material)
    if (tag) {
      const filtered = results.filter(product => product.materialTags.includes(tag))
      if (filtered.length > 0) results = filtered
    }
  }

  // ── Hard filter 2: tool_type (드릴/엔드밀/탭 구분) ──
  if (params.tool_type) {
    const rootCat = resolveToolType(params.tool_type)
    if (rootCat) {
      const filtered = results.filter(p => {
        const pCat = (p.toolType ?? "").toLowerCase()
        return pCat.includes(rootCat.toLowerCase()) || pCat.includes(params.tool_type!.toLowerCase())
      })
      if (filtered.length > 0) results = filtered
    }
  }

  // ── Hard filter 3: tool_subtype (Square/Ball/Radius) ──
  if (canonSubtype) {
    const filtered = results.filter(p => {
      const pSub = (p.toolSubtype ?? "").toLowerCase()
      return pSub.includes(canonSubtype.toLowerCase())
    })
    if (filtered.length > 0) results = filtered
  }

  // ── Diameter: exact-first → near fallback ──
  let diameterNote: string | null = null
  if (params.diameter_mm != null) {
    const target = params.diameter_mm
    // Stage 1: exact match (0mm tolerance)
    const exact = results.filter(p => p.diameterMm != null && p.diameterMm === target)
    if (exact.length > 0) {
      results = exact
    } else {
      // Stage 2: near match (±0.5mm)
      const near = results.filter(p => p.diameterMm != null && Math.abs(p.diameterMm - target) <= 0.5)
      if (near.length > 0) {
        results = near
        diameterNote = `φ${target}mm 정확 매칭 없음. ±0.5mm 근접 직경으로 검색.`
      } else {
        // Stage 3: wider near (±2mm)
        const wider = results.filter(p => p.diameterMm != null && Math.abs(p.diameterMm - target) <= 2)
        if (wider.length > 0) {
          results = wider
          const nearDiameters = [...new Set(wider.map(p => p.diameterMm))].sort((a, b) => Math.abs(a! - target) - Math.abs(b! - target)).slice(0, 3)
          diameterNote = `φ${target}mm 제품 없음. 근접 직경: ${nearDiameters.map(d => `φ${d}mm`).join(", ")}`
        } else {
          // No products within ±2mm — don't return distant mismatches
          diameterNote = `φ${target}mm 및 근접 직경 제품을 찾지 못했습니다.`
          results = []
        }
      }
    }
  }

  // ── Keyword search ──
  const keyword = params.keyword
  if (keyword) {
    const filtered = results.filter(product => matchesKeyword(product, keyword))
    if (filtered.length > 0) {
      results = filtered
    } else if (results.length === 0) {
      const wideResults = await ProductRepo.search({ manufacturerScope: "yg1-only", locale: "ko" }, [], 500)
      const keywordMatched = wideResults.filter(product => matchesKeyword(product, keyword))
      if (keywordMatched.length > 0) results = keywordMatched
    }
  }

  let deduped = dedupeProductsBySeries(results)

  // ── Safe auto-relax: only soft constraints ──
  // NEVER relax: tool_type, tool_subtype (when explicit), diameter (hard)
  if (deduped.length === 0 && (params.operation_type || params.coating)) {
    const relaxedParams = { ...params, operation_type: undefined, coating: undefined }
    // Keep hard constraints
    const { input: rInput, filters: rFilters } = buildProductSearchOptions(relaxedParams)
    let relaxedResults = await ProductRepo.search(rInput, rFilters, 200)
    // Re-apply hard filters
    if (params.material) {
      const tag = resolveMaterialTag(params.material)
      if (tag) {
        const f = relaxedResults.filter(product => product.materialTags.includes(tag))
        if (f.length > 0) relaxedResults = f
      }
    }
    if (params.tool_type) {
      const rootCat = resolveToolType(params.tool_type)
      if (rootCat) {
        const f = relaxedResults.filter(p => (p.toolType ?? "").toLowerCase().includes(rootCat.toLowerCase()))
        if (f.length > 0) relaxedResults = f
      }
    }
    if (canonSubtype) {
      const f = relaxedResults.filter(p => (p.toolSubtype ?? "").toLowerCase().includes(canonSubtype.toLowerCase()))
      if (f.length > 0) relaxedResults = f
    }
    if (params.diameter_mm != null) {
      const f = relaxedResults.filter(p => p.diameterMm != null && Math.abs(p.diameterMm - params.diameter_mm!) <= 2)
      if (f.length > 0) relaxedResults = f
      else relaxedResults = [] // don't return distant diameter mismatches
    }
    if (keyword) {
      const f = relaxedResults.filter(product => matchesKeyword(product, keyword))
      if (f.length > 0) relaxedResults = f
    }
    deduped = dedupeProductsBySeries(relaxedResults)
    if (deduped.length > 0) {
      const totalDeduped = deduped.length
      const pageSize = params.show_all ? 100 : 10
      const offset = params.offset ?? 0
      const page = deduped.slice(offset, offset + pageSize)
      return JSON.stringify({
        count: page.length,
        totalMatched: totalDeduped,
        showing: `${offset + 1}~${offset + page.length}/${totalDeduped}`,
        hasMore: offset + page.length < totalDeduped,
        remainingCount: Math.max(0, totalDeduped - offset - page.length),
        relaxedFilter: "가공형상/코팅 필터를 완화하여 검색했습니다.",
        ...(diameterNote ? { diameterNote } : {}),
        products: page.map(slimProduct),
      })
    }
  }

  const totalDeduped = deduped.length

  if (deduped.length === 0) {
    return JSON.stringify({
      count: 0,
      totalMatched: 0,
      products: [],
      ...(diameterNote ? { diameterNote } : {}),
      message: diameterNote
        ? `${diameterNote} 다른 직경이나 조건으로 검색해보세요.`
        : "내부 DB에서 검색 조건에 맞는 제품을 찾지 못했습니다. 조건을 줄이거나 keyword로 시리즈명을 검색해보세요.",
    })
  }

  const pageSize = params.show_all ? 100 : 10
  const offset = params.offset ?? 0
  const page = deduped.slice(offset, offset + pageSize)

  return JSON.stringify({
    count: page.length,
    totalMatched: totalDeduped,
    showing: `${offset + 1}~${offset + page.length}/${totalDeduped}`,
    hasMore: offset + page.length < totalDeduped,
    remainingCount: Math.max(0, totalDeduped - offset - page.length),
    ...(diameterNote ? { diameterNote } : {}),
    products: page.map(slimProduct),
  })
}

function buildProductDetailPayload(
  products: CanonicalProduct[],
  representative: CanonicalProduct,
  matchedProduct?: CanonicalProduct
): string {
  const variants = products.map(product => ({
    displayCode: product.displayCode,
    diameterMm: product.diameterMm,
    fluteCount: product.fluteCount,
    coating: product.coating,
    lengthOfCutMm: product.lengthOfCutMm,
    overallLengthMm: product.overallLengthMm,
    shankDiameterMm: product.shankDiameterMm,
  }))

  return JSON.stringify({
    found: true,
    displayCode: matchedProduct?.displayCode ?? representative.displayCode,
    seriesName: representative.seriesName,
    brand: representative.brand,
    toolType: representative.toolType,
    toolSubtype: representative.toolSubtype,
    materialTags: representative.materialTags,
    applicationShapes: representative.applicationShapes,
    featureText: representative.featureText,
    coating: representative.coating,
    coolantHole: representative.coolantHole,
    matchedProduct: matchedProduct
      ? {
          displayCode: matchedProduct.displayCode,
          diameterMm: matchedProduct.diameterMm,
          fluteCount: matchedProduct.fluteCount,
          coating: matchedProduct.coating,
          lengthOfCutMm: matchedProduct.lengthOfCutMm,
          overallLengthMm: matchedProduct.overallLengthMm,
          shankDiameterMm: matchedProduct.shankDiameterMm,
        }
      : null,
    variantCount: variants.length,
    variants: variants.slice(0, 20),
  })
}

async function executeSearchProductByEdp(params: {
  edp_code?: string
}): Promise<string> {
  if (!params.edp_code?.trim()) {
    return JSON.stringify({
      found: false,
      message: "edp_code가 필요합니다.",
    })
  }

  const found = await ProductRepo.findByCode(params.edp_code)
  if (!found) {
    return JSON.stringify({
      found: false,
      edpCode: params.edp_code,
      message: "내부 DB에서 해당 EDP 제품 코드를 찾지 못했습니다. 코드 오타를 확인하거나 web_search 도구로 웹 카탈로그를 검색해보세요.",
    })
  }

  const products = found.seriesName
    ? await ProductRepo.findBySeries(found.seriesName)
    : [found]

  return buildProductDetailPayload(products, products[0] ?? found, found)
}

async function executeGetProductDetail(params: {
  product_code?: string
  series_name?: string
}): Promise<string> {
  let products: CanonicalProduct[] = []

  if (params.product_code) {
    const found = await ProductRepo.findByCode(params.product_code)
    if (found) {
      if (found.seriesName) {
        products = await ProductRepo.findBySeries(found.seriesName)
      } else {
        products = [found]
      }
    }
  }

  if (products.length === 0 && params.series_name) {
    products = await ProductRepo.findBySeries(params.series_name)
  }

  if (products.length === 0) {
    return JSON.stringify({
      found: false,
      message: "내부 DB에서 해당 제품을 찾지 못했습니다. web_search 도구로 웹에서 검색해보세요.",
    })
  }

  return buildProductDetailPayload(
    products,
    products[0],
    products.find(product => normalizeProductCode(product.displayCode) === normalizeProductCode(params.product_code))
  )
}

async function executeGetCuttingConditions(params: {
  series_name?: string
  product_code?: string
  material?: string
}): Promise<string> {
  const isoGroup = params.material ? resolveMaterialTag(params.material) : null

  if (params.product_code) {
    const product = await ProductRepo.findByCode(params.product_code)
    const chunks = await EvidenceRepo.findForProduct(params.product_code, {
      seriesName: product?.seriesName,
      isoGroup,
      diameterMm: product?.diameterMm,
    })
    if (chunks.length > 0) {
      return JSON.stringify({
        found: true,
        source: "product_code",
        productCode: params.product_code,
        matchedSeriesName: product?.seriesName ?? null,
        matchedDiameterMm: product?.diameterMm ?? null,
        conditions: chunks.slice(0, 5).map(chunk => ({
          isoGroup: chunk.isoGroup,
          cuttingType: chunk.cuttingType,
          diameterMm: chunk.diameterMm,
          Vc: chunk.conditions.Vc,
          fz: chunk.conditions.fz,
          ap: chunk.conditions.ap,
          ae: chunk.conditions.ae,
          n: chunk.conditions.n,
          vf: chunk.conditions.vf,
          confidence: chunk.confidence,
          sourceFile: chunk.sourceFile,
        })),
      })
    }
  }

  if (params.series_name) {
    const chunks = await EvidenceRepo.findBySeriesName(params.series_name, { isoGroup })
    let filtered = chunks
    if (isoGroup) {
      const isoFiltered = chunks.filter(
        chunk => chunk.isoGroup?.toUpperCase() === isoGroup.toUpperCase()
      )
      if (isoFiltered.length > 0) filtered = isoFiltered
    }
    filtered.sort((a, b) => b.confidence - a.confidence)

    if (filtered.length > 0) {
      return JSON.stringify({
        found: true,
        source: "series_name",
        seriesName: params.series_name,
        conditions: filtered.slice(0, 5).map(chunk => ({
          isoGroup: chunk.isoGroup,
          cuttingType: chunk.cuttingType,
          diameterMm: chunk.diameterMm,
          Vc: chunk.conditions.Vc,
          fz: chunk.conditions.fz,
          ap: chunk.conditions.ap,
          ae: chunk.conditions.ae,
          n: chunk.conditions.n,
          vf: chunk.conditions.vf,
          confidence: chunk.confidence,
          sourceFile: chunk.sourceFile,
        })),
      })
    }
  }

  if (isoGroup) {
    const chunks = await EvidenceRepo.filterByConditions({ isoGroup })
    if (chunks.length > 0) {
      chunks.sort((a, b) => b.confidence - a.confidence)
      return JSON.stringify({
        found: true,
        source: "material_filter",
        isoGroup,
        note: "특정 제품/시리즈를 지정하지 않아 해당 소재 그룹의 일반적인 절삭조건 샘플입니다.",
        conditions: chunks.slice(0, 5).map(chunk => ({
          seriesName: chunk.seriesName,
          productCode: chunk.productCode,
          isoGroup: chunk.isoGroup,
          cuttingType: chunk.cuttingType,
          diameterMm: chunk.diameterMm,
          Vc: chunk.conditions.Vc,
          fz: chunk.conditions.fz,
          ap: chunk.conditions.ap,
          ae: chunk.conditions.ae,
          confidence: chunk.confidence,
        })),
      })
    }
  }

  return JSON.stringify({
    found: false,
    message: "내부 DB에서 해당 조건의 절삭조건 데이터를 찾지 못했습니다. web_search 도구로 웹에서 카탈로그 절삭조건을 검색해보세요.",
  })
}

// ── Cross-reference shape group matching ──
const SHAPE_GROUPS: Record<string, string[]> = {
  square:  ["square", "flat end", "스퀘어", "평엔드밀"],
  ball:    ["ball", "볼", "ball nose", "ballnose"],
  radius:  ["radius", "corner r", "corner radius", "코너r", "코너R", "코너라디우스"],
  chamfer: ["chamfer", "bevel", "챔퍼"],
  roughing:["roughing", "hog", "corn cob", "황삭"],
  drill:   ["drill", "드릴"],
  tap:     ["tap", "탭"],
}

function getShapeGroup(shapeStr: string): string {
  const s = shapeStr.toLowerCase().replace(/\s/g, "")
  for (const [group, keywords] of Object.entries(SHAPE_GROUPS)) {
    if (keywords.some(k => s.includes(k.replace(/\s/g, "")))) return group
  }
  return "unknown"
}

async function executeGetCompetitorMapping(
  params: {
    competitor_name?: string
    competitor_product?: string
  },
  deps: ChatToolRuntimeDeps
): Promise<string> {
  const query = params.competitor_product
    ? `${params.competitor_product} cutting tool specifications diameter flute coating material`
    : params.competitor_name
      ? `${params.competitor_name} cutting tool endmill drill tap product lineup specifications`
      : null

  if (!query) {
    return JSON.stringify({ found: false, message: "경쟁사 이름 또는 제품 코드를 입력해주세요." })
  }

  // Step 0: 코드파싱 먼저 (빠름 ~2초) → 충분하면 웹검색 skip
  let codeParseSpecs: Record<string, unknown> | null = null
  if (params.competitor_product && deps.client) {
    try {
      let parsingPolicy: string
      try {
        const { readFileSync } = await import("fs")
        const { join } = await import("path")
        parsingPolicy = readFileSync(join(process.cwd(), "data", "competitor-code-parsing-policy.md"), "utf-8")
      } catch {
        parsingPolicy = "절삭공구 전문가로서 경쟁사 제품 코드를 분석하여 스펙을 JSON으로 추정하세요."
      }
      const parseResp = await deps.client.messages.create({
        model: deps.anthropicChatModel as Parameters<typeof deps.client.messages.create>[0]["model"],
        max_tokens: 500,
        system: parsingPolicy,
        messages: [{ role: "user", content: `제품코드: "${params.competitor_product}"\nJSON만 반환:` }],
      })
      const parseText = parseResp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map(b => b.text).join("")
      const parseMatch = parseText.match(/\{[\s\S]*\}/)
      if (parseMatch) {
        codeParseSpecs = JSON.parse(parseMatch[0])
        console.log(`[competitor-xref] code parse: ${JSON.stringify(codeParseSpecs)}`)
      }
    } catch (err) {
      console.warn("[competitor-mapping] Code parse failed:", err)
    }
  }

  // Step 1: 웹서치 (코드파싱이 high confidence면 skip)
  const skipWebSearch = codeParseSpecs && (codeParseSpecs as any).confidence === "high" && (codeParseSpecs as any).diameter_mm
  let webSpecs: string | null = null
  if (!skipWebSearch && deps.client) {
    try {
      const searchPrompt = params.competitor_product
        ? `Search for the cutting tool "${params.competitor_product}" specifications. Look for:
1. Official manufacturer product page or PDF catalog
2. Distributor pages with detailed specs
3. Technical data sheets

Extract ALL of these specs:
- Exact diameter (mm)
- Number of flutes/teeth
- Coating type and name
- Applicable ISO material groups (P/M/K/N/S/H)
- Tool shape (Square/Ball/Radius/Chamfer/Roughing)
- Length of cut (LOC) in mm
- Overall length (OAL) in mm
- Helix angle
- Shank diameter

Return as detailed structured text with ALL specs found.`
        : `Find specifications for: ${query}\n\nExtract: diameter, flutes, coating, materials (ISO P/M/K/N/S/H), tool type.`

      const resp = await createAnthropicMessageWithLogging({
        client: deps.client,
        route: deps.route,
        operation: "competitor_web_search",
        request: {
          model: deps.anthropicChatModel as Parameters<typeof deps.client.messages.create>[0]["model"],
          max_tokens: 1000,
          tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 1 }],
          messages: [{
            role: "user",
            content: searchPrompt,
          }],
        },
      })
      const textBlocks = resp.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      )
      webSpecs = textBlocks.map(block => block.text).join("\n")
      console.log(`[competitor-xref] web search result length: ${webSpecs?.length ?? 0}`)
    } catch (err) {
      console.warn("[competitor-mapping] Web search failed:", err)
    }
  }

  // (코드파싱은 Step 0으로 이동됨)

  // Step 2: 웹서치 결과에서 스펙 추출 → YG-1 대체품 검색
  if (webSpecs && deps.client) {
    try {
      const extractResp = await createAnthropicMessageWithLogging({
        client: deps.client,
        route: deps.route,
        operation: "competitor_spec_extract",
        request: {
          model: deps.anthropicChatModel as Parameters<typeof deps.client.messages.create>[0]["model"],
          max_tokens: 1500,
          messages: [{
            role: "user",
            content: `From this text, extract cutting tool specs as JSON. Only include fields you're confident about.\n\n${webSpecs.slice(0, 1500)}\n\nJSON: {"diameter_mm":null,"flute_count":null,"coating":null,"material":"","tool_type":"","tool_shape":"square|ball|radius|chamfer|roughing|drill|tap|null","iso_groups":[]}
\ntool_shape: square(flat end mill), ball(ball nose), radius(corner R), chamfer, roughing, drill, tap
\niso_groups: array of ISO material groups this tool supports, e.g. ["P","M","K","S","N"]`,
          }],
        },
      })
      const extractText = extractResp.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      ).map(b => b.text).join("")

      const cleaned = extractText.replace(/```json\n?|\n?```/g, "").trim()
      let specs = JSON.parse(cleaned)

      // Merge: web search is primary, code parse only fills gaps
      if (codeParseSpecs) {
        const cp = codeParseSpecs as Record<string, unknown>
        if (!specs.diameter_mm && cp.diameter_mm) specs.diameter_mm = cp.diameter_mm
        if (!specs.flute_count && cp.flute_count) specs.flute_count = cp.flute_count
        if (!specs.tool_shape && cp.tool_shape) specs.tool_shape = cp.tool_shape
        if (!specs.coating && cp.coating) specs.coating = cp.coating
        if ((!specs.iso_groups || specs.iso_groups.length === 0) && cp.iso_groups) specs.iso_groups = cp.iso_groups
        console.log(`[competitor-xref] merged (web+codeParse):`, JSON.stringify(specs))
      }

      // Step 3: 추출된 스펙으로 YG-1 내부 DB 검색
      const searchInput: RecommendationInput = { manufacturerScope: "yg1-only", locale: "ko" }
      if (specs.diameter_mm) searchInput.diameterMm = specs.diameter_mm
      if (specs.material) searchInput.material = specs.material

      // 크로스레퍼런스에서는 날수 필터만 적용 — 코팅은 경쟁사≠YG-1이므로 필터 안 함
      const searchFilters: AppliedFilter[] = []
      if (specs.flute_count) {
        searchFilters.push({ field: "fluteCount", op: "eq", value: `${specs.flute_count}날`, rawValue: specs.flute_count, appliedAt: 0 })
      }
      // 코팅은 크로스레퍼런스에서 제외 (SECO SIRA ≠ YG-1 T-Coating이므로 매칭 불가)

      let alternatives = await ProductRepo.search(searchInput, searchFilters, 200)
      console.log(`[competitor-xref] DB search: input=${JSON.stringify(searchInput)}, filters=${JSON.stringify(searchFilters)}, results=${alternatives.length}`)
      console.log(`[competitor-xref] sample products:`, alternatives.slice(0, 3).map(p => `${p.displayCode}(${p.toolSubtype},d=${p.diameterMm})`).join(", "))

      if (specs.diameter_mm) {
        const diam = specs.diameter_mm
        const beforeDiam = alternatives.length
        alternatives = alternatives.filter(p => p.diameterMm != null && Math.abs(p.diameterMm - diam) <= 1)
        console.log(`[competitor-xref] diameter filter: ±1mm of ${diam} → ${alternatives.length} (from ${beforeDiam})`)
      }

      // ── Cross-reference hard filters: shape + material group ──
      // Shape filter: competitor shape must match YG-1 shape group
      // Also try to infer shape from tool_type if tool_shape is missing
      const competitorShape = specs.tool_shape ?? specs.tool_type ?? ""
      const srcGroup = getShapeGroup(competitorShape)
      console.log(`[competitor-xref] shape filter: input="${competitorShape}" → group="${srcGroup}", candidates before=${alternatives.length}`)

      if (srcGroup !== "unknown") {
        const shapeFiltered = alternatives.filter(p => {
          // Check toolSubtype, toolType, AND description/featureText for shape keywords
          const fields = [
            p.toolSubtype ?? "",
            p.toolType ?? "",
            p.description ?? "",
            p.featureText ?? "",
          ].join(" ")
          const candGroup = getShapeGroup(fields)
          return candGroup === srcGroup
        })
        console.log(`[competitor-xref] shape filter: ${srcGroup} → ${shapeFiltered.length} matches (from ${alternatives.length})`)
        if (shapeFiltered.length > 0) {
          alternatives = shapeFiltered
        } else {
          console.log(`[competitor-xref] shape filter returned 0, keeping all ${alternatives.length} candidates`)
        }
      }

      // ISO material group intersection filter
      const srcIsoGroups = new Set<string>(
        (specs.iso_groups ?? []).map((g: string) => g.toUpperCase())
      )
      console.log(`[competitor-xref] material filter: srcGroups=${[...srcIsoGroups].join(",")}, candidates before=${alternatives.length}`)

      if (srcIsoGroups.size > 0) {
        const materialFiltered = alternatives.filter(p => {
          if (!p.materialTags || p.materialTags.length === 0) return true
          const intersection = p.materialTags.filter(t => srcIsoGroups.has(t.toUpperCase()))
          return intersection.length > 0
        })
        console.log(`[competitor-xref] material filter: ${materialFiltered.length} matches (from ${alternatives.length})`)
        if (materialFiltered.length > 0) alternatives = materialFiltered
      }

      const deduped = dedupeProductsBySeries(alternatives)

      return JSON.stringify({
        found: true,
        source: "web_search_then_internal_db",
        competitorQuery: params.competitor_product ?? params.competitor_name,
        extractedSpecs: specs,
        webSearchSummary: webSpecs.slice(0, 500),
        yg1Alternatives: deduped.slice(0, 5).map(slimProduct),
        note: deduped.length > 0
          ? `웹 검색으로 경쟁사 제품 스펙을 확인한 뒤, 유사한 YG-1 제품 ${deduped.length}개를 찾았습니다.`
          : "웹 검색으로 스펙을 확인했지만, 정확히 매칭되는 YG-1 제품이 없습니다. 조건을 완화해서 search_products로 재검색해보세요.",
        disclaimer: "⚠️ 경쟁사 스펙은 웹 검색 결과 기반이며, 정확한 수치는 해당 제조사 카탈로그를 확인하세요.",
      })
    } catch (err) {
      console.warn("[competitor-mapping] Spec extraction failed:", err)
    }
  }

  // Fallback 1: 코드 파싱만으로 YG-1 매칭 시도 (웹서치 실패 시)
  if (codeParseSpecs && deps.client) {
    try {
      const cp = codeParseSpecs as Record<string, unknown>
      const searchInput: RecommendationInput = { manufacturerScope: "yg1-only", locale: "ko" }
      if (cp.diameter_mm) searchInput.diameterMm = cp.diameter_mm as number

      const searchFilters: AppliedFilter[] = []
      if (cp.flute_count) {
        searchFilters.push({ field: "fluteCount", op: "eq", value: `${cp.flute_count}날`, rawValue: cp.flute_count as number, appliedAt: 0 })
      }

      let alternatives = await ProductRepo.search(searchInput, searchFilters, 200)
      if (cp.diameter_mm) {
        const diam = cp.diameter_mm as number
        alternatives = alternatives.filter(p => p.diameterMm != null && Math.abs(p.diameterMm - diam) <= 1)
      }

      // Shape filter
      const cpShape = (cp.tool_shape as string) ?? ""
      const cpShapeGroup = getShapeGroup(cpShape)
      if (cpShapeGroup !== "unknown") {
        const filtered = alternatives.filter(p => {
          const fields = [p.toolSubtype ?? "", p.toolType ?? "", p.description ?? "", p.featureText ?? ""].join(" ")
          return getShapeGroup(fields) === cpShapeGroup
        })
        if (filtered.length > 0) alternatives = filtered
      }

      // Material filter
      const cpIso = new Set<string>(((cp.iso_groups as string[]) ?? []).map(g => g.toUpperCase()))
      if (cpIso.size > 0) {
        const filtered = alternatives.filter(p => {
          if (!p.materialTags || p.materialTags.length === 0) return true
          return p.materialTags.some(t => cpIso.has(t.toUpperCase()))
        })
        if (filtered.length > 0) alternatives = filtered
      }

      const deduped = dedupeProductsBySeries(alternatives)
      if (deduped.length > 0) {
        return JSON.stringify({
          found: true,
          source: "code_parse_then_internal_db",
          competitorQuery: params.competitor_product,
          extractedSpecs: cp,
          yg1Alternatives: deduped.slice(0, 5).map(slimProduct),
          note: `제품 코드 분석으로 스펙을 추정하여 YG-1 제품 ${deduped.length}개를 찾았습니다.`,
          disclaimer: `⚠️ AI 코드 파싱 기반 추정 (${(cp.confidence as string) ?? "medium"}) — ${(cp.parse_notes as string) ?? ""}`,
        })
      }
    } catch (err) {
      console.warn("[competitor-mapping] Code parse DB search failed:", err)
    }
  }

  // Fallback 2: 웹서치 결과만 반환
  if (webSpecs) {
    return JSON.stringify({
      found: true,
      source: "web_search_only",
      competitorQuery: params.competitor_product ?? params.competitor_name,
      webSearchResult: webSpecs.slice(0, 800),
      note: "경쟁사 제품 정보를 웹에서 찾았습니다. 스펙 추출이 어려워 자동 매칭은 하지 못했습니다. search_products 도구로 유사 스펙을 직접 검색해보세요.",
      disclaimer: "⚠️ 웹 검색 결과 기반 — 정확한 수치는 해당 제조사 카탈로그를 확인하세요.",
    })
  }

  return JSON.stringify({
    found: false,
    message: "경쟁사 제품 정보를 찾지 못했습니다. 제품 코드나 정확한 경쟁사명을 입력해주세요.",
    knownCompetitors: ["Sandvik Coromant", "Kennametal", "OSG", "Walter", "Mitsubishi", "Hitachi", "Nachi", "IMC(이스카)"],
  })
}

async function executeFindYG1Alternative(params: {
  product_code?: string
  reason?: string
}): Promise<string> {
  if (!params.product_code?.trim()) {
    return JSON.stringify({ found: false, message: "제품 코드를 입력해주세요." })
  }

  // Step 1: 원본 제품 스펙 조회
  const original = await ProductRepo.findByCode(params.product_code.trim())
  if (!original) {
    return JSON.stringify({ found: false, message: `${params.product_code} 제품을 찾을 수 없습니다.` })
  }

  // Step 2: 같은 조건으로 대체품 검색
  const searchInput: RecommendationInput = {
    manufacturerScope: "yg1-only",
    locale: "ko",
    diameterMm: original.diameterMm ?? undefined,
    toolSubtype: original.toolSubtype ?? undefined,
  }

  const filters: AppliedFilter[] = []
  if (original.fluteCount) {
    filters.push({ field: "fluteCount", op: "eq", value: `${original.fluteCount}날`, rawValue: original.fluteCount, appliedAt: 0 })
  }

  let alternatives = await ProductRepo.search(searchInput, filters, 100)

  // 직경 exact match
  if (original.diameterMm) {
    alternatives = alternatives.filter(p => p.diameterMm === original.diameterMm)
  }

  // 형상 match
  if (original.toolSubtype) {
    const sub = original.toolSubtype.toLowerCase()
    const shaped = alternatives.filter(p => (p.toolSubtype ?? "").toLowerCase().includes(sub))
    if (shaped.length > 0) alternatives = shaped
  }

  // 소재 match (교집합)
  if (original.materialTags.length > 0) {
    const matFiltered = alternatives.filter(p =>
      p.materialTags.some(t => original.materialTags.includes(t))
    )
    if (matFiltered.length > 0) alternatives = matFiltered
  }

  // 원본 제외
  alternatives = alternatives.filter(p => p.normalizedCode !== original.normalizedCode)

  // 재고 확인 + 정렬 (재고 있는 것 우선) — N+1 제거: 단일 배치 쿼리
  const { InventoryRepo } = await import("@/lib/data/repos/inventory-repo")
  const top = alternatives.slice(0, 20)
  const invMap = await InventoryRepo.getEnrichedBatchAsync(top.map(p => p.normalizedCode))
  const enriched = top.map(p => {
    const inv = invMap.get(p.normalizedCode)
    return {
      product: p,
      stockStatus: inv?.stockStatus ?? "unknown",
      totalStock: inv?.totalStock ?? 0,
    }
  })

  enriched.sort((a, b) => {
    const stockOrder: Record<string, number> = { instock: 0, limited: 1, unknown: 2, outofstock: 3 }
    return (stockOrder[a.stockStatus] ?? 3) - (stockOrder[b.stockStatus] ?? 3)
  })

  const deduped = dedupeProductsBySeries(enriched.map(e => e.product))

  return JSON.stringify({
    found: deduped.length > 0,
    originalProduct: {
      displayCode: original.displayCode,
      seriesName: original.seriesName,
      brand: original.brand,
      diameterMm: original.diameterMm,
      fluteCount: original.fluteCount,
      coating: original.coating,
      toolSubtype: original.toolSubtype,
      materialTags: original.materialTags,
    },
    reason: params.reason ?? "대체품 검색",
    alternativeCount: deduped.length,
    alternatives: deduped.slice(0, 5).map(slimProduct),
    note: deduped.length > 0
      ? `${original.displayCode}와 동일 스펙(φ${original.diameterMm}mm, ${original.toolSubtype})의 대체품 ${deduped.length}개를 찾았습니다.`
      : `${original.displayCode}와 동일 스펙의 대체품을 찾지 못했습니다. 직경이나 형상을 변경해서 검색해보세요.`,
  })
}

export async function executeChatTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  deps: ChatToolRuntimeDeps
): Promise<string> {
  try {
    switch (toolName) {
      case "search_products":
        return await executeSearchProducts(
          toolInput as Parameters<typeof executeSearchProducts>[0]
        )
      case "search_product_by_edp":
        return await executeSearchProductByEdp(
          toolInput as Parameters<typeof executeSearchProductByEdp>[0]
        )
      case "get_product_detail":
        return await executeGetProductDetail(
          toolInput as Parameters<typeof executeGetProductDetail>[0]
        )
      case "get_cutting_conditions":
        return executeGetCuttingConditions(
          toolInput as Parameters<typeof executeGetCuttingConditions>[0]
        )
      case "get_competitor_mapping":
        return await executeGetCompetitorMapping(
          toolInput as Parameters<typeof executeGetCompetitorMapping>[0],
          deps
        )
      case "find_yg1_alternative":
        return await executeFindYG1Alternative(
          toolInput as Parameters<typeof executeFindYG1Alternative>[0]
        )
      case "query_yg1_knowledge":
        return await executeQueryYG1Knowledge(
          toolInput as Parameters<typeof executeQueryYG1Knowledge>[0]
        )
      case "web_search":
        return await executeWebSearch(
          toolInput as Parameters<typeof executeWebSearch>[0],
          deps
        )
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Tool ${toolName} error:`, msg)
    await logRuntimeError({
      category: "error",
      event: "chat.tool.error",
      error: err,
      context: {
        route: deps.route,
        toolName,
        toolInput,
      },
    })
    return JSON.stringify({ error: msg })
  }
}
