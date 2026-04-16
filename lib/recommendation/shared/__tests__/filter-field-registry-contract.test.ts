/**
 * Registry Contract Test
 *
 * 목적: 모든 필터 필드가 "LLM 노출 → emit → WHERE 실행 → in-memory scoring"
 * 전 경로를 완결적으로 구현하고 있음을 강제한다.
 *
 * 과거 버그: cuttingType 필드가 registry 에 등록됐지만 buildDbClause 없이
 * 배포돼서 SQL Agent 가 emit 해도 WHERE 에 안 들어가 v5 골든셋 일부통과
 * 146 건 발생. 이 테스트가 있었으면 PR 단계에서 차단됐을 것.
 *
 * 규칙 (CI-enforced):
 * 1) 실제 필터 역할을 하는 필드는 buildDbClause 필수
 * 2) 후보 스코어링 역할이 있는 필드는 extractValues + matches 필수
 * 3) 알려진 예외(canonicalField 로 위임하는 alias)는 화이트리스트 명시
 */

import { describe, it, expect } from "vitest"
import {
  getRegisteredFilterFields,
  getFilterFieldDefinition,
} from "@/lib/recommendation/shared/filter-field-registry"

/**
 * 화이트리스트 — 의도적으로 buildDbClause 를 갖지 않는 필드.
 * 이유를 주석으로 명시해야 하고, 리뷰 없이 추가 금지.
 */
const DB_CLAUSE_EXEMPT: Record<string, string> = {
  // diameterRefine 은 diameterMm 의 alias. canonicalField 로 위임하므로
  // 자체 buildDbClause 불필요. 실행 경로는 diameterMm 이 담당.
  diameterRefine: "alias of diameterMm via canonicalField",
  // material 은 메타 필드 — buildDbClause 대신 SCR 단계에서 inferIsoGroupsFromText 로
  // ISO 그룹을 도출해 workPieceName / materialTags 로 fanout 한다. DB 매칭은 그쪽 경로가
  // 담당. 직접 컬럼이 없어 자체 WHERE 도 불가. (in-memory scoring 도 ISO 그룹 경유라 생략.)
  material: "meta field — fanout to workPieceName/materialTags via ISO group inference",
  // workPieceName 은 product enrichment 단계에서 workpieceMatched 플래그로 매칭한다.
  // matches() 는 그 플래그를 검사하지만 buildDbClause 자체는 enrichment 가 담당하므로
  // registry 가 직접 WHERE 를 만들 필요 없음. extractValues 도 enrichment 산출물이라 생략.
  workPieceName: "matched upstream via product enrichment workpieceMatched flag",
}

/**
 * 화이트리스트 — 의도적으로 in-memory matching 을 갖지 않는 필드.
 * SQL EXISTS 로만 강제되는 virtual-table 필드가 전형적인 경우.
 */
const IN_MEMORY_MATCH_EXEMPT: Record<string, string> = {
  rpm: "virtual cutting_condition_table — SQL EXISTS only",
  feedRate: "virtual cutting_condition_table — SQL EXISTS only",
  cuttingSpeed: "virtual cutting_condition_table — SQL EXISTS only",
  depthOfCut: "virtual cutting_condition_table — SQL EXISTS only",
  stockStatus: "virtual inventory_summary_mv — SQL EXISTS only",
  totalStock: "virtual inventory_summary_mv — SQL EXISTS only",
  hasCuttingCondition: "virtual cutting_condition_table — SQL EXISTS only",
  materialTag: "DB-only overlap on material_tags[]; no in-memory record path",
  edpBrandName: "DB-only identifier match; in-memory uses brand field instead",
  edpSeriesName: "DB-only identifier match; in-memory uses seriesName field instead",
}

