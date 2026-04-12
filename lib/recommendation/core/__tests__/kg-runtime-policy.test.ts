import { afterEach, describe, expect, it } from "vitest"

import { isLegacyKgHintEnabled, isLegacyKgInterpreterEnabled } from "../kg-runtime-policy"
import { runWithRuntimeFlags } from "@/lib/recommendation/runtime-flags"

const PREV_INTERPRETER = process.env.ENABLE_LEGACY_KG_INTERPRETER
const PREV_HINTS = process.env.ENABLE_LEGACY_KG_HINTS

afterEach(() => {
  if (PREV_INTERPRETER == null) delete process.env.ENABLE_LEGACY_KG_INTERPRETER
  else process.env.ENABLE_LEGACY_KG_INTERPRETER = PREV_INTERPRETER

  if (PREV_HINTS == null) delete process.env.ENABLE_LEGACY_KG_HINTS
  else process.env.ENABLE_LEGACY_KG_HINTS = PREV_HINTS
})

describe("kg runtime policy", () => {
  it("disables the legacy KG interpreter by default when LLM providers are available", () => {
    delete process.env.ENABLE_LEGACY_KG_INTERPRETER
    delete process.env.ENABLE_LEGACY_KG_HINTS

    expect(isLegacyKgInterpreterEnabled(true)).toBe(false)
    expect(isLegacyKgHintEnabled(true)).toBe(false)
  })

  it("keeps the legacy KG interpreter as an offline safety net", () => {
    delete process.env.ENABLE_LEGACY_KG_INTERPRETER
    delete process.env.ENABLE_LEGACY_KG_HINTS

    expect(isLegacyKgInterpreterEnabled(false)).toBe(true)
    expect(isLegacyKgHintEnabled(false)).toBe(true)
  })

  it("allows explicit opt-in via environment flags", () => {
    process.env.ENABLE_LEGACY_KG_INTERPRETER = "1"
    process.env.ENABLE_LEGACY_KG_HINTS = "1"

    expect(isLegacyKgInterpreterEnabled(true)).toBe(true)
    expect(isLegacyKgHintEnabled(true)).toBe(true)
  })

  it("respects the request-scoped disableKg flag", () => {
    process.env.ENABLE_LEGACY_KG_INTERPRETER = "1"
    process.env.ENABLE_LEGACY_KG_HINTS = "1"

    runWithRuntimeFlags({ precisionMode: false, disableKg: true }, () => {
      expect(isLegacyKgInterpreterEnabled(false)).toBe(false)
      expect(isLegacyKgHintEnabled(false)).toBe(false)
    })
  })
})
