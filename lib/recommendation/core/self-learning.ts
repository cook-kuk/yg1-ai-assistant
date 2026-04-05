/**
 * Self-Supervised Learning Engine
 *
 * Learns from every user interaction to improve KG and intent resolution.
 * No external labels needed — uses implicit signals:
 *   - User continued conversation → positive signal (decision was correct)
 *   - User reset/went back → negative signal (decision was wrong)
 *   - KG miss → LLM resolved → learn new pattern
 *   - User selected chip → learn alias mapping
 *
 * Storage: JSON file (data/learning/), periodic KG updates
 */

import fs from "fs"
import path from "path"

// ── Types ───────────────────────────────────────────────────────

export interface InteractionLog {
  id: string
  timestamp: string
  sessionId: string
  turnNumber: number
  // Input
  userMessage: string
  pendingField: string | null
  appliedFilters: string[]  // "field=value" format
  candidateCount: number
  // Decision
  decisionSource: "kg" | "llm" | "deterministic" | "chip"
  kgSource?: string  // "kg-intent" | "kg-entity" | "kg-exclude" | "none"
  kgReason?: string
  kgConfidence?: number
  llmModel?: string
  llmDurationMs?: number
  actionType: string
  actionDetail: string  // e.g., "toolSubtype=Ball"
  // Outcome (filled on next turn)
  outcome?: "continued" | "reset" | "back" | "abandoned" | "success"
  nextUserMessage?: string
}

export interface LearnedPattern {
  id: string
  learnedAt: string
  source: "interaction" | "llm-fallback" | "chip-selection" | "feedback"
  patternType: "alias" | "intent" | "exclude" | "numeric"
  field: string
  trigger: string        // user input that triggered learning
  canonical: string      // resolved canonical value
  confidence: number     // 0-1, increases with more evidence
  evidenceCount: number  // how many times this pattern was seen
  lastSeen: string
  verified: boolean      // manually verified by admin
}

export interface LearningStats {
  totalInteractions: number
  kgHitRate: number       // % of decisions by KG (no LLM)
  llmFallbackRate: number
  newPatternsLearned: number
  patternsByType: Record<string, number>
  topMissedPatterns: Array<{ message: string; count: number; lastSeen: string }>
  recentLearnings: LearnedPattern[]
  dailyStats: Array<{
    date: string
    interactions: number
    kgHits: number
    llmFallbacks: number
    patternsLearned: number
  }>
}

// ── Storage ─────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data", "learning")
const INTERACTIONS_FILE = path.join(DATA_DIR, "interactions.json")
const PATTERNS_FILE = path.join(DATA_DIR, "patterns.json")
const STATS_FILE = path.join(DATA_DIR, "stats.json")
const MISSED_FILE = path.join(DATA_DIR, "missed-patterns.json")

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T
  } catch {
    return fallback
  }
}

function writeJson(filePath: string, data: unknown) {
  ensureDir()
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
}

// ── In-memory cache ─────────────────────────────────────────────

let _interactions: InteractionLog[] = []
let _patterns: LearnedPattern[] = []
let _missedPatterns: Map<string, { count: number; lastSeen: string; messages: string[] }> = new Map()
let _loaded = false

function loadIfNeeded() {
  if (_loaded) return
  _interactions = readJson<InteractionLog[]>(INTERACTIONS_FILE, [])
  _patterns = readJson<LearnedPattern[]>(PATTERNS_FILE, [])
  const missed = readJson<Array<{ key: string; count: number; lastSeen: string; messages: string[] }>>(MISSED_FILE, [])
  _missedPatterns = new Map(missed.map(m => [m.key, { count: m.count, lastSeen: m.lastSeen, messages: m.messages }]))
  _loaded = true
}

function persist() {
  writeJson(INTERACTIONS_FILE, _interactions.slice(-5000))  // Keep last 5000
  writeJson(PATTERNS_FILE, _patterns)
  writeJson(MISSED_FILE, [..._missedPatterns.entries()].map(([key, v]) => ({ key, ...v })))
}

// ── Interaction Logging ─────────────────────────────────────────

export function logInteraction(log: InteractionLog) {
  loadIfNeeded()
  _interactions.push(log)

  // Track LLM fallback as missed KG pattern
  if (log.decisionSource === "llm" && log.userMessage.length > 1) {
    const key = normalizeForMissed(log.userMessage, log.actionType, log.actionDetail)
    const existing = _missedPatterns.get(key)
    if (existing) {
      existing.count++
      existing.lastSeen = log.timestamp
      if (!existing.messages.includes(log.userMessage) && existing.messages.length < 5) {
        existing.messages.push(log.userMessage)
      }
    } else {
      _missedPatterns.set(key, {
        count: 1,
        lastSeen: log.timestamp,
        messages: [log.userMessage],
      })
    }
  }

  // Auto-learn from chip selections (high confidence)
  if (log.decisionSource === "chip" && log.actionType === "continue_narrowing") {
    tryLearnFromChipSelection(log)
  }

  // Periodic persist (every 10 interactions)
  if (_interactions.length % 10 === 0) {
    persist()
  }
}

