// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — 교육 모드 콘텐츠 DB
// 모든 UI 요소/용어에 대한 beginner/intermediate/expert 3단계 설명
//
// 이 파일은 v2 UI에 산재된 모든 기술 용어의 "사전"이다.
// 연구소장 대면 시 "이게 뭔가요?"에 즉답할 수 있도록 정확성 > 간결성 원칙.

export type EducationLevel = "beginner" | "intermediate" | "expert"

export interface EducationEntry {
  id: string                    // 'sfm', 'ipt', 'adoc' 등 고유 키
  korean: string                // "절삭속도 (SFM/Vc)"
  english: string               // "Surface Speed"
  category:                     // 카테고리 (검색/그룹핑용)
    | "speeds"
    | "depth"
    | "tool-shape"
    | "material"
    | "coating"
    | "machine"
    | "operation"
    | "coolant"
    | "result"
    | "phenomenon"
    | "technique"
  definition: {
    beginner: string            // 중고등학생도 이해 가능. 비유·예시. 100자 이하 권장
    intermediate: string        // 업계 용어 허용. 공식 간략 언급
    expert: string              // 공식 완전 + 수치 인용 + 경계조건
  }
  formula?: string              // "Vc [m/min] = (π × D[mm] × n[rpm]) / 1000"
  whyItMatters: string          // 왜 중요한지 (1~2문장)
  realWorldExample: string      // 실전 예시 (숫자 포함 1~2문장)
  commonPitfall?: string        // 흔한 함정 (경고)
  relatedConcepts: string[]     // 관련 entry id 목록
  sourceAuthority?: string      // "Sandvik Coromant Handbook Ch.3" 등
}

export type EducationDb = Record<string, EducationEntry>

// ═══════════════════════════════════════════════════════════════════
// 병합 유틸 — 카테고리별 세트를 하나의 DB로 합침
// ═══════════════════════════════════════════════════════════════════

import { SPEEDS_ENTRIES } from "./edu/speeds"
import { DEPTH_ENTRIES } from "./edu/depth"
import { TOOL_SHAPE_ENTRIES } from "./edu/tool-shape"
import { MATERIAL_ENTRIES } from "./edu/material"
import { COATING_ENTRIES } from "./edu/coating"
import { MACHINE_ENTRIES } from "./edu/machine"
import { OPERATION_ENTRIES } from "./edu/operation"
import { COOLANT_ENTRIES } from "./edu/coolant"
import { RESULT_ENTRIES } from "./edu/result"
import { PHENOMENON_ENTRIES } from "./edu/phenomenon"
import { TECHNIQUE_ENTRIES } from "./edu/technique"

export const EDUCATION_DB: EducationDb = {
  ...SPEEDS_ENTRIES,
  ...DEPTH_ENTRIES,
  ...TOOL_SHAPE_ENTRIES,
  ...MATERIAL_ENTRIES,
  ...COATING_ENTRIES,
  ...MACHINE_ENTRIES,
  ...OPERATION_ENTRIES,
  ...COOLANT_ENTRIES,
  ...RESULT_ENTRIES,
  ...PHENOMENON_ENTRIES,
  ...TECHNIQUE_ENTRIES,
}

export function getEntry(id: string): EducationEntry | undefined {
  return EDUCATION_DB[id]
}

export function searchEntries(query: string): EducationEntry[] {
  const q = query.toLowerCase().trim()
  if (!q) return []
  return Object.values(EDUCATION_DB).filter(e =>
    e.id.toLowerCase().includes(q) ||
    e.korean.toLowerCase().includes(q) ||
    e.english.toLowerCase().includes(q)
  )
}

export function entriesByCategory(category: EducationEntry["category"]): EducationEntry[] {
  return Object.values(EDUCATION_DB).filter(e => e.category === category)
}
