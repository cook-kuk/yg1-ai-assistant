/**
 * Bridge to the Python `/products` pipeline via the Next.js proxy layer.
 *
 * Primary path — `POST /api/products/stream` → FastAPI `/products/stream`
 * (SSE). Python emits:
 *   - `filters`  → intent dict + route + session_id
 *   - `products` → top-10 cards + count + broadened flag
 *   - `answer`   → answer + chips + reasoning (CoT)
 *   - `done`     → terminator
 * Each is translated to the hook's streaming callbacks:
 *   filters → onThinking(stage summary)
 *   products → onThinking(candidate count) + onCards(partial DTO)
 *   answer.reasoning → onThinking(…, kind:"deep") — populates thinkingDeep
 *
 * Fallback — if the stream init fails (non-2xx, missing body, transport
 * error) we retry via the non-stream `fetchProducts` path (same adapter, no
 * CoT). Last-resort safety net so a Python hiccup doesn't blank the UI.
 *
 * There is no longer a legacy-JS branch or feature flag — Python is the only
 * recommendation backend for the product page.
 */

import {
  adaptProductsToRecommendationDto,
  fetchProducts,
  type ProductCard,
  type ProductsResponse,
} from "@/lib/frontend/recommendation/products-api-client"
import { buildIntakePromptText } from "@/lib/frontend/recommendation/intake-flow"
import type { RecommendationRequestDto, RecommendationResponseDto } from "@/lib/contracts/recommendation"

export interface StreamRecommendationCallbacks {
  onCards?: (dto: RecommendationResponseDto) => void
  /**
   * Real-time reasoning flushes from the server.
   *
   * - `delta=true`  → `text` is a chunk to *append* to the in-flight reasoning.
   * - `delta=false` → `text` is the *complete* reasoning so far; *replace*
   *                   the current value.
   */
  onThinking?: (text: string, opts?: { delta?: boolean; kind?: "stage" | "deep" | "agent" }) => void
}

export interface StreamRecommendationOptions extends StreamRecommendationCallbacks {
  signal?: AbortSignal
  timeoutMs?: number
}

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
  const fromMessages = extractLastUserText(payload)
  if (fromMessages) return fromMessages
  const form = payload.intakeForm
  if (form) {
    try {
      const text = buildIntakePromptText(form, payload.language ?? "ko")
      if (text && text.trim()) return text
    } catch {
      // fall through
    }
  }
  return undefined
}

// Module-level so Python's carry-forward context ("이 중에서 4날" on turn 2
// still knows material+diameter from turn 1) survives across bridge calls.
// The hook calls sequentially so a shared slot is fine.
let _pythonSessionId: string | null = null

export function resetPythonSession(): void {
  _pythonSessionId = null
}

export function getPythonSessionId(): string | null {
  return _pythonSessionId
}

// ── SSE helpers ──────────────────────────────────────────────────────

interface StreamFiltersEvent {
  filters: Record<string, unknown> | null
  route?: string
  session_id?: string | null
}

interface StreamProductsEvent {
  count: number
  top10: Array<{
    edp_no: string
    brand?: string | null
    series?: string | null
    tool_type?: string | null
    subtype?: string | null
    diameter?: string | null
    flutes?: string | null
    coating?: string | null
    material_tags?: string[] | null
    description?: string | null
    feature?: string | null
    oal?: string | null
    loc?: string | null
    helix_angle?: string | null
    coolant_hole?: string | null
    shank_type?: string | null
    total_stock?: number | null
    warehouse_count?: number | null
    stock_status?: string | null
    matched_fields?: string[] | null
    material_rating?: string | null
    score: number
    score_breakdown?: Record<string, number>
  }>
  broadened?: boolean
  score_breakdown_max?: Record<string, number> | null
}

interface StreamAnswerEvent {
  answer?: string
  chips?: string[]
  reasoning?: string
  refined_filters?: Record<string, unknown> | null
}

