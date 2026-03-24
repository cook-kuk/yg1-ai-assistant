import { searchKB } from "./yg1-knowledge-base"

export type KnowledgeSource = "internal_kb" | "web_search" | "not_found"

export interface KnowledgeResult {
  source: KnowledgeSource
  answer: string
  /** true면 chat-tools의 web_search를 호출해야 함 */
  needsWebSearch: boolean
}

/**
 * 3단계 지식 라우터:
 * 1. 내부 KB 검색 → 있으면 즉시 답변
 * 2. KB에 없으면 → needsWebSearch=true 반환 (호출자가 web_search tool 실행)
 * 3. web_search도 실패하면 → not_found 안내
 */
export function resolveYG1Query(query: string): KnowledgeResult {
  // STEP 1: 내부 KB 검색
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
 * 웹 검색도 실패했을 때 최종 응답
 */
export function buildNotFoundResponse(query: string): KnowledgeResult {
  return {
    source: "not_found",
    answer: `YG-1 관련 "${query}"에 대한 정보를 찾을 수 없습니다. 정확한 내용은 YG-1 본사(032-526-0909)나 공식 사이트(www.yg1.solutions)에 문의해 주세요.`,
    needsWebSearch: false,
  }
}
