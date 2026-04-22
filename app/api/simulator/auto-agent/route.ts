/**
 * AI 자율 에이전트 (최고 조건 자동 탐색) API
 *
 * POST /api/simulator/auto-agent
 *
 * Body:
 *   {
 *     state: { ...현재 simulator 전체 state },   // Vc/fz/ap/ae 포함
 *     goal:  "productivity" | "tool-life" | "quality" | "cost",
 *     maxIterations?: number                      // 기본 6, 3~8 clamp
 *   }
 *
 * Response: SSE streaming text/event-stream
 *   event: thinking   data: {"text": "현재 Vc가 낮아 150 시도..."}
 *   event: iteration  data: {"n":1,"params":{Vc,fz,ap,ae},"predicted":{mrr,toolLife,Ra,chatterRisk},"score":0.82,"note":"..."}
 *   event: final      data: {"bestParams":{...},"bestScore":0.95,"reasoning":"...","history":[...]}
 *   event: error      data: {"message":"..."}
 *
 * 모델: Claude Sonnet 4.6 (ANTHROPIC_AUTO_AGENT_MODEL → ANTHROPIC_SONNET_MODEL → "claude-sonnet-4-20250514")
 *
 * 참고: /app/api/simulator/coach/route.ts (SSE 패턴),
 *      /app/api/simulator/optimize/route.ts (JSON 추출·검증 패턴)
 */

import { NextRequest } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import * as Sentry from "@sentry/nextjs"
import { logApiRequest, logApiError, logApiLatency } from "@/lib/logger/sim-logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const AGENT_MODEL =
  process.env.ANTHROPIC_AUTO_AGENT_MODEL ||
  process.env.ANTHROPIC_SONNET_MODEL ||
  "claude-sonnet-4-20250514"

type Goal = "productivity" | "tool-life" | "quality" | "cost"

const GOAL_LABEL: Record<Goal, string> = {
  productivity: "생산성 최대화 (MRR↑, 사이클타임↓)",
  "tool-life": "공구 수명 최대화 (마모·열부하↓)",
  quality: "표면 품질 최대화 (Ra·진동↓)",
  cost: "총비용 최저 (공구비 + 사이클타임 합계 최소)",
}

interface SimParams {
  Vc: number
  fz: number
  ap: number
  ae: number
}

interface Predicted {
  mrr: number
  toolLife: number
  Ra: number
  chatterRisk: "low" | "med" | "high"
}

interface IterationRecord {
  n: number
  params: SimParams
  predicted: Predicted
  score: number
  note: string
}

// ── helpers ──────────────────────────────────────────────────────────
function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function extractCurrent(state: Record<string, unknown>): SimParams | null {
  const Vc = toNum(state.Vc)
  const fz = toNum(state.fz)
  const ap = toNum(state.ap)
  const ae = toNum(state.ae)
  if (Vc === null || fz === null || ap === null || ae === null) return null
  return { Vc, fz, ap, ae }
}

