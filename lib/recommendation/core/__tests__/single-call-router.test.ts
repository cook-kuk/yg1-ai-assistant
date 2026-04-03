import { describe, it, expect } from "vitest"
import {
  extractJsonFromResponse,
  validateAction,
  validateAndCleanResult,
  type SingleCallAction,
  type SingleCallResult,
} from "../single-call-router"

// ── extractJsonFromResponse ──────────────────────────────────

describe("extractJsonFromResponse", () => {
  it("parses valid JSON directly", () => {
    const input = '{"actions":[{"type":"apply_filter","field":"diameter","value":10,"op":"eq"}],"answer":"","reasoning":"direct"}'
    const result = extractJsonFromResponse(input)
    expect(result).toEqual({
      actions: [{ type: "apply_filter", field: "diameter", value: 10, op: "eq" }],
      answer: "",
      reasoning: "direct",
    })
  })

  it("extracts JSON from markdown code block", () => {
    const input = 'Here is the result:\n```json\n{"actions":[],"answer":"hello","reasoning":"test"}\n```'
    const result = extractJsonFromResponse(input)
    expect(result).toEqual({ actions: [], answer: "hello", reasoning: "test" })
  })

  it("extracts JSON from code block without json tag", () => {
    const input = '```\n{"actions":[],"answer":"","reasoning":"ok"}\n```'
    const result = extractJsonFromResponse(input)
    expect(result).toEqual({ actions: [], answer: "", reasoning: "ok" })
  })

  it("extracts JSON from text with surrounding prose", () => {
    const input = 'I think the answer is: {"actions":[{"type":"skip"}],"answer":"","reasoning":"skip"} and that is all.'
    const result = extractJsonFromResponse(input)
    expect(result).toEqual({ actions: [{ type: "skip" }], answer: "", reasoning: "skip" })
  })

  it("returns null for completely invalid input", () => {
    expect(extractJsonFromResponse("no json here")).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(extractJsonFromResponse("")).toBeNull()
  })

  it("returns null for malformed JSON", () => {
    expect(extractJsonFromResponse('{"actions": [broken')).toBeNull()
  })
})

// ── validateAction ───────────────────────────────────────────

describe("validateAction", () => {
  it("accepts valid apply_filter action", () => {
    expect(validateAction({ type: "apply_filter", field: "diameter", value: 10, op: "eq" })).toBe(true)
  })

  it("accepts valid skip action", () => {
    expect(validateAction({ type: "skip" })).toBe(true)
  })

  it("accepts valid compare action", () => {
    expect(validateAction({ type: "compare", targets: ["A", "B"] })).toBe(true)
  })

  it("rejects null", () => {
    expect(validateAction(null)).toBe(false)
  })

  it("rejects undefined", () => {
    expect(validateAction(undefined)).toBe(false)
  })

  it("rejects non-object", () => {
    expect(validateAction("apply_filter")).toBe(false)
  })

  it("rejects missing type", () => {
    expect(validateAction({ field: "diameter" })).toBe(false)
  })

  it("rejects unknown type", () => {
    expect(validateAction({ type: "unknown_action" })).toBe(false)
  })

  it("rejects invalid op", () => {
    expect(validateAction({ type: "apply_filter", op: "invalid_op" })).toBe(false)
  })

  it("accepts action without op (op is optional)", () => {
    expect(validateAction({ type: "apply_filter", field: "diameter", value: 10 })).toBe(true)
  })

  it.each([
    "apply_filter", "remove_filter", "replace_filter", "show_recommendation",
    "compare", "answer", "skip", "reset", "go_back",
  ])("accepts valid type: %s", (type) => {
    expect(validateAction({ type })).toBe(true)
  })
})

// ── validateAndCleanResult ───────────────────────────────────

describe("validateAndCleanResult", () => {
  it("returns empty result for null input", () => {
    const result = validateAndCleanResult(null)
    expect(result.actions).toEqual([])
    expect(result.answer).toBe("")
    expect(result.reasoning).toBe("")
  })

  it("returns empty result for non-object input", () => {
    const result = validateAndCleanResult("string")
    expect(result.actions).toEqual([])
  })

  it("filters out invalid actions, keeps valid ones", () => {
    const input = {
      actions: [
        { type: "apply_filter", field: "diameter", value: 10 },
        { type: "invalid_action" },
        null,
        { type: "skip" },
        "not_an_object",
      ],
      answer: "test answer",
      reasoning: "some reasoning",
    }
    const result = validateAndCleanResult(input)
    expect(result.actions).toHaveLength(2)
    expect(result.actions[0].type).toBe("apply_filter")
    expect(result.actions[1].type).toBe("skip")
    expect(result.answer).toBe("test answer")
    expect(result.reasoning).toBe("some reasoning")
  })

  it("returns empty actions when actions is not an array", () => {
    const result = validateAndCleanResult({ actions: "not_array", answer: "a", reasoning: "r" })
    expect(result.actions).toEqual([])
    expect(result.answer).toBe("a")
    expect(result.reasoning).toBe("r")
  })

  it("handles missing answer/reasoning gracefully", () => {
    const result = validateAndCleanResult({ actions: [{ type: "reset" }] })
    expect(result.actions).toHaveLength(1)
    expect(result.answer).toBe("")
    expect(result.reasoning).toBe("")
  })

  it("handles multiple valid filter actions", () => {
    const input = {
      actions: [
        { type: "apply_filter", field: "diameter", value: 10, op: "eq" },
        { type: "apply_filter", field: "coating", value: "TiAlN", op: "eq" },
        { type: "remove_filter", field: "length" },
      ],
      answer: "",
      reasoning: "multi-filter",
    }
    const result = validateAndCleanResult(input)
    expect(result.actions).toHaveLength(3)
  })

  it("preserves all valid fields in actions", () => {
    const input = {
      actions: [
        { type: "replace_filter", field: "diameter", from: "10", to: "12", op: "eq" },
      ],
      answer: "",
      reasoning: "replace",
    }
    const result = validateAndCleanResult(input)
    const action = result.actions[0]
    expect(action.type).toBe("replace_filter")
    expect(action.field).toBe("diameter")
    expect(action.from).toBe("10")
    expect(action.to).toBe("12")
    expect(action.op).toBe("eq")
  })
})