function formatFilterStage(intent: Record<string, unknown> | null): string | null {
  if (!intent) return null
  const bits: string[] = []
  const push = (label: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return
    bits.push(`${label}=${v}`)
  }
  push("소재", intent.material_tag)
  push("세부 피삭재", intent.workpiece_name)
  push("직경", intent.diameter)
  push("날수", intent.flute_count)
  push("형상", intent.subtype)
  push("브랜드", intent.brand)
  push("코팅", intent.coating)
  if (!bits.length) return "요청 해석 중 — 조건 미검출"
  return `조건 추출: ${bits.join(", ")}`
}

function streamTopToProductCards(top10: StreamProductsEvent["top10"]): ProductCard[] {
  // Stream payload mirrors sync /products' ProductCard shape so the partial
  // UI renders with the same badges (inventory, matched_fields, LOC/OAL)
  // as the terminal answer. Fields the stream omits fall back to null.
  return top10.map(row => ({
    edp_no: row.edp_no,
    brand: row.brand ?? null,
    series: row.series ?? null,
    tool_type: row.tool_type ?? null,
    subtype: row.subtype ?? null,
    diameter: row.diameter ?? null,
    flutes: row.flutes ?? null,
    coating: row.coating ?? null,
    material_tags: row.material_tags ?? null,
    description: row.description ?? null,
    feature: row.feature ?? null,
    oal: row.oal ?? null,
    loc: row.loc ?? null,
    helix_angle: row.helix_angle ?? null,
    coolant_hole: row.coolant_hole ?? null,
    shank_type: row.shank_type ?? null,
    total_stock: row.total_stock ?? null,
    warehouse_count: row.warehouse_count ?? null,
    stock_status: row.stock_status ?? null,
    matched_fields: row.matched_fields ?? null,
    material_rating: row.material_rating ?? null,
    score: typeof row.score === "number" ? row.score : 0,
    score_breakdown: row.score_breakdown ?? {},
  }))
}

function intentToAppliedFilters(
  intent: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!intent) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(intent)) {
    if (v !== null && v !== undefined && v !== "") out[k] = v
  }
  return out
}

function parseSseFrame(frame: string): { event: string; data: unknown } | null {
  let event = "message"
  const dataLines: string[] = []
  for (const line of frame.split("\n")) {
    if (!line) continue
    if (line.startsWith("event:")) event = line.slice(6).trim()
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) }
  } catch {
    return null
  }
}

