/**
 * Conversation Repository — PostgreSQL
 *
 * 공유 풀(getSharedPool) 사용. 테이블: catalog_app.conversations
 * messages는 JSONB 하나로 저장 → 복원 시 1 쿼리로 전체 로드.
 */

import { getSharedPool, hasDatabase } from "@/lib/data/shared-pool"

export interface ConversationSummary {
  conversationId: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
  lastUserMessage: string | null
  filterSummary: string[]
  candidateCount: number
}

export interface ConversationFull extends ConversationSummary {
  messages: ConversationMessageDto[]
  sessionState: Record<string, unknown> | null
  intakeForm: Record<string, unknown> | null
}

export interface ConversationMessageDto {
  role: "user" | "ai"
  text: string
  createdAt: string
  hasRecommendation: boolean
  appliedFilters?: Array<{ field: string; value: string; op: string }>
  feedback?: "good" | "neutral" | "bad" | null
  chips?: string[]
}

// De-dupe concurrent LLM title requests per conversation.
const _titleInflight = new Set<string>()

let _ensured = false
async function ensureTable(): Promise<boolean> {
  if (_ensured) return true
  if (!hasDatabase()) return false
  const pool = getSharedPool()
  if (!pool) return false
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS catalog_app.conversations (
        id              SERIAL PRIMARY KEY,
        conversation_id TEXT NOT NULL UNIQUE,
        user_id         TEXT NOT NULL DEFAULT 'default',
        title           TEXT NOT NULL DEFAULT '새 대화',
        title_locked    BOOLEAN NOT NULL DEFAULT false,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        message_count   INTEGER NOT NULL DEFAULT 0,
        last_user_message TEXT,
        filter_summary  TEXT[] DEFAULT '{}',
        candidate_count INTEGER DEFAULT 0,
        messages        JSONB NOT NULL DEFAULT '[]'::jsonb,
        session_state   JSONB,
        intake_form     JSONB
      )
    `)
    await pool.query(`
      ALTER TABLE catalog_app.conversations
      ADD COLUMN IF NOT EXISTS title_locked BOOLEAN NOT NULL DEFAULT false
    `)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_conv_user_updated
        ON catalog_app.conversations (user_id, updated_at DESC)
    `)
    _ensured = true
    console.log("[conversation-repo] table ensured")
    return true
  } catch (e) {
    console.warn("[conversation-repo] table ensure failed:", (e as Error).message)
    return false
  }
}

