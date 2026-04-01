"use client"

import { useState } from "react"

import type { AnswerState, ProductIntakeForm } from "@/lib/frontend/recommendation/intake-types"
import {
  resolveCompetitorSpec,
  type CompetitorSpec,
} from "@/lib/frontend/recommendation/competitor-spec-resolver"

function getDefaultOperation(opType: string | null): string | null {
  switch (opType) {
    case "Milling": return "Side_Milling"
    case "Holemaking": return "Drilling"
    case "Threading": return "Threading_Blind"
    case "Turning": return "ISO_Turning"
    default: return null
  }
}

export function useCompetitorSpec(
  onFormChange: (key: keyof ProductIntakeForm, val: AnswerState<string>) => void,
) {
  const [isResolving, setIsResolving] = useState(false)
  const [resolvedSpec, setResolvedSpec] = useState<CompetitorSpec | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)

  const resolveSpec = async (modelName: string) => {
    setIsResolving(true)
    setResolveError(null)
    setResolvedSpec(null)

    const result = await resolveCompetitorSpec(modelName)

    if (result.success && result.spec) {
      const spec = result.spec
      setResolvedSpec(spec)

      // Auto-fill form fields
      if (spec.diameterMm != null) {
        onFormChange("diameterInfo", { status: "known", value: `${spec.diameterMm}mm` })
      }
      if (spec.isoMaterial.length > 0) {
        onFormChange("material", { status: "known", value: spec.isoMaterial.join(",") })
      }
      if (spec.operationType) {
        const op = getDefaultOperation(spec.operationType)
        if (op) {
          onFormChange("operationType", { status: "known", value: op })
        }
      }
    } else {
      setResolveError(result.error ?? "스펙을 찾지 못했습니다")
    }

    setIsResolving(false)
  }

  const clearSpec = () => {
    setResolvedSpec(null)
    setResolveError(null)
  }

  return { isResolving, resolvedSpec, resolveError, resolveSpec, clearSpec }
}
