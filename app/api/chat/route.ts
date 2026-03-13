/**
 * /api/chat — Multi-intent YG-1 AI Chat
 *
 * Intent-aware chat that handles:
 *   1. Product recommendation (기존 추천 플로우)
 *   2. General Q&A (코팅, 소재, 가공 지식)
 *   3. Product spec lookup (시리즈/EDP 검색)
 *   4. Cutting condition inquiry (절삭조건 문의)
 *   5. Cross-reference (경쟁사 대체품)
 *   6. General conversation (인사, 잡담 등)
 *
 * Data is loaded from normalized JSON — no hallucination.
 */

import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { ProductRepo } from "@/lib/data/repos/product-repo"
import { EvidenceRepo } from "@/lib/data/repos/evidence-repo"

const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY || ""
const client = anthropicApiKey ? new Anthropic({ apiKey: anthropicApiKey }) : null

// ── Build context from real data ────────────────────────────
function buildProductContext(): string {
  const products = ProductRepo.getAll()
  const seriesMap = new Map<string, { count: number; diameters: number[]; materialTags: string[]; coating: string | null; featureText: string | null; brand: string }>()

  for (const p of products) {
    const key = p.seriesName ?? p.displayCode
    const existing = seriesMap.get(key)
    if (existing) {
      existing.count++
      if (p.diameterMm !== null && !existing.diameters.includes(p.diameterMm)) {
        existing.diameters.push(p.diameterMm)
      }
      for (const tag of p.materialTags) {
        if (!existing.materialTags.includes(tag)) existing.materialTags.push(tag)
      }
    } else {
      seriesMap.set(key, {
        count: 1,
        diameters: p.diameterMm !== null ? [p.diameterMm] : [],
        materialTags: [...p.materialTags],
        coating: p.coating,
        featureText: p.featureText,
        brand: p.brand ?? "YG-1",
      })
    }
  }

  const lines: string[] = []
  for (const [series, info] of seriesMap) {
    const diaRange = info.diameters.length > 0
      ? `직경 ${Math.min(...info.diameters)}~${Math.max(...info.diameters)}mm`
      : "직경 정보 없음"
    const matTags = info.materialTags.length > 0 ? info.materialTags.join(",") : "미분류"
    lines.push(`- ${series} (${info.brand}): ${info.count}개 EDP, ${diaRange}, 소재그룹=[${matTags}], 코팅=${info.coating ?? "정보없음"}${info.featureText ? ` | ${info.featureText.slice(0, 80)}` : ""}`)
  }

  return lines.join("\n")
}