export async function listConversations(
  userId: string,
  limit = 50,
  offset = 0,
  query?: string,
): Promise<{ conversations: ConversationSummary[]; total: number }> {
  const ok = await ensureTable()
  if (!ok) return { conversations: [], total: 0 }
  const pool = getSharedPool()
  if (!pool) return { conversations: [], total: 0 }

  const q = (query ?? "").trim()
  const hasQuery = q.length > 0
  const like = `%${q.replace(/[%_]/g, m => `\\${m}`)}%`

  const whereClause = hasQuery
    ? `WHERE user_id = $1 AND (
         title ILIKE $2
         OR last_user_message ILIKE $2
         OR EXISTS (SELECT 1 FROM unnest(filter_summary) fs WHERE fs ILIKE $2)
       )`
    : `WHERE user_id = $1`

  const listParams = hasQuery ? [userId, like, limit, offset] : [userId, limit, offset]
  const countParams = hasQuery ? [userId, like] : [userId]
  const listPlaceholders = hasQuery ? `$3 OFFSET $4` : `$2 OFFSET $3`

  const [listRes, countRes] = await Promise.all([
    pool.query(
      `SELECT conversation_id, title, created_at, updated_at,
              message_count, last_user_message, filter_summary, candidate_count
       FROM catalog_app.conversations
       ${whereClause}
       ORDER BY updated_at DESC
       LIMIT ${listPlaceholders}`,
      listParams
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM catalog_app.conversations ${whereClause}`,
      countParams
    ),
  ])

  return {
    conversations: listRes.rows.map(r => ({
      conversationId: r.conversation_id,
      title: r.title,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
      messageCount: r.message_count,
      lastUserMessage: r.last_user_message,
      filterSummary: r.filter_summary ?? [],
      candidateCount: r.candidate_count ?? 0,
    })),
    total: countRes.rows[0]?.total ?? 0,
  }
}

export async function getConversation(conversationId: string): Promise<ConversationFull | null> {
  const ok = await ensureTable()
  if (!ok) return null
  const pool = getSharedPool()
  if (!pool) return null

  const res = await pool.query(
    `SELECT * FROM catalog_app.conversations WHERE conversation_id = $1`,
    [conversationId]
  )
  if (res.rows.length === 0) return null
  const r = res.rows[0]
  return {
    conversationId: r.conversation_id,
    title: r.title,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    messageCount: r.message_count,
    lastUserMessage: r.last_user_message,
    filterSummary: r.filter_summary ?? [],
    candidateCount: r.candidate_count ?? 0,
    messages: r.messages ?? [],
    sessionState: r.session_state,
    intakeForm: r.intake_form,
  }
}

export async function saveConversation(params: {
  conversationId: string
  userId: string
  messages: ConversationMessageDto[]
  sessionState: Record<string, unknown> | null
  intakeForm: Record<string, unknown> | null
}): Promise<void> {
  const ok = await ensureTable()
  if (!ok) return
  const pool = getSharedPool()
  if (!pool) return

  const heuristicTitle = generateTitle(params.messages, params.intakeForm)
  const lastUserMsg = [...params.messages].reverse().find(m => m.role === "user")
  const filters = Array.isArray((params.sessionState as { appliedFilters?: unknown })?.appliedFilters)
    ? ((params.sessionState as { appliedFilters: Array<Record<string, unknown>> }).appliedFilters)
    : []
  const filterSummary = filters
    .filter(f => f.op !== "skip")
    .map(f => `${String(f.field)}=${String(f.value)}`)
    .slice(0, 5)
  const candidateCount = Number((params.sessionState as { candidateCount?: number } | null)?.candidateCount ?? 0)

  // Only overwrite title if not locked (LLM-generated titles take precedence).
  await pool.query(
    `INSERT INTO catalog_app.conversations
       (conversation_id, user_id, title, updated_at, message_count,
        last_user_message, filter_summary, candidate_count,
        messages, session_state, intake_form)
     VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (conversation_id)
     DO UPDATE SET
       title = CASE WHEN catalog_app.conversations.title_locked THEN catalog_app.conversations.title ELSE $3 END,
       updated_at = NOW(),
       message_count = $4,
       last_user_message = $5,
       filter_summary = $6,
       candidate_count = $7,
       messages = $8,
       session_state = $9,
       intake_form = $10`,
    [
      params.conversationId,
      params.userId,
      heuristicTitle,
      params.messages.length,
      lastUserMsg?.text?.slice(0, 200) ?? null,
      filterSummary,
      candidateCount,
      JSON.stringify(params.messages),
      params.sessionState ? JSON.stringify(params.sessionState) : null,
      params.intakeForm ? JSON.stringify(params.intakeForm) : null,
    ]
  )

  // Fire-and-forget: once we have a real back-and-forth, let the LLM name it.
  void maybeGenerateLlmTitle(params.conversationId, params.messages)
}

export async function updateTitle(
  conversationId: string,
  title: string,
  locked: boolean,
): Promise<void> {
  const ok = await ensureTable()
  if (!ok) return
  const pool = getSharedPool()
  if (!pool) return
  await pool.query(
    `UPDATE catalog_app.conversations
     SET title = $2, title_locked = $3
     WHERE conversation_id = $1`,
    [conversationId, title.slice(0, 80), locked]
  )
}

export async function getTitleLocked(conversationId: string): Promise<boolean> {
  const ok = await ensureTable()
  if (!ok) return false
  const pool = getSharedPool()
  if (!pool) return false
  const res = await pool.query(
    `SELECT title_locked FROM catalog_app.conversations WHERE conversation_id = $1`,
    [conversationId]
  )
  return Boolean(res.rows[0]?.title_locked)
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const ok = await ensureTable()
  if (!ok) return
  const pool = getSharedPool()
  if (!pool) return
  await pool.query(
    `DELETE FROM catalog_app.conversations WHERE conversation_id = $1`,
    [conversationId]
  )
}

function isIntakeTemplate(text: string): boolean {
  // The /products intake summary prepopulates the first user message with
  // structured emoji labels — not a real question, so skip it for titling.
  return /🧭|🧱|🛠️|📐|📏|🌐/.test(text)
    || /위 조건에 맞는 YG-1 제품을 추천해 주세요/.test(text)
}

function generateTitle(
  messages: ConversationMessageDto[],
  intakeForm: Record<string, unknown> | null,
): string {
  // Prefer the first *real* user question over the auto-generated intake summary.
  const realUser = messages.find(m => m.role === "user" && !isIntakeTemplate(m.text))
  if (realUser) {
    const text = realUser.text.trim().replace(/\s+/g, " ")
    if (text) return text.length > 30 ? text.slice(0, 30) + "…" : text
  }

  if (intakeForm) {
    const parts: string[] = []
    const pick = (key: string): string | null => {
      const entry = (intakeForm as Record<string, unknown>)[key] as { status?: string; value?: unknown } | undefined
      if (!entry || entry.status !== "known") return null
      const v = entry.value
      return typeof v === "string" && v.trim() ? v.trim() : null
    }
    const material = pick("material")
    const diameter = pick("diameter")
    const operation = pick("operation")
    if (material) parts.push(material)
    if (diameter) parts.push(diameter)
    if (operation) parts.push(operation)
    if (parts.length > 0) return parts.slice(0, 3).join(" · ")
  }

  const firstUserMsg = messages.find(m => m.role === "user")
  if (!firstUserMsg) return "새 대화"
  const text = firstUserMsg.text.trim().replace(/\s+/g, " ")
  if (!text) return "새 대화"
  return text.length > 30 ? text.slice(0, 30) + "…" : text
}

async function maybeGenerateLlmTitle(
  conversationId: string,
  messages: ConversationMessageDto[],
): Promise<void> {
  if (_titleInflight.has(conversationId)) return
  // Need at least one real exchange (user Q + AI A) to title meaningfully.
  const realUserCount = messages.filter(m => m.role === "user" && !isIntakeTemplate(m.text)).length
  const aiCount = messages.filter(m => m.role === "ai" && m.text.trim().length > 0).length
  if (realUserCount < 1 || aiCount < 1) return

  // Skip if already locked (LLM already set it).
  if (await getTitleLocked(conversationId)) return

  _titleInflight.add(conversationId)
  try {
    const { getProvider } = await import("@/lib/llm/provider")
    const provider = getProvider()
    if (!provider.available()) return

    const transcript = messages
      .slice(0, 8)
      .map(m => {
        const role = m.role === "user" ? "사용자" : "어시스턴트"
        const text = isIntakeTemplate(m.text)
          ? m.text.replace(/[🧭🧱🛠️📐📏🌐]/g, "").replace(/\s+/g, " ").trim()
          : m.text.trim().replace(/\s+/g, " ")
        return `${role}: ${text.slice(0, 400)}`
      })
      .join("\n")

    const systemPrompt = "대화 내용을 보고 한국어로 3~8단어 정도의 간결한 제목만 출력해. 따옴표·이모지·마침표 금지. 제품명/공정/소재가 핵심이면 그걸 살려."
    const userPrompt = `대화:\n${transcript}\n\n제목:`

    const raw = await provider.complete(
      systemPrompt,
      [{ role: "user", content: userPrompt }],
      60,
      "haiku",
    )
    const title = raw
      .replace(/^["'`\s]+|["'`\s.]+$/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 60)
      .trim()
    if (!title) return
    await updateTitle(conversationId, title, true)
  } catch (e) {
    console.warn("[conversation-repo] LLM title generation failed:", (e as Error).message)
  } finally {
    _titleInflight.delete(conversationId)
  }
}
