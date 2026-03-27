import "server-only"

type TraceLevel = "log" | "warn" | "error"

const DEFAULT_MAX_STRING = 600
const DEFAULT_MAX_ARRAY = 8
const DEFAULT_MAX_DEPTH = 5
const DEFAULT_MAX_OUTPUT = 400

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(String(raw ?? ""), 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function maxStringLength(): number {
  return parsePositiveInt(process.env.RECOMMEND_TRACE_MAX_CHARS, DEFAULT_MAX_STRING)
}

function maxArrayLength(): number {
  return parsePositiveInt(process.env.RECOMMEND_TRACE_MAX_ITEMS, DEFAULT_MAX_ARRAY)
}

function maxOutputLength(): number {
  return parsePositiveInt(process.env.RECOMMEND_TRACE_MAX_TOTAL_CHARS, DEFAULT_MAX_OUTPUT)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]"
}

function truncateString(value: string): string {
  const limit = maxStringLength()
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}...<truncated:${value.length - limit}>`
}

function sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth >= DEFAULT_MAX_DEPTH) return "[MaxDepth]"
  if (value === undefined) return "[undefined]"
  if (value === null) return null

  if (typeof value === "string") return truncateString(value)
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "symbol") return String(value)
  if (typeof value === "function") return `[Function ${(value as Function).name || "anonymous"}]`

  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: truncateString(value.stack ?? "[no-stack]"),
    }
  }

  if (Array.isArray(value)) {
    const limit = maxArrayLength()
    const visible = value.slice(0, limit).map(item => sanitize(item, depth + 1, seen))
    if (value.length > limit) {
      visible.push(`[+${value.length - limit} more items]`)
    }
    return visible
  }

  if (value instanceof Map) {
    return {
      __type: "Map",
      entries: sanitize(Array.from(value.entries()), depth + 1, seen),
    }
  }

  if (value instanceof Set) {
    return {
      __type: "Set",
      values: sanitize(Array.from(value.values()), depth + 1, seen),
    }
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[Circular]"
    seen.add(value as object)

    if (!isPlainObject(value)) {
      return sanitize({ ...(value as Record<string, unknown>) }, depth + 1, seen)
    }

    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      output[key] = sanitize(item, depth + 1, seen)
    }
    seen.delete(value as object)
    return output
  }

  return String(value)
}

function stringify(payload: unknown): string {
  try {
    return JSON.stringify(sanitize(payload))
  } catch (error) {
    return JSON.stringify({
      fallback: "[Unserializable payload]",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function truncateOutput(value: string): string {
  const limit = maxOutputLength()
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}...<truncated:${value.length - limit}>`
}

export function isRecommendationTraceEnabled(): boolean {
  const raw = process.env.RECOMMEND_TRACE_VERBOSE?.trim().toLowerCase()
  if (raw === "false" || raw === "0" || raw === "off") return false
  if (raw === "true" || raw === "1" || raw === "on") return true
  return process.env.NODE_ENV !== "production"
}

export function traceRecommendation(tag: string, payload?: unknown, level: TraceLevel = "log"): void {
  if (!isRecommendationTraceEnabled()) return

  const prefix = `[recommend-trace][${tag}]`
  if (payload === undefined) {
    console[level](truncateOutput(prefix))
    return
  }

  console[level](truncateOutput(`${prefix} ${stringify(payload)}`))
}

export function traceRecommendationError(tag: string, error: unknown, context?: Record<string, unknown>): void {
  traceRecommendation(tag, {
    ...(context ?? {}),
    error,
  }, "error")
}
