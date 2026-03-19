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
        max_tokens: 1024,
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

  const deduped = dedupeProductsBySeries(results)
  const totalDeduped = deduped.length

  if (deduped.length === 0) {
    return JSON.stringify({
      count: 0,
      totalMatched: 0,
      products: [],
      message: "내부 DB에서 검색 조건에 맞는 제품을 찾지 못했습니다. web_search 도구로 웹에서 카탈로그를 검색해보세요.",
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

async function executeGetCompetitorMapping(params: {
  competitor_name?: string
  competitor_product?: string
}): Promise<string> {
  const competitors = CompetitorRepo.getAll()

  if (params.competitor_product) {
    const found = CompetitorRepo.findByCode(params.competitor_product)
    if (found) {
      const alternativeInput: RecommendationInput = {
        manufacturerScope: "yg1-only",
        locale: "ko",
      }
      if (found.diameterMm != null) alternativeInput.diameterMm = found.diameterMm

      const alternativeFilters: AppliedFilter[] = []
      if (found.fluteCount != null) {
        alternativeFilters.push({
          field: "fluteCount",
          op: "eq",
          value: `${found.fluteCount}날`,
          rawValue: found.fluteCount,
          appliedAt: 0,
        })
      }
      if (found.coating) {
        alternativeFilters.push({
          field: "coating",
          op: "includes",
          value: found.coating,
          rawValue: found.coating,
          appliedAt: 0,
        })
      }

      let alternatives = await ProductRepo.search(alternativeInput, alternativeFilters, 100)
      alternatives = alternatives.filter(product => {
        let match = true
        if (found.diameterMm !== null && product.diameterMm !== null) {
          match = match && Math.abs(product.diameterMm - found.diameterMm) <= 1
        }
        if (found.fluteCount !== null && product.fluteCount !== null) {
          match = match && product.fluteCount === found.fluteCount
        }
        return match
      })

      const deduped = dedupeProductsBySeries(alternatives)

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
      product =>
        product.manufacturer?.toLowerCase().includes(q) ||
        product.brand?.toLowerCase().includes(q)
    )

    if (filtered.length > 0) {
      const seriesSeen = new Set<string>()
      const deduped = filtered.filter(product => {
        const key = product.seriesName ?? product.displayCode
        if (seriesSeen.has(key)) return false
        seriesSeen.add(key)
        return true
      })

      return JSON.stringify({
        found: true,
        competitorName: params.competitor_name,
        competitorProducts: deduped.slice(0, 10).map(product => ({
          displayCode: product.displayCode,
          seriesName: product.seriesName,
          diameterMm: product.diameterMm,
          fluteCount: product.fluteCount,
          coating: product.coating,
          materialTags: product.materialTags,
        })),
        note: "위 경쟁사 제품과 유사한 YG-1 제품을 찾으려면 search_products 도구로 같은 스펙(직경, 날수, 소재)을 검색하세요.",
      })
    }
  }

  return JSON.stringify({
    found: false,
    message: "내부 DB에서 해당 경쟁사 제품 정보를 찾지 못했습니다. web_search 도구로 웹에서 검색해보세요.",
    availableCompetitors: [
      ...new Set(competitors.map(product => product.manufacturer).filter(Boolean)),
    ].slice(0, 10),
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
          toolInput as Parameters<typeof executeGetCompetitorMapping>[0]
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
