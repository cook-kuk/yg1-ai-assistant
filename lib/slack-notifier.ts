/**
 * Slack Notifier — 추천/피드백/에러 이벤트를 Slack으로 전송
 */

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || ""

async function sendSlack(payload: Record<string, unknown>): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error("[slack] send failed:", err)
  }
}

/** 추천 완료 알림 */
export async function notifyRecommendation(params: {
  productCode: string
  brand: string
  seriesName: string | null
  matchStatus: string
  score: number
  query: string
}): Promise<void> {
  await sendSlack({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🔧 제품 추천 완료" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*브랜드명:*\n${params.brand}` },
          { type: "mrkdwn", text: `*제품코드:*\n${params.productCode}` },
          { type: "mrkdwn", text: `*시리즈:*\n${params.seriesName ?? "-"}` },
          { type: "mrkdwn", text: `*매칭:*\n${params.matchStatus} (${params.score}점)` },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `📝 검색 조건: ${params.query}` },
        ],
      },
    ],
  })
}

/** 채팅 응답 알림 */
export async function notifyChatResponse(params: {
  userMessage: string
  intent: string
  toolsUsed: string[]
  productCount: number
}): Promise<void> {
  const tools = params.toolsUsed.length > 0 ? params.toolsUsed.join(", ") : "없음"
  await sendSlack({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "💬 채팅 응답" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*사용자:*\n${params.userMessage.slice(0, 100)}` },
          { type: "mrkdwn", text: `*의도:*\n${params.intent}` },
          { type: "mrkdwn", text: `*도구:*\n${tools}` },
          { type: "mrkdwn", text: `*제품 수:*\n${params.productCount}개` },
        ],
      },
    ],
  })
}

/** 피드백 등록 알림 (스크린샷 + 세션 컨텍스트 포함) */
export async function notifyFeedback(params: {
  rating: number | null
  comment: string
  tags: string[]
  authorType: string
  authorName: string
  screenshotCount?: number
  intakeSummary?: string | null
  recommendationSummary?: string | null
  chatHistoryLength?: number
}): Promise<void> {
  const stars = params.rating ? "⭐".repeat(params.rating) : "평가 없음"
  const tagStr = params.tags.length > 0 ? params.tags.join(", ") : "없음"
  const author = params.authorName || params.authorType
  const ssInfo = params.screenshotCount ? `📷 스크린샷 ${params.screenshotCount}장 첨부` : ""
  await sendSlack({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `📋 의견 등록 ${ssInfo}` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*평점:*\n${stars}` },
          { type: "mrkdwn", text: `*작성자:*\n${author} (${params.authorType})` },
          { type: "mrkdwn", text: `*태그:*\n${tagStr}` },
          { type: "mrkdwn", text: `*대화 길이:*\n${params.chatHistoryLength ?? "?"}턴` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*의견:*\n${params.comment.slice(0, 500)}` },
      },
      ...(params.intakeSummary ? [{
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: `*입력 조건:*\n${params.intakeSummary.slice(0, 300)}` },
      }] : []),
      ...(params.recommendationSummary ? [{
        type: "context" as const,
        elements: [{ type: "mrkdwn" as const, text: `🔧 추천 결과: ${params.recommendationSummary}` }],
      }] : []),
    ],
  })
}

/** DB 쿼리 알림 */
export async function notifyDbQuery(params: {
  source: string
  filterCount: number
  resultCount: number
  durationMs: number
  query: string
}): Promise<void> {
  await sendSlack({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🗄️ DB 쿼리" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*소스:*\n${params.source}` },
          { type: "mrkdwn", text: `*필터:*\n${params.filterCount}개` },
          { type: "mrkdwn", text: `*결과:*\n${params.resultCount}건` },
          { type: "mrkdwn", text: `*소요:*\n${params.durationMs}ms` },
        ],
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `🔍 ${params.query.slice(0, 200)}` },
        ],
      },
    ],
  })
}

/** LLM 요청/응답 알림 */
export async function notifyLlmCall(params: {
  model: string
  route: string
  promptPreview: string
  responsePreview: string
  durationMs: number
  inputTokens?: number
  outputTokens?: number
}): Promise<void> {
  const tokenInfo = params.inputTokens
    ? `입력: ${params.inputTokens} / 출력: ${params.outputTokens ?? "?"}`
    : "토큰 정보 없음"
  await sendSlack({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🤖 LLM 호출" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*모델:*\n${params.model}` },
          { type: "mrkdwn", text: `*경로:*\n${params.route}` },
          { type: "mrkdwn", text: `*소요:*\n${params.durationMs}ms` },
          { type: "mrkdwn", text: `*토큰:*\n${tokenInfo}` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*요청 (프롬프트 미리보기):*\n\`\`\`${params.promptPreview.slice(0, 300)}\`\`\`` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*응답:*\n\`\`\`${params.responsePreview.slice(0, 500)}\`\`\`` },
      },
    ],
  })
}