/** Update the outcome of a previous interaction based on user's next action */
export function updateOutcome(sessionId: string, turnNumber: number, outcome: InteractionLog["outcome"], nextMessage?: string) {
  loadIfNeeded()
  const prev = _interactions.find(i => i.sessionId === sessionId && i.turnNumber === turnNumber)
  if (prev) {
    prev.outcome = outcome
    prev.nextUserMessage = nextMessage
  }
}

// ── Pattern Learning ────────────────────────────────────────────

function normalizeForMissed(message: string, actionType: string, detail: string): string {
  // Key by action+field (not value) — so "diameterMm=3" and "diameterMm=4" accumulate together
  // This allows patterns like "직경 Nmm 찾아줘" to be learned regardless of the specific diameter
  const field = detail.split("=")[0] || detail
  // For non-numeric fields, keep the value (e.g., "workPieceName=알루미늄" is distinct from "workPieceName=주철")
  const isNumericField = /^(diameterMm|fluteCount|lengthOfCutMm|overallLengthMm|helixAngleDeg|shankDiameterMm|ballRadiusMm|taperAngleDeg)$/.test(field)
  if (isNumericField) {
    // Group all numeric values for the same field: "continue_narrowing|diameterMm"
    return `${actionType}|${field}`
  }
  // Keep full detail for categorical fields: "continue_narrowing|workPieceName=알루미늄"
  return `${actionType}|${detail}`
}

function tryLearnFromChipSelection(log: InteractionLog) {
  // User clicked a chip → the chip text maps to the action
  // This is a high-confidence training signal
  const chipText = log.userMessage.trim()
  const [field, value] = log.actionDetail.split("=")
  if (!field || !value) return

  learnPattern({
    source: "chip-selection",
    patternType: "alias",
    field,
    trigger: chipText.toLowerCase(),
    canonical: value,
    confidence: 0.90,
  })
}

export function tryLearnFromLLMFallback(
  userMessage: string,
  llmAction: string,
  llmDetail: string,
  llmConfidence: number
) {
  if (llmConfidence < 0.5) return

  const [field, value] = llmDetail.split("=")
  if (!field || !value) return

  // Extract multiple trigger candidates from the message
  const msg = userMessage.toLowerCase().trim()
  const triggers: string[] = [msg] // full message as one trigger

  // Also extract individual meaningful tokens as triggers
  const tokens = msg.split(/[\s,!?.]+/).filter(t => t.length >= 2)
  for (const token of tokens) {
    const STOP_WORDS = ["있어","줘","해줘","해","주세요","알려","추천","보여","찾아","가공","용으로","공구","엔드밀","제품","좋은","뭐야","있나요","전용","가공에","보기","타입으로","바꿔줘","조건","어떻게","할","때","으로","에서","이","가","을","를","은","는","도","만","좀","좀","나","내","그","이걸","저걸","것","거","수","mm","개","날"]
    if (token.length >= 2 && !STOP_WORDS.includes(token)) {
      triggers.push(token)
    }
  }

  // Learn each trigger
  for (const trigger of triggers) {
    learnPattern({
      source: "llm-fallback",
      patternType: llmAction === "continue_narrowing" ? "alias" : "intent",
      field,
      trigger,
      canonical: value,
      confidence: llmConfidence * 0.8,
    })
  }
}

