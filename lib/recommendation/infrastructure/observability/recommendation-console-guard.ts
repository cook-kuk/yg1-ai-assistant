import "server-only"

const DEFAULT_MAX_STRING = 180
const DEFAULT_MAX_ARRAY = 6
const DEFAULT_MAX_DEPTH = 4
const DEFAULT_MAX_OUTPUT = 400

type ConsoleMethodName = "log" | "warn" | "error"

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(String(raw ?? ""), 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function maxStringLength(): number {
  return parsePositiveInt(process.env.RECOMMEND_LOG_MAX_CHARS, DEFAULT_MAX_STRING)
}

function maxArrayLength(): number {
  return parsePositiveInt(process.env.RECOMMEND_LOG_MAX_ITEMS, DEFAULT_MAX_ARRAY)
}

function maxOutputLength(): number {
  return parsePositiveInt(process.env.RECOMMEND_LOG_MAX_TOTAL_CHARS, DEFAULT_MAX_OUTPUT)
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
    if (value.length > limit) visible.push(`[+${value.length - limit} more items]`)
    return visible
  }

  if (value instanceof Map) {
    return {
      __type: "Map",
      size: value.size,
      entries: sanitize(Array.from(value.entries()).slice(0, maxArrayLength()), depth + 1, seen),
    }
  }

  if (value instanceof Set) {
    return {
      __type: "Set",
      size: value.size,
      values: sanitize(Array.from(value.values()).slice(0, maxArrayLength()), depth + 1, seen),
    }
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[Circular]"
    seen.add(value as object)

    const source = isPlainObject(value) ? value : { ...(value as Record<string, unknown>) }
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(source)) {
      output[key] = sanitize(item, depth + 1, seen)
    }
    seen.delete(value as object)
    return output
  }

  return String(value)
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") return truncateString(arg)
  try {
    return JSON.stringify(sanitize(arg))
  } catch {
    return "[Unserializable]"
  }
}

function truncateOutput(value: string): string {
  const limit = maxOutputLength()
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}...<truncated:${value.length - limit}>`
}

function patchConsoleMethod(methodName: ConsoleMethodName) {
  const original = console[methodName].bind(console)
  console[methodName] = (...args: unknown[]) => {
    const rendered = args.map(arg => stringifyArg(arg)).join(" ")
    original(truncateOutput(rendered))
  }
}

export function installRecommendationConsoleGuard(): void {
  if ((globalThis as { __yg1RecommendationConsoleGuardInstalled?: boolean }).__yg1RecommendationConsoleGuardInstalled) {
    return
  }

  patchConsoleMethod("log")
  patchConsoleMethod("warn")
  patchConsoleMethod("error")
  ;(globalThis as { __yg1RecommendationConsoleGuardInstalled?: boolean }).__yg1RecommendationConsoleGuardInstalled = true
}
