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
    console.log("[shared-pool] Creating shared pg pool (max=8)")
    globalThis.__yg1SharedDbPool = new Pool({
      connectionString,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  }
  return globalThis.__yg1SharedDbPool
}

export function hasDatabase(): boolean {
  return !!dbConnectionString()
}
