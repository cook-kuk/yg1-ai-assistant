// SPDX-License-Identifier: MIT
// Simulator API 전용 구조화 로거 (Pino 기반)
import pino from "pino"

const isDev = process.env.NODE_ENV !== "production"

export const simLogger = pino({
  name: "yg1-sim-v3",
  level: process.env.LOG_LEVEL ?? (isDev ? "debug" : "info"),
  transport: isDev ? {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:HH:MM:ss",
      ignore: "pid,hostname",
    },
  } : undefined,
  formatters: {
    level: (label) => ({ level: label }),
  },
})

// 편의 래퍼
export function logApiRequest(route: string, method: string, meta?: Record<string, unknown>) {
  simLogger.info({ route, method, ...meta }, `→ ${method} ${route}`)
}

export function logApiError(route: string, err: unknown, meta?: Record<string, unknown>) {
  const e = err as Error
  simLogger.error({ route, err: { message: e?.message, stack: e?.stack }, ...meta }, `✗ ${route} error`)
}

export function logApiLatency(route: string, ms: number, meta?: Record<string, unknown>) {
  simLogger.info({ route, latencyMs: ms, ...meta }, `✓ ${route} ${ms}ms`)
}
