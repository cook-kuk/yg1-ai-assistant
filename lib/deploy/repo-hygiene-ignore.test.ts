import { readFileSync } from "node:fs"
import path from "node:path"

describe("repo hygiene ignore rules", () => {
  const gitignore = readFileSync(path.resolve(process.cwd(), ".gitignore"), "utf8")

  it("ignores generated benchmark and playwright report directories", () => {
    expect(gitignore).toContain("/benchmark-results/")
    expect(gitignore).toContain("/playwright-report/")
    expect(gitignore).toContain("/test-results/")
  })

  it("ignores ephemeral browser run outputs under test-results", () => {
    expect(gitignore).toContain("test-results/.last-run.json")
    expect(gitignore).toContain("test-results/*-chromium/")
    expect(gitignore).toContain("test-results/*-firefox/")
    expect(gitignore).toContain("test-results/*-webkit/")
  })

  it("ignores root scratch logs, tmp files, backups, and db export zips", () => {
    expect(gitignore).toContain("tmp-*")
    expect(gitignore).toContain("tmp_*.txt")
    expect(gitignore).toContain("*.bak-*")
    expect(gitignore).toContain("db_export.zip")
    expect(gitignore).toContain("qa-full-report-*.xlsx")
  })
})
