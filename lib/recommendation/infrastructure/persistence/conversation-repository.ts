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
): Promise<{ conversations: ConversationSummary[]; total: number }> {
  const ok = await ensureTable()
  if (!ok) return { conversations: [], total: 0 }
  const pool = getSharedPool()
  if (!pool) return { conversations: [], total: 0 }

  const [listRes, countRes] = await Promise.all([
    pool.query(
      `SELECT conversation_id, title, created_at, updated_at,
              message_count, last_user_message, filter_summary, candidate_count
       FROM catalog_app.conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM catalog_app.conversations WHERE user_id = $1`,
      [userId]
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

  const title = generateTitle(params.messages, params.intakeForm)
  const lastUserMsg = [...params.messages].reverse().find(m => m.role === "user")
  const filters = Array.isArray((params.sessionState as { appliedFilters?: unknown })?.appliedFilters)
    ? ((params.sessionState as { appliedFilters: Array<Record<string, unknown>> }).appliedFilters)
    : []
  const filterSummary = filters
    .filter(f => f.op !== "skip")
    .map(f => `${String(f.field)}=${String(f.value)}`)
    .slice(0, 5)
  const candidateCount = Number((params.sessionState as { candidateCount?: number } | null)?.candidateCount ?? 0)

  await pool.query(
    `INSERT INTO catalog_app.conversations
       (conversation_id, user_id, title, updated_at, message_count,
        last_user_message, filter_summary, candidate_count,
        messages, session_state, intake_form)
     VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (conversation_id)
     DO UPDATE SET
       title = $3,
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
      title,
      params.messages.length,
      lastUserMsg?.text?.slice(0, 200) ?? null,
      filterSummary,
      candidateCount,
      JSON.stringify(params.messages),
      params.sessionState ? JSON.stringify(params.sessionState) : null,
      params.intakeForm ? JSON.stringify(params.intakeForm) : null,
    ]
  )
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

function generateTitle(
  messages: ConversationMessageDto[],
  intakeForm: Record<string, unknown> | null,
): string {
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
