import {
  parseRecommendationResponse,
} from "@/lib/frontend/recommendation/recommendation-client"
import type {
  RecommendationRequestDto,
  RecommendationResponseDto,
} from "@/lib/contracts/recommendation"

/**
 * Streams a recommendation request via /api/recommend/stream (SSE).
 *
 * Two events flow back:
 *   - `cards`: partial DTO emitted right before the LLM narrative is generated.
 *              `text` is empty but `recommendation`/cards data is populated.
 *              Use this to render product cards immediately for perceived speed.
 *   - `final`: full DTO once the LLM narrative is done (same shape as the
 *              non-streaming /api/recommend response).
 *
 * Falls back to a single JSON POST to /api/recommend if SSE fails or the
 * server doesn't honor the streaming endpoint.
 */
export interface StreamRecommendationCallbacks {
  onCards?: (dto: RecommendationResponseDto) => void
  /**
   * Real-time reasoning flushes from the server (Claude-style "thinking").
   *
   * - `delta=true`  → `text` is a chunk to *append* to the in-flight reasoning.
   *                   Used for true token-by-token streaming.
   * - `delta=false` → `text` is the *complete* reasoning so far; *replace* the
   *                   current value. Used for synthetic/non-streaming sources.
   */
  onThinking?: (text: string, opts?: { delta?: boolean }) => void
}

export interface StreamRecommendationOptions extends StreamRecommendationCallbacks {
  signal?: AbortSignal
  timeoutMs?: number
}

export async function streamRecommendation(
  payload: RecommendationRequestDto,
  options: StreamRecommendationOptions = {}
): Promise<RecommendationResponseDto> {
  const { onCards, onThinking, signal, timeoutMs = 55_000 } = options

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener("abort", () => controller.abort(), { once: true })
  }

  try {
    const res = await fetch("/api/recommend/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok || !res.body) {
      throw new Error(`stream init failed (${res.status})`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let finalDto: RecommendationResponseDto | null = null
    let streamErrorMessage: string | null = null

    // Parse SSE frames: blank line delimits events, lines are `event:` / `data:`.
    const dispatch = (rawFrame: string) => {
      let event = "message"
      const dataLines: string[] = []
      for (const line of rawFrame.split("\n")) {
        if (!line) continue
        if (line.startsWith("event:")) event = line.slice(6).trim()
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length === 0) return
      let parsed: unknown
      try { parsed = JSON.parse(dataLines.join("\n")) } catch { return }

      if (event === "cards") {
        if (!onCards) return
        try { onCards(parseRecommendationResponse(parsed)) }
        catch { /* malformed partial — ignore, final will arrive */ }
      } else if (event === "thinking") {
        if (!onThinking) return
        const obj = parsed as { text?: unknown; delta?: unknown } | null
        const text = obj?.text
        const delta = obj?.delta === true
        if (typeof text === "string" && (delta || text.trim())) {
          try { onThinking(text, { delta }) } catch { /* never block stream */ }
        }
      } else if (event === "final") {
        try { finalDto = parseRecommendationResponse(parsed) }
        catch (err) { streamErrorMessage = err instanceof Error ? err.message : "parse error" }
      } else if (event === "error") {
        const msg = (parsed as { message?: string } | null)?.message
        streamErrorMessage = msg ?? "stream error"
      }
    }

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      // SSE event delimiter is a blank line ("\n\n"). Some servers emit \r\n.
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "")
        dispatch(frame)
      }
    }
    if (buffer.trim()) dispatch(buffer)

    if (streamErrorMessage) throw new Error(streamErrorMessage)
    if (!finalDto) throw new Error("stream ended without final frame")
    return finalDto
  } catch (err) {
    // Fallback: plain JSON POST. Keeps tests/non-streaming clients working
    // and lets us silently degrade if SSE infra is unavailable.
    if (controller.signal.aborted && !signal?.aborted) {
      throw err
    }
    const fallbackController = new AbortController()
    const fallbackTimeout = setTimeout(() => fallbackController.abort(), timeoutMs)
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: fallbackController.signal,
      })
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`)
      return parseRecommendationResponse(await res.json())
    } finally {
      clearTimeout(fallbackTimeout)
    }
  } finally {
    clearTimeout(timeout)
  }
}
