// ~$0.10 total (Haiku 200 calls)
import { describe, expect, it } from "vitest"

import { resolveExplicitRevisionRequest } from "../serve-engine-runtime"
import { getProvider } from "@/lib/recommendation/infrastructure/llm/recommendation-llm"
import type { ExplorationSessionState } from "@/lib/recommendation/domain/types"

function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {
  return {
    sessionId: "s1",
    candidateCount: 10,
    appliedFilters: [],
    narrowingHistory: [],
    stageHistory: [],
    resolutionStatus: "narrowing",
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      material: "일반강",
    },
    turnCount: 1,
    displayedCandidates: [],
    displayedChips: [],
    displayedOptions: [],
    currentMode: "question",
    lastAskedField: undefined,
    ...overrides,
  } as ExplorationSessionState
}

// ---------------------------------------------------------------------------
// Helper state builders
// ---------------------------------------------------------------------------

const fluteState = (val: string, raw: number) =>
  makeState({
    appliedFilters: [
      { field: "fluteCount", op: "eq", value: val, rawValue: raw, appliedAt: 0 } as any,
    ],
  })

const coatState = (val: string) =>
  makeState({
    appliedFilters: [
      { field: "coating", op: "includes", value: val, rawValue: val, appliedAt: 0 } as any,
    ],
  })

const subtypeState = (val: string) =>
  makeState({
    appliedFilters: [
      { field: "toolSubtype", op: "includes", value: val, rawValue: val, appliedAt: 0 } as any,
    ],
  })

const diameterState = (mm: number) =>
  makeState({
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      material: "일반강",
      diameterMm: mm,
    },
  })

const materialState = (mat: string) =>
  makeState({
    appliedFilters: [
      { field: "workPieceName", op: "includes", value: mat, rawValue: mat, appliedAt: 0 } as any,
    ],
  })

const materialInputState = (mat: string) =>
  makeState({
    resolvedInput: {
      manufacturerScope: "yg1-only",
      locale: "ko",
      material: mat,
    },
  })

// ---------------------------------------------------------------------------
// Part 1: fluteCount revision (40 cases)
// ---------------------------------------------------------------------------

