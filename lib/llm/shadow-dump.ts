/**
 * Shadow dump — when OPENAI_SHADOW=true, agents that have openai routing
 * configured run BOTH providers (production response from Claude, OpenAI
 * fired in background) and append the paired outputs to a JSONL file. The
 * diff script in test-results/_shadow-diff.mjs reads this file and reports
 * per-agent agreement rates between the two providers.
 *
 * Append-only, fire-and-forget. No throw — shadow failures must not affect
 * the main request.
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import crypto from "node:crypto"

const DUMP_PATH = path.join(process.cwd(), "test-results", "_shadow-dump.jsonl")

export interface ShadowEntry {
  ts: string
  agent: string | null
  inputHash: string
  claude: { model: string; output: string; durMs: number; error?: string }
  openai: { model: string; output: string; durMs: number; error?: string }
}

export function isShadowEnabled(): boolean {
  return process.env.OPENAI_SHADOW === "true"
}

export function hashInput(systemPrompt: string, messages: Array<{ role: string; content: string }>): string {
  const h = crypto.createHash("sha256")
  h.update(systemPrompt)
  for (const m of messages) { h.update("|"); h.update(m.role); h.update(":"); h.update(m.content) }
  return h.digest("hex").slice(0, 16)
}

export async function appendShadowEntry(entry: ShadowEntry): Promise<void> {
  try {
    await fs.appendFile(DUMP_PATH, JSON.stringify(entry) + "\n", "utf8")
  } catch (err) {
    console.warn("[shadow-dump] append failed (ignored):", (err as Error).message)
  }
}
