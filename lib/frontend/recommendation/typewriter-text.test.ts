import { describe, expect, it } from "vitest"
import {
  advanceTypewriter,
  computeTypewriterIntervalMs,
  computeTypewriterStep,
} from "./typewriter-text"

describe("typewriter helpers", () => {
  describe("computeTypewriterStep", () => {
    it("returns at least 1 even for very low cps", () => {
      expect(computeTypewriterStep(1)).toBe(1)
      expect(computeTypewriterStep(30)).toBe(1)
    })
    it("scales linearly past 60 cps", () => {
      expect(computeTypewriterStep(60)).toBe(1)
      expect(computeTypewriterStep(120)).toBe(2)
      expect(computeTypewriterStep(600)).toBe(10)
    })
  })

  describe("computeTypewriterIntervalMs", () => {
    it("clamps to minimum 4ms", () => {
      expect(computeTypewriterIntervalMs(1000)).toBe(4)
      expect(computeTypewriterIntervalMs(10000)).toBe(4)
    })
    it("returns reasonable ms for typical cps", () => {
      expect(computeTypewriterIntervalMs(60)).toBe(16)
      expect(computeTypewriterIntervalMs(120)).toBe(8)
    })
  })

  describe("advanceTypewriter", () => {
    it("advances by step", () => {
      expect(advanceTypewriter(0, 10, 2)).toBe(2)
      expect(advanceTypewriter(4, 10, 3)).toBe(7)
    })
    it("clamps at textLength", () => {
      expect(advanceTypewriter(8, 10, 5)).toBe(10)
      expect(advanceTypewriter(10, 10, 5)).toBe(10)
    })
    it("handles empty text", () => {
      expect(advanceTypewriter(0, 0, 5)).toBe(0)
    })
  })

  describe("full reveal simulation", () => {
    it("reveals a string in order and terminates", () => {
      const text = "Hello, YG-1 assistant!"
      const step = computeTypewriterStep(120)
      expect(step).toBe(2)
      let i = 0
      const snapshots: string[] = []
      // cap iterations to guard against regression-introduced infinite loops
      for (let guard = 0; guard < 1000 && i < text.length; guard++) {
        i = advanceTypewriter(i, text.length, step)
        snapshots.push(text.slice(0, i))
      }
      expect(i).toBe(text.length)
      expect(snapshots.at(-1)).toBe(text)
      // monotonic growth
      for (let k = 1; k < snapshots.length; k++) {
        expect(snapshots[k].length).toBeGreaterThanOrEqual(snapshots[k - 1].length)
      }
    })
  })
})
