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

/** 피드백 등록 알림 */
export async function notifyFeedback(params: {
  rating: number | null
  comment: string
  tags: string[]
  authorType: string
}): Promise<void> {
  const stars = params.rating ? "⭐".repeat(params.rating) : "평가 없음"
  const tagStr = params.tags.length > 0 ? params.tags.join(", ") : "없음"
  await sendSlack({
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "📋 피드백 등록" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*평점:*\n${stars}` },
          { type: "mrkdwn", text: `*작성자:*\n${params.authorType}` },
          { type: "mrkdwn", text: `*태그:*\n${tagStr}` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*코멘트:*\n${params.comment.slice(0, 300)}` },
      },
    ],
  })
}

<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 3b4ec06 (feat: Slack 알림 확장 — DB 쿼리, LLM 요청/응답 추가)
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

<<<<<<< HEAD
=======
>>>>>>> 6a98a4f (feat: Slack 알림 연동 — 추천/채팅/피드백/에러 이벤트 전송)
=======
>>>>>>> 3b4ec06 (feat: Slack 알림 확장 — DB 쿼리, LLM 요청/응답 추가)
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
