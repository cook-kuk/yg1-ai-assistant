/**
 * AI 1-click 최적화 API
 *
 * POST /api/simulator/optimize
 *
 * Body:
 *   {
 *     state: { ...현재 simulator 전체 state },
 *     goal: "productivity" | "tool-life" | "quality" | "cost"
 *   }
 *
 * Response: NextResponse.json(OptimizeResult)
 *
 * 모델: Claude Sonnet 4.6 (정확도 우선 — Haiku 대신)
 *
 * 참고: /app/api/simulator/coach/route.ts (SSE 패턴),
 *      /app/api/simulator/explain-warning/route.ts (단발 응답 패턴)
 */

import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import * as Sentry from "@sentry/nextjs"
import { logApiRequest, logApiError, logApiLatency } from "@/lib/logger/sim-logger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SONNET_MODEL =
  process.env.ANTHROPIC_SONNET_MODEL || "claude-sonnet-4-20250514"

type Goal = "productivity" | "tool-life" | "quality" | "cost"

const GOAL_LABEL: Record<Goal, string> = {
  productivity: "생산성 최대화 (MRR↑)",
  "tool-life": "공구 수명 최대화 (마모↓)",
  quality: "표면 품질 최대화 (조도·진동↓)",
  cost: "비용 최저 (공구비+사이클타임 합계 최소)",
}

const SYSTEM_PROMPT = [
  "너는 Sandvik/Harvey 표준을 준수하는 CNC 가공 최적화 엔지니어 AI다.",
  "현재 가공조건(Vc/fz/ap/ae + 공구/재질/장비 컨텍스트)과 사용자의 최적화 목표를 받아,",
  "안전 범위 내에서 목표에 가장 부합하는 파라미터를 JSON으로 제안한다.",
  "",
  "규칙:",
  "1) 파라미터는 Sandvik/Harvey 카탈로그 권장 범위를 벗어나지 않는다.",
  "2) 공구경/스틱아웃/날수에 따른 기계역학 한계(처짐·채터)를 고려한다.",
  "3) 각 변경 값에 대해 '왜 이렇게 바꿨는지'를 한국어 1문장으로 설명한다.",
  "4) 예상 개선치는 공식 기반으로 수치화(+25% 등). 확실치 않으면 보수적으로.",
  "5) 위험은 2~4개, 구체적으로 작성.",
  "6) 반드시 아래 JSON 스키마만 출력. 마크다운/주석/설명문 금지.",
  "",
  "출력 스키마:",
  '{',
  '  "optimized": { "Vc": number, "fz": number, "ap": number, "ae": number },',
  '  "current":   { "Vc": number, "fz": number, "ap": number, "ae": number },',
  '  "changes": [',
  '    { "param": "Vc"|"fz"|"ap"|"ae", "from": number, "to": number, "reason": "한국어 1문장" }',
  '  ],',
  '  "expectedImprovements": {',
  '    "mrr": "+25%",',
  '    "toolLifePct": "-15%",',
  '    "summary": "한국어 1문장 요약"',
  '  },',
  '  "risks": ["위험1", "위험2"]',
  '}',
].join("\n")

interface SimParams {
  Vc: number
  fz: number
  ap: number
  ae: number
}

interface OptimizeChange {
  param: "Vc" | "fz" | "ap" | "ae"
  from: number
  to: number
  reason: string
}

interface OptimizeResult {
  optimized: SimParams
  current: SimParams
  changes: OptimizeChange[]
  expectedImprovements: {
    mrr: string
    toolLifePct: string
    summary: string
  }
  risks: string[]
}

function extractCurrent(state: Record<string, unknown>): SimParams | null {
  const toNum = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v
    if (typeof v === "string") {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    return null
  }
  const Vc = toNum(state.Vc)
  const fz = toNum(state.fz)
  const ap = toNum(state.ap)
  const ae = toNum(state.ae)
  if (Vc === null || fz === null || ap === null || ae === null) return null
  return { Vc, fz, ap, ae }
}