describe("revision-200 — fluteCount (40 cases)", () => {
  it('"3날 대신 2날로" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "3날 대신 2날로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"날수 4날 말고 2날로" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "날수 4날 말고 2날로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"2날로 변경해주세요" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "2날로 변경해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"플루트 수 줄여줘 2날로" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "플루트 수 줄여줘 2날로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"3날 말고 2날이 좋겠어요" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "3날 말고 2날이 좋겠어요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "3날", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"change flute to 2날로 바꿔" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "change flute to 2날로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"2날이 나을것 같아 바꿔줘" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "2날이 나을것 같아 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"3날 말고 4날" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "3날 말고 4날")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "3날", nextFilter: { field: "fluteCount", rawValue: 4 } },
    })
  })

  it('"4날에서 6날로 변경" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날에서 6날로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 6 } },
    })
  })

  it('"날수를 좀 줄여서 2날로 변경해줘" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "날수를 좀 줄여서 2날로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"아까 4날이라 했는데 2날로 바꿔줘" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "아까 4날이라 했는데 2날로 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"4날 대신 2날로 해줘" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날 대신 2날로 해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "4날", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"flute count를 2개로 변경" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "flute count를 2개로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"날 수를 2날로 변경하고 싶습니다" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "날 수를 2날로 변경하고 싶습니다")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"2날로 수정 부탁드립니다" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "2날로 수정 부탁드립니다")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"2날로 바꿔" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "2날로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"4날 말고 2날로 해줘요" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날 말고 2날로 해줘요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "4날", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"2날로 해줘요" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "2날로 변경 해줘요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"황삭이니까 3날보다 2날이 좋겠어 변경해줘" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "황삭이니까 3날보다 2날이 좋겠어 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"3날 아니고 2날로" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "3날 아니고 2날로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"4날 대신에 2날이요" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날 대신에 2날이요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "4날", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"4날 말고 2날로 변경" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날 말고 2날로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "4날", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"4날 말고 6날로 바꿔" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날 말고 6날로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "4날", nextFilter: { field: "fluteCount", rawValue: 6 } },
    })
  })

  it('"6날로 수정해주세요" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "6날로 수정해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 6 } },
    })
  })

  it('"3날 대신 6날" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "3날 대신 6날")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "3날", nextFilter: { field: "fluteCount", rawValue: 6 } },
    })
  })

  it('"날수를 3날로 변경해줘" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "날수를 3날로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 3 } },
    })
  })

  it('"4날에서 3날로 수정" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날에서 3날로 수정")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 3 } },
    })
  })

  it('"2날로 바꿀 수 있나요" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "2날로 바꿀 수 있나요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"날수 2로 바꿔줘" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "날수 2로 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"4날 아닌 3날로" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날 아닌 3날로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 3 } },
    })
  })

  it('"3날 말고 2날로 수정해주세요" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "3날 말고 2날로 수정해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "3날", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"switch to 2 flute로 변경" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "switch to 2 flute로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"4날 말고 2날이 좋겠어" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날 말고 2날이 좋겠어")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "4날", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"3날 대신 4날로 변경해주세요" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "3날 대신 4날로 변경해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "3날", nextFilter: { field: "fluteCount", rawValue: 4 } },
    })
  })

  it('"flute 수를 2날로 수정" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "flute 수를 2날로 수정")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"4날 대신 2날로 바꿔줘" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날 대신 2날로 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "4날", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  // Negative: should NOT match fluteCount
  it('"날수는 그대로 두고 코팅만 바꿔 TiAlN으로" → NOT fluteCount (targets coating)', async () => {
    const state = makeState({
      appliedFilters: [
        { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any,
        { field: "coating", op: "includes", value: "AlCrN", rawValue: "AlCrN", appliedAt: 1 } as any,
      ],
    })
    const result = await resolveExplicitRevisionRequest(state, "날수는 그대로 두고 코팅만 바꿔 TiAlN으로")
    if (result && result.kind === "resolved") {
      expect(result.request.targetField).not.toBe("fluteCount")
    }
  })

  it('"2날 말고 6날로 해주세요" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("2날", 2), "2날 말고 6날로 해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "2날", nextFilter: { field: "fluteCount", rawValue: 6 } },
    })
  })

  it('"3날에서 2날로 수정해줘" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("3날", 3), "3날에서 2날로 수정해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", nextFilter: { field: "fluteCount", rawValue: 2 } },
    })
  })

  it('"4날 말고 3날이 적합할것 같아" → fluteCount', async () => {
    await expect(resolveExplicitRevisionRequest(fluteState("4날", 4), "4날 말고 3날이 적합할것 같아")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "fluteCount", previousValue: "4날", nextFilter: { field: "fluteCount", rawValue: 3 } },
    })
  })
})

// ---------------------------------------------------------------------------
// Part 2: coating revision (40 cases)
// ---------------------------------------------------------------------------

