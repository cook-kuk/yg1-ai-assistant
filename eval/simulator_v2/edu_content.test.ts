// SPDX-License-Identifier: MIT
// 교육 콘텐츠 품질 검증 eval
// 실행: npx vitest run eval/simulator_v2/edu_content.test.ts

import { describe, expect, it } from "vitest"
import { EDUCATION_DB, entriesByCategory } from "../../lib/frontend/simulator/v2/education-content"
import type { EducationEntry } from "../../lib/frontend/simulator/v2/education-content"

const EXPECTED_MIN_COUNTS: Record<EducationEntry["category"], number> = {
  speeds: 10,
  depth: 8,
  "tool-shape": 12,
  material: 15,
  coating: 12,
  machine: 10,
  operation: 12,
  coolant: 7,
  result: 10,
  phenomenon: 8,
  technique: 8,
}

describe("Education DB — 총량 검증", () => {
  it("카테고리별 최소 엔트리 수 충족", () => {
    for (const [cat, min] of Object.entries(EXPECTED_MIN_COUNTS)) {
      const count = entriesByCategory(cat as EducationEntry["category"]).length
      expect(count, `category ${cat}`).toBeGreaterThanOrEqual(min)
    }
  })

  it("전체 ≥ 100 entry", () => {
    expect(Object.keys(EDUCATION_DB).length).toBeGreaterThanOrEqual(100)
  })

  it("id 중복 없음", () => {
    const ids = Object.values(EDUCATION_DB).map(e => e.id)
    const unique = new Set(ids)
    expect(ids.length).toBe(unique.size)
  })
})

describe("Education DB — 필수 필드 검증", () => {
  it("모든 entry가 4 필수 필드 보유", () => {
    for (const [id, entry] of Object.entries(EDUCATION_DB)) {
      expect(entry.id, `${id}.id`).toBe(id)
      expect(entry.korean, `${id}.korean`).toBeTruthy()
      expect(entry.english, `${id}.english`).toBeTruthy()
      expect(entry.category, `${id}.category`).toBeTruthy()
      expect(entry.definition, `${id}.definition`).toBeDefined()
      expect(entry.definition.beginner, `${id}.definition.beginner`).toBeTruthy()
      expect(entry.definition.intermediate, `${id}.definition.intermediate`).toBeTruthy()
      expect(entry.definition.expert, `${id}.definition.expert`).toBeTruthy()
      expect(entry.whyItMatters, `${id}.whyItMatters`).toBeTruthy()
      expect(entry.realWorldExample, `${id}.realWorldExample`).toBeTruthy()
      expect(Array.isArray(entry.relatedConcepts), `${id}.relatedConcepts`).toBe(true)
    }
  })
})

describe("Education DB — 품질 규칙", () => {
  it("beginner 정의 150자 이하 (업계 초심자 이해)", () => {
    const violations: string[] = []
    for (const [id, entry] of Object.entries(EDUCATION_DB)) {
      if (entry.definition.beginner.length > 150) {
        violations.push(`${id} (${entry.definition.beginner.length}자): ${entry.definition.beginner.slice(0, 50)}...`)
      }
    }
    expect(violations, `${violations.length}개 entry가 초과`).toEqual([])
  })

  it("expert 정의는 수치 또는 공식 포함 (정확성)", () => {
    const missing: string[] = []
    const numPattern = /[0-9]/
    for (const [id, entry] of Object.entries(EDUCATION_DB)) {
      if (!numPattern.test(entry.definition.expert)) {
        missing.push(id)
      }
    }
    expect(missing, `expert에 숫자 없는 entry`).toEqual([])
  })

  it("relatedConcepts의 id가 모두 실재 (dead link 방지)", () => {
    const allIds = new Set(Object.keys(EDUCATION_DB))
    const broken: Array<{ from: string; to: string }> = []
    for (const entry of Object.values(EDUCATION_DB)) {
      for (const rel of entry.relatedConcepts) {
        if (!allIds.has(rel)) broken.push({ from: entry.id, to: rel })
      }
    }
    expect(broken, `dead link`).toEqual([])
  })
})