/** 턴별 피드백 알림 */
export async function notifyTurnFeedback(params: {
  turnNumber: number
  feedback: string
  feedbackEmoji: string
  userMessage: string
  aiResponse: string
  chips: string[]
  sessionId: string | null
  candidateCount: number | null
  appliedFilters: string[]
  conversationLength: number
}): Promise<void> {
  const filterStr = params.appliedFilters.length > 0 ? params.appliedFilters.join(", ") : "없음"
  await sendSlack({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${params.feedbackEmoji} 턴 피드백 (Turn ${params.turnNumber})` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*평가:*\n${params.feedbackEmoji} ${params.feedback}` },
          { type: "mrkdwn", text: `*후보 수:*\n${params.candidateCount ?? "?"}개` },
          { type: "mrkdwn", text: `*대화 길이:*\n${params.conversationLength}턴` },
          { type: "mrkdwn", text: `*필터:*\n${filterStr}` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*사용자:*\n${params.userMessage.slice(0, 200)}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*AI 응답:*\n${params.aiResponse.slice(0, 300)}` },
      },
      ...(params.chips.length > 0 ? [{
        type: "context" as const,
        elements: [
          { type: "mrkdwn" as const, text: `💡 칩: ${params.chips.join(", ")}` },
        ],
      }] : []),
    ],
  })
}

/** 성공 사례 알림 (SUCCESS_CASE) */
export async function notifySuccessCase(params: {
  sessionId: string | null
  mode: string | null
  conditions: string
  candidateCounts: string
  topProducts: string
  narrowingPath: string
  userComment: string
  lastUserMessage: string
  lastAiResponse: string
  conversationLength: number
  comparisonArtifact: string | null
}): Promise<void> {
  await sendSlack({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "✅ SUCCESS_CASE" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*세션:*\n${params.sessionId ?? "unknown"}` },
          { type: "mrkdwn", text: `*모드:*\n${params.mode ?? "narrowing"}` },
          { type: "mrkdwn", text: `*후보수:*\n${params.candidateCounts}` },
          { type: "mrkdwn", text: `*대화 길이:*\n${params.conversationLength}턴` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*현재 조건:*\n${params.conditions}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*좁히기 경로:*\n${params.narrowingPath}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*표시 상위 제품:*\n${params.topProducts}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*마지막 사용자:*\n${params.lastUserMessage.slice(0, 200)}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*마지막 AI:*\n${params.lastAiResponse.slice(0, 300)}` },
      },
      ...(params.userComment ? [{
        type: "section" as const,
        text: { type: "mrkdwn" as const, text: `*유저 코멘트:*\n💬 "${params.userComment}"` },
      }] : []),
      ...(params.comparisonArtifact ? [{
        type: "context" as const,
        elements: [{ type: "mrkdwn" as const, text: `📊 비교 artifact: ${params.comparisonArtifact.slice(0, 200)}` }],
      }] : []),
    ],
  })
}

/** 실패 사례 알림 (FAILURE_CASE) */
export async function notifyFailureCase(params: {
  sessionId: string | null
  userComment: string
  mode: string | null
  lastUserMessage: string
  lastAiResponse: string
  conditions: string
  candidateCounts: string
  topProducts: string
  conversationLength: number
  appliedFilters: string[]
  feedbackHistory?: Array<{ text: string; feedback: string | null; chipFeedback: string | null }> | null
}): Promise<void> {
  const filterStr = params.appliedFilters.length > 0 ? params.appliedFilters.join(", ") : "없음"
  const badTurns = params.feedbackHistory?.filter(f => f.feedback === "bad" || f.chipFeedback === "bad").length ?? 0
  await sendSlack({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🚨 FAILURE_CASE" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*세션:*\n${params.sessionId ?? "unknown"}` },
          { type: "mrkdwn", text: `*모드:*\n${params.mode ?? "unknown"}` },
          { type: "mrkdwn", text: `*후보수:*\n${params.candidateCounts}` },
          { type: "mrkdwn", text: `*👎 받은 턴:*\n${badTurns}개 / ${params.conversationLength}턴` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*현재 조건:*\n${params.conditions}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*유저 불만:*\n💢 "${params.userComment || "(코멘트 없음)"}"` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*마지막 사용자:*\n${params.lastUserMessage.slice(0, 200)}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*마지막 AI:*\n${params.lastAiResponse.slice(0, 300)}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*표시 상위 제품:*\n${params.topProducts.slice(0, 300)}` },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `🔍 필터: ${filterStr}` }],
      },
    ],
  })
}

/** 에러 알림 */
export async function notifyError(params: {
  route: string
  error: string
}): Promise<void> {
  await sendSlack({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🚨 에러 발생" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*경로:*\n${params.route}` },
          { type: "mrkdwn", text: `*에러:*\n${params.error.slice(0, 500)}` },
        ],
      },
    ],
  })
}