describe("filter-field-registry contract", () => {
  const fields = getRegisteredFilterFields()

  it("최소 한 개 이상의 필드가 등록되어 있다 (smoke)", () => {
    expect(fields.length).toBeGreaterThan(0)
  })

  describe.each(fields)("field: %s", (fieldName) => {
    const def = getFilterFieldDefinition(fieldName)

    it("definition 조회 가능", () => {
      expect(def).not.toBeNull()
    })

    it("필수 메타데이터: field, kind, op", () => {
      expect(def?.field).toBe(fieldName)
      expect(def?.kind).toBeTruthy()
      expect(def?.op).toBeTruthy()
    })

    it("buildDbClause 존재 (또는 화이트리스트 사유 명시)", () => {
      if (DB_CLAUSE_EXEMPT[fieldName]) {
        // 사유 문자열이 비어있으면 안 됨 — 왜 면제됐는지 한 줄 설명 필수
        expect(
          DB_CLAUSE_EXEMPT[fieldName].trim(),
          `${fieldName}: DB_CLAUSE_EXEMPT 사유가 비어있음 — 한 줄 설명 필수`
        ).toBeTruthy()
        return
      }
      expect(
        def?.buildDbClause,
        `${fieldName}: buildDbClause 없음. 필터로 emit 돼도 WHERE 안 걸림. ` +
        `의도된 예외면 DB_CLAUSE_EXEMPT 에 사유 주석과 함께 추가할 것.`
      ).toBeDefined()
    })

    it("in-memory scoring 경로 (extractValues + matches) 존재 또는 예외 등록", () => {
      if (IN_MEMORY_MATCH_EXEMPT[fieldName] || DB_CLAUSE_EXEMPT[fieldName]) {
        return
      }
      expect(
        def?.extractValues,
        `${fieldName}: extractValues 없음. in-memory scoring 에서 값을 뽑을 수 없음. ` +
        `SQL-only 필드면 IN_MEMORY_MATCH_EXEMPT 에 사유 주석과 함께 추가할 것.`
      ).toBeDefined()
      expect(
        def?.matches,
        `${fieldName}: matches 없음. in-memory scoring 에서 매칭 불가. ` +
        `SQL-only 필드면 IN_MEMORY_MATCH_EXEMPT 에 사유 주석과 함께 추가할 것.`
      ).toBeDefined()
    })

    it("setInput / clearInput 쌍으로 존재 (둘 다 있거나 둘 다 없거나)", () => {
      const hasSet = typeof def?.setInput === "function"
      const hasClear = typeof def?.clearInput === "function"
      expect(
        hasSet === hasClear,
        `${fieldName}: setInput=${hasSet}, clearInput=${hasClear} — 한 쪽만 있으면 ` +
        `input 상태가 stuck 됨 (set 만 있으면 clear 불가, clear 만 있으면 주입 불가).`
      ).toBe(true)
    })

    it("virtualTable 선언 시 실행 경로 일관성", () => {
      if (!def?.virtualTable) return
      // virtualTable 필드는 buildDbClause 필수 (EXISTS 서브쿼리가 구현되어야 함)
      expect(
        def.buildDbClause,
        `${fieldName}: virtualTable=${def.virtualTable} 선언했는데 buildDbClause 없음. ` +
        `EXISTS 서브쿼리 없으면 virtualTable 마커는 의미 없음.`
      ).toBeDefined()
    })
  })

  it("화이트리스트 필드는 실제로 등록된 필드여야 한다 (stale exemption 방지)", () => {
    const registered = new Set(fields)
    for (const name of Object.keys(DB_CLAUSE_EXEMPT)) {
      expect(
        registered.has(name),
        `DB_CLAUSE_EXEMPT["${name}"] 가 registry 에 없음 — 제거됐는데 예외만 남아있음.`
      ).toBe(true)
    }
    for (const name of Object.keys(IN_MEMORY_MATCH_EXEMPT)) {
      expect(
        registered.has(name),
        `IN_MEMORY_MATCH_EXEMPT["${name}"] 가 registry 에 없음 — 제거됐는데 예외만 남아있음.`
      ).toBe(true)
    }
  })
})
