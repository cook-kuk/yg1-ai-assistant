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
import { resolveYG1Query, buildNotFoundResponse } from "@/lib/knowledge/knowledge-router"

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

function executeQueryYG1Knowledge(params: { query: string }): string {
  const result = resolveYG1Query(params.query)

  if (result.source === "internal_kb") {
    return JSON.stringify({
      found: true,
      source: "internal_kb",
      answer: result.answer,
      badge: "✓ YG-1 공식 정보",
    })
  }

  if (result.needsWebSearch) {
    return JSON.stringify({
      found: false,
      source: "needs_web_search",
      message: `내부 KB에 "${params.query}" 관련 정보가 없습니다. web_search 도구로 "YG-1 ${params.query}"를 검색해보세요.`,
      suggestedQuery: `YG-1 와이지원 ${params.query}`,
    })
  }

  const notFound = buildNotFoundResponse(params.query)
  return JSON.stringify({
    found: false,
    source: "not_found",
    answer: notFound.answer,
    badge: "ℹ 정보 없음",
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
    applicationShapes: product.applicationShapes,
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

function buildProductSearchOptions(params: {
  material?: string
  diameter_mm?: number
  flute_count?: number
  operation_type?: string
  coating?: string
  keyword?: string
}): { input: RecommendationInput; filters: AppliedFilter[] } {
  const input: RecommendationInput = {
    manufacturerScope: "yg1-only",
    locale: "ko",
  }

  if (params.material) input.material = params.material
  if (params.diameter_mm != null) input.diameterMm = params.diameter_mm
  if (params.operation_type) input.operationType = params.operation_type

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
  if (params.keyword) {
    filters.push({
      field: "seriesName",
      op: "includes",
      value: params.keyword,
      rawValue: params.keyword,
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
  show_all?: boolean
  offset?: number
}): Promise<string> {
  const { input, filters } = buildProductSearchOptions(params)
  let results = await ProductRepo.search(input, filters, 200)

  if (params.material) {
    const tag = resolveMaterialTag(params.material)
    if (tag) {
      const filtered = results.filter(product => product.materialTags.includes(tag))
      if (filtered.length > 0) results = filtered
    }
  }

  const keyword = params.keyword
  if (keyword) {
    const filtered = results.filter(product => matchesKeyword(product, keyword))
    if (filtered.length > 0) results = filtered
  }

  let deduped = dedupeProductsBySeries(results)

  // Auto-relax: 0건이면 operation_type 빼고 재검색
  if (deduped.length === 0 && params.operation_type) {
    const relaxedParams = { ...params, operation_type: undefined }
    const { input: rInput, filters: rFilters } = buildProductSearchOptions(relaxedParams)
    let relaxedResults = await ProductRepo.search(rInput, rFilters, 200)
    if (params.material) {
      const tag = resolveMaterialTag(params.material)
      if (tag) {
        const filtered = relaxedResults.filter(product => product.materialTags.includes(tag))
        if (filtered.length > 0) relaxedResults = filtered
      }
    }
    if (keyword) {
      const filtered = relaxedResults.filter(product => matchesKeyword(product, keyword))
      if (filtered.length > 0) relaxedResults = filtered
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
        relaxedFilter: "operation_type 필터를 완화하여 검색했습니다. 가공형상(operation_type) 매칭이 정확하지 않을 수 있습니다.",
        products: page.map(slimProduct),
      })
    }
  }

  // Auto-relax: 여전히 0건이면 coating도 빼고 재검색
  if (deduped.length === 0 && params.coating) {
    const relaxedParams = { ...params, operation_type: undefined, coating: undefined }
    const { input: rInput, filters: rFilters } = buildProductSearchOptions(relaxedParams)
    let relaxedResults = await ProductRepo.search(rInput, rFilters, 200)
    if (params.material) {
      const tag = resolveMaterialTag(params.material)
      if (tag) {
        const filtered = relaxedResults.filter(product => product.materialTags.includes(tag))
        if (filtered.length > 0) relaxedResults = filtered
      }
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
        relaxedFilter: "operation_type + coating 필터를 완화하여 검색했습니다.",
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
      message: "내부 DB에서 검색 조건에 맞는 제품을 찾지 못했습니다. 조건을 줄이거나 keyword로 시리즈명을 검색해보세요.",
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

  // Step 1: 웹서치로 경쟁사 제품 스펙 조회
  let webSpecs: string | null = null
  if (deps.client) {
    try {
      const resp = await createAnthropicMessageWithLogging({
        client: deps.client,
        route: deps.route,
        operation: "competitor_web_search",
        request: {
          model: deps.anthropicChatModel as Parameters<typeof deps.client.messages.create>[0]["model"],
          max_tokens: 1500,
          tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 2 }],
          messages: [{
            role: "user",
            content: `Find specifications for this cutting tool: ${query}\n\nExtract: diameter (mm), number of flutes, coating type, applicable materials (ISO P/M/K/N/S/H), tool type (endmill/drill/tap). Return as structured text.`,
          }],
        },
      })
      const textBlocks = resp.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      )
      webSpecs = textBlocks.map(block => block.text).join("\n")
    } catch (err) {
      console.warn("[competitor-mapping] Web search failed:", err)
    }
  }

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
            content: `From this text, extract cutting tool specs as JSON. Only include fields you're confident about.\n\n${webSpecs.slice(0, 1500)}\n\nJSON: {"diameter_mm":null,"flute_count":null,"coating":null,"material":"","tool_type":""}`,
          }],
        },
      })
      const extractText = extractResp.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      ).map(b => b.text).join("")

      const cleaned = extractText.replace(/```json\n?|\n?```/g, "").trim()
      const specs = JSON.parse(cleaned)

      // Step 3: 추출된 스펙으로 YG-1 내부 DB 검색
      const searchInput: RecommendationInput = { manufacturerScope: "yg1-only", locale: "ko" }
      if (specs.diameter_mm) searchInput.diameterMm = specs.diameter_mm
      if (specs.material) searchInput.material = specs.material

      const searchFilters: AppliedFilter[] = []
      if (specs.flute_count) {
        searchFilters.push({ field: "fluteCount", op: "eq", value: `${specs.flute_count}날`, rawValue: specs.flute_count, appliedAt: 0 })
      }
      if (specs.coating) {
        searchFilters.push({ field: "coating", op: "includes", value: specs.coating, rawValue: specs.coating, appliedAt: 0 })
      }

      let alternatives = await ProductRepo.search(searchInput, searchFilters, 100)
      if (specs.diameter_mm) {
        const diam = specs.diameter_mm
        alternatives = alternatives.filter(p => p.diameterMm != null && Math.abs(p.diameterMm - diam) <= 1)
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

  // Fallback: 웹서치 결과만 반환
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
      case "query_yg1_knowledge":
        return executeQueryYG1Knowledge(
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
