/**
 * NL Test Report Generator
 * Generates structured reports for natural language test suite results.
 */

export interface NLTestResult {
  id: string
  category: string
  severity: "critical" | "high" | "medium" | "low"
  input: string
  passed: boolean
  error?: string
  durationMs?: number
}

export interface NLTestReport {
  timestamp: string
  total: number
  passed: number
  failed: number
  errors: number
  passRate: number
  byCategory: Record<string, { total: number; passed: number; rate: number }>
  bySeverity: Record<string, { total: number; passed: number; rate: number }>
  failedCases: NLTestResult[]
  criticalFailures: NLTestResult[]
}

export function generateNLTestReport(results: NLTestResult[]): NLTestReport {
  const total = results.length
  const passed = results.filter(r => r.passed).length
  const errors = results.filter(r => !!r.error).length
  const failed = total - passed

  // By category
  const categories = [...new Set(results.map(r => r.category))]
  const byCategory: Record<string, { total: number; passed: number; rate: number }> = {}
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat)
    const catPassed = catResults.filter(r => r.passed).length
    byCategory[cat] = {
      total: catResults.length,
      passed: catPassed,
      rate: catResults.length > 0 ? catPassed / catResults.length : 0,
    }
  }

  // By severity
  const severities = ["critical", "high", "medium", "low"] as const
  const bySeverity: Record<string, { total: number; passed: number; rate: number }> = {}
  for (const sev of severities) {
    const sevResults = results.filter(r => r.severity === sev)
    const sevPassed = sevResults.filter(r => r.passed).length
    bySeverity[sev] = {
      total: sevResults.length,
      passed: sevPassed,
      rate: sevResults.length > 0 ? sevPassed / sevResults.length : 0,
    }
  }

  const failedCases = results.filter(r => !r.passed)
  const criticalFailures = failedCases.filter(r => r.severity === "critical")

  return {
    timestamp: new Date().toISOString(),
    total,
    passed,
    failed,
    errors,
    passRate: total > 0 ? passed / total : 0,
    byCategory,
    bySeverity,
    failedCases,
    criticalFailures,
  }
}

export function formatNLTestReport(report: NLTestReport): string {
  const lines: string[] = []

  lines.push("═══════════════════════════════════════")
  lines.push("YG-1 ARIA Natural Language Test Report")
  lines.push("═══════════════════════════════════════")
  lines.push("")
  lines.push(`Total: ${report.total} | Passed: ${report.passed} | Failed: ${report.failed} | Errors: ${report.errors}`)
  lines.push(`Pass Rate: ${(report.passRate * 100).toFixed(1)}%`)
  lines.push("")
  lines.push("By Category:")
  for (const [cat, stats] of Object.entries(report.byCategory)) {
    const pct = (stats.rate * 100).toFixed(0)
    const pad = cat.padEnd(18)
    lines.push(`  ${pad} ${stats.passed}/${stats.total}  (${pct}%)`)
  }
  lines.push("")
  lines.push("By Severity:")
  for (const [sev, stats] of Object.entries(report.bySeverity)) {
    if (stats.total === 0) continue
    const pct = (stats.rate * 100).toFixed(0)
    const pad = sev.padEnd(10)
    const marker = sev === "critical" && stats.rate < 0.95 ? " ← 최우선 수정 대상" : ""
    lines.push(`  ${pad} ${stats.passed}/${stats.total}  (${pct}%)${marker}`)
  }

  if (report.failedCases.length > 0) {
    lines.push("")
    lines.push("Failed Cases:")
    for (const fc of report.failedCases.slice(0, 20)) {
      const marker = fc.severity === "critical" ? "🔴" : fc.severity === "high" ? "🟠" : "🟡"
      const err = fc.error ? ` — ${fc.error}` : ""
      lines.push(`  ${marker} ${fc.id} [${fc.severity}]${err}`)
    }
    if (report.failedCases.length > 20) {
      lines.push(`  ... and ${report.failedCases.length - 20} more`)
    }
  }

  return lines.join("\n")
}
