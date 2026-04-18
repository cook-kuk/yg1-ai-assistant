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

export async function streamRecommendationMaybePython(
  payload: RecommendationRequestDto,
  options: StreamRecommendationOptions = {},
): Promise<RecommendationResponseDto> {
  if (!USE_PYTHON_API) {
    return streamRecommendation(payload, options)
  }

  const message = extractLastUserText(payload)
  const resp = await fetchProducts(message)
  const pageSize = payload.pagination?.pageSize
  return adaptProductsToRecommendationDto(resp, pageSize ? { pageSize } : {})
}
