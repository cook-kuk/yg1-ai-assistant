import "server-only"

import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

type LogLevel = "info" | "warn" | "error"

interface RuntimeLogEntry {
  level?: LogLevel
  category: string
  event: string
  context?: Record<string, unknown>
}

declare global {
  // eslint-disable-next-line no-var
  var __yg1RuntimeLogWriteQueue: Promise<void> | undefined
  // eslint-disable-next-line no-var
  var __yg1RuntimeLogDirReady: Promise<string | undefined> | undefined
}

function getRuntimeLogPath(): string {
  const configuredPath = process.env.RUNTIME_LOG_FILE?.trim()
  if (configuredPath) {
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(process.cwd(), configuredPath)
  }

  return path.join(process.cwd(), "logs", "runtime.log")
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const base: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack ?? "[no-stack]",
    }

    const errorWithCause = error as Error & { cause?: unknown }
    if (errorWithCause.cause !== undefined) {
      base.cause = toSerializable(errorWithCause.cause)
    }

    return base
  }

  return { message: String(error) }
}

function toSerializable(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined) return "[undefined]"
  if (value === null) return null

  const valueType = typeof value
  if (valueType === "string" || valueType === "number" || valueType === "boolean") return value
  if (valueType === "bigint") return value.toString()
  if (valueType === "symbol") return String(value)
  if (valueType === "function") return `[Function ${(value as Function).name || "anonymous"}]`

  if (value instanceof Date) return value.toISOString()
  if (value instanceof URL) return value.toString()
  if (value instanceof Error) return serializeError(value)

  if (Array.isArray(value)) {
    return value.map(item => toSerializable(item, seen))
  }

  if (value instanceof Set) {
    return [...value].map(item => toSerializable(item, seen))
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, item]) => [String(key), toSerializable(item, seen)])
    )
  }

  if (valueType === "object") {
    if (seen.has(value as object)) return "[Circular]"
    seen.add(value as object)

    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = toSerializable(item, seen)
    }

    seen.delete(value as object)
    return output
  }

  return String(value)
}

async function ensureLogDirectory(): Promise<void> {
  if (!globalThis.__yg1RuntimeLogDirReady) {
    globalThis.__yg1RuntimeLogDirReady = mkdir(path.dirname(getRuntimeLogPath()), {
      recursive: true,
    })
  }

  await globalThis.__yg1RuntimeLogDirReady
}

export async function appendRuntimeLog(entry: RuntimeLogEntry): Promise<void> {
  const record = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
    level: entry.level ?? "info",
    category: entry.category,
    event: entry.event,
    context: toSerializable(entry.context ?? {}),
  }
  const line = `${JSON.stringify(record)}\n`

  const write = async () => {
    await ensureLogDirectory()
    await appendFile(getRuntimeLogPath(), line, "utf8")
  }

  globalThis.__yg1RuntimeLogWriteQueue = (globalThis.__yg1RuntimeLogWriteQueue ?? Promise.resolve())
    .catch(() => {})
    .then(write)

  try {
    await globalThis.__yg1RuntimeLogWriteQueue
  } catch (error) {
    console.error("[runtime-log] write failed:", error)
  }
}

export async function logRuntimeError(params: {
  category: string
  event: string
  error: unknown
  context?: Record<string, unknown>
  level?: LogLevel
}): Promise<void> {
  await appendRuntimeLog({
    level: params.level ?? "error",
    category: params.category,
    event: params.event,
    context: {
      ...(params.context ?? {}),
      error: serializeError(params.error),
    },
  })
}
