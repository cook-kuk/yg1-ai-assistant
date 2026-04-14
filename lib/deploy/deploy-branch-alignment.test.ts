import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const deployBranchModuleUrl = pathToFileURL(
  path.resolve(process.cwd(), "scripts", "deploy-branch.mjs"),
).href

describe("deploy branch alignment", () => {
  it("prefers explicit TARGET_BRANCH over git inspection", async () => {
    const { resolveTargetBranch } = await import(deployBranchModuleUrl)
    const exec = vi.fn(() => "ignored\n")

    expect(resolveTargetBranch({ env: { TARGET_BRANCH: "release/20260414" }, exec })).toBe(
      "release/20260414",
    )
    expect(exec).not.toHaveBeenCalled()
  })

  it("falls back to the current git branch and rejects detached HEAD", async () => {
    const { getCurrentGitBranch, resolveTargetBranch } = await import(deployBranchModuleUrl)

    const exec = vi.fn(() => "20260414\n")
    expect(resolveTargetBranch({ env: {}, exec })).toBe("20260414")
    expect(exec).toHaveBeenCalledWith("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" })

    expect(() => getCurrentGitBranch({ exec: () => "HEAD\n" })).toThrow(
      /set TARGET_BRANCH explicitly/i,
    )
  })

  it("routes deploy callers through the selected branch instead of hardcoded main", () => {
    const autohuntScript = readFileSync(
      path.resolve(process.cwd(), "scripts", "autohunt-loop.mjs"),
      "utf8",
    )
    const sshDeployScript = readFileSync(
      path.resolve(process.cwd(), "scripts", "ssh-deploy.mjs"),
      "utf8",
    )

    expect(autohuntScript).toContain("git push origin HEAD:${targetBranch}")
    expect(autohuntScript).toContain("git push company HEAD:${targetBranch}")
    expect(autohuntScript).not.toContain("git push origin main")
    expect(autohuntScript).not.toContain("git push company main")
    expect(sshDeployScript).not.toContain("TARGET_BRANCH=main")
  })
})
