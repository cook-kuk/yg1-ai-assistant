import { spawnSync } from "node:child_process"

const rawArgs = process.argv.slice(2)
const forwardedArgs = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs
const vitestArgs = forwardedArgs.length > 0 ? forwardedArgs : ["run"]

const result = spawnSync(
  "npx",
  ["-p", "node@22", "node", "./node_modules/vitest/vitest.mjs", ...vitestArgs],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
  }
)

if (typeof result.status === "number") {
  process.exit(result.status)
}

process.exit(1)
