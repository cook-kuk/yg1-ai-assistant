import {
  EvidenceRepo,
  InventoryRepo,
  ProductRepo,
} from "@/lib/recommendation/infrastructure/repositories/recommendation-repositories"
import { resolveMaterialTag } from "@/lib/recommendation/domain/recommendation-domain"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"

import type {
  CandidateSnapshot,
  ExplorationSessionState,
  ProductIntakeForm,
  RecommendationInput,
  ScoredProduct,
} from "@/lib/recommendation/domain/types"

const DIRECT_PRODUCT_CODE_PATTERN = /\b([A-Z][A-Z0-9-]{4,})\b/i
const DIRECT_SERIES_CODE_PATTERN = /\b([A-Z]\d[A-Z]\d{2,}[A-Z]?)\b/i
const CUTTING_CONDITION_QUERY_PATTERN = /절삭조건|가공조건|vc|fz|이송|회전수|rpm|feed/i
const INVENTORY_QUERY_PATTERN = /재고|stock|inventory|available|availability|수량|남았/i
const CUTTING_KNOWLEDGE_PATTERNS = /절삭|공구|엔드밀|드릴|인서트|코팅|소재|가공|선반|밀링|CNC|초경|CBN|세라믹|황삭|정삭|면취|보링|리머|탭|나사|칩|인선|마모|수명|이송|회전|절입|쿨란트|치핑|버|진동|채터|tialn|alcrn|dlc|hss|carbide|endmill|milling|turning|drilling/i

function normalizeLookupCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, "").trim()
}

function escapeMarkdownTableCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-"
  return String(value).replace(/\|/g, "/").replace(/\n/g, " ").trim() || "-"
}

function buildMarkdownTable(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const headerRow = `| ${headers.map(escapeMarkdownTableCell).join(" | ")} |`
  const dividerRow = `| ${headers.map(() => "---").join(" | ")} |`
  const bodyRows = rows.map(row => `| ${row.map(escapeMarkdownTableCell).join(" | ")} |`)
  return [headerRow, dividerRow, ...bodyRows].join("\n")
}

function formatStockStatusLabel(stockStatus: "instock" | "limited" | "outofstock" | "unknown"): string {
  if (stockStatus === "instock") return "재고 있음"
  if (stockStatus === "limited") return "소량 재고"
  if (stockStatus === "outofstock") return "재고 없음"
  return "재고 미확인"
}

function summarizeInventoryRowsByWarehouse(rows: Array<{ warehouseOrRegion: string; quantity: number | null }>): Array<{ warehouseOrRegion: string; quantity: number }> {
  return Array.from(
    rows.reduce((acc, row) => {
      if (row.quantity === null) return acc
      const key = row.warehouseOrRegion?.trim()
      if (!key) return acc
      acc.set(key, (acc.get(key) ?? 0) + row.quantity)
      return acc
    }, new Map<string, number>())
  )
    .map(([warehouseOrRegion, quantity]) => ({ warehouseOrRegion, quantity }))
    .sort((a, b) => b.quantity - a.quantity || a.warehouseOrRegion.localeCompare(b.warehouseOrRegion))
}

function getLatestInventorySnapshotDateFromRows(rows: Array<{ snapshotDate: string | null }>): string | null {
  const dates = rows
    .map(row => row.snapshotDate)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .sort()
  return dates.length > 0 ? dates[dates.length - 1] : null
}

