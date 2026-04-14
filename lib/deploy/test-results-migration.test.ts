import { readFileSync } from "node:fs"
import path from "node:path"

function readRepoFile(...segments: string[]) {
  return readFileSync(path.resolve(process.cwd(), ...segments), "utf8")
}

describe("test-results migration", () => {
  it("keeps generated outputs in test-results and curated inputs in testset", () => {
    const autoRunner = readRepoFile("scripts", "auto-test-runner.js")
    const qaRunner = readRepoFile("scripts", "qa-full-runner.js")
    const threadRunner = readRepoFile("scripts", "run-thread-fixtures.js")
    const goldenRunner = readRepoFile("scripts", "golden-multiturn-runner.mjs")
    const feedbackExtractor = readRepoFile("scripts", "extract-goldset-from-feedback.mjs")
    const fullReport = readRepoFile("scripts", "gen-full-test-report.js")
    const qaTrackingReport = readRepoFile("scripts", "gen-qa-tracking-report.js")
    const adaptiveFewShot = readRepoFile("lib", "recommendation", "core", "adaptive-few-shot.ts")
    expect(autoRunner).toContain("path.join(__dirname, '..', 'test-results')")
    expect(qaRunner).toContain("path.join(__dirname, '..', 'testset', 'golden-set-v1.json')")
    expect(qaRunner).toContain("const RESULTS_DIR = path.join(__dirname, '..', 'test-results');")
    expect(qaRunner).toContain("path.join(RESULTS_DIR, `qa-full-report-${new Date().toISOString().slice(0, 10)}.xlsx`)")
    expect(threadRunner).toContain('path.join(__dirname, "..", "testset", "thread-fixtures")')
    expect(threadRunner).toContain('path.join(__dirname, "..", "test-results")')
    expect(goldenRunner).toContain('path.join(process.cwd(), "testset", "golden-set-extra-hard.json")')
    expect(feedbackExtractor).toContain('const OUT = process.argv[3] || "testset/goldset/from-feedback.json"')
    expect(fullReport).toContain("path.join(__dirname, '..', 'testset', 'golden-set-v1.json')")
    expect(qaTrackingReport).toContain("const TESTSET_DIR = path.join(__dirname, '..', 'testset');")
    expect(qaTrackingReport).toContain("readJSON(path.join(TESTSET_DIR, 'golden-set-v1.json'))")
    expect(adaptiveFewShot).toContain('path.join(process.cwd(), "testset", "golden-set-v1.json")')
  })
})
