import { execSync } from "node:child_process"

export function getCurrentGitBranch({ exec = execSync } = {}) {
  const branch = exec("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim()
  if (!branch || branch === "HEAD") {
    throw new Error("Unable to determine current git branch; set TARGET_BRANCH explicitly.")
  }
  return branch
}

export function resolveTargetBranch({ env = process.env, exec = execSync } = {}) {
  const explicitBranch = env.TARGET_BRANCH?.trim()
  if (explicitBranch) {
    return explicitBranch
  }
  return getCurrentGitBranch({ exec })
}

export function buildRemoteDeployCommand({ appMode = "dev", targetBranch }) {
  const branch = targetBranch?.trim()
  if (!branch) {
    throw new Error("targetBranch is required")
  }
  return `APP_MODE=${JSON.stringify(appMode)} TARGET_BRANCH=${JSON.stringify(branch)} bash scripts/remote-deploy.sh`
}

export function buildRemoteDeployRepoCommand({
  repoPath = "~/yg1-ai-catalog-dev",
  appMode = "dev",
  targetBranch,
}) {
  return `cd ${repoPath} && ${buildRemoteDeployCommand({ appMode, targetBranch })}`
}
