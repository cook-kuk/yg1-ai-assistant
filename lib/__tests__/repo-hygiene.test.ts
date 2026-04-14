import { readFileSync } from "node:fs"
import path from "node:path"

function readRepoFile(...segments: string[]) {
  return readFileSync(path.resolve(process.cwd(), ...segments), "utf8")
}

describe("repo hygiene", () => {
  test("documents curated fixtures separately from generated results", () => {
    const readme = readRepoFile("README.md")

    expect(readme).toContain("`test-results/`: generated eval/probe artifacts and scratch outputs.")
    expect(readme).toContain("`testset/`: curated fixtures, golden sets, and reusable regression inputs.")
    expect(readme).toContain("Keep curated replay inputs in `testset/` and generated outputs in `test-results/`.")
  })

  test("ignores generated artifacts and root scratch files", () => {
    const gitignore = readRepoFile(".gitignore")

    expect(gitignore).toContain("/test-results/")
    expect(gitignore).toContain("/playwright-report/")
    expect(gitignore).toContain("/benchmark-results/")
    expect(gitignore).toContain("/db_export/")
    expect(gitignore).toContain("tmp-*")
    expect(gitignore).toContain("tmp_*.txt")
    expect(gitignore).toContain("*.bak-*")
    expect(gitignore).toContain("db_export.zip")
    expect(gitignore).toContain("qa-full-report-*.xlsx")
  })

  test("uses testset inputs and test-results outputs consistently", () => {
    const qaRunner = readRepoFile("scripts", "qa-full-runner.js")
    const fetchFeedback = readRepoFile("tools", "fetch-feedback.js")
    const quickRecommend = readRepoFile("tools", "quick-runner-recommend.js")
    const quickQuality = readRepoFile("tools", "quick-runner-quality.js")
    const adaptiveFewShot = readRepoFile("lib", "recommendation", "core", "adaptive-few-shot.ts")

    expect(qaRunner).toContain("const RESULTS_DIR = path.join(__dirname, '..', 'test-results');")
    expect(qaRunner).toContain("path.join(RESULTS_DIR, `qa-full-report-${new Date().toISOString().slice(0, 10)}.xlsx`)")
    expect(fetchFeedback).toContain('path.join(__dirname, "..", "testset", "autohunt", "feedback-cases.json")')
    expect(quickRecommend).toContain('path.join(__dirname, "..", "testset", "autohunt", "feedback-cases.json")')
    expect(quickQuality).toContain('path.join(__dirname, "..", "testset", "autohunt", "feedback-cases.json")')
    expect(adaptiveFewShot).toContain('path.join(process.cwd(), "testset", "golden-set-v1.json")')
  })
})
