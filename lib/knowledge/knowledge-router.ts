import { searchKB, searchKBSemantic } from "./yg1-knowledge-base"
import type { LLMProvider } from "@/lib/shared/infrastructure/llm/llm-provider"

export type KnowledgeSource = "internal_kb" | "web_search" | "not_found"

export interface KnowledgeResult {
  source: KnowledgeSource
  answer: string
  /** true면 chat-tools의 web_search를 호출해야 함 */
  needsWebSearch: boolean
}

/**
 * 3단계 지식 라우터:
 * 1. 내부 KB 키워드 검색 → 있으면 즉시 답변
 * 2. provider가 있으면 Haiku 시맨틱 검색 시도
 * 3. KB에 없으면 → needsWebSearch=true 반환 (호출자가 web_search tool 실행)
 */
export function resolveYG1Query(query: string): KnowledgeResult {
  // STEP 1: 내부 KB 키워드 검색
  const kbResult = searchKB(query)
  if (kbResult.found && kbResult.confidence === "high") {
    return { source: "internal_kb", answer: kbResult.answer, needsWebSearch: false }
  }

  // STEP 2: KB에 없음 → 웹 검색 필요 표시
  return {
    source: "not_found",
    answer: "",
    needsWebSearch: true,
  }
}

/**
 * 시맨틱 검색 포함 비동기 지식 라우터:
 * 1. 키워드 검색 → 있으면 즉시 답변
 * 2. 키워드 미스 → Haiku 시맨틱 검색으로 패러프레이즈 캐치
 * 3. 둘 다 실패 → needsWebSearch=true
 */
export async function resolveYG1QuerySemantic(
  query: string,
  provider: LLMProvider
): Promise<KnowledgeResult> {
  // STEP 1: 키워드 검색 (빠름, 무비용)
  const kbResult = searchKB(query)
  if (kbResult.found && kbResult.confidence === "high") {
    return { source: "internal_kb", answer: kbResult.answer, needsWebSearch: false }
  }

  // STEP 2: Haiku 시맨틱 검색 (패러프레이즈 캐치)
  const semanticResult = await searchKBSemantic(query, provider)
  if (semanticResult.found && semanticResult.confidence === "high") {
    return { source: "internal_kb", answer: semanticResult.answer, needsWebSearch: false }
  }

  // STEP 3: 둘 다 실패 → 웹 검색 필요
  return {
    source: "not_found",
    answer: "",
    needsWebSearch: true,
  }
}

/**
 * 웹 검색도 실패했을 때 최종 응답
 */
export function buildNotFoundResponse(query: string): KnowledgeResult {
  return {
    source: "not_found",
    answer: `YG-1 관련 "${query}"에 대한 정보를 찾을 수 없습니다. 정확한 내용은 YG-1 본사(032-526-0909)나 공식 사이트(www.yg1.solutions)에 문의해 주세요.`,
    needsWebSearch: false,
  }
}