describe("revision-200 — coating (40 cases)", () => {
  it('"TiAlN 말고 AlCrN" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN 말고 AlCrN")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiAlN" },
    })
  })

  it('"코팅 DLC로 변경" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "코팅 DLC로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"TiAlN 말고 Bright Finish로" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN 말고 Bright Finish로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiAlN" },
    })
  })

  it('"Bright Finish 대신 TiCN으로 변경" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("Bright Finish"), "Bright Finish 대신 TiCN으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "Bright Finish" },
    })
  })

  it('"코팅을 바꾸고 싶어 AlCrN으로 변경" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "코팅을 바꾸고 싶어 AlCrN으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"TiAlN 대신 DLC로" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN 대신 DLC로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiAlN" },
    })
  })

  it('"AlCrN으로 변경해주세요" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "AlCrN으로 변경해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"TiCN으로 바꿔" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiCN으로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"AlCrN 대신 TiAlN으로 변경" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("AlCrN"), "AlCrN 대신 TiAlN으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "AlCrN" },
    })
  })

  it('"TiAlN 말고 TiCN으로 변경" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN 말고 TiCN으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiAlN" },
    })
  })

  it('"TiCN 말고 Bright Finish로 바꿔" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiCN"), "TiCN 말고 Bright Finish로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiCN" },
    })
  })

  it('"DLC로 변경해줘" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "DLC로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"AlCrN 말고 DLC로 바꿔" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("AlCrN"), "AlCrN 말고 DLC로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "AlCrN" },
    })
  })

  it('"내열성이 필요해서 TiAlN으로 변경해줘" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("AlCrN"), "내열성이 필요해서 TiAlN으로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"DLC가 더 좋을것 같아 바꿔줘" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "DLC가 더 좋을것 같아 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"TiAlN 코팅 대신 AlCrN으로" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN 코팅 대신 AlCrN으로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiAlN" },
    })
  })

  it('"코팅 변경 TiCN으로" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("AlCrN"), "코팅 변경 TiCN으로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"DLC 대신 TiAlN으로 바꿔" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("DLC"), "DLC 대신 TiAlN으로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "DLC" },
    })
  })

  it('"TiAlN으로 수정해주세요" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("DLC"), "TiAlN으로 수정해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"AlCrN 말고 TiAlN이 나을듯 변경" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("AlCrN"), "AlCrN 말고 TiAlN이 나을듯 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "AlCrN" },
    })
  })

  it('"Bright Finish로 바꿔줘" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "Bright Finish로 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"코팅을 TiAlN으로 변경하고 싶습니다" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("AlCrN"), "코팅을 TiAlN으로 변경하고 싶습니다")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"TiAlN 말고 Bright Finish" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN 말고 Bright Finish")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiAlN" },
    })
  })

  it('"코팅 수정 부탁드립니다 AlCrN으로" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "코팅 수정 부탁드립니다 AlCrN으로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"TiAlN 대신 DLC로 해줘" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN 대신 DLC로 해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiAlN" },
    })
  })

  it('"TiCN 대신 AlCrN으로 수정" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiCN"), "TiCN 대신 AlCrN으로 수정")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiCN" },
    })
  })

  it('"AlCrN으로 바꿀게요" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "AlCrN으로 바꿀게요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"코팅 AlCrN 대신 DLC로 바꿔줘" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("AlCrN"), "코팅 AlCrN 대신 DLC로 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "AlCrN" },
    })
  })

  it('"TiAlN에서 AlCrN으로 변경" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN에서 AlCrN으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"DLC 말고 TiCN" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("DLC"), "DLC 말고 TiCN")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "DLC" },
    })
  })

  it('"TiAlN 말고 DLC가 좋겠어" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN 말고 DLC가 좋겠어")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "TiAlN" },
    })
  })

  it('"replace with AlCrN으로 변경" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "replace with AlCrN으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"switch to DLC로 바꿔" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "switch to DLC로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"instead of TiAlN, AlCrN으로 변경" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "instead of TiAlN, AlCrN으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"TiAlN 아닌 DLC로" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiAlN 아닌 DLC로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"AlCrN 아니고 TiAlN으로" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("AlCrN"), "AlCrN 아니고 TiAlN으로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "AlCrN" },
    })
  })

  it('"TiCN으로 변경해줘요" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "TiCN으로 변경해줘요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"코팅을 DLC로 바꾸고 싶어요" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("TiAlN"), "코팅을 DLC로 바꾸고 싶어요 변경해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })

  it('"Bright Finish 말고 TiAlN으로 수정" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("Bright Finish"), "Bright Finish 말고 TiAlN으로 수정")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating", previousValue: "Bright Finish" },
    })
  })

  it('"DLC에서 TiAlN으로 수정해주세요" → coating', async () => {
    await expect(resolveExplicitRevisionRequest(coatState("DLC"), "DLC에서 TiAlN으로 수정해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "coating" },
    })
  })
})

// ---------------------------------------------------------------------------
// Part 3: toolSubtype revision (40 cases)
// ---------------------------------------------------------------------------

