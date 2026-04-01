export interface CompetitorSpec {
  model: string
  diameterMm: number | null
  flutes: number | null
  isoMaterial: string[]
  toolSubtype: "Square" | "Radius" | "Ball" | null
  coating: string | null
  operationType: "Milling" | "Holemaking" | "Threading" | "Turning" | null
  confidence: "high" | "medium" | "low"
  source: string
}

export interface SpecResolveResult {
  success: boolean
  spec: CompetitorSpec | null
  error?: string
}

const SPEC_EXTRACTION_PROMPT = `당신은 절삭공구 스펙 추출 전문가입니다.
주어진 경쟁사 공구 모델명을 웹 검색으로 찾아 스펙을 추출하세요.

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:
{
  "model": "모델명",
  "diameterMm": 숫자 또는 null,
  "flutes": 숫자 또는 null,
  "isoMaterial": ["P","M","K","N","S","H"] 중 해당하는 것들의 배열,
  "toolSubtype": "Square" | "Radius" | "Ball" | null,
  "coating": "코팅명" 또는 null,
  "operationType": "Milling" | "Holemaking" | "Threading" | "Turning" | null,
  "confidence": "high" | "medium" | "low",
  "source": "출처 URL"
}

confidence 기준:
- high: 공식 카탈로그/제조사 사이트에서 확인
- medium: 대리점/유통사 자료에서 확인
- low: 추정 또는 불확실`

export async function resolveCompetitorSpec(modelName: string): Promise<SpecResolveResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", text: `${SPEC_EXTRACTION_PROMPT}\n\n모델명: "${modelName}"` },
        ],
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      return { success: false, spec: null, error: `API error: ${res.status}` }
    }

    const data = await res.json()
    const text: string = data.text ?? ""

    // Parse JSON from response (handle ```json ... ``` blocks)
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/)
      ?? text.match(/(\{[\s\S]*\})/)

    if (!jsonMatch) {
      return { success: false, spec: null, error: "스펙 JSON을 파싱할 수 없습니다" }
    }

    const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0])
    const spec: CompetitorSpec = {
      model: parsed.model ?? modelName,
      diameterMm: typeof parsed.diameterMm === "number" ? parsed.diameterMm : null,
      flutes: typeof parsed.flutes === "number" ? parsed.flutes : null,
      isoMaterial: Array.isArray(parsed.isoMaterial) ? parsed.isoMaterial : [],
      toolSubtype: parsed.toolSubtype ?? null,
      coating: parsed.coating ?? null,
      operationType: parsed.operationType ?? null,
      confidence: parsed.confidence ?? "low",
      source: parsed.source ?? "",
    }

    return { success: true, spec }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { success: false, spec: null, error: "검색 시간 초과 (15초)" }
    }
    return {
      success: false,
      spec: null,
      error: err instanceof Error ? err.message : "알 수 없는 오류",
    }
  } finally {
    clearTimeout(timeout)
  }
}