function buildEvidenceContext(): string {
  const chunks = EvidenceRepo.getAll()
  const seriesConditions = new Map<string, { isoGroup: string | null; toolType: string | null; condSample: string }>()

  for (const c of chunks) {
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
function buildSystemPrompt(): string {
  const productCtx = buildProductContext()
  const evidenceCtx = buildEvidenceContext()

  return `당신은 YG-1의 AI 어시스턴트입니다. YG-1은 한국의 세계적인 절삭공구 제조사입니다.

## 역할
고객의 다양한 질문에 전문적이면서 친근하게 답변합니다.
제품 추천뿐 아니라 절삭가공 전반의 기술 상담이 가능합니다.

## 의도 분류 (intent)
고객 메시지를 다음 중 하나로 분류합니다:
- "product_recommendation": 제품 추천 요청 (소재, 가공, 직경 등 조건 제시)
- "product_lookup": 특정 제품/시리즈 정보 조회 ("CE5G60 알려줘", "ALU-PLUS가 뭐야")
- "cutting_condition": 절삭조건 문의 ("SUS304 황삭 조건", "Vc 얼마로?")
- "coating_material_qa": 코팅/소재/가공 기술 Q&A ("TiAlN이 뭐야", "알루미늄 가공 주의점")
- "cross_reference": 경쟁사 대체품 문의 ("SANDVIK 대체품", "미쓰비시 XXX 대신")
- "general": 인사, 잡담, 기타 ("안녕", "고마워", "뭐 할 수 있어?")

## 보유 데이터 (제품 카탈로그)
${productCtx}

## 절삭조건 데이터 (카탈로그 근거)
${evidenceCtx}

${MATERIAL_KNOWLEDGE}
${COATING_KNOWLEDGE}
${MACHINING_KNOWLEDGE}

## 응답 규칙
1. 항상 한국어로 답변
2. 제품 코드, 스펙은 위 데이터에 있는 것만 언급 (없으면 "정보 없음" 또는 "확인 필요")
3. 절삭조건은 카탈로그 근거 데이터에서만 인용
4. 모르는 것은 솔직하게 "확인이 필요합니다" 라고 답변
5. 친근하면서도 전문적인 톤 유지
6. 간결하게 답변 (너무 길지 않게)
7. 제품 추천 시에는 단계별로 질문하여 조건을 수집

## 응답 형식 (반드시 아래 JSON만 반환)
{
  "intent": "분류된 의도",
  "text": "한국어 응답 텍스트",
  "chips": ["선택지1", "선택지2"] 또는 null,
  "extractedField": {
    "label": "필드명",
    "value": "추출된 값",
    "confidence": "high|medium|low",
    "step": 숫자
  } 또는 null,
  "isComplete": false,
  "recommendationIds": null,
  "references": ["참조한 시리즈/제품 코드"] 또는 null
}

intent별 응답 가이드:
- "general": text에 자연스럽게 답변, chips로 할 수 있는 것 제안
- "coating_material_qa": text에 기술 설명, chips로 관련 후속 질문 제안
- "product_lookup": text에 시리즈/제품 정보, references에 해당 코드
- "cutting_condition": text에 조건 안내, 반드시 출처(카탈로그) 언급
- "product_recommendation": 기존처럼 단계별 질문 수집, isComplete 처리
- "cross_reference": 대체 가능한 YG-1 제품 안내

중요: JSON 외 다른 텍스트 없이 오직 JSON만 반환하세요.`
}

export const maxDuration = 60

export interface ChatMessage {
  role: "user" | "ai" | "system"
  text: string
}

export type ChatIntent =
  | "product_recommendation"
  | "product_lookup"
  | "cutting_condition"
  | "coating_material_qa"
  | "cross_reference"
  | "general"

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
  const lastUserInput = [...messages].reverse().find(m => m.role === "user")?.text || ""
  const lower = lastUserInput.toLowerCase()

  // Simple intent detection for mock mode
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

  // Default: product recommendation flow
  return {
    intent: "product_recommendation",
    text: "추가 정보가 필요합니다. 소재, 가공 조건 또는 직경을 알려주세요.",
    chips: ["스테인리스", "알루미늄", "탄소강", "고경도강"],
    extractedField: null,
    isComplete: false,
    recommendationIds: null,
  }
}

export async function POST(req: NextRequest) {
  try {
    const { messages, mode } = await req.json() as { messages: ChatMessage[]; mode?: string }

    if (!client) {
      console.warn("Anthropic API key not set. Using mock chat response.")
      return NextResponse.json(mockChatResponse(messages))
    }

    // Convert to Claude API format
    const apiMessages = messages
      .filter(m => m.role === "user" || m.role === "ai")
      .map(m => ({
        role: m.role === "user" ? "user" as const : "assistant" as const,
        content: m.text,
      }))
      .filter((_, i, arr) => !(i === 0 && arr[0].role === "assistant"))

    const systemPrompt = buildSystemPrompt()

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: systemPrompt,
      messages: apiMessages,
    })

    const content = response.content[0]
    if (content.type !== "text") {
      throw new Error("Unexpected response type")
    }

    // Parse JSON from LLM response
    let parsed: LLMResponse
    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content.text)
    } catch {
      // Fallback if JSON parsing fails — return as general response
      parsed = {
        intent: "general",
        text: content.text,
        isComplete: false,
        chips: null,
      }
    }

    return NextResponse.json(parsed)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("Chat API error:", msg)
    return NextResponse.json(
      { error: "AI 응답을 가져오는데 실패했습니다", detail: msg },
      { status: 500 }
    )
  }
}
