#!/usr/bin/env node
/**
 * install-git-hooks.js
 * scripts/git-hooks/* 를 .git/hooks/ 로 복사 (+실행 권한).
 * 사용: node scripts/install-git-hooks.js
 */
const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

const ROOT = execSync("git rev-parse --show-toplevel").toString().trim()
const SRC = path.join(ROOT, "scripts", "git-hooks")
const DST = path.join(ROOT, ".git", "hooks")

if (!fs.existsSync(SRC)) {
  console.error("no source dir:", SRC)
  process.exit(1)
}
fs.mkdirSync(DST, { recursive: true })

for (const name of fs.readdirSync(SRC)) {
  const s = path.join(SRC, name)
  const d = path.join(DST, name)
  fs.copyFileSync(s, d)
  try { fs.chmodSync(d, 0o755) } catch {}
  console.log(`installed: .git/hooks/${name}`)
}
