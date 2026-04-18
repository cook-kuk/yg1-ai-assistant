/**
 * Flag-guarded bridge between the legacy streaming recommender and the new
 * Python /products endpoint. Keeps the hook's signature stable — when
 * NEXT_PUBLIC_USE_PYTHON_API is "true", the hook's streamRecommendation calls
 * route through fetchProducts and the ProductsResponse is adapted into a
 * minimal RecommendationResponseDto skeleton. When the flag is absent or
 * "false", the call falls through to the original SSE client unchanged.
 *
 * The Python path does not emit streaming events; onThinking / onCards
 * callbacks simply do not fire on that branch. The legacy path is untouched.
 */

import { streamRecommendation, type StreamRecommendationOptions } from "@/lib/frontend/recommendation/recommendation-stream-client"
import {
  USE_PYTHON_API,
  adaptProductsToRecommendationDto,
  fetchProducts,
} from "@/lib/frontend/recommendation/products-api-client"
import { buildIntakePromptText } from "@/lib/frontend/recommendation/intake-flow"
import type { RecommendationRequestDto, RecommendationResponseDto } from "@/lib/contracts/recommendation"

function extractLastUserText(payload: RecommendationRequestDto): string | undefined {
  const msgs = payload.messages
  if (!msgs?.length) return undefined
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    const m = msgs[i]
    if (m.role === "user" && typeof m.text === "string" && m.text.trim()) return m.text
  }
  return undefined
}

function deriveMessage(payload: RecommendationRequestDto): string | undefined {
  // Prefer an explicit chat turn — that's what the user actually typed.
  const fromMessages = extractLastUserText(payload)
  if (fromMessages) return fromMessages
  // Intake-form entry point sends `{intakeForm, messages: []}`. Synthesize
  // a prompt string from the form so the Python /products guard (which
  // rejects requests with neither message nor filters) doesn't 400 us.
  const form = payload.intakeForm
  if (form) {
    try {
      const text = buildIntakePromptText(form, payload.language ?? "ko")
      if (text && text.trim()) return text
    } catch {
      // fall through — caller will handle the empty case
    }
  }
  return undefined
}

export async function streamRecommendationMaybePython(
  payload: RecommendationRequestDto,
  options: StreamRecommendationOptions = {},
): Promise<RecommendationResponseDto> {
  if (!USE_PYTHON_API) {
    return streamRecommendation(payload, options)
  }

  const message = deriveMessage(payload)
  const resp = await fetchProducts(message)
  const pageSize = payload.pagination?.pageSize
  return adaptProductsToRecommendationDto(resp, pageSize ? { pageSize } : {})
}