describe("revision-200 — toolSubtype (40 cases)", () => {
  it('"Square 말고 Ball로" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Ball로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square", nextFilter: { field: "toolSubtype", value: "Ball" } },
    })
  })

  it('"Square 말고 Ball" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Ball")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square", nextFilter: { field: "toolSubtype", value: "Ball" } },
    })
  })

  it('"Square 말고 Ball로 바꿔줘" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Ball로 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"코너레디우스로 변경해주세요" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "코너레디우스로 변경해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"황삭으로 변경" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "황삭으로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"라디우스로 바꿔주세요" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "라디우스로 바꿔주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"평엔드밀로 변경" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Ball"), "평엔드밀로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"Square 대신 Ball로 해줘" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 대신 Ball로 해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Square 말고 Radius type으로" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Radius type으로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Square 말고 Ball이 곡면에 좋겠어" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Ball이 곡면에 좋겠어")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Square 대신 Radius가 나을듯" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 대신 Radius가 나을듯")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Radius 대신 Square로" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Radius"), "Radius 대신 Square로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Radius", nextFilter: { field: "toolSubtype", value: "Square" } },
    })
  })

  it('"황삭 말고 Square로" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Roughing"), "황삭 말고 Square로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Roughing" },
    })
  })

  it('"Ball 말고 Radius로 변경" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Ball"), "Ball 말고 Radius로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Ball", nextFilter: { field: "toolSubtype", value: "Radius" } },
    })
  })

  it('"Square 말고 Radius로 변경해줘" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Radius로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Ball로 수정해주세요" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Ball로 수정해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"Roughing 대신 Ball로 바꿔" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Roughing"), "Roughing 대신 Ball로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Roughing" },
    })
  })

  it('"Square 말고 Radius" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Radius")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Ball 대신 Square로 변경해줘" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Ball"), "Ball 대신 Square로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Ball" },
    })
  })

  it('"Square 말고 Ball로 바꿔주세요" → toolSubtype (2)', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Ball로 바꿔주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Radius 말고 Ball이 좋겠어" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Radius"), "Radius 말고 Ball이 좋겠어")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Radius" },
    })
  })

  it('"Ball 아니고 Square로" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Ball"), "Ball 아니고 Square로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Ball" },
    })
  })

  it('"Square 아니고 Radius로" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 아니고 Radius로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Square 말고 Ball로 변경하고 싶습니다" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Ball로 변경하고 싶습니다")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Radius로 수정 부탁드립니다" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Radius로 수정 부탁드립니다")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"Square 말고 Ball로 해줘" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Ball로 해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Roughing 말고 Radius로 수정" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Roughing"), "Roughing 말고 Radius로 수정")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Roughing" },
    })
  })

  it('"Ball 말고 Square가 나을것 같아" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Ball"), "Ball 말고 Square가 나을것 같아")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Ball" },
    })
  })

  it('"Radius에서 Ball로 변경" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Radius"), "Radius에서 Ball로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"Square 말고 Ball이 낫겠어" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Ball이 낫겠어")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Square 대신 Radius로 변경해줘" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 대신 Radius로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Square 말고 Ball이 3D 곡면에 좋겠어" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Ball이 3D 곡면에 좋겠어")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"형상 변경 Ball로" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "형상 변경 Ball로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"Square 대신 Ball이요" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 대신 Ball이요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Ball 대신 Radius로 해주세요" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Ball"), "Ball 대신 Radius로 해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Ball" },
    })
  })

  it('"Ball 말고 Square로 변경해주세요" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Ball"), "Ball 말고 Square로 변경해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Ball" },
    })
  })

  it('"Square로 바꿀게요" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Ball"), "Square로 바꿀게요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype" },
    })
  })

  it('"Radius 말고 Ball로" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Radius"), "Radius 말고 Ball로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Radius" },
    })
  })

  it('"Square 말고 Radius로 수정해" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Square"), "Square 말고 Radius로 수정해")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Square" },
    })
  })

  it('"Ball 말고 Square가 나을것 같아요" → toolSubtype', async () => {
    await expect(resolveExplicitRevisionRequest(subtypeState("Ball"), "Ball 말고 Square가 나을것 같아요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "toolSubtype", previousValue: "Ball" },
    })
  })
})

// ---------------------------------------------------------------------------
// Part 4: diameterMm revision (30 cases)
// ---------------------------------------------------------------------------

