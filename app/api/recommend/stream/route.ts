/**
 * /api/recommend/stream — Server-Sent Events variant of /api/recommend.
 *
 * Why: progressive card streaming (TODO-B). The client wants product cards
 * to render before the (slow) LLM narrative text is generated. This endpoint
 * emits two SSE frames:
 *   1. `event: cards`  — fired mid-flight from buildRecommendationResponse,
 *      right before the LLM summary call. Contains primary/alternatives and
 *      enough data to render product cards.
 *   2. `event: final`  — fired after the full JSON DTO is assembled. Contains
 *      the complete recommendation response payload (identical to what the
 *      non-streaming /api/recommend returns).
 *
 * The non-streaming /api/recommend remains unchanged for backwards
 * compatibility (tests, curl, non-streaming clients).
 */

import { recommendationRequestSchema, type RecommendationRequestDto } from "@/lib/contracts/recommendation"
import {
  getRoutingDecision,
  type RoutingDecision,
  type UiThinkingMode,
} from "@/lib/recommendation/core/complexity-router"
import { createServeRuntimeDependencies } from "@/lib/recommendation/infrastructure/http/recommendation-http"
import {
  handleServeExploration,
  handleServeSimpleChat,
} from "@/lib/recommendation/infrastructure/engines/serve-engine-runtime"
import {
  buildRecommendationResponseDto,
  getEngineSessionState,
} from "@/lib/recommendation/infrastructure/presenters/recommendation-presenter"
import {
  traceRecommendation,
  traceRecommendationError,
} from "@/lib/recommendation/infrastructure/observability/recommendation-trace"
import type {
  ExplorationSessionState,
  ProductIntakeForm,
} from "@/lib/recommendation/domain/types"
import type { EarlyRecommendationFlush } from "@/lib/recommendation/infrastructure/engines/serve-engine-response"

// 120s: chat/stream과 동일. 60s 였을 때 무거운 턴(74s+)에서 Vercel 런타임이
// request signal을 reason 없이 abort → 클라이언트에 "signal is aborted without
// reason" 으로 노출되던 이슈를 해결.
export const maxDuration = 120

function parseRequest(body: unknown): RecommendationRequestDto {
  return recommendationRequestSchema.parse(body) as RecommendationRequestDto
}

function getRequestSessionState(body: RecommendationRequestDto): ExplorationSessionState | null {
  if (body.sessionState && typeof body.sessionState === "object") {
    return body.sessionState as ExplorationSessionState
  }
  return getEngineSessionState(body.session ?? null)
}

function getLatestUserMessageText(body: RecommendationRequestDto): string | null {
  const messages = body.messages ?? []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "user" && typeof message.text === "string" && message.text.trim()) {
      return message.text.trim()
    }
  }
  return null
}

function getStreamRoutingDecision(body: RecommendationRequestDto): RoutingDecision | null {
  const latestUserText = getLatestUserMessageText(body)
  if (!latestUserText) return null
  const prevState = getRequestSessionState(body)
  const displayed = body.displayedProducts ?? []
  return getRoutingDecision({
    message: latestUserText,
    appliedFilterCount: prevState?.appliedFilters?.length ?? 0,
    displayedProductsCount: displayed.length,
    hasPendingQuestion: !!prevState?.lastAskedField,
    hasSelectionContext: displayed.length > 0,
    hasComparisonTargets: displayed.length >= 2,
  })
}

function getStreamThinkingMode(decision: RoutingDecision | null): UiThinkingMode {
  if (!decision) return "hidden"
  return decision.complexity.uiThinkingMode
}

