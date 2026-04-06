/**
 * Execute with Relaxation — 전략 순서대로 쿼리 실행
 *
 * strict → diameter_near_0_5 → diameter_near_2_0 → drop_operation_shape
 * 0건일 때만 다음 전략으로 이동. 어떤 전략이 선택되었는지 trace 가능.
 */

import type { QuerySpec, QueryConstraint } from "./query-spec"
import { compileProductQuery, type CompiledQuery } from "./compile-product-query"

// ── Types ───────────────────────────────────────────────────

export interface RelaxationResult {
  /** 최종 선택된 전략 */
  strategy: string
  /** 컴파일된 쿼리 */
  compiled: CompiledQuery
  /** 결과 행 수 */
  rowCount: number
  /** 시도한 전략 히스토리 */
  attempts: RelaxationAttempt[]
}

export interface RelaxationAttempt {
  strategy: string
  rowCount: number
  durationMs: number
  /** 이 전략에서 drop된 constraints */
  droppedConstraints: CompiledQuery["droppedConstraints"]
}

// ── Strategy Definitions ────────────────────────────────────

interface RelaxationStrategy {
  name: string
  /** QuerySpec을 전략에 맞게 조정 */
  transform: (spec: QuerySpec) => QuerySpec
  /** compileProductQuery에 전달할 strategy 이름 */
  compileStrategy: string
}

const STRATEGIES: RelaxationStrategy[] = [
  {
    name: "strict",
    transform: (spec) => spec,
    compileStrategy: "strict",
  },
  {
    name: "diameter_near_0_5",
    transform: (spec) => spec,
    compileStrategy: "diameter_near_0_5",
  },
  {
    name: "diameter_near_2_0",
    transform: (spec) => spec,
    compileStrategy: "diameter_near_2_0",
  },
  {
    name: "drop_operation_shape",
    transform: (spec) => ({
      ...spec,
      constraints: spec.constraints.filter(c => c.field !== "operationShape"),
    }),
    compileStrategy: "strict",
  },
]

// ── Executor ────────────────────────────────────────────────

export type QueryExecutor = (sql: string, params: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>

export async function executeWithRelaxation(
  spec: QuerySpec,
  executor: QueryExecutor,
): Promise<RelaxationResult> {
  const hasDiameter = spec.constraints.some(c => c.field === "diameterMm")
  const hasOperationShape = spec.constraints.some(c => c.field === "operationShape")

  // 적용 가능한 전략만 필터링
  const applicableStrategies = STRATEGIES.filter(s => {
    if (s.name.startsWith("diameter_near") && !hasDiameter) return false
    if (s.name === "drop_operation_shape" && !hasOperationShape) return false
    return true
  })

  const attempts: RelaxationAttempt[] = []
  let finalResult: RelaxationResult | null = null

  for (const strategy of applicableStrategies) {
    const transformedSpec = strategy.transform(spec)
    const compiled = compileProductQuery(transformedSpec, strategy.compileStrategy)

    const startMs = Date.now()
    const result = await executor(compiled.sql, compiled.params)
    const durationMs = Date.now() - startMs

    const attempt: RelaxationAttempt = {
      strategy: strategy.name,
      rowCount: result.rowCount,
      durationMs,
      droppedConstraints: compiled.droppedConstraints,
    }
    attempts.push(attempt)

    console.log(`[relaxation] strategy=${strategy.name} rows=${result.rowCount} duration=${durationMs}ms`)

    if (result.rowCount > 0) {
      finalResult = {
        strategy: strategy.name,
        compiled,
        rowCount: result.rowCount,
        attempts,
      }
      break
    }
  }

  // 모든 전략 실패 시 마지막 시도 결과 반환
  if (!finalResult) {
    const lastAttempt = attempts[attempts.length - 1]
    const lastStrategy = applicableStrategies[applicableStrategies.length - 1] ?? STRATEGIES[0]
    finalResult = {
      strategy: lastStrategy.name + "_exhausted",
      compiled: compileProductQuery(lastStrategy.transform(spec), lastStrategy.compileStrategy),
      rowCount: 0,
      attempts,
    }
  }

  return finalResult
}
