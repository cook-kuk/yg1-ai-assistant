/**
 * AI 자연어 → 가공조건 프리셋 변환 API
 *
 * POST /api/simulator/nl-query
 *
 * Body: { query: string }
 *
 * Response (성공):
 *   { isoGroup, subgroupKey, operation, coating,
 *     Vc, fz, ap, ae, diameter, fluteCount, activeShape, reasoning }
 *
 * Response (파싱 실패):
 *   { error: "파싱 실패", raw: "..." }
 */

import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SYSTEM_PROMPT = [
  "너는 YG-1 CNC 시뮬레이터 도우미. 한국어 자연어 쿼리를 받아 구조화된 JSON 프리셋으로 변환한다. 반드시 JSON만 출력.",
  "",
  "출력 스키마(반드시 이 키만 포함):",
  "{",
  '  "isoGroup": "P|M|K|N|S|H",',
  '  "subgroupKey": "austenitic-ss|low-carbon-steel|aluminum-wrought|titanium-ti6al4v|inconel-718|hardened-steel|...",',
  '  "operation": "side-milling|slotting|finishing|roughing",',
  '  "coating": "altin|aicrn|uncoated|dlc|tin|ticn",',
  '  "Vc": number,',
  '  "fz": number,',
  '  "ap": number,',
  '  "ae": number,',
  '  "diameter": number,',
  '  "fluteCount": number,',
  '  "activeShape": "square|ball|radius|chamfer",',
  '  "reasoning": "간단 한국어 설명 (1~2문장)"',
  "}",
  "",
  "재질 매핑 가이드:",
  "- 알루미늄 → N / aluminum-wrought / uncoated 또는 dlc / Vc 300~800 / fz 0.05~0.15",
  "- 스테인리스(SUS/STS) → M / austenitic-ss / altin / Vc 80~180 / fz 0.03~0.08",
  "- 인코넬(Inconel) → S / inconel-718 / aicrn 또는 altin / Vc 20~50 / fz 0.03~0.06",
  "- 티타늄(Ti) → S / titanium-ti6al4v / altin / Vc 40~100 / fz 0.04~0.10",
  "- 일반강/연강 → P / low-carbon-steel / altin / Vc 150~250 / fz 0.05~0.12",
  "- 고경도강(HRC 50+) → H / hardened-steel / altin 또는 aicrn / Vc 40~120 / fz 0.02~0.05",
  "- 주철 → K",
  "",
  "의도 매핑:",
  "- '빠르게/빠른' → Vc 상한, fz 상한, operation=side-milling",
  "- '안전하게/보수적' → Vc 하한, fz 하한, ap 보수적",
  "- '마감/피니싱' → operation=finishing, fz 낮게, ae 작게",
  "- '황삭/거칠게/rough' → operation=roughing, ap 크게",
  "- '긴 수명/오래' → Vc 보수적, 코팅 강화",
  "",
  "공구 기본값: diameter=8~10, fluteCount=4 (알루미늄은 2~3), activeShape=square",
  "",
  "중요: 백틱/주석/설명 없이 순수 JSON 객체 하나만 출력. 스키마 키 전부 포함.",
].join("\n")

type Preset = {
  isoGroup: string
  subgroupKey: string
  operation: string
  coating: string
  Vc: number
  fz: number
  ap: number
  ae: number
  diameter: number
  fluteCount: number
  activeShape: string
  reasoning: string
}

function extractJson(text: string): string {
  const trimmed = text.trim()
  // ```json ... ``` 또는 ``` ... ``` 블록 제거
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenceMatch) return fenceMatch[1].trim()
  // 첫 { ~ 마지막 } 추출 (여분 텍스트 방어)
  const first = trimmed.indexOf("{")
  const last = trimmed.lastIndexOf("}")
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1)
  return trimmed
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured" },
      { status: 500 },
    )
  }

  let body: { query?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 })
  }

  const query = typeof body.query === "string" ? body.query.trim() : ""
  if (!query) {
    return NextResponse.json(
      { error: "query is required" },
      { status: 400 },
    )
  }

  const client = new Anthropic({ apiKey })

  let raw = ""
  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: query }],
    })
    raw = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
  } catch (err) {
    const msg =
      err instanceof Anthropic.APIError
        ? `Anthropic ${err.status ?? ""}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const jsonText = extractJson(raw)

  let parsed: Preset
  try {
    parsed = JSON.parse(jsonText) as Preset
  } catch {
    return NextResponse.json({ error: "파싱 실패", raw })
  }

  // 필수 키 검증 (최소한)
  const requiredKeys = [
    "isoGroup",
    "subgroupKey",
    "operation",
    "coating",
    "Vc",
    "fz",
    "ap",
    "ae",
    "diameter",
    "fluteCount",
    "activeShape",
    "reasoning",
  ] as const
  const missing = requiredKeys.filter(
    (k) => (parsed as Record<string, unknown>)[k] === undefined,
  )
  if (missing.length > 0) {
    return NextResponse.json({
      error: "파싱 실패",
      raw,
      missingKeys: missing,
    })
  }

  return NextResponse.json(parsed)
}