function sseFrame(event: string, data: unknown): string {
  // SSE wire format: optional `event: <name>` line + one or more `data: ` lines
  // + trailing blank line. We JSON-encode data onto a single line so clients
  // can reconstruct frames without line reassembly.
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(req: Request): Promise<Response> {
  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return new Response("invalid json", { status: 400 })
  }

  let body: RecommendationRequestDto
  try {
    body = parseRequest(rawBody)
  } catch (err) {
    traceRecommendationError("http.stream.parse:error", err)
    return new Response("invalid request", { status: 400 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const safeEnqueue = (frame: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(frame))
        } catch { /* stream already torn down */ }
      }

      // Initial "started" ping so the client knows the connection is live.
      safeEnqueue(sseFrame("started", { ok: true }))
      const routingDecision = getStreamRoutingDecision(body)
      const streamThinkingMode = getStreamThinkingMode(routingDecision)

      // 고정 heartbeat 타이머는 제거했다. 과거에는 실제 파이프라인이 조용할 때를
      // 덮으려고 2.5s 주기로 5-stage 메시지를 뿌렸지만 → 사용자에게 "생각하는 척"
      // 으로 보이고 실제 실행 단계와 어긋났다. 지금은 파이프라인이 emitStage
      // 를 실제로 호출할 때만 "thinking" SSE 프레임이 나간다.
      //
      // streamThinkingMode === "hidden" 인 경우(잡담/off-topic) onThinking 을
      // 아예 UI 로 흘리지 않고 서버 로그만 남긴다.
      const onThinking = (text: string, opts?: { delta?: boolean; kind?: "deep" | "stage" | "agent" }) => {
        if (!text) return
        if (!opts?.delta && !text.trim()) return
        if (streamThinkingMode === "hidden") return
        // 채널 3개:
        //   - "stage"  → 노란 trail 박스 (실시간 스테이지)
        //   - "deep"   → 남색 토글 본문 (LLM chain-of-thought)
        //   - "agent"  → 초록 토글 본문 (구조화된 의사결정 트레이스)
        const kind = opts?.kind ?? "stage"
        try { safeEnqueue(sseFrame("thinking", { text, delta: !!opts?.delta, kind })) }
        catch (err) { traceRecommendationError("http.stream.thinking:enqueue-error", err) }
      }

      const onEarlyFlush = (payload: EarlyRecommendationFlush) => {
        // Build a partial DTO so the client can reuse parseRecommendationResponse.
        // text is empty (LLM narrative still pending); recommendation/explanations
        // are populated so product cards render immediately.
        try {
          const partialDto = buildRecommendationResponseDto({
            text: "",
            purpose: "recommendation",
            isComplete: false,
            recommendation: payload.recommendation,
            evidenceSummaries: payload.evidenceSummaries,
            primaryExplanation: payload.primaryExplanation,
            primaryFactChecked: payload.primaryFactChecked as unknown as Record<string, unknown> | null,
            altExplanations: payload.altExplanations,
            altFactChecked: payload.altFactChecked as unknown as Array<Record<string, unknown>>,
            // Include candidates + pagination so the client can populate the
            // right-side "추천 후보" panel immediately, in parallel with cards.
            candidateSnapshot: payload.candidates,
            pagination: payload.pagination,
          })
          safeEnqueue(sseFrame("cards", partialDto))
        } catch (err) {
          traceRecommendationError("http.stream.cards:dto-error", err)
        }
      }

      try {
        const runtimeDeps = createServeRuntimeDependencies({
          onEarlyFlush,
          onThinking,
          routingHint: routingDecision,
        })

        const language = body.language === "en" ? "en" : "ko"
        const intakeForm = body.intakeForm as ProductIntakeForm | undefined
        const prevState = getRequestSessionState(body)
        const messages = body.messages ?? []
        const displayedProducts = body.displayedProducts ?? null
        const pagination = body.pagination ?? null

        // Intake-form flows go through exploration; legacy chat stays on the
        // simple path. Mirrors the routing in RecommendationService.
        const response = intakeForm
          ? await handleServeExploration(
              runtimeDeps,
              intakeForm,
              messages,
              prevState,
              displayedProducts,
              language,
              pagination,
            )
          : await handleServeSimpleChat(runtimeDeps, messages, body.mode ?? "simple")

        let finalJson: unknown = null
        try {
          finalJson = await response.json()
        } catch {
          finalJson = { error: "non_json_response" }
        }

        safeEnqueue(sseFrame("final", finalJson))
        traceRecommendation("http.stream:complete", {
          status: response.status,
          ok: response.ok,
        })
      } catch (err) {
        traceRecommendationError("http.stream:error", err)
        safeEnqueue(sseFrame("error", {
          message: err instanceof Error ? err.message : "unknown error",
        }))
      } finally {
        closed = true
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "connection": "keep-alive",
    },
  })
}
