import "server-only"

type TraceLevel = "log" | "warn" | "error"

const DEFAULT_MAX_STRING = 600
const DEFAULT_MAX_ARRAY = 8
const DEFAULT_MAX_DEPTH = 5
const DEFAULT_MAX_OUTPUT = 800

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null
}

function getPath(value: unknown, path: string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    const record = asRecord(current)
    if (!record || !(key in record)) return undefined
    current = record[key]
  }
  return current
}

function formatFilterList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const record = asRecord(item)
      if (!record) return null
      const field = typeof record.field === "string" ? record.field : null
      const op = typeof record.op === "string" ? record.op : null
      const rawValue = record.rawValue ?? record.value
      if (!field) return null
      if (op === "skip") return `${field}=skip`
      return `${field}=${String(rawValue ?? "")}`
    })
    .filter((item): item is string => Boolean(item))
}

function formatSlots(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const record = asRecord(item)
      if (!record || typeof record.field !== "string") return null
      return `${record.field}=${String(record.value ?? "")}`
    })
    .filter((item): item is string => Boolean(item))
}

function formatOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const record = asRecord(item)
      if (!record || typeof record.label !== "string") return null
      const field = typeof record.field === "string" ? record.field : "?"
      return `${record.label}(${field})`
    })
    .filter((item): item is string => Boolean(item))
}

function formatDroppedFilters(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const record = asRecord(item)
      if (!record || typeof record.field !== "string") return null
      const op = typeof record.op === "string" ? record.op : "?"
      const rawValue = record.rawValue ?? record.value
      const reason = typeof record.reason === "string" ? record.reason : "unknown"
      return `${record.field}:${op}=${String(rawValue ?? "")} (${reason})`
    })
    .filter((item): item is string => Boolean(item))
}

function formatClauseEntries(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      const record = asRecord(item)
      if (!record || typeof record.field !== "string" || typeof record.clause !== "string") return null
      const op = typeof record.op === "string" ? record.op : "?"
      return `${record.field}:${op} => ${record.clause}`
    })
    .filter((item): item is string => Boolean(item))
}

function summarizeAction(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value)
  if (!record || typeof record.type !== "string") return null

  const summary: Record<string, unknown> = { type: record.type }
  if (record.type === "continue_narrowing" && asRecord(record.filter)) {
    const filter = asRecord(record.filter)!
    summary.filter = `${String(filter.field ?? "?")}=${String(filter.rawValue ?? filter.value ?? "")}`
  }
  if (record.type === "replace_existing_filter") {
    summary.targetField = record.targetField ?? null
    if (asRecord(record.nextFilter)) {
      const nextFilter = asRecord(record.nextFilter)!
      summary.nextFilter = `${String(nextFilter.field ?? "?")}=${String(nextFilter.rawValue ?? nextFilter.value ?? "")}`
    }
  }
  if (record.type === "compare_products" && Array.isArray(record.targets)) {
    summary.targets = record.targets
  }
  if (record.type === "filter_by_stock" && typeof record.stockFilter === "string") {
    summary.stockFilter = record.stockFilter
    if (typeof record.stockThreshold === "number") {
      summary.stockThreshold = record.stockThreshold
    }
  }
  return summary
}

function summarizeTopLevel(payload: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      summary[key] = value
      continue
    }
    if (Array.isArray(value)) {
      summary[`${key}Count`] = value.length
      continue
    }
    if (isPlainObject(value)) {
      const nested: Record<string, unknown> = {}
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (nestedValue == null || typeof nestedValue === "string" || typeof nestedValue === "number" || typeof nestedValue === "boolean") {
          nested[nestedKey] = nestedValue
        }
      }
      if (Object.keys(nested).length > 0) summary[key] = nested
    }
  }
  return summary
}

