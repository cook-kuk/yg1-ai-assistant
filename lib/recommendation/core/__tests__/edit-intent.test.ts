import { describe, expect, it, vi } from "vitest"

import {
  applyEditIntent,
  getEditIntentAffectedFields,
  getEditIntentHintTokens,
  hasEditSignal,
  parseEditIntent,
  shouldExecuteEditIntentDeterministically,
} from "../edit-intent"
import type { AppliedFilter } from "@/lib/types/exploration"

vi.mock("../sql-agent-schema-cache", () => ({
  getDbSchemaSync: () => ({
    columns: [],
    sampleValues: {},
    workpieces: [],
    brands: ["CRX S", "CRX-S", "ALU-CUT", "TANK-POWER", "V7 PLUS"],
    loadedAt: Date.now(),
  }),
}))

function makeFilter(field: string, value: string, op: AppliedFilter["op"] = "eq"): AppliedFilter {
  return { field, op, value, rawValue: value, appliedAt: 0 }
}

describe("hasEditSignal", () => {
  it.each([
    "CRX S \uB9D0\uACE0",
    "TiAlN \uBE7C\uACE0",
    "Square \uC544\uB2CC \uAC78\uB85C",
    "Ball\uB85C \uBC14\uAFD4\uC918",
    "\uBE0C\uB79C\uB4DC\uB294 \uC0C1\uAD00\uC5C6\uC74C",
    "\uCC98\uC74C\uBD80\uD130 \uB2E4\uC2DC",
    "\uCF54\uD305 \uBCC0\uACBD\uD574\uC918",
  ])("detects Stage 1 edit phrasing: %s", (message) => {
    expect(hasEditSignal(message)).toBe(true)
  })

  it.each([
    "\uBE0C\uB79C\uB4DC \uB178\uC0C1\uAD00",
    "\uB300\uCDA9 \uC9C1\uACBD\uB9CC \uD544\uC694",
    "\uD615\uC0C1 \uCC3E\uC544\uC918 10mm",
    "\uCF54\uD305\uC740 \uBB50 \uC544\uBB34\uB798\uB3C4 \uC88B\uC740\uB370 \uB0A0\uC218\uB9CC 4\uB0A0\uB85C \uD574\uC918",
    "10mm",
    "\uCD94\uCC9C\uD574\uC918",
  ])("does not force Stage 2 phrasing into Stage 1: %s", (message) => {
    expect(hasEditSignal(message)).toBe(false)
  })
})

describe("parseEditIntent", () => {
  it("parses replace_field for numeric revisions", () => {
    const result = parseEditIntent("2\uB0A0 \uB9D0\uACE0 4\uB0A0\uB85C")
    expect(result?.intent.type).toBe("replace_field")
    if (result?.intent.type === "replace_field") {
      expect(result.intent.field).toBe("fluteCount")
      expect(result.intent.oldValue).toBe("2")
      expect(result.intent.newValue).toBe("4")
    }
  })

  it("parses exclude_field for deterministic negation", () => {
    const result = parseEditIntent("TiAlN \uBE7C\uACE0")
    expect(result?.intent.type).toBe("exclude_field")
    if (result?.intent.type === "exclude_field") {
      expect(result.intent.field).toBe("coating")
      expect(result.intent.value).toBe("TiAlN")
    }
  })

  it("uses deterministic stage-one hints for identifier negation when entity lookup is ambiguous", () => {
    const result = parseEditIntent("4G MILL \uC544\uB2CC \uAC78\uB85C", [], [
      { type: "apply_filter", field: "brand", value: "4G MILL", op: "includes" },
    ])

    expect(result?.intent.type).toBe("exclude_field")
    if (result?.intent.type === "exclude_field") {
      expect(result.intent.field).toBe("brand")
      expect(result.intent.value).toBe("4G MILL")
    }
  })

  it("parses skip_field only for the basic fast-path phrases", () => {
    const result = parseEditIntent("\uBE0C\uB79C\uB4DC\uB294 \uC0C1\uAD00\uC5C6\uC74C")
    expect(result?.intent.type).toBe("skip_field")
    if (result?.intent.type === "skip_field") {
      expect(result.intent.field).toBe("brand")
    }
  })

  it.each([
    "\uBE0C\uB79C\uB4DC \uB178\uC0C1\uAD00",
    "\uB300\uCDA9 \uC9C1\uACBD\uB9CC \uD544\uC694",
    "\uD615\uC0C1 \uCC3E\uC544\uC918 10mm",
    "\uCF54\uD305\uC740 \uBB50 \uC544\uBB34\uB798\uB3C4 \uC88B\uC740\uB370 \uB0A0\uC218\uB9CC 4\uB0A0\uB85C \uD574\uC918",
  ])("returns null for Stage 2/3 fallback phrases: %s", (message) => {
    expect(parseEditIntent(message)).toBeNull()
  })

  it("parses go_back_then_apply when the wording is explicit", () => {
    const result = parseEditIntent("\uC774\uC804\uC73C\uB85C \uB3CC\uC544\uAC00\uC11C CRX S \uC81C\uC678")
    expect(result?.intent.type).toBe("go_back_then_apply")
  })

  it("parses reset_all", () => {
    const result = parseEditIntent("\uCC98\uC74C\uBD80\uD130 \uB2E4\uC2DC")
    expect(result?.intent.type).toBe("reset_all")
  })
})