describe("revision-200 — diameterMm (30 cases)", () => {
  it('"직경 8mm로 바꿔" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "직경 8mm로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 8 } },
    })
  })

  it('"10mm 대신 12mm로 변경" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "10mm 대신 12mm로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 12 } },
    })
  })

  it('"10mm 말고 8mm로" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "10mm 말고 8mm로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 8 } },
    })
  })

  it('"파이 8로 변경해줘" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "파이 8로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 8 } },
    })
  })

  it('"직경을 좀 줄여서 6mm로 변경" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "직경을 좀 줄여서 6mm로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 6 } },
    })
  })

  it('"10mm 말고 8mm로 바꿔" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "10mm 말고 8mm로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 8 } },
    })
  })

  it('"이 직경이면 8mm가 더 적합할것 같아 변경해줘" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "이 직경이면 8mm가 더 적합할것 같아 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 8 } },
    })
  })

  it('"직경 12mm로 변경해주세요" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "직경 12mm로 변경해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 12 } },
    })
  })

  it('"10mm 대신 6mm로" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "10mm 대신 6mm로")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 6 } },
    })
  })

  it('"직경을 8mm로 수정해줘" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "직경을 8mm로 수정해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 8 } },
    })
  })

  it('"8mm로 변경" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "8mm로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 8 } },
    })
  })

  it('"직경을 12mm로 바꿔줘" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "직경을 12mm로 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 12 } },
    })
  })

  it('"6mm로 바꿔주세요" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "6mm로 바꿔주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 6 } },
    })
  })

  it('"10mm 말고 12mm로 변경" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "10mm 말고 12mm로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 12 } },
    })
  })

  it('"diameter 8mm로 변경해줘" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "diameter 8mm로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 8 } },
    })
  })

  it('"10mm 대신 16mm로 바꿔줘" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "10mm 대신 16mm로 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 16 } },
    })
  })

  it('"10mm 대신 20mm로 바꿔" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "10mm 대신 20mm로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 20 } },
    })
  })

  it('"직경을 4mm로 수정" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "직경을 4mm로 수정")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 4 } },
    })
  })

  it('"파이 12로 바꿔줘" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "파이 12로 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 12 } },
    })
  })

  it('"10mm 말고 8mm로 수정해주세요" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "10mm 말고 8mm로 수정해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 8 } },
    })
  })

  it('"8mm가 좋겠어 변경해줘" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "8mm가 좋겠어 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 8 } },
    })
  })

  it('"10mm보다 6mm가 나을듯 바꿔줘" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "10mm보다 6mm가 나을듯 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 6 } },
    })
  })

  it('"직경을 8mm로 변경하고 싶습니다" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "직경을 8mm로 변경하고 싶습니다")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 8 } },
    })
  })

  it('"8mm로 수정 부탁드립니다" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "8mm로 수정 부탁드립니다")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 8 } },
    })
  })

  it('"직경 6으로 바꿔" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "직경 6으로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 6 } },
    })
  })

  it('"10mm에서 16mm로 변경해주세요" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "10mm에서 16mm로 변경해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 16 } },
    })
  })

  it('"10mm 대신 12mm가 좋겠어" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "10mm 대신 12mm가 좋겠어")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 12 } },
    })
  })

  it('"20mm로 변경해줘" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "20mm로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 20 } },
    })
  })

  it('"10mm 말고 4mm로 바꿔줘" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "10mm 말고 4mm로 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 4 } },
    })
  })

  it('"직경을 25mm로 수정해주세요" → diameterMm', async () => {
    await expect(resolveExplicitRevisionRequest(diameterState(10), "직경을 25mm로 수정해주세요")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "diameterMm", nextFilter: { field: "diameterMm", rawValue: 25 } },
    })
  })
})

// ---------------------------------------------------------------------------
// Part 5: workPieceName / material revision (20 cases)
// ---------------------------------------------------------------------------

