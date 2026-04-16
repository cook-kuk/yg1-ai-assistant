# Filter Field Registry — 등록 규칙

## 필수 원칙

`filter-field-registry.ts` 에 필터 필드를 추가할 때,
**실행 경로가 완결적이어야 한다**. 한 쪽만 구현된 필드는 배포 금지.

CI 가 강제: `__tests__/filter-field-registry-contract.test.ts`

## 필수 체크리스트

신규 필드 추가 시 아래를 **모두** 만족해야 한다:

- [ ] `field`, `kind`, `op` 기본 메타데이터
- [ ] `buildDbClause` — SQL WHERE 절 생성
  - 예외 1: `canonicalField` 로 다른 필드에 위임하는 alias
  - 예외 2: 메타 필드(material 처럼 SCR 가 다른 필드로 fanout 하는 경우) 또는
    upstream enrichment 가 매칭을 담당하는 필드(workPieceName)
- [ ] `extractValues` + `matches` — in-memory scoring 경로
  - 예외: SQL EXISTS 로만 강제되는 virtual-table 필드 (rpm, stockStatus 등).
    이 경우 `virtualTable` 마커 반드시 선언
- [ ] `setInput` + `clearInput` — 쌍으로 (둘 다 있거나 둘 다 없거나)
  - `RecommendationInput` 에 키가 없는 SQL-only 필드라도 no-op 쌍을 두면 됨
- [ ] 사용자 표현용 `queryAliases` (한국어/영어 별칭)
- [ ] `label` — UI 표시용 한국어 라벨

## 예외 등록 방법

의도적으로 일부 메서드를 생략하는 경우, 테스트 파일
`__tests__/filter-field-registry-contract.test.ts` 의 화이트리스트에
**사유 한 줄과 함께** 추가:

```typescript
const DB_CLAUSE_EXEMPT = {
  myField: "왜 buildDbClause 가 없는지 한 줄 설명 (어디서 매칭이 일어나는지 명시)",
}
```

사유 없이 추가하면 stale exemption 검사도 같이 실패한다.

## 현재 등록된 예외

`DB_CLAUSE_EXEMPT`:
- `diameterRefine` — diameterMm 의 alias
- `material` — SCR 가 ISO 그룹 추론으로 workPieceName/materialTags 로 fanout
- `workPieceName` — product enrichment 의 workpieceMatched 플래그로 매칭

`IN_MEMORY_MATCH_EXEMPT`:
- `rpm`, `feedRate`, `cuttingSpeed`, `depthOfCut`, `hasCuttingCondition` — virtual cutting_condition_table
- `stockStatus`, `totalStock` — virtual product_inventory_summary_mv
- `materialTag`, `edpBrandName`, `edpSeriesName` — DB-only identifier 매칭

## 과거 사건

**2026-04 cuttingType 사일런트 버그**: 필드 등록됐지만 `buildDbClause` 누락.
SQL Agent 가 `field:"cuttingType"` 로 emit 해도 WHERE 에 안 들어가,
v5 골든셋에서 "일부통과" 146 건 발생 (material 은 잡히고 cuttingType 은 N/A).

이 contract 테스트는 그런 버그를 **등록 시점에** 차단하기 위해 존재한다.