export async function handleDirectInventoryQuestion(
  userMessage: string,
  prevState: ExplorationSessionState
): Promise<{ text: string; chips: string[] } | null> {
  if (!INVENTORY_QUERY_PATTERN.test(userMessage)) return null

  const productCodeMatch = userMessage.match(DIRECT_PRODUCT_CODE_PATTERN)
  const lookupCode = normalizeLookupCode(productCodeMatch?.[1] ?? "")
  if (!lookupCode) return null

  const [product, inv] = await Promise.all([
    ProductRepo.findByCode(lookupCode).catch(() => null),
    InventoryRepo.getEnrichedAsync(lookupCode),
  ])
  const inventoryRows = inv.snapshots
  const totalStock = inv.totalStock
  const stockStatus = inv.stockStatus
  const warehouseSummary = summarizeInventoryRowsByWarehouse(inventoryRows)
  const latestSnapshotDate = getLatestInventorySnapshotDateFromRows(inventoryRows)

  if (totalStock !== null || warehouseSummary.length > 0) {
    const summaryTable = buildMarkdownTable(
      ["항목", "값"],
      [
        ["제품코드", lookupCode],
        ["시리즈", product?.seriesName ?? "-"],
        ["직경", product?.diameterMm != null ? `φ${product.diameterMm}mm` : "-"],
        ["전체 지역 합산 재고", totalStock != null ? `${totalStock}개` : "-"],
        ["재고 상태", formatStockStatusLabel(stockStatus)],
        ["기준일", latestSnapshotDate ?? "-"],
      ]
    )
    const inventoryTable = buildMarkdownTable(
      ["지역", "수량"],
      warehouseSummary.length > 0
        ? warehouseSummary.slice(0, 8).map(row => [row.warehouseOrRegion, `${row.quantity}개`])
        : [["지역별 재고", "없음"]]
    )

    return {
      text: [
        `${lookupCode}의 재고 데이터를 내부 데이터에서 조회했습니다.`,
        "",
        summaryTable,
        "",
        inventoryTable,
        "",
        "[Reference: YG-1 내부 재고 데이터]",
      ].join("\n"),
      chips: ["다른 제품 재고", "추천 제품 보기", "처음부터 다시"],
    }
  }

  if (product) {
    return {
      text: [
        `${lookupCode} 제품은 찾았지만, 매칭되는 재고 데이터는 없습니다.`,
        "",
        buildMarkdownTable(
          ["항목", "값"],
          [
            ["제품코드", lookupCode],
            ["시리즈", product.seriesName ?? "-"],
            ["직경", product.diameterMm != null ? `φ${product.diameterMm}mm` : "-"],
            ["재고", "매칭 데이터 없음"],
          ]
        ),
        "",
        "[Reference: YG-1 내부 재고 데이터]",
      ].join("\n"),
      chips: ["다른 제품 재고", "추천 제품 보기", "처음부터 다시"],
    }
  }

  if (prevState.displayedCandidates?.length > 0) {
    return {
      text: [
        `${lookupCode}에 대한 재고 데이터를 내부 데이터에서 찾지 못했습니다.`,
        "현재 표시된 후보의 제품코드로 다시 물어보시면 내부 재고 기준으로 조회해드릴 수 있습니다.",
        "[Reference: YG-1 내부 재고 데이터]",
      ].join("\n"),
      chips: ["후보 제품 보기", "추천 제품 보기", "처음부터 다시"],
    }
  }

  return {
    text: [
      `${lookupCode}에 대한 재고 데이터를 내부 데이터에서 찾지 못했습니다.`,
      "제품코드를 다시 확인해주세요.",
      "[Reference: YG-1 내부 재고 데이터]",
    ].join("\n"),
    chips: ["제품 추천", "다른 제품 재고", "처음부터 다시"],
  }
}