function learnPattern(input: {
  source: LearnedPattern["source"]
  patternType: LearnedPattern["patternType"]
  field: string
  trigger: string
  canonical: string
  confidence: number
}) {
  loadIfNeeded()
  const now = new Date().toISOString()

  // Check if pattern already exists
  const existing = _patterns.find(p =>
    p.field === input.field &&
    p.trigger === input.trigger &&
    p.canonical === input.canonical
  )

  if (existing) {
    existing.evidenceCount++
    existing.lastSeen = now
    // Increase confidence with more evidence (max 0.95)
    existing.confidence = Math.min(0.95, existing.confidence + 0.02 * (1 - existing.confidence))
    return
  }

  // New pattern
  _patterns.push({
    id: `lp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    learnedAt: now,
    source: input.source,
    patternType: input.patternType,
    field: input.field,
    trigger: input.trigger,
    canonical: input.canonical,
    confidence: input.confidence,
    evidenceCount: 1,
    lastSeen: now,
    verified: false,
  })

  console.log(`[self-learning] New pattern: "${input.trigger}" → ${input.field}=${input.canonical} (${input.source}, conf=${input.confidence.toFixed(2)})`)
}

// ── Pattern Mining (Self-Supervised) ────────────────────────────

/** Analyze missed patterns and auto-promote high-frequency ones */
export function runPatternMining(): { promoted: number; analyzed: number } {
  loadIfNeeded()
  let promoted = 0
  const analyzed = _missedPatterns.size

  for (const [key, data] of _missedPatterns.entries()) {
    // Promote patterns seen ≥1 time — even a single LLM fallback is a learning signal
    // The confidence scales with count, so single-occurrence patterns get lower confidence
    if (data.count >= 1) {
      const [actionType, detail] = key.split("|")
      const parts = (detail || "").split("=")
      const field = parts[0]
      const value = parts[1] || field // For field-only keys (numeric), use field name as canonical
      if (field) {
        // Use the shortest representative message as trigger
        const trigger = data.messages
          .sort((a, b) => a.length - b.length)[0]
          ?.toLowerCase().trim()

        if (trigger) {
          learnPattern({
            source: "interaction",
            patternType: actionType === "continue_narrowing" ? "alias" : "intent",
            field,
            trigger,
            canonical: value,
            confidence: Math.min(0.90, 0.45 + data.count * 0.08),
          })
          promoted++
        }
      }
      _missedPatterns.delete(key)
    }
  }

  persist()
  console.log(`[self-learning:mining] Promoted ${promoted} patterns from ${analyzed} candidates`)

  return { promoted, analyzed }
}

// ── KG Integration ──────────────────────────────────────────────

/** Get learned patterns that are ready to be integrated into KG */
export function getPromotablePatterns(minConfidence = 0.75, minEvidence = 3): LearnedPattern[] {
  loadIfNeeded()
  return _patterns.filter(p =>
    p.confidence >= minConfidence &&
    p.evidenceCount >= minEvidence &&
    !p.verified
  )
}

/** Get all learned patterns with their lookup index for runtime use */
export function getLearnedEntityIndex(): Map<string, { field: string; canonical: string; confidence: number }> {
  loadIfNeeded()
  const index = new Map<string, { field: string; canonical: string; confidence: number }>()
  for (const p of _patterns) {
    if (p.patternType === "alias" && p.confidence >= 0.40 && p.evidenceCount >= 1) {
      index.set(p.trigger, { field: p.field, canonical: p.canonical, confidence: p.confidence })
    }
  }
  return index
}

// ── Statistics ──────────────────────────────────────────────────

export function getLearningStats(): LearningStats {
  loadIfNeeded()

  const total = _interactions.length
  const kgHits = _interactions.filter(i => i.decisionSource === "kg" || i.decisionSource === "deterministic").length
  const llmFallbacks = _interactions.filter(i => i.decisionSource === "llm").length

  // Daily stats (last 14 days)
  const dailyMap = new Map<string, { interactions: number; kgHits: number; llmFallbacks: number; patternsLearned: number }>()
  for (const log of _interactions) {
    const date = log.timestamp.slice(0, 10)
    const day = dailyMap.get(date) ?? { interactions: 0, kgHits: 0, llmFallbacks: 0, patternsLearned: 0 }
    day.interactions++
    if (log.decisionSource === "kg" || log.decisionSource === "deterministic") day.kgHits++
    if (log.decisionSource === "llm") day.llmFallbacks++
    dailyMap.set(date, day)
  }
  for (const p of _patterns) {
    const date = p.learnedAt.slice(0, 10)
    const day = dailyMap.get(date)
    if (day) day.patternsLearned++
  }

  const topMissed = [..._missedPatterns.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([, v]) => ({
      message: v.messages[0] ?? "",
      count: v.count,
      lastSeen: v.lastSeen,
    }))

  const patternsByType: Record<string, number> = {}
  for (const p of _patterns) {
    patternsByType[p.patternType] = (patternsByType[p.patternType] ?? 0) + 1
  }

  return {
    totalInteractions: total,
    kgHitRate: total > 0 ? kgHits / total : 0,
    llmFallbackRate: total > 0 ? llmFallbacks / total : 0,
    newPatternsLearned: _patterns.length,
    patternsByType,
    topMissedPatterns: topMissed,
    recentLearnings: _patterns.slice(-20).reverse(),
    dailyStats: [...dailyMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, d]) => ({ date, ...d })),
  }
}

export function getPatterns(): LearnedPattern[] {
  loadIfNeeded()
  return [..._patterns]
}

export function verifyPattern(id: string, verified: boolean) {
  loadIfNeeded()
  const p = _patterns.find(p => p.id === id)
  if (p) {
    p.verified = verified
    persist()
  }
}

/** Force persist all data */
export function flushLearningData() {
  persist()
}