describe("edit-intent execution mode", () => {
  it("marks replace and exclude intents as semantic hints instead of stage1 executable truth", () => {
    const replaceIntent = {
      intent: { type: "replace_field", field: "fluteCount", oldValue: "2", newValue: "4" } as const,
      confidence: 0.95,
      reason: "replace fluteCount",
    }
    const excludeIntent = {
      intent: { type: "exclude_field", field: "coating", value: "TiAlN" } as const,
      confidence: 0.95,
      reason: "exclude coating",
    }

    expect(shouldExecuteEditIntentDeterministically(replaceIntent)).toBe(false)
    expect(shouldExecuteEditIntentDeterministically(excludeIntent)).toBe(false)
    expect(getEditIntentAffectedFields(replaceIntent)).toEqual(["fluteCount"])
    expect(getEditIntentHintTokens(replaceIntent)).toEqual(["2", "4"])
    expect(getEditIntentAffectedFields(excludeIntent)).toEqual(["coating"])
    expect(getEditIntentHintTokens(excludeIntent)).toEqual(["TiAlN"])
  })

  it("keeps skip/reset style intents stage1 executable", () => {
    const skipIntent = {
      intent: { type: "skip_field", field: "brand" } as const,
      confidence: 0.93,
      reason: "skip brand",
    }
    const resetIntent = {
      intent: { type: "reset_all" } as const,
      confidence: 0.95,
      reason: "reset signal",
    }

    expect(shouldExecuteEditIntentDeterministically(skipIntent)).toBe(true)
    expect(shouldExecuteEditIntentDeterministically(resetIntent)).toBe(true)
  })
})

describe("applyEditIntent", () => {
  it("replaces the existing field with a skip filter", () => {
    const before = [makeFilter("brand", "CRX-S"), makeFilter("coating", "TiAlN")]
    const parsed = parseEditIntent("\uBE0C\uB79C\uB4DC\uB294 \uC0C1\uAD00\uC5C6\uC74C", before)
    expect(parsed?.intent.type).toBe("skip_field")
    if (!parsed) return

    const mutation = applyEditIntent(parsed.intent, before, 7)
    expect(mutation.removeIndices).toEqual([0])
    expect(mutation.addFilter).toEqual(
      expect.objectContaining({ field: "brand", op: "skip", rawValue: "skip" }),
    )
  })

  it("keeps Stage 2/3 phrases out of the deterministic mutator", () => {
    expect(parseEditIntent("\uBE0C\uB79C\uB4DC \uB178\uC0C1\uAD00", [makeFilter("brand", "CRX-S")])).toBeNull()
  })
})
