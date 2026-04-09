/**
 * Complexity Router — 유저 메시지 복잡도 → 파이프라인 깊이 결정.
 * 규칙 기반 (0ms, LLM 호출 없음).
 */

export type ComplexityLevel = "light" | "normal" | "deep"

export interface ComplexityDecision {
  level: ComplexityLevel
  reason: string
  /** self-correction 실행 여부 */
  runSelfCorrection: boolean
  /** KB 시맨틱 검색 여부 */
  searchKB: boolean
  /** CoT(thinkingProcess) 스트리밍 여부 */
  generateCoT: boolean
  /** 웹서치 허용 여부 */
  allowWebSearch: boolean
  /** 응답 최대 문장 수 가이드 (LLM 프롬프트에 주입) */
  maxSentences: number
}

// ── 판단 패턴 (LLM 없음, 0ms) ──

const LIGHT_PATTERNS = [
  /^(네|응|좋아|OK|ok|ㅇㅇ|그래|맞아|됐어|고마워)$/iu,
  /^\d+(\.\d+)?\s*(mm|날|도)?$/iu,
  /^[A-Za-z][\w\-]*$/,
  /^(스퀘어|볼|라디우스|테이퍼|챔퍼|러핑)$/iu,
  /^(국내|미국|일본|유럽)$/iu,
  /^(상관없음|패스|스킵|넘어가|아무거나)$/iu,
  /^(이전|돌아가|뒤로|처음부터|리셋)$/iu,
]

const DEEP_TRIGGERS = [
  /비교|차이|뭐가\s*나[아요]|뭐가\s*좋|어떤\s*게|\bvs\b/iu,
  /왜|이유|원리|어떻게|메커니즘/iu,
  /떨림|진동|채터|파손|깨짐|수명|문제|트러블/iu,
  /sandvik|kennametal|mitsubishi|osg|walter|iscar|seco/iu,
  /대체|대안|대신|비슷한|동급/iu,
  /뭐야\??|뭐예요|뭔가요/iu,
  /PVD|CVD|ISO\s*\d|규격/iu,
  /그리고|또|추가로|근데|그런데/iu,
]

export function assessComplexity(
  message: string,
  appliedFilterCount: number = 0,
): ComplexityDecision {
  const t = message.trim()

  // LIGHT
  if (LIGHT_PATTERNS.some(p => p.test(t))) {
    return { level: "light", reason: "단순 값/확인", runSelfCorrection: false, searchKB: false, generateCoT: false, allowWebSearch: false, maxSentences: 2 }
  }
  if (t.length <= 8 && appliedFilterCount > 0) {
    return { level: "light", reason: `짧은 입력(${t.length}자)+기존필터`, runSelfCorrection: false, searchKB: false, generateCoT: false, allowWebSearch: false, maxSentences: 2 }
  }

  // DEEP
  if (DEEP_TRIGGERS.some(p => p.test(t))) {
    return { level: "deep", reason: "분석/비교/트러블슈팅", runSelfCorrection: true, searchKB: true, generateCoT: true, allowWebSearch: true, maxSentences: 6 }
  }
  if (t.length >= 30) {
    return { level: "deep", reason: `긴 입력(${t.length}자)`, runSelfCorrection: true, searchKB: true, generateCoT: true, allowWebSearch: false, maxSentences: 5 }
  }

  // NORMAL
  return { level: "normal", reason: "일반 추천", runSelfCorrection: true, searchKB: false, generateCoT: true, allowWebSearch: false, maxSentences: 4 }
}
