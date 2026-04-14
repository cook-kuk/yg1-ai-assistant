/**
 * Feedback-Driven Few-Shot Pool
 *
 * 사용자 👍 피드백을 받은 (query → filters) 쌍을 실시간으로 축적.
 * adaptive-few-shot.ts의 golden set pool에 합류하여,
 * 다음 유사 질문 시 자동으로 few-shot example로 선택됨.
 *
 * 저장: MongoDB (feedback_learned_examples collection) — graceful degradation.
 *       MongoDB 없거나 연결 실패 시 인메모리만으로 동작.
 *
 * DSPy의 BootstrapFewShot과 동일한 원리:
 * "성공한 trace를 수집해서 다음 프롬프트에 demonstration으로 주입"
 */

import { tokenize } from "./auto-synonym"
import type { AppliedFilter } from "@/lib/types/exploration"
import type { FewShotExample } from "./adaptive-few-shot"

export interface LearnedFilterSpec {
  field: string
  op: string
  value: string
}

export interface LearnedExample {
  id: string
  userMessage: string
  filters: LearnedFilterSpec[]
  /** 👍 횟수. 같은 쿼리-필터 쌍이 여러 번 👍 받으면 가중치 증가 */
  positiveCount: number
  /** 👎 횟수. positiveCount - negativeCount <= 0 이면 pool에서 제거 */
  negativeCount: number
  /** 처음 학습된 시각 */
  learnedAt: string
  /** 마지막 피드백 시각 */
  lastFeedbackAt: string
  /** 출처 세션 ID */
  sessionId: string
}

// ── 인메모리 캐시 ────────────────────────────────────────
let _learnedPool: LearnedExample[] = []
let _loaded = false
let _loadPromise: Promise<void> | null = null

function normalizeMessage(msg: string): string {
  return msg.trim().toLowerCase()
}

function buildFilterKey(filters: LearnedFilterSpec[]): string {
  return filters
    .map(f => `${f.field}:${f.op}:${f.value}`)
    .sort()
    .join("|")
}

function normalizeFilters(filters: AppliedFilter[]): LearnedFilterSpec[] {
  return filters
    .filter(f => f.op !== "skip")
    .map(f => ({
      field: f.field,
      op: f.op,
      value: String(f.rawValue ?? f.value ?? ""),
    }))
    .filter(f => f.field && f.value)
}

/**
 * 서버 시작 시 MongoDB에서 로드. 재호출은 idempotent.
 */
export async function loadLearnedPool(): Promise<void> {
  if (_loaded) return
  if (_loadPromise) return _loadPromise
  _loadPromise = (async () => {
    try {
      const { getMongoLogDb } = await import("@/lib/mongo/client")
      const db = await getMongoLogDb()
      if (!db) {
        console.log("[feedback-pool] MongoDB disabled, starting empty in-memory pool")
        return
      }
      const coll = db.collection("feedback_learned_examples")
      const docs = await coll.find({}).toArray()
      _learnedPool = docs.map(doc => ({
        id: String(doc._id),
        userMessage: String(doc.userMessage ?? ""),
        filters: Array.isArray(doc.filters) ? doc.filters : [],
        positiveCount: typeof doc.positiveCount === "number" ? doc.positiveCount : 1,
        negativeCount: typeof doc.negativeCount === "number" ? doc.negativeCount : 0,
        learnedAt: String(doc.learnedAt ?? new Date().toISOString()),
        lastFeedbackAt: String(doc.lastFeedbackAt ?? new Date().toISOString()),
        sessionId: String(doc.sessionId ?? ""),
      }))
      console.log(`[feedback-pool] loaded ${_learnedPool.length} learned examples from MongoDB`)
    } catch (e) {
      console.warn("[feedback-pool] MongoDB load failed, starting empty:", (e as Error).message)
    } finally {
      _loaded = true
    }
  })()
  return _loadPromise
}

/**
 * 👍 피드백 시 호출. (userMessage, filters) 쌍을 pool에 추가.
 */
export async function learnFromPositiveFeedback(
  userMessage: string,
  filters: AppliedFilter[],
  sessionId: string,
): Promise<void> {
  if (!userMessage || !userMessage.trim()) return
  const spec = normalizeFilters(filters)
  if (spec.length === 0) return

  await loadLearnedPool()

  const key = buildFilterKey(spec)
  const normalized = normalizeMessage(userMessage)
  const existing = _learnedPool.find(ex =>
    normalizeMessage(ex.userMessage) === normalized && buildFilterKey(ex.filters) === key
  )

  if (existing) {
    existing.positiveCount++
    existing.lastFeedbackAt = new Date().toISOString()
    console.log(`[feedback-pool] reinforced: "${userMessage.slice(0, 40)}" (count=${existing.positiveCount})`)
  } else {
    _learnedPool.push({
      id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userMessage: userMessage.trim(),
      filters: spec,
      positiveCount: 1,
      negativeCount: 0,
      learnedAt: new Date().toISOString(),
      lastFeedbackAt: new Date().toISOString(),
      sessionId,
    })
    console.log(`[feedback-pool] learned NEW: "${userMessage.slice(0, 40)}" → ${spec.length} filters`)
  }

  persistPositive(normalized, spec, key, sessionId).catch(e =>
    console.warn("[feedback-pool] persist failed:", (e as Error).message)
  )
}

