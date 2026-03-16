/**
 * /api/chat — YG-1 AI Chat with Tool Use Architecture
 *
 * Uses Sonnet 4.5 + Anthropic Tool Use instead of dumping all products into context.
 * Tools: search_products, search_product_by_edp, get_product_detail, get_cutting_conditions, get_competitor_mapping, web_search
 */

import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { notifyChatResponse, notifyError, notifyLlmCall } from "@/lib/slack-notifier"
import { buildStateFromHistory, buildRetrievalMemory, buildStructuredContext, logConversationState, type RetrievalMemory } from "@/lib/domain/conversation-state"
import { ProductRepo } from "@/lib/data/repos/product-repo"
import { EvidenceRepo } from "@/lib/data/repos/evidence-repo"
import { CompetitorRepo } from "@/lib/data/repos/competitor-repo"
import { resolveMaterialTag } from "@/lib/domain/material-resolver"
import type { AppliedFilter } from "@/lib/types/exploration"
import type { CanonicalProduct, RecommendationInput } from "@/lib/types/canonical"

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

  return `당신은 YG-1의 절삭공구 추천 어시스턴트입니다. 파라미터 기반 축소 추천 엔진처럼 동작하라.

═══ 핵심 동작 원칙 ═══

매 턴마다 반드시 다음 순서를 따르라:
1. 사용자 메시지에서 파라미터 추출 (소재, 직경, 가공방식, 코팅, 날수, 공구타입 등)
2. 이전 대화에서 이미 파악된 파라미터와 병합 (절대 덮어쓰지 마라, 누적하라)
3. 이미 알고 있는 값은 다시 묻지 마라 — 이것이 가장 중요한 규칙
4. 가장 중요한 누락 파라미터 1개만 질문
5. 충분한 정보가 모이면 즉시 도구를 호출하여 후보를 좁혀라

═══ 대화 상태 추적 (매 턴마다 내부적으로 유지) ═══

conversation_state:
- intent: 추천/코팅추천/절삭조건문의/대체품/일반질문
- tool_type: 엔드밀/드릴/탭/인서트 등
- material: 피삭재 (S45C, SUS304, 알루미늄, ISO P/M/K/N/S/H 등)
- diameter_mm: 직경 (mm)
- operation: 황삭/정삭/측면가공/슬롯/프로파일 등
- coating: 코팅 종류
- flute_count: 날 수
- known_params: 지금까지 확인된 것들
- missing_params: 아직 모르는 것들

사용자가 "직경 2mm" → diameter_mm = 2 (이후 절대 다시 묻지 마라)
사용자가 "S45C" → material = S45C (이후 절대 다시 묻지 마라)
사용자가 "상관없어" → 해당 필드 skip (다시 묻지 마라)

═══ 질문 우선순위 ═══

누락 파라미터가 여러 개일 때 이 순서로 1개만 물어라:
1. 피삭재 (material) — 가장 중요
2. 직경 (diameter_mm)
3. 가공 방식 (operation)
4. 날 수 (flute_count)
5. 코팅 (coating)
6. 기타 조건

═══ 응답 형식 ═══

[정보 수집 중일 때]
"확인했습니다. 현재 조건: [파악된 파라미터 나열]
추천을 위해 [다음 누락 파라미터]를 알려주세요.
[구체적 질문 1개]"

[추천 가능할 때 — 도구 호출 후]
"현재 조건 기준 후보:
**브랜드명:** [brand] | **제품코드:** [displayCode]
[추천 이유 1줄]

📋 Reference: [출처]"

═══ 절대 금지 사항 ═══

❌ 이미 알려준 정보를 다시 묻는 것 (예: 직경 2mm라고 했는데 "직경을 알려주세요")
❌ 사용자 입력을 무시하고 관련 없는 질문을 하는 것
❌ 제품 코드/스펙/브랜드명을 추측하거나 생성하는 것 — 반드시 도구 결과에서만 인용
❌ 장황한 서론이나 불필요한 설명
❌ 한 번에 여러 질문을 하는 것 (1턴에 1질문만)
❌ 일반 챗봇처럼 동작하는 것 — 기술 축소 추천 시스템처럼 동작하라

═══ 도구 사용 규칙 ═══

- 소재 + 직경 또는 소재 + 가공방식이 확보되면 즉시 search_products 호출
- EDP 코드를 직접 받으면 search_product_by_edp 우선 사용
- 절삭조건 문의 → get_cutting_conditions
- 경쟁사 대체품 → get_competitor_mapping
- 내부 DB에 없을 때 → web_search (출처: "📌 웹 검색 결과 (내부 DB 외부)")

═══ 검색 결과 표시 규칙 ═══

- 검색 결과는 기본 10개만 보여준다
- 응답에 반드시 전체 개수를 알려줘라: "총 X개 중 10개를 보여드립니다"
- 사용자가 "더 보여줘", "전체 보기", "나머지도 보여줘" 요청 시 → show_all=true로 재검색
- 절대 자발적으로 "더 보시겠습니까?" 같은 제안을 하지 마라. 사용자가 원할 때만 보여줘라

═══ 브랜드명 표기 (필수) ═══

- 형식: **브랜드명:** [도구 결과의 brand 필드 그대로] | **제품코드:** [displayCode]
- brand는 제조사("YG-1")가 아닌 제품 라인명 (예: "4G MILL", "ALU-POWER HPC")
- 도구가 반환한 brand 값만 사용 — 추측/변경 절대 금지

═══ 대화 맥락 판단 ═══

[연결 질문] "그거 절삭조건은?", "다른 직경도?", "코팅 차이?" → 이전 맥락 활용, 재검색 불필요
[새 질문] 완전히 다른 조건, "다른 거 물어볼게" → 새로 검색, 상태 초기화
[조건 변경] "직경 바꿔줘", "3날로", "상관없어" → 해당 필드만 업데이트, 나머지 유지

═══ Reference 표기 ═══

- 내부 DB: "📋 Reference: YG-1 내부 DB"
- 웹 검색: "📋 Reference: 웹 검색 (외부 소스 — 카탈로그 확인 필요)"
- AI 지식: "📋 Reference: AI 일반 지식 (카탈로그 확인 필요)"

═══ 참고 지식 ═══

${MATERIAL_KNOWLEDGE}
${COATING_KNOWLEDGE}
${MACHINING_KNOWLEDGE}`
}

