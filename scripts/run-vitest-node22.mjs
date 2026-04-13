import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const rawArgs = process.argv.slice(2)
const forwardedArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs
const vitestArgs = forwardedArgs.length > 0 ? forwardedArgs : ["run"]
const vitestEntrypoint = resolve(process.cwd(), "node_modules", "vitest", "vitest.mjs")
const currentMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10)

const command = currentMajor >= 22
  ? process.execPath
  : process.platform === "win32"
    ? "npx.cmd"
    : "npx"
const args = currentMajor >= 22
  ? [vitestEntrypoint, ...vitestArgs]
  : ["-y", "-p", "node@22", "node", vitestEntrypoint, ...vitestArgs]

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: false,
})

if (typeof result.status === "number") {
  process.exit(result.status)
}

process.exit(1)
