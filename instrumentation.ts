/**
 * Next.js instrumentation hook — runs once at server boot.
 *
 * Pre-warm caches that would otherwise pay sync I/O on the first request:
 *   1. semantic-search KB (data/domain-knowledge/*.json — ~256 entries)
 *   2. SQL agent DB schema cache (Postgres column metadata + sample values)
 *
 * This shaves ~200-500ms off the very first /api/recommend call after deploy.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  try {
    const { loadKB } = await import("@/lib/recommendation/core/semantic-search")
    loadKB()
  } catch (err) {
    console.warn("[instrumentation] KB preload failed:", (err as Error).message)
  }
  try {
    const { getDbSchema } = await import("@/lib/recommendation/core/sql-agent-schema-cache")
    void getDbSchema().catch(err =>
      console.warn("[instrumentation] schema preload failed:", (err as Error).message),
    )
  } catch (err) {
    console.warn("[instrumentation] schema import failed:", (err as Error).message)
  }
}