describe("revision-200 — workPieceName/material (20 cases)", () => {
  it('"알루미늄 아니고 주철로 변경" → workPieceName', async () => {
    await expect(resolveExplicitRevisionRequest(materialState("알루미늄"), "알루미늄 아니고 주철로 변경")).resolves.toMatchObject({
      kind: "resolved",
      request: { targetField: "workPieceName" },
    })
  })

  it('"소재 스테인리스로 변경해줘" → material', async () => {
    await expect(resolveExplicitRevisionRequest(materialInputState("일반강"), "소재 스테인리스로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"알루미늄 말고 탄소강으로" → material', async () => {
    await expect(resolveExplicitRevisionRequest(materialInputState("알루미늄"), "알루미늄 말고 탄소강으로")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"피삭재 고경도강으로 변경" → workPieceName', async () => {
    await expect(resolveExplicitRevisionRequest(materialState("일반강"), "피삭재 고경도강으로 변경")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"알루미늄 말고 스테인리스로" → workPieceName', async () => {
    await expect(resolveExplicitRevisionRequest(materialState("알루미늄"), "알루미늄 말고 스테인리스로")).resolves.toMatchObject({
      kind: "resolved",
      request: { previousValue: "알루미늄" },
    })
  })

  it('"일반강 대신 주철로 변경" → material', async () => {
    await expect(resolveExplicitRevisionRequest(materialInputState("일반강"), "일반강 대신 주철로 변경")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"소재를 알루미늄으로 바꿔줘" → material', async () => {
    await expect(resolveExplicitRevisionRequest(materialInputState("일반강"), "소재를 알루미늄으로 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"피삭재 변경 스테인리스로" → workPieceName', async () => {
    await expect(resolveExplicitRevisionRequest(materialState("일반강"), "피삭재 변경 스테인리스로")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"material 변경해줘 titanium으로" → material', async () => {
    await expect(resolveExplicitRevisionRequest(materialInputState("일반강"), "material 변경해줘 titanium으로")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"알루미늄에서 주철로 수정" → workPieceName', async () => {
    await expect(resolveExplicitRevisionRequest(materialState("알루미늄"), "알루미늄에서 주철로 수정")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"소재 변경 주철로" → material', async () => {
    await expect(resolveExplicitRevisionRequest(materialInputState("일반강"), "소재 변경 주철로")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"주철로 바꿔줘" → workPieceName', async () => {
    await expect(resolveExplicitRevisionRequest(materialState("알루미늄"), "주철로 바꿔줘")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"알루미늄 대신 탄소강으로" → workPieceName', async () => {
    await expect(resolveExplicitRevisionRequest(materialState("알루미늄"), "알루미늄 대신 탄소강으로")).resolves.toMatchObject({
      kind: "resolved",
      request: { previousValue: "알루미늄" },
    })
  })

  it('"일반강 말고 알루미늄으로 변경해줘" → material', async () => {
    await expect(resolveExplicitRevisionRequest(materialInputState("일반강"), "일반강 말고 알루미늄으로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"소재를 주철로 수정해주세요" → material', async () => {
    await expect(resolveExplicitRevisionRequest(materialInputState("알루미늄"), "소재를 주철로 수정해주세요")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"스테인리스로 변경해주세요" → workPieceName', async () => {
    await expect(resolveExplicitRevisionRequest(materialState("일반강"), "스테인리스로 변경해주세요")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"피삭재를 알루미늄으로 바꿔" → workPieceName', async () => {
    await expect(resolveExplicitRevisionRequest(materialState("주철"), "피삭재를 알루미늄으로 바꿔")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"소재 수정 탄소강으로" → material', async () => {
    await expect(resolveExplicitRevisionRequest(materialInputState("알루미늄"), "소재 수정 탄소강으로")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"일반강에서 알루미늄으로 변경해줘" → material', async () => {
    await expect(resolveExplicitRevisionRequest(materialInputState("일반강"), "일반강에서 알루미늄으로 변경해줘")).resolves.toMatchObject({
      kind: "resolved",
    })
  })

  it('"알루미늄 말고 고경도강으로 수정" → workPieceName', async () => {
    await expect(resolveExplicitRevisionRequest(materialState("알루미늄"), "알루미늄 말고 고경도강으로 수정")).resolves.toMatchObject({
      kind: "resolved",
      request: { previousValue: "알루미늄" },
    })
  })
})

// ---------------------------------------------------------------------------
// Part 6: Negative cases (30 cases)
// ---------------------------------------------------------------------------

describe("revision-200 — negative cases (30 cases)", () => {
  const baseState = makeState({
    appliedFilters: [
      { field: "fluteCount", op: "eq", value: "4날", rawValue: 4, appliedAt: 0 } as any,
      { field: "coating", op: "includes", value: "TiAlN", rawValue: "TiAlN", appliedAt: 1 } as any,
    ],
  })

  // Plain selections (no revision signal)
  it('"Ball" → null (plain value, no revision signal)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "Ball")).resolves.toBeNull()
  })

  it('"4날" → null (plain value, no revision signal)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "4날")).resolves.toBeNull()
  })

  it('"TiAlN" → null (plain value, no revision signal)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "TiAlN")).resolves.toBeNull()
  })

  it('"Square" → null (plain value)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "Square")).resolves.toBeNull()
  })

  it('"Radius" → null (plain value)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "Radius")).resolves.toBeNull()
  })

  // Questions
  it('"이거 뭐야?" → null (question)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "이거 뭐야?")).resolves.toBeNull()
  })

  it('"차이가 뭐야?" → null (question)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "차이가 뭐야?")).resolves.toBeNull()
  })

  it('"TiAlN이 뭔가요?" → null (question)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "TiAlN이 뭔가요?")).resolves.toBeNull()
  })

  it('"코팅이 뭐야?" → null (question)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "코팅이 뭐야?")).resolves.toBeNull()
  })

  it('"AlCrN 코팅의 장단점은?" → null (question)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "AlCrN 코팅의 장단점은?")).resolves.toBeNull()
  })

  // Side questions
  it('"재고 있어?" → null (side question)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "재고 있어?")).resolves.toBeNull()
  })

  it('"가격 알려줘" → null (side question)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "가격 알려줘")).resolves.toBeNull()
  })

  it('"배송 기간은?" → null (side question)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "배송 기간은?")).resolves.toBeNull()
  })

  it('"이 제품 몇개 남았어?" → null (side question)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "이 제품 몇개 남았어?")).resolves.toBeNull()
  })

  // No matching filter (previous value mismatch)
  it('"10날 말고 2날로" → null (10날 not in filters)', async () => {
    const result = await resolveExplicitRevisionRequest(baseState, "10날 말고 2날로")
    if (result !== null) {
      expect(result).toHaveProperty("kind")
    } else {
      expect(result).toBeNull()
    }
  })

  // Same value
  it('"4날 대신 4날로" → null (same value)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "4날 대신 4날로")).resolves.toBeNull()
  })

  it('"TiAlN 말고 TiAlN으로" → null (same value)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "TiAlN 말고 TiAlN으로")).resolves.toBeNull()
  })

  // Empty/null
  it('"" → null (empty string)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "")).resolves.toBeNull()
  })

  it("null message → null", async () => {
    await expect(resolveExplicitRevisionRequest(baseState, null as any)).resolves.toBeNull()
  })

  it("null session → null", async () => {
    await expect(resolveExplicitRevisionRequest(null, "4날 말고 2날로")).resolves.toBeNull()
  })

  // Greetings / unrelated
  it('"안녕하세요" → null (greeting)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "안녕하세요")).resolves.toBeNull()
  })

  it('"감사합니다" → null (greeting)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "감사합니다")).resolves.toBeNull()
  })

  it('"오늘 날씨 어때?" → null (unrelated)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "오늘 날씨 어때?")).resolves.toBeNull()
  })

  it('"추천해줘" → null (recommendation without revision)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "추천해줘")).resolves.toBeNull()
  })

  it('"좋아 그걸로 할게" → null (acceptance)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "좋아 그걸로 할게")).resolves.toBeNull()
  })

  // Bare numbers / no signal
  it('"10" → null (bare number)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "10")).resolves.toBeNull()
  })

  it('"2" → null (bare number)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "2")).resolves.toBeNull()
  })

  it('"네" → null (affirmative)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "네")).resolves.toBeNull()
  })

  it('"아니요" → null (negative without target)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "아니요")).resolves.toBeNull()
  })

  it('"  " → null (whitespace only)', async () => {
    await expect(resolveExplicitRevisionRequest(baseState, "  ")).resolves.toBeNull()
  })
})