function buildUserPrompt(
  state: Record<string, unknown>,
  goal: Goal,
  current: SimParams,
): string {
  const stateJson = JSON.stringify(state, null, 2)
  return [
    `## 최적화 목표`,
    `- goal: ${goal}`,
    `- 설명: ${GOAL_LABEL[goal]}`,
    ``,
    `## 현재 파라미터 (기준값)`,
    `- Vc: ${current.Vc} m/min`,
    `- fz: ${current.fz} mm/tooth`,
    `- ap: ${current.ap} mm`,
    `- ae: ${current.ae} mm`,
    ``,
    `## 시뮬레이터 전체 state`,
    "```json",
    stateJson,
    "```",
    ``,
    `위 컨텍스트를 분석해서 "${GOAL_LABEL[goal]}" 목표에 최적화된 Vc/fz/ap/ae를 JSON으로만 출력해 주세요.`,
  ].join("\n")
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim()
  // 코드펜스 제거
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : trimmed
  try {
    return JSON.parse(body)
  } catch {
    // 중괄호 구간만 추출 재시도
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

function validateResult(
  raw: unknown,
  current: SimParams,
): OptimizeResult | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const opt = r.optimized as Record<string, unknown> | undefined
  if (!opt) return null
  const toNum = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : Number(v)
    return Number.isFinite(n) ? n : null
  }
  const Vc = toNum(opt.Vc)
  const fz = toNum(opt.fz)
  const ap = toNum(opt.ap)
  const ae = toNum(opt.ae)
  if (Vc === null || fz === null || ap === null || ae === null) return null

  const changesRaw = Array.isArray(r.changes) ? r.changes : []
  const changes: OptimizeChange[] = changesRaw
    .map((c: unknown) => {
      if (!c || typeof c !== "object") return null
      const cc = c as Record<string, unknown>
      const param = cc.param
      if (
        param !== "Vc" &&
        param !== "fz" &&
        param !== "ap" &&
        param !== "ae"
      )
        return null
      const from = toNum(cc.from)
      const to = toNum(cc.to)
      const reason = typeof cc.reason === "string" ? cc.reason : ""
      if (from === null || to === null) return null
      return { param, from, to, reason } as OptimizeChange
    })
    .filter((c): c is OptimizeChange => c !== null)

  const exp = (r.expectedImprovements ?? {}) as Record<string, unknown>
  const expectedImprovements = {
    mrr: typeof exp.mrr === "string" ? exp.mrr : "±0%",
    toolLifePct:
      typeof exp.toolLifePct === "string" ? exp.toolLifePct : "±0%",
    summary: typeof exp.summary === "string" ? exp.summary : "",
  }

  const risks = Array.isArray(r.risks)
    ? r.risks.filter((x: unknown): x is string => typeof x === "string")
    : []

  return {
    optimized: { Vc, fz, ap, ae },
    current: (r.current as SimParams) ?? current,
    changes,
    expectedImprovements,
    risks,
  }
}

export async function POST(req: NextRequest) {
  const started = Date.now()
  logApiRequest("/api/simulator/optimize", "POST")
  try {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 },
    )
  }

  let body: { state?: unknown; goal?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const goal = body.goal
  if (
    goal !== "productivity" &&
    goal !== "tool-life" &&
    goal !== "quality" &&
    goal !== "cost"
  ) {
    return NextResponse.json(
      { error: "goal must be one of productivity|tool-life|quality|cost" },
      { status: 400 },
    )
  }

  if (!body.state || typeof body.state !== "object") {
    return NextResponse.json(
      { error: "state (object) is required" },
      { status: 400 },
    )
  }

  const state = body.state as Record<string, unknown>
  const current = extractCurrent(state)
  if (!current) {
    return NextResponse.json(
      { error: "state must include numeric Vc, fz, ap, ae" },
      { status: 400 },
    )
  }

  const userPrompt = buildUserPrompt(state, goal, current)
  const client = new Anthropic({ apiKey })

  try {
    const message = await client.messages.create({
      model: SONNET_MODEL,
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPrompt }],
    })

    const raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()

    const parsed = extractJson(raw)
    const result = validateResult(parsed, current)
    if (!result) {
      return NextResponse.json(
        { error: "LLM 응답을 파싱할 수 없습니다", raw },
        { status: 502 },
      )
    }

    // current는 서버에서 실제 state 값으로 덮어써서 신뢰성 보장
    result.current = current

    logApiLatency("/api/simulator/optimize", Date.now() - started)
    return NextResponse.json(result)
  } catch (err) {
    try { Sentry.captureException(err) } catch {}
    const msg =
      err instanceof Anthropic.APIError
        ? `Anthropic ${err.status ?? ""}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
  } catch (err) {
    logApiError("/api/simulator/optimize", err)
    throw err
  }
}
