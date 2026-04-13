import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/recommendation/shared/material-mapping", () => ({
  buildMaterialPromptHints: vi.fn(() => "- Stainless | ISO M | LV2 Stainless Steel"),
  buildScopedMaterialPromptHints: vi.fn(() => "detected family: Stainless\nbrand hints: YG1\nseries hints: INOX-MASTER"),
}))

import { buildSessionContext, buildSystemPrompt } from "../prompt-builder"

describe("prompt-builder material hints", () => {
  it("threads CSV-backed material hints into the session context", () => {
    const sessionContext = buildSessionContext(
      {
        inquiryPurpose: { status: "known", value: "new" },
        material: { status: "known", value: "SUS304" },
        operationType: { status: "unknown" },
        toolTypeOrCurrentProduct: { status: "unknown" },
        diameterInfo: { status: "unknown" },
      } as any,
      { appliedFilters: [], narrowingHistory: [] } as any,
      12,
      null,
      undefined,
    )

    expect(sessionContext).toContain("[CSV material hints]")
    expect(sessionContext).toContain("detected family: Stainless")
    expect(sessionContext).toContain("brand hints: YG1")
    expect(sessionContext).toContain("series hints: INOX-MASTER")
  })

  it("injects the canonical registry snippet into the system prompt", () => {
    const prompt = buildSystemPrompt("ko")

    expect(prompt).toContain("[Canonical registry]")
    expect(prompt).toContain("country: KOREA, AMERICA, ASIA, EUROPE")
  })
})
