/**
 * Tool Memory — Vanna 2.0 스타일 SQL 메모리.
 *
 * 성공한 (question → sqlQuery + filters + candidateCount) 튜플을 PostgreSQL
 * 에 축적하고 pg_trgm similarity 로 검색. 유사한 질문이 다시 들어오면
 * 과거 성공 사례를 LLM 앙상블 컨텍스트에 주입해 필터 추출 정확도↑ 지연↓.
 *
 * 설계 원칙:
 *   - DB 없으면 빈 배열/무동작 (local dev + 테스트 친화).
 *   - 모든 mutation 은 fire-and-forget (SQL Agent 흐름을 막지 않음).
 *   - hit_count, last_hit_at 로 inactive row 관찰 가능.
 *   - success = null (미피드백) / true (👍) / false (👎)
 *     → search 는 success=false 는 제외.
 */

import { getSharedPool, hasDatabase } from "@/lib/data/shared-pool"
import { TOOL_MEMORY_CONFIG } from "@/lib/recommendation/infrastructure/config/cache-config"

export interface ToolMemoryHit {
  id: number
  question: string
  sqlQuery: string
  filters: unknown
  candidateCount: number
  hitCount: number
  similarity: number
  tier: "high" | "mid"
}

export interface SaveToolMemoryInput {
  question: string
  sqlQuery: string
  filters: unknown
  candidateCount: number
}

let _ensured = false
let _ensuring: Promise<boolean> | null = null

async function ensureTable(): Promise<boolean> {
  if (_ensured) return true
  if (!hasDatabase()) return false
  if (_ensuring) return _ensuring
  _ensuring = (async () => {
    const pool = getSharedPool()
    if (!pool) return false
    try {
      await pool.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS catalog_app.tool_memory (
          id              SERIAL PRIMARY KEY,
          question        TEXT NOT NULL,
          sql_query       TEXT NOT NULL,
          filters         JSONB NOT NULL DEFAULT '[]'::jsonb,
          candidate_count INTEGER NOT NULL DEFAULT 0,
          success         BOOLEAN,
          hit_count       INTEGER NOT NULL DEFAULT 0,
          last_hit_at     TIMESTAMPTZ,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_tool_memory_question_trgm
          ON catalog_app.tool_memory USING gin (question gin_trgm_ops)
      `)
      _ensured = true
      console.log("[tool-memory] table ensured")
      return true
    } catch (e) {
      console.warn("[tool-memory] ensure failed:", (e as Error).message)
      return false
    } finally {
      _ensuring = null
    }
  })()
  return _ensuring
}

export async function searchToolMemory(question: string): Promise<ToolMemoryHit[]> {
  const q = question.trim()
  if (!q) return []
  const ok = await ensureTable()
  if (!ok) return []
  const pool = getSharedPool()
  if (!pool) return []

  try {
    const { rows } = await pool.query<{
      id: number
      question: string
      sql_query: string
      filters: unknown
      candidate_count: number
      hit_count: number
      similarity: number
    }>(
      `SELECT id, question, sql_query, filters, candidate_count, hit_count,
              similarity(question, $1) AS similarity
         FROM catalog_app.tool_memory
        WHERE (success IS DISTINCT FROM FALSE)
          AND similarity(question, $1) >= $2
        ORDER BY similarity DESC, hit_count DESC
        LIMIT $3`,
      [q, TOOL_MEMORY_CONFIG.minSearchThreshold, TOOL_MEMORY_CONFIG.maxResults],
    )
    return rows.map(r => ({
      id: r.id,
      question: r.question,
      sqlQuery: r.sql_query,
      filters: r.filters,
      candidateCount: r.candidate_count,
      hitCount: r.hit_count,
      similarity: Number(r.similarity),
      tier: Number(r.similarity) >= TOOL_MEMORY_CONFIG.highThreshold ? "high" : "mid",
    }))
  } catch (e) {
    console.warn("[tool-memory] search failed:", (e as Error).message)
    return []
  }
}

export async function saveToolMemory(input: SaveToolMemoryInput): Promise<void> {
  const q = input.question.trim()
  if (!q || !input.sqlQuery.trim()) return
  const ok = await ensureTable()
  if (!ok) return
  const pool = getSharedPool()
  if (!pool) return

  try {
    const { rowCount } = await pool.query(
      `UPDATE catalog_app.tool_memory
          SET hit_count   = hit_count + 1,
              last_hit_at = NOW(),
              sql_query   = $2,
              filters     = $3::jsonb,
              candidate_count = $4
        WHERE question = $1`,
      [q, input.sqlQuery, JSON.stringify(input.filters ?? []), input.candidateCount],
    )
    if (rowCount && rowCount > 0) return
    await pool.query(
      `INSERT INTO catalog_app.tool_memory
         (question, sql_query, filters, candidate_count, hit_count, last_hit_at)
         VALUES ($1, $2, $3::jsonb, $4, 1, NOW())`,
      [q, input.sqlQuery, JSON.stringify(input.filters ?? []), input.candidateCount],
    )
  } catch (e) {
    console.warn("[tool-memory] save failed:", (e as Error).message)
  }
}

export async function markToolMemorySuccess(
  question: string,
  success: boolean,
): Promise<void> {
  const q = question.trim()
  if (!q) return
  const ok = await ensureTable()
  if (!ok) return
  const pool = getSharedPool()
  if (!pool) return

  try {
    await pool.query(
      `UPDATE catalog_app.tool_memory
          SET success = $2
        WHERE question = $1`,
      [q, success],
    )
  } catch (e) {
    console.warn("[tool-memory] mark failed:", (e as Error).message)
  }
}
