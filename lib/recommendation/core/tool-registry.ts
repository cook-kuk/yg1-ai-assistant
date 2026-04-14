/**
 * Tool Registry — 동적 SQL 템플릿 저장소.
 *
 * Tool Forge가 새 쿼리 패턴을 만들면 여기 저장. 다음에 비슷한 패턴이
 * 들어오면 LLM forge 단계를 건너뛰고 즉시 재사용한다.
 *
 * 매칭 전략: trigger pattern + description 키워드 overlap (Jaccard).
 * 임베딩 없이 간단한 토큰 기반 — 빠르고 외부 의존성 없음.
 *
 * 청소 규칙:
 *   1. TTL 7일 (사용 안 된 tool 자동 삭제)
 *   2. useCount ≥ 3 → TTL 면제 (검증된 유용한 tool은 영구 보존)
 *   3. verified=false → 매칭에서 제외 (1회용 검증 실패 tool)
 *   4. 최대 200개 — 초과 시 useCount/createdAt 기준으로 trim
 */

import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { TOOL_REGISTRY_CONFIG } from "@/lib/recommendation/infrastructure/config/runtime-config"

// ── Types ────────────────────────────────────────────────────

export interface ToolParam {
  name: string
  type: "string" | "number"
  description: string
}

export interface ToolEntry {
  id: string
  name: string
  description: string
  triggerPatterns: string[]
  sqlTemplate: string
  params: ToolParam[]
  sourceTable: string
  createdAt: string
  useCount: number
  lastUsedAt: string | null
  verified: boolean
}

// ── Constants ────────────────────────────────────────────────

const REGISTRY_PATH = path.join(process.cwd(), "data", "runtime", "tool-registry.json")
const TOOL_TTL_DAYS = TOOL_REGISTRY_CONFIG.ttlDays
const MIN_USE_FOR_PERMANENT = TOOL_REGISTRY_CONFIG.minUseForPermanent
const MAX_REGISTRY_SIZE = TOOL_REGISTRY_CONFIG.maxSize
const MIN_MATCH_SCORE = TOOL_REGISTRY_CONFIG.minMatchScore

// ── In-memory cache ──────────────────────────────────────────

let cache: ToolEntry[] | null = null
let dirty = false

// ── IO ───────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true })
}

export async function loadRegistry(): Promise<ToolEntry[]> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(REGISTRY_PATH, "utf8")
    const parsed = JSON.parse(raw) as ToolEntry[]
    cache = pruneExpired(parsed)
    cache = enforceMaxSize(cache)
    if (cache.length !== parsed.length) {
      dirty = true
      void saveRegistry()
    }
    return cache
  } catch {
    cache = []
    return cache
  }
}

export async function saveRegistry(): Promise<void> {
  if (!cache || !dirty) return
  await ensureDir()
  await fs.writeFile(REGISTRY_PATH, JSON.stringify(cache, null, 2), "utf8")
  dirty = false
}

// ── Pruning ──────────────────────────────────────────────────

function pruneExpired(entries: ToolEntry[]): ToolEntry[] {
  const cutoff = Date.now() - TOOL_TTL_DAYS * 86_400_000
  return entries.filter(e => {
    if (e.useCount >= MIN_USE_FOR_PERMANENT) return true
    const ts = e.lastUsedAt ?? e.createdAt
    return new Date(ts).getTime() > cutoff
  })
}

function enforceMaxSize(entries: ToolEntry[]): ToolEntry[] {
  if (entries.length <= MAX_REGISTRY_SIZE) return entries
  return [...entries]
    .sort((a, b) => b.useCount - a.useCount || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_REGISTRY_SIZE)
}

// ── Matching ─────────────────────────────────────────────────

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9가-힣\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 2),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersect = 0
  for (const t of a) if (b.has(t)) intersect++
  return intersect / (a.size + b.size - intersect)
}

function scoreMatch(userMessage: string, tool: ToolEntry): number {
  const msgTokens = tokenize(userMessage)
  const triggerTokens = tokenize(tool.triggerPatterns.join(" "))
  const descTokens = tokenize(tool.description)
  // Trigger patterns weight 2x, description 1x
  return jaccard(msgTokens, triggerTokens) * 0.7 + jaccard(msgTokens, descTokens) * 0.3
}

export async function findMatchingTool(userMessage: string): Promise<ToolEntry | null> {
  const registry = await loadRegistry()
  const verified = registry.filter(t => t.verified)
  if (verified.length === 0) return null

  let best: ToolEntry | null = null
  let bestScore = 0
  for (const tool of verified) {
    const score = scoreMatch(userMessage, tool)
    if (score > bestScore) {
      bestScore = score
      best = tool
    }
  }
  return bestScore >= MIN_MATCH_SCORE ? best : null
}

// ── Mutations ────────────────────────────────────────────────

export async function addTool(entry: Omit<ToolEntry, "id" | "createdAt" | "useCount" | "lastUsedAt">): Promise<ToolEntry> {
  const registry = await loadRegistry()
  // Dedupe by description (rough)
  const existing = registry.find(t => t.description === entry.description)
  if (existing) return existing

  const tool: ToolEntry = {
    ...entry,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    useCount: 0,
    lastUsedAt: null,
  }
  registry.push(tool)
  cache = enforceMaxSize(registry)
  dirty = true
  await saveRegistry()
  return tool
}

export async function incrementUseCount(id: string): Promise<void> {
  const registry = await loadRegistry()
  const tool = registry.find(t => t.id === id)
  if (!tool) return
  tool.useCount += 1
  tool.lastUsedAt = new Date().toISOString()
  dirty = true
  await saveRegistry()
}

export async function removeTool(id: string): Promise<void> {
  const registry = await loadRegistry()
  cache = registry.filter(t => t.id !== id)
  dirty = true
  await saveRegistry()
}

// Test helper — clears in-memory cache so tests can rebuild
export function _resetCacheForTest(): void {
  cache = null
  dirty = false
}
