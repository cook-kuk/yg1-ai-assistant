import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { candidateProducts, crossReferences } from "@/lib/demo-data"

const client = new Anthropic()

const SYSTEM_PROMPT = `당신은 YG-1의 AI 절삭공구 추천 어시스턴트입니다. YG-1은 한국의 선도적인 절삭공구 제조사입니다.

## 역할
고객이 원하는 절삭공구를 찾을 수 있도록 핵심 질문을 하고 최적 제품을 추천합니다.

## 사용 가능한 제품 목록
${JSON.stringify(candidateProducts.map(p => ({
  id: p.id,
  sku: p.sku,
  name: p.name,
  fitTag: p.fitTag,
  score: p.score,
  metrics: p.metrics,
  reasons: p.reasons,
  risks: p.risks,
  stock: p.stock,
  stockQty: p.stockQty,
  leadTimeDays: p.leadTimeDays,
})), null, 2)}

## 경쟁사 크로스레퍼런스
${JSON.stringify(crossReferences, null, 2)}

## 수집할 정보 (단계별)
- step 0 - intent: 해결하고 싶은 문제
- step 1 - machine: 장비 종류
- step 2 - material: 가공 소재
- step 2 - hardness: 소재 경도
- step 3 - operation: 가공 종류
- step 3 - mode: 황삭/정삭 여부
- step 3 - priority: 우선순위 (비용/시간/품질)
- step 4 - diameter: 공구 직경
- step 4 - depth: 가공 깊이

## 응답 규칙
1. 사용자 메시지에서 정보를 먼저 추출하고, 그 다음 다음 질문을 합니다
2. 경쟁사 품번이 언급되면 크로스레퍼런스로 YG-1 동등/상위 제품을 바로 제안합니다
3. 4~5개 질문 후 추천을 완료합니다 (모드에 따라 조정)
4. "잘 모르겠어요" 등의 답변은 confidence: "low"로 기록하고 계속 진행합니다

## 응답 형식 (반드시 아래 JSON만 반환)
{
  "text": "한국어 응답 텍스트",
  "purpose": "이 질문을 하는 이유 (선택, 한국어)",
  "chips": ["선택지1", "선택지2", "선택지3", "선택지4"],
  "extractedField": {
    "label": "필드명",
    "value": "추출된 값",
    "confidence": "high|medium|low",
    "step": 숫자
  } 또는 null,
  "isComplete": false,
  "recommendationIds": null
}

isComplete가 true일 때:
- recommendationIds에 제품 id 배열 (적합도 순) 반환
- chips는 null 또는 생략
- text는 추천 완료 메시지

중요: JSON 외 다른 텍스트 없이 오직 JSON만 반환하세요.`

export interface ChatMessage {
  role: "user" | "ai" | "system"
  text: string
}

export interface LLMResponse {
  text: string
  purpose?: string
  chips?: string[]
  extractedField?: {
    label: string
    value: string
    confidence: "high" | "medium" | "low"
    step: number
  } | null
  isComplete: boolean
  recommendationIds?: string[] | null
}

export async function POST(req: NextRequest) {
  try {
    const { messages, mode } = await req.json() as { messages: ChatMessage[]; mode: string }

    // Convert to Claude API format (only user/assistant messages)
    const apiMessages = messages
      .filter(m => m.role === "user" || m.role === "ai")
      .map(m => ({
        role: m.role === "user" ? "user" as const : "assistant" as const,
        content: m.text,
      }))

    // Add mode context to system prompt
    const modeNote = mode === "simple"
      ? "\n\n현재 모드: 간편 (핵심 4개 질문만, intent/material/operation+mode/diameter 순으로)"
      : "\n\n현재 모드: 정밀 (전체 9개 질문 수집)"

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT + modeNote,
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
      // Fallback if JSON parsing fails
      parsed = {
        text: content.text,
        isComplete: false,
        chips: [],
      }
    }

    return NextResponse.json(parsed)
  } catch (error) {
    console.error("Chat API error:", error)
    return NextResponse.json(
      { error: "AI 응답을 가져오는데 실패했습니다" },
      { status: 500 }
    )
  }
}