export async function handleDirectCuttingConditionQuestion(
  userMessage: string,
  currentInput: RecommendationInput,
  prevState: ExplorationSessionState
): Promise<{ text: string; chips: string[] } | null> {
  if (!CUTTING_CONDITION_QUERY_PATTERN.test(userMessage)) return null

  const productCodeMatch = userMessage.match(DIRECT_PRODUCT_CODE_PATTERN)
  const seriesCodeMatch = userMessage.match(DIRECT_SERIES_CODE_PATTERN)
  const lookupCode = normalizeLookupCode(productCodeMatch?.[1] ?? seriesCodeMatch?.[1] ?? "")
  if (!lookupCode) return null

  const product = await ProductRepo.findByCode(lookupCode)
  const isoGroup = currentInput.material ? resolveMaterialTag(currentInput.material) : null

  if (product) {
    const chunks = await EvidenceRepo.findForProduct(lookupCode, {
      seriesName: product.seriesName,
      diameterMm: product.diameterMm,
      isoGroup,
    })

    if (chunks.length > 0) {
      const summaryTable = buildMarkdownTable(
        ["항목", "값"],
        [
          ["제품코드", lookupCode],
          ["시리즈", product.seriesName ?? "-"],
          ["직경", product.diameterMm != null ? `φ${product.diameterMm}mm` : "-"],
          ["ISO 소재", isoGroup ? `ISO ${isoGroup}` : "-"],
        ]
      )
      const conditionTable = buildMarkdownTable(
        ["ISO", "가공", "직경", "Vc", "fz", "ap", "ae", "n", "vf"],
        chunks.slice(0, 5).map(chunk => [
          chunk.isoGroup ? `ISO ${chunk.isoGroup}` : "-",
          chunk.cuttingType,
          chunk.diameterMm != null ? `φ${chunk.diameterMm}mm` : "-",
          chunk.conditions.Vc,
          chunk.conditions.fz,
          chunk.conditions.ap,
          chunk.conditions.ae,
          chunk.conditions.n,
          chunk.conditions.vf,
        ])
      )

      return {
        text: [
          `${lookupCode}의 절삭조건을 내부 DB에서 조회했습니다.`,
          "",
          summaryTable,
          "",
          conditionTable,
          "",
          "[Reference: YG-1 내부 DB]",
        ].join("\n"),
        chips: ["다른 소재 조건도 보여줘", "추천 제품 보기", "처음부터 다시"],
      }
    }

    return {
      text: [
        `${lookupCode} 제품은 내부 DB에서 찾았지만, 매칭되는 절삭조건 데이터는 찾지 못했습니다.`,
        "",
        buildMarkdownTable(
          ["항목", "값"],
          [
            ["제품코드", lookupCode],
            ["시리즈", product.seriesName ?? "-"],
            ["직경", product.diameterMm != null ? `φ${product.diameterMm}mm` : "-"],
            ["절삭조건", "매칭 데이터 없음"],
          ]
        ),
        "",
        "[Reference: YG-1 내부 DB]",
      ].join("\n"),
      chips: ["시리즈 기준으로 다시 보기", "추천 제품 보기", "처음부터 다시"],
    }
  }

  const seriesChunks = await EvidenceRepo.findBySeriesName(lookupCode, {
    isoGroup,
    diameterMm: currentInput.diameterMm,
  })
  if (seriesChunks.length > 0) {
    const summaryTable = buildMarkdownTable(
      ["항목", "값"],
      [
        ["시리즈", lookupCode],
        ["ISO 소재", isoGroup ? `ISO ${isoGroup}` : "-"],
        ["직경 필터", currentInput.diameterMm != null ? `φ${currentInput.diameterMm}mm` : "-"],
      ]
    )
    const seriesTable = buildMarkdownTable(
      ["ISO", "가공", "직경", "Vc", "fz", "ap", "ae", "n", "vf"],
      seriesChunks.slice(0, 5).map(chunk => [
        chunk.isoGroup ? `ISO ${chunk.isoGroup}` : "-",
        chunk.cuttingType,
        chunk.diameterMm != null ? `φ${chunk.diameterMm}mm` : "-",
        chunk.conditions.Vc,
        chunk.conditions.fz,
        chunk.conditions.ap,
        chunk.conditions.ae,
        chunk.conditions.n,
        chunk.conditions.vf,
      ])
    )
    return {
      text: [
        `${lookupCode} 시리즈 기준 절삭조건을 내부 DB에서 조회했습니다.`,
        "",
        summaryTable,
        "",
        seriesTable,
        "",
        "[Reference: YG-1 내부 DB]",
      ].join("\n"),
      chips: ["추천 제품 보기", "다른 소재 조건도 보여줘", "처음부터 다시"],
    }
  }

  if (prevState.displayedCandidates?.length > 0) {
    return {
      text: [
        `${lookupCode}에 대한 절삭조건은 내부 DB에서 찾지 못했습니다.`,
        "현재 추천 결과의 제품코드/시리즈로 다시 물어보시면 내부 DB 기준으로 조회해드릴 수 있습니다.",
        "[Reference: YG-1 내부 DB]",
      ].join("\n"),
      chips: ["후보 제품 보기", "추천 제품 보기", "처음부터 다시"],
    }
  }

  return {
    text: [
      `${lookupCode}에 대한 절삭조건은 내부 DB에서 찾지 못했습니다.`,
      "제품코드 또는 시리즈명을 다시 확인해주세요.",
      "[Reference: YG-1 내부 DB]",
    ].join("\n"),
    chips: ["제품 추천", "시리즈 검색", "처음부터 다시"],
  }
}

