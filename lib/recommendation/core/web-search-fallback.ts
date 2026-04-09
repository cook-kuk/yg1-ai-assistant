/**
 * Web Search Fallback — 진짜 헤맬 때만 트리거되는 외부 검색.
 *
 * 트리거 조건 (하나라도 충족):
 *   1. 경쟁사 제품명이 메시지에 포함됨 (Sandvik/Kennametal/OSG/...)
 *   2. DB에 없는 특수 소재 (하스텔로이/마그네슘/...)
 *   3. 일반 기술 지식 질문 (PVD vs CVD, ISO 규격 등) + 후보 0건
 *   4. 필터/후보/KB 모두 비어 있음
 *
 * 출력은 thinkingProcess와 응답 LLM context에 주입.
 */

import { searchKB } from "./semantic-search"

const COMPETITOR_PATTERN =
  /sandvik|kennametal|mitsubishi|osg|walter|iscar|seco|harvey|nachi|sumitomo|kyocera|tungaloy|taegutec|korloy|palbit|dormer|guhring|hitachi/i

const EXOTIC_MATERIAL_PATTERN =
  /하스텔로이|마그네슘|지르코늄|텅스텐|몰리브덴|베릴륨|와스팔로이|rene|mar-m|cmsx|waspaloy|hastelloy|magnesium|zirconium|beryllium/i

const KNOWLEDGE_QUESTION_PATTERN =
  /차이.*뭐|비교.*해|규격|표준|ISO|DIN|JIS|원리|메커니즘|왜.*그런|어떻게.*작동/u

const MATERIAL_KO_TO_EN: Record<string, string> = {
  하스텔로이: "Hastelloy",
  마그네슘: "Magnesium",
  지르코늄: "Zirconium",
  텅스텐: "Tungsten",
  몰리브덴: "Molybdenum",
  와스팔로이: "Waspaloy",
  베릴륨: "Beryllium",
}

export interface WebSearchTriggerContext {
  message: string
  filtersExtracted: boolean
  candidateCount: number
  /** KB 시맨틱 검색 hit 수 (생략 시 자동 계산) */
  kbHits?: number
}

export function shouldTriggerWebSearch(ctx: WebSearchTriggerContext): boolean {
  const msg = ctx.message ?? ""
  if (!msg.trim()) return false

  if (COMPETITOR_PATTERN.test(msg)) return true
  if (EXOTIC_MATERIAL_PATTERN.test(msg)) return true

  const kbHits = ctx.kbHits ?? searchKB(msg, 1).length
  if (KNOWLEDGE_QUESTION_PATTERN.test(msg) && ctx.candidateCount === 0) return true
  if (!ctx.filtersExtracted && ctx.candidateCount === 0 && kbHits === 0) return true

  return false
}

/** 메시지에서 경쟁사명을 추출 (첫 매치). */
export function extractCompetitor(msg: string): string | null {
  const m = msg.match(COMPETITOR_PATTERN)
  return m ? m[0] : null
}

/** 메시지에서 특수 소재를 추출 (첫 매치). */
export function extractExoticMaterial(msg: string): string | null {
  const m = msg.match(EXOTIC_MATERIAL_PATTERN)
  return m ? m[0] : null
}

/** 영어 기술 키워드 위주의 날카로운 웹 검색 쿼리를 생성. 최대 2개. */
export function generateSharpQueries(msg: string): string[] {
  const queries: string[] = []
  const competitor = extractCompetitor(msg)
  const exotic = extractExoticMaterial(msg)

  if (competitor) {
    queries.push(
      `${competitor} cutting tool specifications diameter flute coating datasheet`,
    )
    queries.push(`${competitor} equivalent alternative YG-1 endmill`)
  } else if (exotic) {
    const en = MATERIAL_KO_TO_EN[exotic] ?? exotic
    queries.push(
      `${en} machining parameters cutting speed feed rate endmill carbide`,
    )
    queries.push(`${en} CNC milling recommended tool coating`)
  } else {
    queries.push(msg)
    const ascii = msg.replace(/[가-힣]+/g, " ").trim()
    if (ascii.length > 3) queries.push(`${ascii} cutting tool technical`)
  }

  return queries.slice(0, 2)
}

export interface WebSearchResult {
  query: string
  text: string
}

/**
 * Anthropic web_search 도구를 통해 검색을 실행한다.
 * ANTHROPIC_API_KEY가 없거나 호출 실패 시 null 반환 (조용히 실패).
 */
export async function runWebSearch(
  msg: string,
  maxTokens = 1000,
): Promise<WebSearchResult | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  const queries = generateSharpQueries(msg)
  if (queries.length === 0) return null

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    for (const query of queries) {
      try {
        const resp = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: maxTokens,
          tools: [
            {
              type: "web_search_20250305" as const,
              name: "web_search",
              max_uses: 2,
            },
          ],
          messages: [
            {
              role: "user",
              content: `Search: ${query}. 기술 데이터(스펙, 절삭조건, 코팅, 소재 적합성)만 추출. 광고/블로그 무시.`,
            },
          ],
        })

        const text = (resp.content as Array<{ type: string; text?: string }>)
          .filter(b => b.type === "text" && typeof b.text === "string")
          .map(b => b.text as string)
          .join("\n")
          .trim()

        if (text.length > 50) {
          return { query, text }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[web-search] query failed:", query, (e as Error).message)
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[web-search] init failed:", (e as Error).message)
  }
  return null
}

/**
 * 응답 LLM에 주입할 web search 컨텍스트 블록을 만든다.
 * thinkingProcess 라인과 prompt block을 함께 반환.
 */
export function formatWebSearchBlock(result: WebSearchResult): {
  thinkingLine: string
  promptBlock: string
} {
  const truncated = result.text.slice(0, 800)
  return {
    thinkingLine: `🔍 웹 검색: "${result.query}"\n${result.text.slice(0, 500)}`,
    promptBlock: `\n\n═══ 웹 검색 결과 (내부 DB에 없어서 외부 검색) ═══\n${truncated}\n⚠️ 위 내용은 외부 웹 검색 결과입니다. 응답의 [AI 보충 의견] 섹션에서 활용하고, YG-1 내부 데이터와 명확히 구분하세요.`,
  }
}
