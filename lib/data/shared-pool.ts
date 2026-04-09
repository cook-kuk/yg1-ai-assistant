/**
 * Shared Database Pool — single connection pool for all repos.
 *
 * Vercel serverless + Neon/Supabase free tier has limited concurrent connections (~20).
 * Instead of 4 separate pools (product=10, evidence=4, inventory=5, countries=2 = 21 total),
 * we share one pool with max=5 connections.
 */

import { Pool } from "pg"

declare global {
  // eslint-disable-next-line no-var
  var __yg1SharedDbPool: Pool | undefined
}

function dbConnectionString(): string | undefined {
  return (
    process.env.DATABASE_URL ??
    process.env.PRODUCT_DB_URL ??
    undefined
  )
}

export function getSharedPool(): Pool | null {
  const connectionString = dbConnectionString()
  if (!connectionString) return null

  if (!globalThis.__yg1SharedDbPool) {
    const max = Number(process.env.SHARED_DB_POOL_MAX) || 16
    const idleMs = Number(process.env.SHARED_DB_POOL_IDLE_MS) || 30_000
    const connMs = Number(process.env.SHARED_DB_POOL_CONNECT_MS) || 10_000
    const stmtMs = Number(process.env.SHARED_DB_STATEMENT_TIMEOUT_MS) || 30_000
    console.log(`[shared-pool] Creating shared pg pool (max=${max}, idle=${idleMs}ms, connTimeout=${connMs}ms, stmtTimeout=${stmtMs}ms)`)
    const pool = new Pool({
      connectionString,
      max,
      idleTimeoutMillis: idleMs,
      connectionTimeoutMillis: connMs,
      allowExitOnIdle: false,
      // 슬로우 쿼리 가 커넥션을 영구 점유 못 하도록 서버측 timeout 강제
      statement_timeout: stmtMs,
      query_timeout: stmtMs,
    } as ConstructorParameters<typeof Pool>[0])

    // 풀 자체 에러(서버 disconnect 등)는 throw 되지 않으므로 명시적 listener 필요
    pool.on("error", (err) => {
      console.error(
        `[shared-pool] idle client error: ${err.message} ` +
        `stats={total:${pool.totalCount}, idle:${pool.idleCount}, waiting:${pool.waitingCount}}`
      )
    })

    globalThis.__yg1SharedDbPool = pool
  }
  return globalThis.__yg1SharedDbPool
}

/**
 * 풀 상태 진단용. 타임아웃 에러 컨텍스트 로그에서 호출.
 */
export function getSharedPoolStats(): { total: number; idle: number; waiting: number } | null {
  const pool = globalThis.__yg1SharedDbPool
  if (!pool) return null
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }
}

export function hasDatabase(): boolean {
  return !!dbConnectionString()
}
