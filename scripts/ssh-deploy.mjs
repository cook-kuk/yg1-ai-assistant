#!/usr/bin/env node
/**
 * SSH deploy helper for the VM at 20.119.98.136 as user csp.
 * Usage: node scripts/ssh-deploy.mjs [remote-command]
 * Default: deploy the current git branch to ~/yg1-ai-catalog-dev
 *
 * Do not store the SSH password in the repo.
 * Pass it via the SSH_PASS environment variable.
 */
import { Client } from "ssh2"
import { buildRemoteDeployRepoCommand, resolveTargetBranch } from "./deploy-branch.mjs"

const HOST = "20.119.98.136"
const PORT = 22
const USER = "csp"
const PASS = process.env.SSH_PASS || ""
if (!PASS) {
  console.error("SSH_PASS env required")
  process.exit(1)
}
const customCommand = process.argv.slice(2).join(" ")
let CMD = customCommand

if (!CMD) {
  try {
    CMD = buildRemoteDeployRepoCommand({
      repoPath: "~/yg1-ai-catalog-dev",
      appMode: process.env.APP_MODE || "dev",
      targetBranch: resolveTargetBranch(),
    })
  } catch (error) {
    console.error(`[ssh] ${error.message}`)
    process.exit(1)
  }
}

const conn = new Client()
conn.on("ready", () => {
  console.log("[ssh] connected, running:\n  ", CMD)
  conn.exec(CMD, (err, stream) => {
    if (err) { console.error(err); conn.end(); process.exit(1) }
    let out = ""
    stream
      .on("close", (code) => {
        console.log(`\n[ssh] exit code: ${code}`)
        conn.end()
        process.exit(code ?? 0)
      })
      .on("data", (data) => { process.stdout.write(data); out += data.toString() })
      .stderr.on("data", (data) => { process.stderr.write(data) })
  })
}).on("error", (e) => {
  console.error("[ssh] error:", e.message)
  process.exit(1)
}).connect({
  host: HOST,
  port: PORT,
  username: USER,
  password: PASS,
  readyTimeout: 20000,
})