export async function handleContextualNarrowingQuestion(
  provider: ReturnType<typeof getProvider>,
  userMessage: string,
  _currentInput: RecommendationInput,
  candidates: ScoredProduct[],
  prevState: ExplorationSessionState
): Promise<string | null> {
  const lastField = prevState.lastAskedField ?? "unknown"

  const fieldExplanations: Record<string, () => string> = {
    coating: () => {
      const coatings = [...new Set(candidates.map(c => c.product.coating).filter(Boolean))]
      return `코팅 종류에 대해 설명드리겠습니다.

현재 후보 제품들의 코팅 종류:
${coatings.map(c => `• ${c}`).join("\n")}

간단 설명:
• DLC (Diamond-Like Carbon) — 알루미늄/비철금속에 최적. 낮은 마찰, 높은 내마모성
• TiAlN — 고온 가공에 적합. 내열성 우수 (강, 스테인리스)
• AlCrN — 고경도 소재 가공용. TiAlN보다 더 높은 내열성
• TiCN — 범용. 중간 경도, 탄소강/합금강에 적합
• Blue Coating — YG-1 자체 코팅. 범용 가공에 적합
• 무코팅 — 알루미늄/구리 등 연질 소재에 사용

모르시면 "상관없음"을 선택하면 전체 후보에서 추천해드립니다.`
    },
    fluteCount: () => {
      const flutes = [...new Set(candidates.map(c => c.product.fluteCount).filter(Boolean))].sort()
      return `날 수(flute)에 대해 설명드리겠습니다.

현재 후보 제품 날 수: ${flutes.join(", ")}날

• 2날 — 알루미늄/비철 가공, 칩 배출 우수 (황삭에 유리)
• 3날 — 범용. 황삭~정삭 겸용
• 4날 — 정삭/고정밀 가공. 표면 품질 우수
• 6날 이상 — 고이송 가공, 높은 생산성

모르시면 "상관없음"을 선택해주세요.`
    },
    diameterRefine: () => {
      const diameters = [...new Set(candidates.map(c => c.product.diameterMm).filter((value): value is number => value != null))].sort((a, b) => a - b)
      const min = diameters[0]
      const max = diameters[diameters.length - 1]
      return `직경은 가공하려는 형상과 장비에 따라 선택합니다.

현재 후보 직경 범위: ${min}mm ~ ${max}mm
가용 직경: ${diameters.slice(0, 10).join(", ")}mm${diameters.length > 10 ? " ..." : ""}

직경을 모르시면 "상관없음"을 선택해주세요.`
    },
  }

  const explainer = fieldExplanations[lastField]
  if (explainer) return explainer()

  if (provider.available()) {
    try {
      const raw = await provider.complete(
        "당신은 YG-1 절삭공구 전문 엔지니어입니다. 사용자가 추천 대화 중 현재 질문에 대해 '그게 뭐야?' 같은 질문을 했습니다. 간결하게 3-4문장으로 설명하세요.",
        [{ role: "user", content: `현재 질문 필드: ${lastField}\n사용자 질문: ${userMessage}\n현재 후보 수: ${candidates.length}개` }],
        400
      )
      if (raw?.trim()) return raw.trim()
    } catch {}
  }

  return `현재 ${candidates.length}개 후보가 있습니다. 잘 모르시면 "상관없음"을 선택해주세요.`
}

async function searchWebForKnowledge(query: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY || ""
  if (!apiKey) return null

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default
    const searchClient = new Anthropic({ apiKey })

    const resp = await searchClient.messages.create({
      model: "claude-sonnet-4-20250514" as Parameters<typeof searchClient.messages.create>["0"]["model"],
      max_tokens: 1024,
      tools: [{ type: "web_search_20250305" as const, name: "web_search", max_uses: 3 }],
      messages: [{
        role: "user",
        content: `다음 질문에 대해 웹 검색으로 전문적인 정보를 찾아 한국어로 정리해주세요.\n\n질문: ${query}\n\n규칙:\n- 구체적 수치와 비교 포함\n- 3~5문장으로 핵심만\n- 출처가 있으면 간단히 언급`,
      }],
    })

    const text = resp.content
      .map(block => block.type === "text" ? block.text : "")
      .join("\n")
      .trim()
    return text || null
  } catch (error) {
    console.warn("[recommend] Web search failed:", error)
    return null
  }
}

