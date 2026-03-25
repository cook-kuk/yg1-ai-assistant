import { describe, it, expect } from "vitest"
import { generateNLTestReport, formatNLTestReport, type NLTestResult } from "./nl-test-report"

describe("NL Test Report Generator", () => {
  const mockResults: NLTestResult[] = [
    { id: "test-1", category: "multi_entity", severity: "critical", input: "GMG31 vs GMG30", passed: true },
    { id: "test-2", category: "multi_entity", severity: "high", input: "비교해줘", passed: true },
    { id: "test-3", category: "side_question", severity: "critical", input: "사우디 지점", passed: false, error: "missing answer" },
    { id: "test-4", category: "side_question", severity: "medium", input: "전화번호", passed: true },
    { id: "test-5", category: "edge_case", severity: "low", input: "ㅋㅋ", passed: true },
  ]

  it("calculates correct totals", () => {
    const report = generateNLTestReport(mockResults)
    expect(report.total).toBe(5)
    expect(report.passed).toBe(4)
    expect(report.failed).toBe(1)
    expect(report.passRate).toBe(0.8)
  })

  it("groups by category", () => {
    const report = generateNLTestReport(mockResults)
    expect(report.byCategory.multi_entity.total).toBe(2)
    expect(report.byCategory.multi_entity.passed).toBe(2)
    expect(report.byCategory.side_question.total).toBe(2)
    expect(report.byCategory.side_question.passed).toBe(1)
  })

  it("groups by severity", () => {
    const report = generateNLTestReport(mockResults)
    expect(report.bySeverity.critical.total).toBe(2)
    expect(report.bySeverity.critical.passed).toBe(1)
  })

  it("identifies critical failures", () => {
    const report = generateNLTestReport(mockResults)
    expect(report.criticalFailures.length).toBe(1)
    expect(report.criticalFailures[0].id).toBe("test-3")
  })

  it("formats report as readable text", () => {
    const report = generateNLTestReport(mockResults)
    const text = formatNLTestReport(report)
    expect(text).toContain("Pass Rate: 80.0%")
    expect(text).toContain("multi_entity")
    expect(text).toContain("critical")
    expect(text).toContain("test-3")
  })

  it("handles empty results", () => {
    const report = generateNLTestReport([])
    expect(report.total).toBe(0)
    expect(report.passRate).toBe(0)
  })
})