export function summarizeRecommendationTracePayload(tag: string, payload?: unknown): unknown {
  if (payload === undefined) return undefined
  const record = asRecord(payload)
  if (!record) return sanitize(payload)

  switch (tag) {
    case "runtime.handleServeExplorationInner:input":
      return {
        stage: "runtime-input",
        messageCount: getPath(record, ["messages", "count"]) ?? 0,
        lastUser: getPath(record, ["messages", "lastUserPreview"]) ?? null,
        lastAskedField: getPath(record, ["prevState", "lastAskedField"]) ?? null,
        candidateCount: getPath(record, ["prevState", "candidateCount"]) ?? 0,
        appliedFilterCount: getPath(record, ["prevState", "appliedFilterCount"]) ?? 0,
        currentMode: getPath(record, ["prevState", "currentMode"]) ?? null,
      }

    case "runtime.handleServeExplorationInner:request-prep":
      return {
        stage: "intent",
        intent: getPath(record, ["requestPrep", "intent"]) ?? null,
        confidence: getPath(record, ["requestPrep", "intentConfidence"]) ?? null,
        route: getPath(record, ["requestPrep", "route"]) ?? null,
        slots: formatSlots(getPath(record, ["requestPrep", "slots"])).slice(0, 8),
        activeFilters: formatFilterList(record.filters).slice(0, 8),
        turnCount: record.turnCount ?? 0,
      }

    case "runtime.handleServeExplorationInner:llm-filter-result":
      return {
        stage: "llm-filter",
        pendingField: record.pendingField ?? null,
        extractedFilters: formatFilterList(
          Object.entries(asRecord(record.llmResult)?.extractedFilters ?? {}).map(([field, value]) => ({
            field,
            rawValue: value,
          }))
        ),
        skippedFields: Array.isArray(getPath(record, ["llmResult", "skippedFields"]))
          ? getPath(record, ["llmResult", "skippedFields"])
          : [],
        skipPendingField: getPath(record, ["llmResult", "skipPendingField"]) ?? false,
        isSideQuestion: getPath(record, ["llmResult", "isSideQuestion"]) ?? false,
        confidence: getPath(record, ["llmResult", "confidence"]) ?? null,
      }

    case "runtime.handleServeExplorationInner:sql-agent-filter-pipeline":
      return {
        stage: "sql-agent-filter-pipeline",
        confidence: record.confidence ?? null,
        parsedFilters: formatFilterList(record.parsedFilters).slice(0, 8),
        normalizedFilters: formatFilterList(record.normalizedFilters).slice(0, 8),
        droppedFilters: formatDroppedFilters(record.droppedFilters).slice(0, 8),
        finalFilters: formatFilterList(record.finalFilters).slice(0, 8),
      }

    case "runtime.handleServeExplorationInner:state-after-routing-prep":
      return {
        stage: "routing",
        semanticAction: summarizeAction(record.semanticAction),
        pendingSelectionAction: summarizeAction(record.pendingSelectionAction),
        explicitComparisonAction: summarizeAction(record.explicitComparisonAction),
        explicitRevisionAction: summarizeAction(record.explicitRevisionAction),
        explicitFilterAction: summarizeAction(record.explicitFilterAction),
        explicitRefineAction: summarizeAction(record.explicitRefineAction),
        llmExtraFilters: formatFilterList(record.llmExtraFilters).slice(0, 8),
        activeFilters: formatFilterList(record.filters).slice(0, 8),
      }

    case "response.buildQuestionResponse:input":
      return {
        stage: "question-input",
        candidateCount: record.totalCandidateCount ?? 0,
        activeFilters: formatFilterList(record.filters).slice(0, 8),
        historyCount: record.historyCount ?? 0,
        overrideText: typeof record.overrideText === "string" ? record.overrideText : null,
      }

    case "response.buildQuestionResponse:output":
      return {
        stage: "question-output",
        purpose: record.purpose ?? null,
        field: getPath(record, ["question", "field"]) ?? null,
        question: getPath(record, ["question", "questionText"]) ?? null,
        response: record.responseText ?? null,
        chips: Array.isArray(record.chipPreview) ? record.chipPreview : [],
        optionLabels: formatOptions(record.displayedOptions).slice(0, 6),
      }

    case "response.buildRecommendationResponse:input":
      return {
        stage: "recommendation-input",
        candidateCount: record.totalCandidateCount ?? 0,
        activeFilters: formatFilterList(record.filters).slice(0, 8),
        historyCount: record.historyCount ?? 0,
      }

    case "response.buildRecommendationResponse:output":
      return {
        stage: "recommendation-output",
        purpose: record.purpose ?? null,
        primaryCode: getPath(record, ["recommendation", "primaryProduct", "product", "displayCode"]) ?? null,
        primarySeries: getPath(record, ["recommendation", "primaryProduct", "product", "seriesName"]) ?? null,
        status: getPath(record, ["recommendation", "status"]) ?? null,
        candidateCount: getPath(record, ["recommendation", "totalCandidatesConsidered"]) ?? null,
        summary: record.text ?? null,
        chips: Array.isArray(record.chips) ? record.chips.slice(0, 8) : [],
      }

    case "domain.runHybridRetrieval:input":
      return {
        stage: "retrieval-input",
        filters: formatFilterList(record.filters).slice(0, 8),
        topN: record.topN ?? 0,
        pagination: record.pagination ?? null,
      }

    case "domain.runHybridRetrieval:db-fetch":
      return {
        stage: "retrieval-db-fetch",
        limit: record.limit ?? null,
        offset: record.offset ?? 0,
        fetchedProducts: getPath(record, ["fetchedProducts", "count"]) ?? null,
        totalCount: record.totalCount ?? null,
      }

    case "domain.runHybridRetrieval:output":
      return {
        stage: "retrieval-output",
        durationMs: record.durationMs ?? null,
        totalConsidered: record.totalConsidered ?? null,
        filtersApplied: formatFilterList(record.filtersApplied).slice(0, 8),
        topCandidates: Array.isArray(record.candidates)
          ? record.candidates.slice(0, 5).map((candidate) => {
              const item = asRecord(candidate)
              return item?.displayCode ?? item?.productCode ?? null
            }).filter((item): item is string => Boolean(item))
          : [],
      }

    case "db.product.queryProductsPageFromDatabase:plan":
    case "db.product.queryProductsFromDatabase:plan":
      return {
        stage: "db-query-plan",
        operation: record.operation ?? null,
        appliedClauses: formatClauseEntries(record.appliedClauses).slice(0, 8),
        skippedFilters: formatDroppedFilters(record.skippedFilters).slice(0, 8),
        droppedFilters: formatDroppedFilters(record.droppedFilters).slice(0, 8),
        finalWhereClauses: Array.isArray(record.finalWhereClauses)
          ? record.finalWhereClauses.slice(0, 8)
          : [],
        totalCount: record.totalCount ?? record.productCount ?? null,
        pageCount: record.pageCount ?? record.productCount ?? null,
      }

    case "context.performUnifiedJudgment:input":
      return {
        stage: "unified-judgment-input",
        userMessage: record.userMessage ?? null,
        pendingField: record.pendingField ?? null,
        displayedOptionCount: Array.isArray(record.displayedOptions) ? record.displayedOptions.length : 0,
      }

    case "context.performUnifiedJudgment:output":
      return {
        stage: "unified-judgment-output",
        action: getPath(record, ["result", "intentAction"]) ?? null,
        userState: getPath(record, ["result", "userState"]) ?? null,
        domainRelevance: getPath(record, ["result", "domainRelevance"]) ?? null,
        signalStrength: getPath(record, ["result", "signalStrength"]) ?? null,
        extractedAnswer: getPath(record, ["result", "extractedAnswer"]) ?? null,
      }

    case "http.jsonRecommendationResponse:dto":
      return {
        stage: "http-response",
        purpose: record.purpose ?? null,
        text: record.text ?? null,
        chipCount: record.chipCount ?? null,
        displayedOptionCount: getPath(record, ["sessionState", "displayedOptionCount"]) ?? null,
        candidateCount: getPath(record, ["sessionState", "candidateCount"]) ?? null,
      }

    default:
      return summarizeTopLevel(record)
  }
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

  console[level](truncateOutput(`${prefix} ${stringify(summarizeRecommendationTracePayload(tag, payload))}`))
}

export function traceRecommendationError(tag: string, error: unknown, context?: Record<string, unknown>): void {
  traceRecommendation(tag, {
    ...(context ?? {}),
    error,
  }, "error")
}
