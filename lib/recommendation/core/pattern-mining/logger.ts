/**
 * Pattern Mining Logger
 *
 * Non-blocking, append-only JSONL logger.
 * Production 동작에 절대 영향 없음 — 모든 에러를 삼킴.
 */

import { writeFile, appendFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import type { PatternMiningLog, PatternMiningConstraint } from "./types"

// ── Config ──────────────────────────────────────────────────

const LOG_DIR = path.join(process.cwd(), "data")
const LOG_FILE = path.join(LOG_DIR, "pattern-mining-logs.jsonl")
const MAX_LOG_SIZE_MB = 50

// ── Group Key ───────────────────────────────────────────────

/**
 * 동일 패턴 집계용 키 생성.
 * 같은 의미의 다른 표현을 묶기 위해 field+op+value 조합으로 만듦.
 */
/** range ops는 value 무시 — "직경 10 이상"과 "직경 8 이상"을 같은 그룹으로 */
const RANGE_OPS = new Set(["gte", "lte", "between"])

function buildGroupKey(constraints: PatternMiningConstraint[]): string {
  if (constraints.length === 0) return "_empty"
  return constraints
    .map(c => RANGE_OPS.has(c.op)
      ? `${c.field}:${c.op}`
      : `${c.field}:${c.op}:${String(c.value).toLowerCase()}`)
    .sort()
    .join("|")
}

// ── Normalize ───────────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
}

// ── Public API ──────────────────────────────────────────────

export interface LoggerInput {
  userText: string
  production: {
    source: "kg" | "sql-agent" | "negation" | "scr" | "edit-intent" | "none"
    constraints: PatternMiningConstraint[]
    handled: boolean
  }
  planner: {
    constraints: PatternMiningConstraint[]
    navigation: string
    intent: string
    confidence: number
    reasoning?: string
  }
  decision: {
    winner: "production" | "planner" | "none" | "skip"
    plannerScore: number
    productionScore: number
    margin: number
    reason: string
    applied: boolean
  }
  finalFilters: PatternMiningConstraint[]
}

/**
 * 패턴 마이닝 로그 1건 기록.
 * Non-blocking — fire-and-forget. 에러 시 console.warn만.
 */
export function logPatternMiningEntry(input: LoggerInput): void {
  // Fire-and-forget: 절대 await하지 않음
  _writeLog(input).catch(e => {
    // Production 영향 금지 — 조용히 warn만
    if (process.env.NODE_ENV !== "production") {
      console.warn("[pattern-mining-logger] write failed:", e?.message)
    }
  })
}

async function _writeLog(input: LoggerInput): Promise<void> {
  const entry: PatternMiningLog = {
    userText: input.userText,
    normalizedText: normalizeText(input.userText),
    production: input.production,
    planner: input.planner,
    decision: input.decision,
    final: { constraints: input.finalFilters },
    timestamp: new Date().toISOString(),
    groupKey: buildGroupKey(input.planner.constraints),
  }

  // Ensure directory exists
  if (!existsSync(LOG_DIR)) {
    await mkdir(LOG_DIR, { recursive: true })
  }

  // Append JSONL (1 line per entry)
  const line = JSON.stringify(entry) + "\n"
  await appendFile(LOG_FILE, line, "utf-8")
}

// ── Read Logs (for miner) ───────────────────────────────────

import { readFile } from "fs/promises"

/**
 * 로그 파일 전체 읽기 (miner용).
 * 서버 런타임에서는 호출하지 말 것 — 오프라인 배치 전용.
 */
export async function readAllLogs(): Promise<PatternMiningLog[]> {
  if (!existsSync(LOG_FILE)) return []
  const raw = await readFile(LOG_FILE, "utf-8")
  return raw
    .split("\n")
    .filter(line => line.trim())
    .map(line => {
      try { return JSON.parse(line) as PatternMiningLog }
      catch { return null }
    })
    .filter((entry): entry is PatternMiningLog => entry !== null)
}