// ── Tool Definitions ────────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
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
      const filtered = results.filter((product) => product.materialTags.includes(tag))
      if (filtered.length > 0) results = filtered
    }
  }

  const keyword = params.keyword
  if (keyword) {
    const filtered = results.filter((product) => matchesKeyword(product, keyword))
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

  // show_all이면 전체, 아니면 10개만
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

function buildProductDetailPayload(products: CanonicalProduct[], representative: CanonicalProduct, matchedProduct?: CanonicalProduct): string {
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
      // Also get all variants in the same series
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
    products.find((product) => normalizeProductCode(product.displayCode) === normalizeProductCode(params.product_code))
  )
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

async function executeGetCompetitorMapping(params: {
  competitor_name?: string
  competitor_product?: string
}): Promise<string> {
  const competitors = CompetitorRepo.getAll()

  if (params.competitor_product) {
    // Try exact code match first
    const found = CompetitorRepo.findByCode(params.competitor_product)
    if (found) {
      // Find YG-1 alternatives with similar specs
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
      alternatives = alternatives.filter((p) => {
        let match = true
        if (found.diameterMm !== null && p.diameterMm !== null) {
          match = match && Math.abs(p.diameterMm - found.diameterMm) <= 1
        }
        if (found.fluteCount !== null && p.fluteCount !== null) {
          match = match && p.fluteCount === found.fluteCount
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
  if (toolsUsed.includes("search_product_by_edp")) return "product_lookup"
  if (toolsUsed.includes("get_product_detail")) return "product_lookup"
  if (toolsUsed.includes("search_products")) return "product_recommendation"
  if (toolsUsed.includes("web_search")) return "web_search"
  return "general"
}

// ── Extract Product Brand Info from Tool Results ─────────────

function extractBrandInfo(toolResults: { name: string; result: string }[]): { brand: string; displayCode: string; seriesName: string | null }[] {
  const products: { brand: string; displayCode: string; seriesName: string | null }[] = []
  const seen = new Set<string>()
  for (const tr of toolResults) {
    try {
      const data = JSON.parse(tr.result)
      const addProduct = (p: { brand?: string; displayCode?: string; seriesName?: string | null }) => {
        if (p.brand && p.displayCode && !seen.has(p.displayCode)) {
          seen.add(p.displayCode)
          products.push({ brand: p.brand, displayCode: p.displayCode, seriesName: p.seriesName ?? null })
        }
      }
      if (data.products) data.products.forEach(addProduct)
      if (data.yg1Alternatives) data.yg1Alternatives.forEach(addProduct)
      if (data.matchedProduct) addProduct({ ...data.matchedProduct, brand: data.brand, seriesName: data.seriesName })
      if (data.brand && data.seriesName) addProduct(data)
    } catch {
      // ignore parse errors
    }
  }
  return products
}

// ── Inject Brand Header into Response ────────────────────────

function injectBrandHeader(responseText: string, brandProducts: { brand: string; displayCode: string; seriesName: string | null }[]): string {
  if (brandProducts.length === 0) return responseText

  // Check if brand info is already in the response
  const hasBrandLabel = /\*\*브랜드명[::]\*\*/.test(responseText) || /브랜드명[::]\s*\S+/.test(responseText)
  if (hasBrandLabel) return responseText

  // Build brand header from tool results
  const brandLines = brandProducts.slice(0, 3).map(p =>
    `**브랜드명:** ${p.brand} | **제품코드:** ${p.displayCode}`
  )
  const header = brandLines.join("\n")

  return `${header}\n\n${responseText}`
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
      if (data.displayCode) refs.add(data.displayCode)
      if (data.matchedProduct?.displayCode) refs.add(data.matchedProduct.displayCode)
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

    if (apiMessages.length === 0) {
      return NextResponse.json({
        intent: "general",
        text: "안녕하세요! YG-1 AI 어시스턴트입니다. 무엇을 도와드릴까요?",
        chips: ["제품 추천", "절삭조건 문의", "코팅 비교"],
        isComplete: false,
      } as LLMResponse)
    }

    // ── Build Conversation State from History ──────────────
    const convState = buildStateFromHistory(messages)
    logConversationState(convState, null)

    // ── Build Structured System Prompt with Context ──────
    const baseSystemPrompt = await buildSystemPrompt()
    const structuredCtx = buildStructuredContext(convState, null)
    const systemPrompt = `${baseSystemPrompt}\n\n${structuredCtx}`

    // ── Tool Use Loop ──────────────────────────────────────
    let currentMessages = [...apiMessages]
    const toolsUsed: string[] = []
    const toolResults: { name: string; result: string }[] = []
    const MAX_TOOL_ROUNDS = 5

    const chatLlmStart = Date.now()
    let llmResponse = await client.messages.create({
      model: anthropicChatModel as Parameters<typeof client.messages.create>[0]["model"],
      max_tokens: 2048,
      system: systemPrompt,
      tools: TOOLS,
      messages: currentMessages,
    })

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Check if there are tool_use blocks
      const toolUseBlocks = llmResponse.content.filter(
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
        { role: "assistant" as const, content: llmResponse.content },
        { role: "user" as const, content: toolResultMessages },
      ]

      llmResponse = await client.messages.create({
        model: anthropicChatModel as Parameters<typeof client.messages.create>[0]["model"],
        max_tokens: 2048,
        system: systemPrompt,
        tools: TOOLS,
        messages: currentMessages,
      })

      // If stop_reason is "end_turn", we're done
      if (llmResponse.stop_reason === "end_turn") break
    }

    // ── Extract Final Text Response ────────────────────────
    const textBlocks = llmResponse.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text"
    )
    const responseText =
      textBlocks.map((b) => b.text).join("\n") ||
      "죄송합니다, 응답을 생성하지 못했습니다."

    // ── Build Retrieval Memory from Tool Results ───────────
    const retrievalMem = buildRetrievalMemory(toolResults, convState)
    if (retrievalMem) {
      convState.retrievalMemory = retrievalMem
      logConversationState(convState, retrievalMem)
    }

    // ── Build Response ─────────────────────────────────────
    const intent = inferIntent(toolsUsed)
    const references = extractReferences(toolResults)
    const brandProducts = extractBrandInfo(toolResults)

    // Inject brand header if LLM forgot to include it
    const finalText = (intent === "product_recommendation" || intent === "product_lookup" || intent === "cross_reference")
      ? injectBrandHeader(responseText, brandProducts)
      : responseText

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
      text: finalText,
      chips,
      extractedField: null,
      isComplete: intent === "general" ? false : true,
      recommendationIds: null,
      references,
    }

    // Slack 알림 (비동기, 응답 차단 안 함)
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.text ?? ""
    const knownParams = Object.entries(convState.params).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(",")
    console.log(`[chat] topic=${convState.topicStatus} intent=${intent} known=[${knownParams}] missing=[${convState.missingParams.join(",")}] memory=${retrievalMem?.totalMatched ?? 0}products tools=[${toolsUsed.join(",")}]`)
    notifyChatResponse({
      userMessage: lastUserMsg,
      intent,
      toolsUsed,
      productCount: references?.length ?? 0,
    }).catch(() => {})

    // LLM 호출 알림
    notifyLlmCall({
      model: anthropicChatModel,
      route: "/api/chat",
      promptPreview: lastUserMsg,
      responsePreview: finalText,
      durationMs: Date.now() - chatLlmStart,
      inputTokens: llmResponse.usage?.input_tokens,
      outputTokens: llmResponse.usage?.output_tokens,
    }).catch(() => {})

    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Chat API error:", msg)
    notifyError({ route: "/api/chat", error: msg }).catch(() => {})
    return NextResponse.json(
      { error: "AI 응답을 가져오는데 실패했습니다", detail: msg },
      { status: 500 }
    )
  }
}
