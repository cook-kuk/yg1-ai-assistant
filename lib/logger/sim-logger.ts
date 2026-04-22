// SPDX-License-Identifier: MIT
// Simulator API 전용 경량 로거 (console 기반 · pino 미설치 환경 대응)
// 프로덕션에서 pino 구조화 로그 원하면 추후 `npm install pino pino-pretty` 후 이 파일 교체.

const isDev = process.env.NODE_ENV !== "production"
const isoTime = () => new Date().toISOString().slice(11, 19)

export function logApiRequest(route: string, method: string, meta?: Record<string, unknown>) {
  if (!isDev) return
  console.log(`[${isoTime()}] → ${method} ${route}`, meta ?? "")
}

export function logApiError(route: string, err: unknown, meta?: Record<string, unknown>) {
  const e = err as Error
  console.error(`[${isoTime()}] ✗ ${route} error:`, e?.message ?? err, meta ?? "")
  if (isDev && e?.stack) console.error(e.stack)
}

export function logApiLatency(route: string, ms: number, meta?: Record<string, unknown>) {
  if (!isDev) return
  console.log(`[${isoTime()}] ✓ ${route} ${ms}ms`, meta ?? "")
}

export const simLogger = {
  info: (obj: Record<string, unknown>, msg?: string) => console.log(`[${isoTime()}]`, msg ?? "", obj),
  error: (obj: Record<string, unknown>, msg?: string) => console.error(`[${isoTime()}]`, msg ?? "", obj),
  warn: (obj: Record<string, unknown>, msg?: string) => console.warn(`[${isoTime()}]`, msg ?? "", obj),
  debug: (obj: Record<string, unknown>, msg?: string) => { if (isDev) console.log(`[${isoTime()}] DEBUG`, msg ?? "", obj) },
}
