import { cpSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawn } from "node:child_process"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, "..")
const nextDir = path.join(rootDir, ".next")
const standaloneDir = path.join(nextDir, "standalone")
const standaloneServer = path.join(standaloneDir, "server.js")
const standaloneNextDir = path.join(standaloneDir, ".next")
const standaloneStaticDir = path.join(standaloneNextDir, "static")
const buildStaticDir = path.join(nextDir, "static")
const publicDir = path.join(rootDir, "public")
const standalonePublicDir = path.join(standaloneDir, "public")

function copyRecursive(source, target) {
  cpSync(source, target, {
    recursive: true,
    force: true,
  })
}

if (!existsSync(standaloneServer)) {
  console.error("[start-standalone] Missing .next/standalone/server.js. Run `npm run build` first.")
  process.exit(1)
}

mkdirSync(standaloneNextDir, { recursive: true })

if (existsSync(buildStaticDir)) {
  copyRecursive(buildStaticDir, standaloneStaticDir)
}

if (existsSync(publicDir)) {
  copyRecursive(publicDir, standalonePublicDir)
}

const child = spawn(process.execPath, [standaloneServer], {
  cwd: standaloneDir,
  stdio: "inherit",
  env: process.env,
})

child.on("exit", code => {
  process.exit(code ?? 0)
})

child.on("error", error => {
  console.error("[start-standalone] Failed to launch standalone server:", error)
  process.exit(1)
})