/**
 * 👎 피드백 시 호출. 해당 쌍의 negativeCount 증가.
 * net score <= 0 이면 pool에서 제거.
 */
export async function learnFromNegativeFeedback(
  userMessage: string,
  filters: AppliedFilter[],
): Promise<void> {
  if (!userMessage || !userMessage.trim()) return
  const spec = normalizeFilters(filters)
  if (spec.length === 0) return

  await loadLearnedPool()

  const key = buildFilterKey(spec)
  const normalized = normalizeMessage(userMessage)
  const existing = _learnedPool.find(ex =>
    normalizeMessage(ex.userMessage) === normalized && buildFilterKey(ex.filters) === key
  )
  if (!existing) return

  existing.negativeCount++
  existing.lastFeedbackAt = new Date().toISOString()

  if (existing.positiveCount - existing.negativeCount <= 0) {
    _learnedPool = _learnedPool.filter(ex => ex.id !== existing.id)
    console.log(`[feedback-pool] evicted: "${userMessage.slice(0, 40)}" (net=${existing.positiveCount - existing.negativeCount})`)
  }

  persistNegative(normalized, key).catch(e =>
    console.warn("[feedback-pool] persist(neg) failed:", (e as Error).message)
  )
}

/**
 * adaptive-few-shot pool과 합산해서 반환.
 * feedbackWeight 가 있으면 selectFewShots가 similarity boost 에 활용.
 */
export function getLearnedFewShotExamples(): FewShotExample[] {
  return _learnedPool
    .filter(ex => ex.positiveCount - ex.negativeCount > 0)
    .map(ex => ({
      input: ex.userMessage,
      output: JSON.stringify(ex.filters),
      tokens: tokenize(ex.userMessage),
      feedbackWeight: ex.positiveCount - ex.negativeCount,
    }))
}

export interface LearnedPoolStats {
  total: number
  netPositive: number
  topExamples: Array<{ message: string; net: number; positiveCount: number; negativeCount: number }>
  loaded: boolean
}

export function getLearnedPoolStats(): LearnedPoolStats {
  const netPositive = _learnedPool.filter(ex => ex.positiveCount - ex.negativeCount > 0)
  return {
    total: _learnedPool.length,
    netPositive: netPositive.length,
    topExamples: netPositive
      .slice()
      .sort((a, b) => (b.positiveCount - b.negativeCount) - (a.positiveCount - a.negativeCount))
      .slice(0, 5)
      .map(ex => ({
        message: ex.userMessage,
        net: ex.positiveCount - ex.negativeCount,
        positiveCount: ex.positiveCount,
        negativeCount: ex.negativeCount,
      })),
    loaded: _loaded,
  }
}

async function persistPositive(
  normalizedMessage: string,
  filters: LearnedFilterSpec[],
  filterKey: string,
  sessionId: string,
): Promise<void> {
  const { getMongoLogDb } = await import("@/lib/mongo/client")
  const db = await getMongoLogDb()
  if (!db) return
  const coll = db.collection("feedback_learned_examples")
  const now = new Date().toISOString()
  await coll.updateOne(
    { userMessage: normalizedMessage, filterKey },
    {
      $set: { filters, lastFeedbackAt: now, sessionId },
      $inc: { positiveCount: 1 },
      $setOnInsert: { learnedAt: now, negativeCount: 0 },
    },
    { upsert: true },
  )
}

async function persistNegative(normalizedMessage: string, filterKey: string): Promise<void> {
  const { getMongoLogDb } = await import("@/lib/mongo/client")
  const db = await getMongoLogDb()
  if (!db) return
  const coll = db.collection("feedback_learned_examples")
  const now = new Date().toISOString()
  await coll.updateOne(
    { userMessage: normalizedMessage, filterKey },
    {
      $set: { lastFeedbackAt: now },
      $inc: { negativeCount: 1 },
    },
  )
}

export function _resetLearnedPoolForTest(): void {
  _learnedPool = []
  _loaded = false
  _loadPromise = null
}
