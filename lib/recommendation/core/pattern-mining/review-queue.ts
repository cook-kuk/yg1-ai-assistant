/**
 * Pattern Mining — Review Queue
 *
 * 후보를 pending/approved/rejected로 관리하는 JSON 파일 기반 큐.
 * Dedupe 지원. 오프라인 배치 전용.
 */

import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import type { ReviewQueue, PatternCandidate, AliasCandidate } from "./types"

const QUEUE_FILE = path.join(process.cwd(), "data", "pattern-review-queue.json")

// ── Read / Write ────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  const dir = path.dirname(QUEUE_FILE)
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
}

export async function readQueue(): Promise<ReviewQueue> {
  if (!existsSync(QUEUE_FILE)) {
    return { pending: [], approved: [], rejected: [], lastUpdated: new Date().toISOString() }
  }
  const raw = await readFile(QUEUE_FILE, "utf-8")
  return JSON.parse(raw) as ReviewQueue
}

export async function writeQueue(queue: ReviewQueue): Promise<void> {
  await ensureDir()
  queue.lastUpdated = new Date().toISOString()
  await writeFile(QUEUE_FILE, JSON.stringify(queue, null, 2), "utf-8")
}

// ── Add Candidate (with dedupe) ─────────────────────────────

/**
 * pending에 후보 추가. 동일 id가 이미 있으면 supportCount와 lastSeenAt만 업데이트.
 * approved/rejected에 이미 있으면 추가하지 않음.
 */
export async function addCandidate(
  candidate: PatternCandidate | AliasCandidate,
): Promise<{ added: boolean; reason: string }> {
  const queue = await readQueue()

  // Already approved or rejected → skip
  if (queue.approved.some(c => c.id === candidate.id)) {
    return { added: false, reason: "already approved" }
  }
  if (queue.rejected.some(c => c.id === candidate.id)) {
    return { added: false, reason: "already rejected" }
  }

  // Already pending → update support count
  const existing = queue.pending.find(c => c.id === candidate.id)
  if (existing) {
    existing.supportCount = Math.max(existing.supportCount, candidate.supportCount)
    existing.confidence = Math.max(existing.confidence, candidate.confidence)
    existing.lastSeenAt = candidate.lastSeenAt
    await writeQueue(queue)
    return { added: false, reason: "updated existing pending" }
  }

  // New candidate
  queue.pending.push(candidate)
  await writeQueue(queue)
  return { added: true, reason: "added to pending" }
}

// ── Approve / Reject ────────────────────────────────────────

export async function approveCandidate(id: string): Promise<boolean> {
  const queue = await readQueue()
  const idx = queue.pending.findIndex(c => c.id === id)
  if (idx < 0) return false
  const [candidate] = queue.pending.splice(idx, 1)
  queue.approved.push(candidate)
  await writeQueue(queue)
  return true
}

export async function rejectCandidate(id: string): Promise<boolean> {
  const queue = await readQueue()
  const idx = queue.pending.findIndex(c => c.id === id)
  if (idx < 0) return false
  const [candidate] = queue.pending.splice(idx, 1)
  queue.rejected.push(candidate)
  await writeQueue(queue)
  return true
}

// ── Query ───────────────────────────────────────────────────

export async function getPendingCandidates(): Promise<Array<PatternCandidate | AliasCandidate>> {
  const queue = await readQueue()
  return queue.pending
}

export async function getApprovedCandidates(): Promise<Array<PatternCandidate | AliasCandidate>> {
  const queue = await readQueue()
  return queue.approved
}