function buildGeneralChatFollowUpChips(userMessage: string, candidateCount: number): string[] {
  const lower = userMessage.toLowerCase()

  if (/코팅|tialn|alcrn|dlc/i.test(lower)) {
    return ["코팅별 적합 소재", "무코팅 vs DLC", "소재별 추천 코팅", "제품 추천"]
  }
  if (/소재|알루|스테인|주철|티타늄|가공/i.test(lower)) {
    return ["절삭조건 알려줘", "추천 코팅은?", "주의사항 더 알려줘", "제품 추천"]
  }
  if (/시스템|점수|매칭|어떻게/i.test(lower)) {
    return ["점수 기준 설명", "소재 태그 뜻", "팩트 체크란?", "제품 추천"]
  }
  if (candidateCount > 0) {
    return ["후보 제품 보기", "절삭조건 문의", "코팅 비교", "처음부터 다시"]
  }
  return ["제품 추천", "절삭조건 문의", "코팅 비교", "시리즈 검색"]
}

export async function handleGeneralChat(
  provider: ReturnType<typeof getProvider>,
  userMessage: string,
  _currentInput: RecommendationInput,
  candidates: ScoredProduct[],
  form: ProductIntakeForm,
  displayedCandidatesContext?: CandidateSnapshot[],
): Promise<{ text: string; chips: string[] }> {
  const clean = userMessage.trim()
  const candidateCount = candidates.length

  if (!provider.available()) {
    return {
      text: "안녕하세요! YG-1 절삭공구 추천 시스템입니다. 가공 조건을 알려주시면 최적의 제품을 추천해드립니다.",
      chips: ["스테인리스 가공", "알루미늄 10mm", "엔드밀 추천", "절삭조건 문의"],
    }
  }

  const isCuttingKnowledge = CUTTING_KNOWLEDGE_PATTERNS.test(clean)
  const isKnowledgeQuestion = /차이|비교|뭐야|알려|설명|원리|방법|팁|주의|장단점|특징|어떤|언제|왜|어떻게|추천|좋은/i.test(clean)
  const needsWebSearch = isCuttingKnowledge && isKnowledgeQuestion

  let webSearchResult: string | null = null
  if (needsWebSearch) {
    webSearchResult = await searchWebForKnowledge(clean)
  }

  const sessionContext = candidateCount > 0
    ? `현재 ${candidateCount}개 후보 제품이 검색되어 있습니다.`
    : ""

  const formContext = form.material.status === "known" || form.operationType.status === "known"
    ? `사용자 입력 조건: 소재=${form.material.status === "known" ? form.material.value : "미지정"}, 가공=${form.operationType.status === "known" ? form.operationType.value : "미지정"}`
    : ""

  const displayedContext = displayedCandidatesContext && displayedCandidatesContext.length > 0
    ? `\n═══ 현재 표시된 추천 제품 (사용자가 "이 중", "위 제품", "상위 N개" 등으로 참조 시 반드시 이 목록에서 답하라) ═══\n${displayedCandidatesContext.slice(0, 10).map(c =>
      `#${c.rank} ${c.displayCode}${c.displayLabel ? ` [${c.displayLabel}]` : ""} | ${c.brand ?? "?"} | ${c.seriesName ?? "?"} | φ${c.diameterMm ?? "?"}mm | ${c.fluteCount ?? "?"}F | ${c.coating ?? "?"} | ${c.materialTags.join("/") || "?"} | ${c.matchStatus} ${c.score}점`
    ).join("\n")}`
    : ""

  const webContext = webSearchResult
    ? `\n═══ 웹 검색 참고 자료 (내부 DB 외부) ═══\n${webSearchResult}\n위 웹 검색 결과를 참고하여 답변하되, "📌 웹 검색 참고 (내부 DB 외부 정보)" 라고 출처를 밝혀주세요.`
    : ""

  try {
    const systemPrompt = `당신은 YG-1의 절삭공구 전문 AI 어시스턴트입니다.