async function streamProductsViaPython(
  payload: RecommendationRequestDto,
  options: StreamRecommendationOptions,
): Promise<RecommendationResponseDto> {
  const { onCards, onThinking, signal, timeoutMs = 120_000 } = options
  const message = deriveMessage(payload)
  const pageSize = payload.pagination?.pageSize

  // Immediate heartbeat — flips the AI placeholder's reasoningVisibility from
  // "hidden" to "simple" so the ReasoningPanel (and its elapsed/ETA timer)
  // renders from t=0 instead of blanking until the first Python SSE frame.
  if (onThinking) {
    try { onThinking("🤔 요청을 분석 중…", { delta: false, kind: "stage" }) } catch { /* non-blocking */ }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener("abort", () => controller.abort(), { once: true })
  }

  try {
    const res = await fetch("/api/products/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify({
        message,
        filters: null,
        session_id: _pythonSessionId ?? undefined,
      }),
      signal: controller.signal,
    })

    if (!res.ok || !res.body) {
      throw new Error(`stream init failed (${res.status})`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    let intent: Record<string, unknown> | null = null
    let streamedTop: ProductCard[] = []
    let streamedCount = 0
    let streamedBroadened = false
    let answer = ""
    let chips: string[] = []
    let reasoning = ""

    const flushPartialCards = () => {
      if (!onCards) return
      const partial: ProductsResponse = {
        text: "",
        purpose: "recommendation",
        chips: [],
        isComplete: false,
        products: streamedTop,
        allProducts: [],
        appliedFilters: intentToAppliedFilters(intent),
        totalCount: streamedCount,
        route: "stream-partial",
      }
      try {
        onCards(adaptProductsToRecommendationDto(partial, pageSize ? { pageSize } : {}))
      } catch {
        // partials must never block the stream
      }
    }

    const dispatch = (frame: string) => {
      const parsed = parseSseFrame(frame)
      if (!parsed) return
      const { event, data } = parsed

      if (event === "filters") {
        const payload = data as StreamFiltersEvent
        intent = payload.filters ?? null
        if (payload.session_id) _pythonSessionId = payload.session_id
        if (onThinking) {
          const stage = formatFilterStage(intent)
          if (stage) onThinking(stage, { delta: false, kind: "stage" })
        }
      } else if (event === "products") {
        const payload = data as StreamProductsEvent
        streamedTop = streamTopToProductCards(payload.top10 ?? [])
        streamedCount = typeof payload.count === "number" ? payload.count : streamedTop.length
        streamedBroadened = payload.broadened === true
        if (onThinking) {
          const txt = streamedBroadened
            ? `전체 카탈로그로 확장 · 후보 ${streamedCount}건 · 상위 ${streamedTop.length}개 확보`
            : `후보 ${streamedCount}건 확보 · 상위 ${streamedTop.length}개 확정`
          onThinking(txt, { delta: false, kind: "stage" })
        }
        flushPartialCards()
      } else if (event === "thinking") {
        // Strong CoT progress marker. Python emits up to three of these
        // (deep-analysis start / drafting / verifying) so the user sees
        // the 30–50s wait is intentional. Payload: {step, total_steps,
        // status, cot_level?}.
        const payload = data as { status?: string; step?: number; total_steps?: number; cot_level?: string }
        if (onThinking && typeof payload.status === "string") {
          onThinking(payload.status, { delta: false, kind: "stage" })
        }
      } else if (event === "partial_answer") {
        // Strong CoT draft token stream. Each frame carries the *whole*
        // draft so far (not a delta), so just overwrite the deep-reasoning
        // lane. ReasoningPanel already handles monotonic text growth.
        const payload = data as { text?: string; status?: string }
        const text = typeof payload.text === "string" ? payload.text : ""
        if (onThinking && text) {
          onThinking(text, { delta: false, kind: "deep" })
        }
      } else if (event === "answer") {
        const payload = data as StreamAnswerEvent
        answer = payload.answer ?? ""
        chips = Array.isArray(payload.chips) ? payload.chips : []
        reasoning = typeof payload.reasoning === "string" ? payload.reasoning : ""
        if (onThinking && reasoning) {
          onThinking(reasoning, { delta: false, kind: "deep" })
        }
      }
      // `done` is a terminator — nothing to emit.
    }

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        dispatch(frame)
      }
    }
    if (buffer.trim()) dispatch(buffer)

    const finalPayload: ProductsResponse = {
      text: answer,
      purpose: "recommendation",
      chips,
      isComplete: true,
      products: streamedTop,
      allProducts: [],
      appliedFilters: intentToAppliedFilters(intent),
      totalCount: streamedCount,
      route: "stream",
    }
    const dto = adaptProductsToRecommendationDto(finalPayload, pageSize ? { pageSize } : {})
    if (reasoning) {
      dto.thinkingDeep = reasoning
      dto.reasoningVisibility = "full"
    }
    return dto
  } finally {
    clearTimeout(timer)
  }
}

async function nonStreamFallback(
  payload: RecommendationRequestDto,
  pageSize: number | undefined,
): Promise<RecommendationResponseDto> {
  const message = deriveMessage(payload)
  const resp = await fetchProducts(message, undefined, _pythonSessionId)
  if (resp.session_id) _pythonSessionId = resp.session_id
  return adaptProductsToRecommendationDto(resp, pageSize ? { pageSize } : {})
}

export async function streamRecommendationViaPython(
  payload: RecommendationRequestDto,
  options: StreamRecommendationOptions = {},
): Promise<RecommendationResponseDto> {
  try {
    return await streamProductsViaPython(payload, options)
  } catch (err) {
    // Stream init / transport failure → last-resort non-stream path so a
    // Python hiccup doesn't blank the UI.
    console.warn("[python-bridge] SSE failed, falling back to /products:", err)
    const pageSize = payload.pagination?.pageSize
    return nonStreamFallback(payload, pageSize)
  }
}
