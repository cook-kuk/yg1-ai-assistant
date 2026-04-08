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

export const maxDuration = 60

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
          })
          safeEnqueue(sseFrame("cards", partialDto))
        } catch (err) {
          traceRecommendationError("http.stream.cards:dto-error", err)
        }
      }

      try {
        const runtimeDeps = createServeRuntimeDependencies({ onEarlyFlush })

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