YG-1은 한국의 세계적인 절삭공구 제조사입니다.

═══ 역할 ═══
- 절삭공구, 가공 기술, 소재, 코팅에 대한 전문 지식
- CNC 가공 현장 경험 기반 실용적 조언
- 시스템/화면 용어 설명
- 절삭공구 무관한 질문에도 유연하게 대응

═══ 시스템 정보 (사용자가 물어볼 때) ═══
- 약 36,000개 YG-1 절삭공구 제품 데이터 보유
- 스코어링: 직경(40pt), 소재(20pt), 날수(15pt), 가공방식(15pt), 절삭조건(10pt), 코팅(5pt), 완성도(5pt) = 110점 만점
- 정확 매칭(75%↑), 근사 매칭(45~75%), 매칭 없음(45%↓)
- 팩트 체크: 추천 제품 스펙이 DB 데이터와 일치하는지 자동 검증
- ISO 소재 분류: P=탄소강, M=스테인리스, K=주철, N=비철/알루미늄, S=내열합금/티타늄, H=고경도강
- 할루시네이션 방지: 모든 데이터는 DB에서만 인용

═══ 기술 지식 ═══
## ISO 소재 분류
- P (파란색): 탄소강, 합금강, 공구강
- M (노란색): 스테인리스강 — 가공경화 주의
- K (빨간색): 주철, CGI — 짧은 칩, 마모 주의
- N (초록색): 알루미늄, 비철 — 고속 가공, 구성인선 주의
- S (갈색): 내열합금, 티타늄 — 저속, 고압 쿨란트 필수
- H (회색): 고경도강 HRc 40~65

## 코팅
- TiAlN: 고온 내마모, 고경도강/SUS용, 건식 가공
- AlCrN: 내열성 우수, 고속/난삭재
- DLC: 알루미늄/비철용, 낮은 마찰
- 무코팅: 비철 전용, 날카로운 인선

## 가공 종류
- 황삭: 높은 이송, 깊은 절입, 4~6날
- 정삭: 낮은 이송, 면조도 우선, 2~4날
- 슬롯: 100% 물림, 칩 배출 중요
- 측면: 진동 주의

${sessionContext}
${formContext}
${webContext}

═══ 응답 규칙 ═══
- 한국어로 자연스럽게 대화
- 간결하게 (2-5문장)
- 절삭공구 무관한 질문: 짧게 답변 후 "절삭공구 관련 질문도 도와드릴 수 있어요" 정도만
- 기술 질문: 구체적 수치와 비교 포함
- "추가 조건을 알려주시면~" 같은 빈 말 금지
- 응답 끝에 JSON이나 특수 포맷 쓰지 말고 순수 자연어로만
- 모든 답변 끝에 근거 출처를 반드시 한 줄로 표기:
  [Reference: YG-1 내부 DB] — 제품 데이터, 후보 수, 스펙 기반 답변
  [Reference: AI 지식 추론] — 가공 기술, 코팅 특성, 소재 지식 기반 답변
  [Reference: 웹 검색] — 외부 웹 검색 결과 기반 답변`

    const userPrompt = `${sessionContext}\n${formContext}${displayedContext}${webContext}\n\n사용자: "${clean}"`
    const raw = await provider.complete(systemPrompt, [
      { role: "user", content: userPrompt }
    ], 800)

    if (raw && raw.trim()) {
      return {
        text: raw.trim(),
        chips: buildGeneralChatFollowUpChips(clean, candidateCount),
      }
    }
  } catch (error) {
    console.warn("[recommend] General chat handler failed:", error)
  }

  return {
    text: "죄송합니다, 잠시 오류가 있었습니다. 절삭공구 관련 질문이나 가공 조건을 말씀해주세요.",
    chips: ["스테인리스 가공", "알루미늄 10mm", "엔드밀 추천", "절삭조건 문의"],
  }
}

export function buildGeneralChatFollowUpChipsForRuntime(
  userMessage: string,
  candidateCount: number
): string[] {
  return buildGeneralChatFollowUpChips(userMessage, candidateCount)
}
