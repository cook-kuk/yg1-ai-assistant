/**
 * Self-Correction Loop — 0건 결과 자동 교정. 하드코딩 0.
 *
 * 3단계 (최대):
 * 1. LLM 재진단 — DB sample values 보고 값/op 자동 수정 (haiku)
 * 2. eq → like 완화 — 스키마에서 text 컬럼 자동 판단
 * 3. 마지막 적용 필터 제거 — appliedAt 순서 기반
 *
 * executor는 caller가 주입 (e.g. runHybridRetrieval(input, filters))로
 * 0건 → 자동 교정 → retrieval 재실행 사이클을 closure로 감싼다.
 */

import type { LLMProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { AppliedFilter } from "@/lib/types/exploration"
import { getDbSchemaSync } from "./sql-agent-schema-cache"

export interface CorrectionAttempt {
  step: number
  strategy: "llm_rewrite" | "eq_to_like" | "drop_last"
  resultCount: number
  reasoning: string
  durationMs: number
}

export interface CorrectionResult {
  success: boolean
  finalFilters: AppliedFilter[]
  attempts: CorrectionAttempt[]
  totalDurationMs: number
  explanation: string | null
}

export type RetrievalExecutor = (filters: AppliedFilter[]) => Promise<number>

export async function selfCorrectFilters(
  userMessage: string,
  filters: AppliedFilter[],
  provider: LLMProvider,
  executor: RetrievalExecutor,
): Promise<CorrectionResult> {
  const t0 = Date.now()
  const attempts: CorrectionAttempt[] = []
  let current = [...filters]

  for (let step = 0; step < 3; step++) {
    const st = Date.now()
    let next: AppliedFilter[] | null = null
    let reasoning = ""
    let strategy: CorrectionAttempt["strategy"] = "llm_rewrite"

    if (step === 0) {
      strategy = "llm_rewrite"
      const schema = getDbSchemaSync()
      const diag = current.map(f => {
        const col = f.rawSqlField ?? f.field
        return {
          field: f.field, col,
          op: f.rawSqlOp ?? f.op,
          value: f.rawValue ?? f.value,
          dbSamples: schema ? (schema.sampleValues[col] ?? []).slice(0, 15) : [],
          range: schema?.numericStats[col] ? `${schema.numericStats[col].min}~${schema.numericStats[col].max}` : null,
        }
      })
      try {
        const raw = await provider.complete(
          `0건 결과 진단. 사용자 메시지: "${userMessage}"\n현재 필터:\n${JSON.stringify(diag, null, 2)}\n\n각 필터의 DB 실제 sample values를 확인하고 수정안을 제시:\n- eq인데 sample과 일치 안 하면 like로\n- 숫자 필터가 너무 좁으면 between ±10%\n- 값이 sample에 아예 없으면 가장 가까운 값으로\n\n출력은 JSON 한 줄만 (markdown fence 금지):\n{"reasoning":"한국어 1문장","filters":[{"field":"...","op":"eq|neq|like|gte|lte|between","value":"...","value2":"..."}]}`,
          [{ role: "user", content: "수정안을 출력하세요." }],
          600,
          "haiku",
          "self-correction",
        )
        const match = raw.match(/\{[\s\S]*\}/)
        if (match) {
          const p = JSON.parse(match[0])
          if (Array.isArray(p.filters) && p.filters.length > 0) {
            next = p.filters.map((f: any, i: number) => ({
              field: f.field,
              op: f.op ?? "eq",
              value: String(f.value ?? ""),
              rawValue: f.value,
              rawValue2: f.value2,
              appliedAt: current[i]?.appliedAt ?? 0,
              rawSqlField: f.field,
              rawSqlOp: f.op ?? "eq",
            } as AppliedFilter))
            reasoning = String(p.reasoning ?? "LLM 재진단")
          }
        }
      } catch { /* fall through to next step */ }
    } else if (step === 1) {
      strategy = "eq_to_like"
      const schema = getDbSchemaSync()
      const changed: string[] = []
      next = current.map(f => {
        const col = f.rawSqlField ?? f.field
        const meta = schema?.columns.find(c => c.column_name === col)
        const isText = !meta || /char|text|varchar/i.test(meta.data_type)
        if (f.op === "eq" && isText && typeof f.rawValue === "string") {
          changed.push(f.field)
          return { ...f, op: "includes", rawSqlOp: "like" } as AppliedFilter
        }
        return f
      })
      if (changed.length === 0) { next = null; continue }
      reasoning = `부분 일치로 완화: ${changed.join(", ")}`
    } else {
      strategy = "drop_last"
      if (current.length <= 1) continue
      const sorted = [...current].sort((a, b) => (b.appliedAt ?? 0) - (a.appliedAt ?? 0))
      const dropped = sorted[0]!
      next = current.filter(f => f !== dropped)
      reasoning = `'${dropped.field}' 조건 제외`
    }

    if (!next) continue
    let count = 0
    try {
      count = await executor(next)
    } catch (e) {
      console.warn(`[self-correction] executor failed at step ${step + 1}:`, (e as Error).message)
      continue
    }
    attempts.push({ step: step + 1, strategy, resultCount: count, reasoning, durationMs: Date.now() - st })
    current = next
    if (count > 0) {
      return {
        success: true,
        finalFilters: current,
        attempts,
        totalDurationMs: Date.now() - t0,
        explanation: `🔧 자동 교정: ${reasoning}`,
      }
    }
  }

  return {
    success: false,
    finalFilters: current,
    attempts,
    totalDurationMs: Date.now() - t0,
    explanation: "조건을 여러 번 완화했지만 일치하는 제품을 찾지 못했습니다.",
  }
}
