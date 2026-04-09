/**
 * QuerySpec — 의미 해석(planner)과 실행(compiler)의 경계 계약
 *
 * 현재 AppliedFilter[]가 동시에 맡고 있는 역할:
 *   - 대화 이력 / 현재 실행 제약 / UI chip 표현 / 복원 단서
 * 를 분리하여, QuerySpec이 "현재 실행 제약"의 진실의 원천(source of truth)이 되도록 한다.
 *
 * 장기 목표:
 *   User Message → Intent Detector → Semantic Planner → QuerySpec
 *     → ConstraintState / Reducer → SQL Compiler → DB Execute → Rank / Explain
 *
 * 현재 단계(Phase 1):
 *   naturalLanguageToQuerySpec → QuerySpec
 *     ├─ querySpecToAppliedFilters (하위 호환 브릿지)
 *     └─ compileProductQuery (신규 deterministic compiler)
 */

// ── Semantic Fields ──────────────────────────────────────────

/** 비즈니스 의미 기반 필드. raw DB column이 아닌 도메인 용어. */
export type QueryField =
  | "materialGroup"    // ISO 분류: P, M, K, N, S, H, O
  | "workpiece"        // 세부 피삭재: Copper, Stainless Steels, ...
  | "toolFamily"       // 대분류: End Mill, Drill, ...
  | "toolSubtype"      // 세부 형상: Square, Ball, Corner Radius, ...
  | "diameterMm"       // 직경 (mm)
  | "fluteCount"       // 날수
  | "coating"          // 코팅: TiAlN, AlCrN, ...
  | "brand"            // 브랜드: TANK-POWER, CRX-S, ...
  | "seriesName"       // 시리즈명: GAA29, ...
  | "operationType"    // 가공 형태: slotting, shouldering, ...
  | "operationShape"   // 가공 형상: pocket, wall, ...
  | "shankType"        // 생크 타입: Plain, Weldon, HA, ...
  | "country"          // 생산국
  | "overallLengthMm"  // 전장 OAL
  | "lengthOfCutMm"    // 날장 LOC / CL
  | "shankDiameterMm"  // 샹크 직경
  | "helixAngleDeg"    // 헬릭스 각도
  | "coolantHole"      // 쿨런트홀 (boolean)
  | "pointAngleDeg"    // 드릴 포인트 각도
  | "threadPitchMm"    // 탭 나사 피치 (mm)

// ── Operators ────────────────────────────────────────────────

export type QueryOp =
  | "eq"        // 정확히 일치
  | "neq"       // 제외
  | "in"        // 여러 값 중 하나
  | "not_in"    // 여러 값 모두 제외
  | "contains"  // 부분 일치 (LIKE)
  | "gte"       // 이상
  | "lte"       // 이하
  | "between"   // 범위

// ── Intent & Navigation ─────────────────────────────────────

/** 사용자의 의도. navigation과 분리. */
export type QueryIntent =
  | "narrow"               // 조건 좁히기 (기본)
  | "show_recommendation"  // 추천 결과 보기
  | "question"             // 질문 (side question)
  | "comparison"           // 비교
  | "general_chat"         // 일반 대화

/** 대화 흐름 제어. field명에 숨기지 않고 별도 필드로 표현. */
export type NavigationAction =
  | "none"   // 탐색 계속
  | "skip"   // 현재 질문 건너뛰기
  | "back"   // 이전 단계
  | "reset"  // 처음부터 다시

// ── Constraint ──────────────────────────────────────────────

export interface QueryConstraint {
  field: QueryField
  op: QueryOp
  value: string | number | [number, number]  // between일 때 [min, max]
  /** planner가 채운 사람 읽을 수 있는 설명 (e.g., "직경: 10mm") */
  display?: string
  /**
   * Phase C: fuzzy / tolerance for numeric eq.
   * When present on an `eq` constraint against a numeric field, the compiler
   * rewrites the clause as `BETWEEN [value - tolerance, value + tolerance]`.
   * Absolute (mm, flutes, ...).
   */
  tolerance?: number
  /**
   * Phase C: proportional tolerance. `0.1` → ±10%.
   * Ignored if `tolerance` is also set (absolute wins).
   */
  toleranceRatio?: number
}

// ── Sort / Similarity (Phase C) ─────────────────────────────

export interface QuerySort {
  field: QueryField
  direction: "asc" | "desc"
}

export interface QuerySimilarity {
  /** EDP product id (or whatever serve-engine uses) for the reference row. */
  referenceProductId: string
  /**
   * Numeric fields to compare. If omitted, compiler falls back to the
   * manifest's `similarityComparable: true` set.
   */
  fields?: QueryField[]
  /** LIMIT for the similarity-ranked result. Default 10 at compile time. */
  topK?: number
}

// ── QuerySpec ───────────────────────────────────────────────

export interface QuerySpec {
  intent: QueryIntent
  navigation: NavigationAction
  constraints: QueryConstraint[]
  /** planner가 side question일 때 채우는 원문 */
  questionText?: string
  /** planner의 판단 근거 (디버그용) */
  reasoning?: string
  /** Phase C: single-key ordering (e.g. "재고 많은 순", "직경 작은 순"). */
  sort?: QuerySort
  /** Phase C: similarity-mode query ("A 제품이랑 비슷한 spec"). */
  similarTo?: QuerySimilarity
  /** Optional row cap applied at compile time. */
  limit?: number
}

// ── Build Result ────────────────────────────────────────────

export interface QuerySpecBuildResult {
  spec: QuerySpec
  /** 원본 LLM 응답 (디버그용) */
  raw: string
  /** planner 실행 시간 (ms) */
  latencyMs: number
}

// ── ConstraintState (Phase 2 준비) ──────────────────────────
// TODO: Phase 2에서 도입. 현재는 AppliedFilter[]가 이 역할을 대행.
// ConstraintState는 active constraints + excludes + pendingField + intent를 통합 관리.
// AppliedFilter[]는 점차 "derived state"로 격하.
//
// export interface ConstraintState {
//   active: QueryConstraint[]
//   excludes: QueryConstraint[]
//   pendingField: QueryField | null
//   intent: QueryIntent
//   turnCount: number
// }
