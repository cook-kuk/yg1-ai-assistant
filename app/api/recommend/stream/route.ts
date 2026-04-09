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

      // Heartbeat reasoning: many engine paths don't fire onThinking until late
      // (or not at all for first-turn recommendations). To keep the UI alive,
      // emit a sequence of generic stage updates until either the real engine
      // reasoning arrives (sawRealThinking flips true) or the final frame ships.
      let sawRealThinking = false
      let heartbeatIdx = 0
      const heartbeatStages = [
        "🤔 사용자 입력을 해석하는 중…",
        "🔎 필터를 추출하고 후보 풀을 구성하는 중…",
        "📐 도메인 지식과 충돌 여부를 점검하는 중…",
        "🧮 후보 점수를 매기고 정렬하는 중…",
        "✍️ 추천 근거를 정리하는 중…",
      ]
      // Fire first stage right away so the trail is never empty.
      safeEnqueue(sseFrame("thinking", { text: heartbeatStages[0], delta: false, kind: "stage" }))
      heartbeatIdx = 1
      const heartbeatTimer = setInterval(() => {
        if (closed) return
        if (heartbeatIdx >= heartbeatStages.length) return
        safeEnqueue(sseFrame("thinking", { text: heartbeatStages[heartbeatIdx], delta: false, kind: "stage" }))
        heartbeatIdx++
      }, 2500)

      // Real-time CoT: SQL agent reasoning is flushed the moment it's parsed,
      // before retrieval. The client renders it Claude-style as the message
      // streams in. Two modes:
      //   - {delta:true, text}: append `text` to whatever the UI has shown so
      //     far (true token-by-token streaming from provider.stream())
      //   - {text}: replace the UI's current value (single-shot reasoning from
      //     synthetic fallbacks or non-streaming providers)
      const onThinking = (text: string, opts?: { delta?: boolean; kind?: "deep" | "stage" }) => {
        if (!text) return
        if (!opts?.delta && !text.trim()) return
        if (!sawRealThinking) sawRealThinking = true
        // 기본은 stage(메인 trail). 호출자가 명시적으로 kind:"deep" 을 주면
        // 토글 본문(thinkingDeep)으로 라우팅 — 한 턴 끝난 뒤에도 펼쳐 볼 수
        // 있도록 message 객체에 그대로 보존된다.
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
            primaryFactChecked: payload.primaryFactChecked as Record<string, unknown> | null,
            altExplanations: payload.altExplanations,
            altFactChecked: payload.altFactChecked as Array<Record<string, unknown>>,
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
        const runtimeDeps = createServeRuntimeDependencies({ onEarlyFlush, onThinking })

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
        clearInterval(heartbeatTimer)
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