function clampIterations(v: unknown): number {
  const n = toNum(v)
  if (n === null) return 6
  return Math.max(3, Math.min(8, Math.round(n)))
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : trimmed
  try {
    return JSON.parse(body)
  } catch {
    const first = body.indexOf("{")
    const last = body.lastIndexOf("}")
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(body.slice(first, last + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function parseChatterRisk(v: unknown): "low" | "med" | "high" {
  if (v === "low" || v === "med" || v === "high") return v
  if (typeof v === "string") {
    const s = v.toLowerCase()
    if (s.startsWith("l")) return "low"
    if (s.startsWith("h")) return "high"
  }
  return "med"
}

function validateIteration(
  raw: unknown,
  n: number,
): IterationRecord | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const p = (r.params ?? {}) as Record<string, unknown>
  const Vc = toNum(p.Vc)
  const fz = toNum(p.fz)
  const ap = toNum(p.ap)
  const ae = toNum(p.ae)
  if (Vc === null || fz === null || ap === null || ae === null) return null

  const pred = (r.predicted ?? {}) as Record<string, unknown>
  const mrr = toNum(pred.mrr) ?? 0
  const toolLife = toNum(pred.toolLife) ?? 0
  const Ra = toNum(pred.Ra) ?? 0
  const chatterRisk = parseChatterRisk(pred.chatterRisk)

  let score = toNum(r.score) ?? 0
  if (score > 1) score = score / 100 // 0~100 대응
  score = Math.max(0, Math.min(1, score))

  const note = typeof r.note === "string" ? r.note : ""

  return {
    n,
    params: { Vc, fz, ap, ae },
    predicted: { mrr, toolLife, Ra, chatterRisk },
    score,
    note,
  }
}

// ── prompts ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = [
  "너는 CNC 가공 최적화 자율 에이전트다.",
  "현재 조건을 여러 번 조정하며 사용자의 목표(goal)에 도달할 때까지 실험한다.",
  "각 iteration에서 JSON으로 제안 후 예상 결과를 계산한다. 최종적으로 최고 조건을 선정한다.",
  "",
  "규칙:",
  "1) Sandvik/Harvey 카탈로그 권장 범위를 벗어나지 않는다.",
  "2) 공구경/스틱아웃/날수 기반 기계역학 한계(처짐·채터)를 고려한다.",
  "3) 각 iteration은 이전 iteration의 결과를 반드시 반영해서 탐색 방향을 조정한다 (Bayesian-like).",
  "4) score는 0~1, goal에 대한 가중 점수. 반드시 0~1 범위.",
  "5) chatterRisk는 'low' | 'med' | 'high' 중 하나.",
  "6) 이전 iteration과 최소 하나 이상의 파라미터는 달라야 한다 (탐색 의미).",
  "7) 반드시 아래 JSON 스키마만 출력. 마크다운/주석/설명문 금지.",
  "",
  "iteration 출력 스키마:",
  "{",
  '  "params":   { "Vc": number, "fz": number, "ap": number, "ae": number },',
  '  "predicted": { "mrr": number, "toolLife": number, "Ra": number, "chatterRisk": "low"|"med"|"high" },',
  '  "score":    number,',
  '  "note":     "한국어 1문장 (왜 이 조합을 시도했는지)"',
  "}",
  "",
  "final 출력 스키마 (모든 iteration 끝난 뒤):",
  "{",
  '  "bestIndex": number,',
  '  "reasoning": "한국어 2~4문장 (왜 이게 최고인지 근거)"',
  "}",
].join("\n")

function buildInitialUserPrompt(
  state: Record<string, unknown>,
  goal: Goal,
  current: SimParams,
  maxIterations: number,
): string {
  return [
    "## 최적화 목표",
    `- goal: ${goal}`,
    `- 설명: ${GOAL_LABEL[goal]}`,
    "",
    "## 현재 파라미터 (iteration 0 · baseline)",
    `- Vc: ${current.Vc} m/min`,
    `- fz: ${current.fz} mm/tooth`,
    `- ap: ${current.ap} mm`,
    `- ae: ${current.ae} mm`,
    "",
    "## 시뮬레이터 전체 state",
    "```json",
    JSON.stringify(state, null, 2),
    "```",
    "",
    `총 ${maxIterations}회 iteration을 진행할 것이다.`,
    "먼저 iteration 1의 JSON 한 개만 출력해 주세요. 다른 텍스트/마크다운 없이.",
  ].join("\n")
}

function buildNextIterationPrompt(
  n: number,
  total: number,
  history: IterationRecord[],
): string {
  return [
    `## 지금까지의 iteration (${history.length}건)`,
    "```json",
    JSON.stringify(history, null, 2),
    "```",
    "",
    `다음은 iteration ${n} / ${total}.`,
    "이전 결과에서 최고점을 낸 조합의 방향을 이어가되, 아직 안 가본 영역도 조금 탐색해 주세요.",
    "iteration JSON 한 개만 출력. 다른 텍스트 금지.",
  ].join("\n")
}

function buildFinalPrompt(
  history: IterationRecord[],
  goal: Goal,
): string {
  return [
    `## 최적화 목표: ${GOAL_LABEL[goal]}`,
    "",
    `## 전체 iteration (${history.length}건)`,
    "```json",
    JSON.stringify(history, null, 2),
    "```",
    "",
    "위 결과 중 목표에 가장 부합하는 iteration을 골라 final JSON 스키마로만 출력해 주세요.",
    "bestIndex는 history 배열의 0-based 인덱스입니다. 다른 텍스트 금지.",
  ].join("\n")
}

async function askOnce(
  client: Anthropic,
  system: string,
  userPrompt: string,
  conversation: Array<{ role: "user" | "assistant"; content: string }>,
  onThinking?: (text: string) => void,
): Promise<string> {
  // 대화 맥락 유지 + 새 사용자 턴 추가
  const messages = [
    ...conversation,
    { role: "user" as const, content: userPrompt },
  ]

  // thinking 이벤트를 위해 스트리밍 사용. JSON 자체는 전체 텍스트에서 추출.
  let accumulated = ""
  const stream = client.messages.stream({
    model: AGENT_MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  })

  stream.on("text", (delta: string) => {
    accumulated += delta
    if (onThinking) onThinking(delta)
  })

  await stream.finalMessage()
  return accumulated
}

// ── route ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const started = Date.now()
  logApiRequest("/api/simulator/auto-agent", "POST")
  try {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }

  let body: { state?: unknown; goal?: unknown; maxIterations?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const goal = body.goal
  if (
    goal !== "productivity" &&
    goal !== "tool-life" &&
    goal !== "quality" &&
    goal !== "cost"
  ) {
    return new Response(
      JSON.stringify({
        error: "goal must be one of productivity|tool-life|quality|cost",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )
  }

  if (!body.state || typeof body.state !== "object") {
    return new Response(
      JSON.stringify({ error: "state (object) is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )
  }

  const state = body.state as Record<string, unknown>
  const current = extractCurrent(state)
  if (!current) {
    return new Response(
      JSON.stringify({ error: "state must include numeric Vc, fz, ap, ae" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )
  }

  const maxIterations = clampIterations(body.maxIterations)
  const client = new Anthropic({ apiKey })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false
      const send = (event: string, data: Record<string, unknown>) => {
        if (closed) return
        const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          closed = true
        }
      }

      // 클라이언트 abort 감지
      const abortSignal = req.signal
      const onAbort = () => {
        closed = true
        try {
          controller.close()
        } catch {
          /* noop */
        }
      }
      abortSignal.addEventListener("abort", onAbort)

      const history: IterationRecord[] = []
      const conversation: Array<{
        role: "user" | "assistant"
        content: string
      }> = []

      try {
        for (let n = 1; n <= maxIterations; n++) {
          if (closed || abortSignal.aborted) break

          const userPrompt =
            n === 1
              ? buildInitialUserPrompt(state, goal, current, maxIterations)
              : buildNextIterationPrompt(n, maxIterations, history)

          // thinking delta → client (처음 ~200자까지만 "사고" 텍스트로 보여주기)
          let thinkingBudget = 400
          const raw = await askOnce(
            client,
            SYSTEM_PROMPT,
            userPrompt,
            conversation,
            (delta) => {
              if (closed) return
              if (thinkingBudget <= 0) return
              // JSON 중괄호가 시작되기 전까지만 사고 텍스트로 보내기
              if (delta.includes("{")) {
                thinkingBudget = 0
                return
              }
              thinkingBudget -= delta.length
              send("thinking", { text: delta, n })
            },
          )

          // 다음 턴을 위해 대화 히스토리에 축적
          conversation.push({ role: "user", content: userPrompt })
          conversation.push({ role: "assistant", content: raw })

          const parsed = extractJson(raw)
          const iter = validateIteration(parsed, n)
          if (!iter) {
            send("thinking", {
              text: `\n[iter ${n}] JSON 파싱 실패, 건너뜀`,
              n,
            })
            continue
          }

          history.push(iter)
          send("iteration", {
            n: iter.n,
            params: iter.params,
            predicted: iter.predicted,
            score: iter.score,
            note: iter.note,
          })
        }

        if (closed || abortSignal.aborted) {
          return
        }

        if (history.length === 0) {
          send("error", {
            message: "모든 iteration에서 유효한 JSON을 받지 못했습니다",
          })
          return
        }

        // final 선정
        let bestIndex = 0
        let reasoning = ""
        try {
          const finalPrompt = buildFinalPrompt(history, goal)
          const rawFinal = await askOnce(
            client,
            SYSTEM_PROMPT,
            finalPrompt,
            conversation,
          )
          const parsedFinal = extractJson(rawFinal) as
            | { bestIndex?: unknown; reasoning?: unknown }
            | null
          if (parsedFinal && typeof parsedFinal === "object") {
            const idx = toNum(parsedFinal.bestIndex)
            if (
              idx !== null &&
              Number.isInteger(idx) &&
              idx >= 0 &&
              idx < history.length
            ) {
              bestIndex = idx
            }
            if (typeof parsedFinal.reasoning === "string") {
              reasoning = parsedFinal.reasoning
            }
          }
        } catch {
          // 실패 시 최고 score fallback
        }

        // fallback: 실제 score 기준 최고
        const scoreBest = history.reduce(
          (acc, it, i) => (it.score > history[acc].score ? i : acc),
          0,
        )
        if (!reasoning) {
          bestIndex = scoreBest
          const b = history[bestIndex]
          reasoning = `${history.length}개 iteration 중 score ${b.score.toFixed(2)}로 가장 높음. chatterRisk=${b.predicted.chatterRisk}, 예상 MRR=${b.predicted.mrr}, 예상 공구수명=${b.predicted.toolLife}분.`
        }

        const best = history[bestIndex]
        send("final", {
          bestParams: best.params,
          bestScore: best.score,
          bestIndex,
          reasoning,
          history,
        })
      } catch (err) {
        try { Sentry.captureException(err) } catch {}
        const msg =
          err instanceof Anthropic.APIError
            ? `Anthropic ${err.status ?? ""}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err)
        send("error", { message: msg })
      } finally {
        abortSignal.removeEventListener("abort", onAbort)
        if (!closed) {
          try {
            controller.close()
          } catch {
            /* noop */
          }
          closed = true
        }
      }
    },
  })

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
  logApiLatency("/api/simulator/auto-agent", Date.now() - started)
  return response
  } catch (err) {
    logApiError("/api/simulator/auto-agent", err)
    throw err
  }
}
