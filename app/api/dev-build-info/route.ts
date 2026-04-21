import { NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"

// Dev-only helper. Returns the max mtime across the source directories that
// actually drive UI behavior (app/, lib/, components/, hooks/, styles/). The
// /products page reads this on mount so "Code updated" reflects the last
// real edit rather than the current wall clock. Production bundles still use
// NEXT_PUBLIC_BUILD_TIMESTAMP (baked at build time), so this route is a
// NO-OP in prod — returns { stamp: null } to signal "prefer the env var".
//
// Only the directory roots are crawled (not node_modules / .next / dist) so
// the walk stays O(source-file-count) and finishes in <200ms on this repo.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PROJECT_ROOT = process.cwd()
const SCAN_DIRS = ["app", "lib", "components", "hooks", "styles", "python-api"]
const SKIP_DIR_NAMES = new Set([
  "node_modules", ".next", ".git", "__pycache__", "dist",
  "build", ".venv", "venv", ".turbo",
])
// Extensions that imply a behavior change worth surfacing. Skips .md / logs /
// lockfiles so a README tweak doesn't bump the timestamp.
const TRACKED_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".css", ".scss",
])

async function walkMaxMtime(dir: string): Promise<number> {
  let max = 0
  let entries: import("fs").Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue
    if (SKIP_DIR_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = await walkMaxMtime(full)
      if (sub > max) max = sub
      continue
    }
    if (!entry.isFile()) continue
    const ext = path.extname(entry.name).toLowerCase()
    if (!TRACKED_EXT.has(ext)) continue
    try {
      const stat = await fs.stat(full)
      const ms = stat.mtimeMs
      if (ms > max) max = ms
    } catch {
      // concurrent edit / permission — ignore and keep scanning.
    }
  }
  return max
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ stamp: null, mode: "prod" })
  }
  const start = Date.now()
  const mtimes = await Promise.all(
    SCAN_DIRS.map(d => walkMaxMtime(path.join(PROJECT_ROOT, d))),
  )
  const maxMs = Math.max(...mtimes, 0)
  const stamp = maxMs > 0
    ? new Date(maxMs).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : null
  return NextResponse.json({
    stamp,
    scannedMs: Date.now() - start,
    mode: "dev",
  })
}
