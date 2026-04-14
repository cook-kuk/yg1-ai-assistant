import { readFileSync } from "node:fs"
import path from "node:path"

describe("remote deploy script", () => {
  const scriptPath = path.resolve(process.cwd(), "scripts", "remote-deploy.sh")
  const script = readFileSync(scriptPath, "utf8")

  it("uses a deterministic git sync instead of git pull", () => {
    expect(script).toContain('TARGET_BRANCH="${TARGET_BRANCH:?TARGET_BRANCH is required}"')
    expect(script).toContain('git fetch origin "${TARGET_BRANCH}" --prune')
    expect(script).toContain('git checkout -B "${TARGET_BRANCH}" "origin/${TARGET_BRANCH}"')
    expect(script).toContain('git reset --hard "origin/${TARGET_BRANCH}"')
    expect(script).not.toContain("git pull")
    expect(script).not.toContain('TARGET_BRANCH="${TARGET_BRANCH:-main}"')
  })

  it("force-recreates the fixed-name app container without masking failures", () => {
    expect(script).toContain('sudo docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true')
    expect(script).toContain('sudo env APP_MODE="${APP_MODE}" docker compose up --build -d --force-recreate app')
    expect(script).toContain('sudo docker ps --filter "name=^/${CONTAINER_NAME}$"')
    expect(script).not.toContain("| tail")
  })
})
