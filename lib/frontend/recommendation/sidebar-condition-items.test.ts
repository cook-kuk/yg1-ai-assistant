import { describe, expect, it } from "vitest"

import type { RecommendationPublicSessionDto } from "@/lib/contracts/recommendation"
import { buildSidebarConditionItems } from "@/lib/frontend/recommendation/sidebar-condition-items"
import { INITIAL_INTAKE_FORM, type ProductIntakeForm } from "@/lib/frontend/recommendation/intake-types"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

function makeForm(overrides: Partial<ProductIntakeForm> = {}): ProductIntakeForm {
  return {
    ...INITIAL_INTAKE_FORM,
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "known", value: "비철금속" },
    operationType: { status: "known", value: "Side Milling" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "known", value: "6mm" },
    ...overrides,
  }
}

function makeSessionState(
  filters: RecommendationPublicSessionDto["appliedFilters"] = []
): RecommendationPublicSessionDto {
  return {
    sessionId: "session-1",
    candidateCount: 12,
    appliedFilters: filters,
    narrowingHistory: [],
    resolutionStatus: "narrowing",
    turnCount: 1,
    lastAskedField: null,
    lastAction: "continue_narrowing",
    displayedChips: [],
    displayedOptions: [],
    displayedSeriesGroups: [],
    uiNarrowingPath: [],
    currentMode: "narrowing",
    activeGroupKey: null,
    currentTask: null,
    taskHistory: [],
    capabilities: {
      canCompare: true,
      canRestoreTask: false,
      canGroupBySeries: false,
      canFilterDisplayed: true,
    },
  }
}

describe("buildSidebarConditionItems", () => {
  it("replaces raw diameter input with the actual applied diameter filter", () => {
    const items = buildSidebarConditionItems(
      makeForm(),
      makeSessionState([
        { field: "diameterMm", op: "eq", value: "4mm", rawValue: 4, appliedAt: 1 },
      ]),
      null,
      "ko"
    )

    const diameterItems = items.filter(item => item.label === "공구 직경")

    expect(diameterItems).toHaveLength(1)
    expect(diameterItems[0]).toMatchObject({
      value: "4mm",
      source: "filter",
    })
  })

  it("replaces the base material item when a material filter is applied", () => {
    const items = buildSidebarConditionItems(
      makeForm(),
      makeSessionState([
        { field: "material", op: "eq", value: "알루미늄", rawValue: "aluminum", appliedAt: 1 },
      ]),
      null,
      "ko"
    )

    const materialItems = items.filter(item => item.label === "가공 소재")

    expect(materialItems).toHaveLength(1)
    expect(materialItems[0]).toMatchObject({
      value: "알루미늄",
      source: "filter",
    })
  })

  it("uses resolved input to normalize the displayed diameter value", () => {
    const engineSessionState = {
      resolvedInput: { diameterMm: 6.35 },
    } as ExplorationSessionState

    const items = buildSidebarConditionItems(
      makeForm({
        diameterInfo: { status: "known", value: "1/4인치" },
      }),
      makeSessionState(),
      engineSessionState,
      "ko"
    )

    expect(items.find(item => item.label === "공구 직경")?.value).toBe("6.35mm")
  })

  it("shows Turning when the stored machining category value is Tooling System", () => {
    const items = buildSidebarConditionItems(
      makeForm({
        toolTypeOrCurrentProduct: { status: "known", value: "Tooling System" },
      }),
      makeSessionState(),
      {
        resolvedInput: { toolType: "Tooling System" },
      } as ExplorationSessionState,
      "ko"
    )

    expect(items.find(item => item.label === "가공 방식")?.value).toBe("Turning")
  })
})
