/**
 * AI 채팅 사이드바 API (v3 persistent conversational)
 *
 * POST /api/simulator/chat
 *
 * Body:
 *   {
 *     messages: Array<{ role: "user" | "assistant", content: string }>,
 *     context?: Record<string, unknown>
 *   }
 *
 * Response: SSE streaming text/event-stream
 *   - data: {"type":"delta","text":"..."}
 *   - data: {"type":"done","usage":{...},"stop_reason":"..."}
 *   - data: {"type":"error","message":"..."}
 */

import { NextRequest } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import * as Sentry from "@sentry/nextjs"
import { logApiRequest, logApiError, logApiLatency } from "@/lib/logger/sim-logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const BASE_SYSTEM_PROMPT = `너는 YG-1 CNC 가공 전문 조언자 AI. 절삭조건 시뮬레이터 사용자의 질문에 친절하게 답해야 해.

## 답변 규칙
- 한국어로 답변. 초보자도 이해할 수 있게 **구체적이고 짧게** (100~300자)
- 공식이 있으면 그대로 인용 (예: Vc = π·D·n/1000)
- 수치 예시 적극 활용 (예: "SUS304라면 Vc 120 정도가 안전해요")
- 현재 시뮬 상태가 주어졌으면 그 값 기반으로 답변
- 친절한 어조 + 높임말

## 핵심 CNC 용어 필수 지식 (사용자가 물으면 반드시 답변)
- **RPM (n)**: 공구 회전수, 분당 회전 횟수. 공식: n = 1000·Vc / (π·D)
- **Vc (절삭속도)**: 공구 끝이 소재를 스치는 속도 (m/min). CNC의 가장 기본 파라미터
- **Vf (이송속도)**: 테이블이 이동하는 속도 (mm/min). Vf = fz·Z·n
- **fz (날당이송)**: 한 날이 한 바퀴 돌며 깎는 두께 (mm/t). 너무 작으면 rubbing → 공구 급속 마모
- **ap (축방향 절입 · ADOC)**: 공구가 아래로 얼마나 깊이 박히는지 (mm). 보통 ≤ 2·D
- **ae (경방향 절입 · RDOC)**: 공구가 옆으로 얼마나 넓게 깎는지 (mm). ae/D < 0.5면 chip thinning
- **MRR (금속제거율)**: 분당 깎아내는 부피 (cm³/min). MRR = ap·ae·Vf/1000
- **Pc (소요동력)**: Sandvik 공식 Pc = MRR·kc / (60·10³·η). 머신 한계 이하 필수
- **Ra (표면거칠기)**: 깎은 면의 거친 정도 (μm). 이론값 Ra ≈ fz²/(8·R)·1000
- **Fc (절삭력)**: 주절삭력 (N). Fc = 2·T·1000/D
- **δ (공구 편향)**: 캔틸레버 모델 δ = Fc·L³/(3·E·I)
- **ISO 재질**: P=탄소강, M=스테인리스, K=주철, N=비철, S=내열합금, H=고경도강
- **Taylor 공구수명**: V·T^n = C (n: 카바이드 ≈0.25, HSS ≈0.125)
- **Chatter (채터)**: 공구 떨림. L/D > 6 이면 위험
- **Climb 밀링**: 공구 회전방향 = 이송방향 (다운컷). 표면 -20%, 수명 +15%
- **RCTF**: Radial Chip Thinning Factor, ae/D<0.5 일 때 실 chip load 보정
- **코팅**: AlTiN(보라, 범용, ×1.35), AlCrN(고온·내열합금), DLC(알루미늄), nACo(60+ HRC)

## 질문 유형별 답변 패턴
- "X가 뭐에요?" → 용어 정의 + 공식 + 일반 범위 + 예시
- "이 조건 어때요?" → 현재 state 보고 진단 → 개선안
- "왜 이 값이 나와요?" → 공식 유도 단계별 + 대입값 설명

**절대 "모르겠습니다" 금지**. 위 용어 중 하나면 반드시 정의 + 공식 + 예시 제공.`

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type ChatRole = "user" | "assistant"

interface ChatTurn {
  role: ChatRole
  content: string
}

interface ChatRequestBody {
  messages?: ChatTurn[]
  context?: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────

function sanitizeMessages(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return []
  const out: ChatTurn[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const m = item as Record<string, unknown>
    const role = m.role
    const content = m.content
    if (
      (role === "user" || role === "assistant") &&
      typeof content === "string" &&
      content.trim().length > 0
    ) {
      out.push({ role, content })
    }
  }
  return out
}

function buildSystemPrompt(context?: Record<string, unknown>): string {
  if (!context || Object.keys(context).length === 0) {
    return BASE_SYSTEM_PROMPT
  }
  let ctxJson: string
  try {
    ctxJson = JSON.stringify(context, null, 2)
  } catch {
    ctxJson = "{}"
  }
  return [
    BASE_SYSTEM_PROMPT,
    "",
    "## 현재 시뮬레이터 상태",
    "```json",
    ctxJson,
    "```",
    "",
    "위 상태를 전제로 사용자의 질문에 답하라.",
  ].join("\n")
}

// ─────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const started = Date.now()
  logApiRequest("/api/simulator/chat", "POST")
  try {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    )
  }

  let body: ChatRequestBody
  try {
    body = (await req.json()) as ChatRequestBody
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const messages = sanitizeMessages(body.messages)
  if (messages.length === 0) {
    return new Response(
      JSON.stringify({ error: "messages must be a non-empty array" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )
  }

  // 마지막은 반드시 user 여야 multi-turn 대화 요청으로 유효
  if (messages[messages.length - 1].role !== "user") {
    return new Response(
      JSON.stringify({ error: "last message must be from user" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )
  }

  const systemPrompt = buildSystemPrompt(body.context)
  const client = new Anthropic({ apiKey })

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(obj)}\n\n`),
        )
      }

      try {
        const messageStream = client.messages.stream({
          model: process.env.ANTHROPIC_SONNET_MODEL ?? "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: [
            {
              type: "text",
              text: systemPrompt,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        })

        messageStream.on("text", (delta: string) => {
          send({ type: "delta", text: delta })
        })

        const finalMessage = await messageStream.finalMessage()

        send({
          type: "done",
          usage: {
            input_tokens: finalMessage.usage.input_tokens,
            output_tokens: finalMessage.usage.output_tokens,
            cache_read_input_tokens:
              finalMessage.usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens:
              finalMessage.usage.cache_creation_input_tokens ?? 0,
          },
          stop_reason: finalMessage.stop_reason,
        })
      } catch (err) {
        try { Sentry.captureException(err) } catch {}
        const msg =
          err instanceof Anthropic.APIError
            ? `Anthropic ${err.status ?? ""}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err)
        send({ type: "error", message: msg })
      } finally {
        controller.close()
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
  logApiLatency("/api/simulator/chat", Date.now() - started)
  return response
  } catch (err) {
    logApiError("/api/simulator/chat", err)
    throw err
  }
}
