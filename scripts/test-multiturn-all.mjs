#!/usr/bin/env node
/**
 * test-multiturn-all.mjs
 * 멀티턴/E2E 관련 유닛 테스트 전체 실행 (2,563+ cases)
 *
 * Usage:
 *   npm run test:multiturn          # 멀티턴만
 *   npm run test:multiturn -- --ci  # CI 모드 (실패 시 exit 1 + JSON 리포트)
 *   npm run test:all                # 유닛 전체 + 멀티턴
 */
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

const CI = process.argv.includes("--ci")
const REPORT_PATH = resolve("benchmark-results/multiturn-report.json")

const MULTITURN_FILES = [
  "lib/recommendation/infrastructure/engines/__tests__/multiturn-scenario.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/hard-multiturn-scenarios.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/stress-multiturn-scenarios.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/hardcore-multiturn-200.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/conversation-sim-300.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/filter-pipeline-e2e-150.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/filter-replace-coverage.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/edge-case-attacks-200.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/haiku-intent-200.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/haiku-stress-500.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/haiku-korean-nl-500.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/routing-variance.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/filter-spec-coverage.test.ts",
  "lib/recommendation/infrastructure/engines/__tests__/golden-crxs-copper.test.ts",
  "lib/recommendation/__tests__/golden-scenarios.test.ts",
  "lib/recommendation/__tests__/session-kernel.test.ts",
]

const start = Date.now()

const result = spawnSync(
  "npx",
  ["vitest", "run", ...MULTITURN_FILES, ...(CI ? ["--reporter=json"] : [])],
  { cwd: process.cwd(), stdio: CI ? "pipe" : "inherit", shell: process.platform === "win32" }
)

const elapsed = ((Date.now() - start) / 1000).toFixed(1)

if (CI && result.stdout) {
  try {
    const json = JSON.parse(result.stdout.toString())
    const report = {
      timestamp: new Date().toISOString(),
      durationSec: Number(elapsed),
      files: json.numTotalTestSuites,
      passed: json.numPassedTests,
      failed: json.numFailedTests,
      total: json.numTotalTests,
      success: json.numFailedTests === 0,
    }
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
    console.log(`\n📊 Report saved → ${REPORT_PATH}`)
    console.log(JSON.stringify(report, null, 2))
  } catch {
    console.log(result.stdout.toString())
  }
}

if (!CI) {
  console.log(`\n⏱  Total: ${elapsed}s`)
}

process.exit(typeof result.status === "number" ? result.status : 1)
