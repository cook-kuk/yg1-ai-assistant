#!/usr/bin/env node
/**
 * SSH 기반 배포 트리거 — 20.119.98.136 csp user.
 * 사용: node scripts/ssh-deploy.mjs [remote-command]
 *   기본: cd ~/yg1-ai-catalog-dev && git pull && docker compose up -d --build
 * 출력: stdout/stderr 실시간 tail.
 *
 * 비번은 reference_ssh_deploy_server.md 에 기록된 값을 사용 — repo에 평문
 * 저장 금지, 호출 시 env SSH_PASS 또는 memory에서 읽는 것이 원칙.
 */
import { Client } from "ssh2"

const HOST = "20.119.98.136"
const PORT = 22
const USER = "csp"
const PASS = process.env.SSH_PASS || ""
if (!PASS) {
  console.error("SSH_PASS env required")
  process.exit(1)
}
const CMD = process.argv.slice(2).join(" ") ||
  "cd ~/yg1-ai-catalog-dev && git fetch --all && git reset --hard origin/main && docker compose up -d --build 2>&1 | tail -120"

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
