// Unit tests for rule-based insight generator. Lock in the key
// "aha" narratives that drive the lab's demo value (productivity win,
// life-first tradeoff, chatter alarm, productivity loss story).
import { describe, expect, it } from "vitest"
import {
  computeImpact,
  IMPACT_PRESETS,
  DEFAULT_LOCKED_TOOL,
  DEFAULT_LOCKED_MATERIAL,
  DEFAULT_LOCKED_OPERATION,
} from "./impact-calc-engine"
import { generateInsights } from "./insight-generator"

const LOCKED = {
  D_inch: DEFAULT_LOCKED_TOOL.diameterInch,
  D_mm: DEFAULT_LOCKED_TOOL.diameter,
  Z: DEFAULT_LOCKED_TOOL.flutes,
  sfmBase: DEFAULT_LOCKED_MATERIAL.sfmBase,
  iptBase: DEFAULT_LOCKED_MATERIAL.iptBase,
  kc: DEFAULT_LOCKED_MATERIAL.kc,
  isoGroup: DEFAULT_LOCKED_MATERIAL.isoGroup,
  adocInch: DEFAULT_LOCKED_OPERATION.adocInch,
  rdocInch: DEFAULT_LOCKED_OPERATION.rdocInch,
}

function computeFor(presetKey: keyof typeof IMPACT_PRESETS) {
  return computeImpact({ ...LOCKED, ...IMPACT_PRESETS[presetKey].config })
}

describe("insight-generator — preset narratives", () => {
  const baseline = computeFor("baseline")

  it("premium preset gets a productivity-win trophy insight", () => {
    const ins = generateInsights(computeFor("premium"), baseline)
    expect(ins.some((i) => i.icon === "🏆" && i.tone === "positive")).toBe(true)
  })

  it("highspeed preset also gets productivity-win insight", () => {
    const ins = generateInsights(computeFor("highspeed"), baseline)
    expect(ins.some((i) => i.icon === "🏆")).toBe(true)
  })

  it("budget preset surfaces chatter + MRR-loss cautions (life-first suppressed by HIGH chatter)", () => {
    // Budget 은 수명이 길지만 LD=5, TIR=25μm 조합 때문에 채터 HIGH —
    // 안전 이슈가 수명 장점을 덮어쓰므로 "🌙 life-first" 는 fire 하지 않고
    // "⚠️ chatter" 와 "📉 MRR loss" 가 우선 표시돼야 함.
    const ins = generateInsights(computeFor("budget"), baseline)
    expect(ins.some((i) => i.icon === "⚠️")).toBe(true)
    expect(ins.some((i) => i.icon === "📉")).toBe(true)
    expect(ins.some((i) => i.icon === "🌙")).toBe(false)
  })

  it("disaster preset surfaces caution: MRR loss + chatter warning", () => {
    const ins = generateInsights(computeFor("disaster"), baseline)
    expect(ins.some((i) => i.icon === "📉" && i.tone === "caution")).toBe(true)
    expect(ins.some((i) => i.icon === "⚠️" && i.tone === "caution")).toBe(true)
  })

  it("baseline vs baseline → reassurance (🛡️) insight, no cautions", () => {
    const ins = generateInsights(baseline, baseline)
    expect(ins.some((i) => i.icon === "🛡️")).toBe(true)
    expect(ins.every((i) => i.tone !== "caution")).toBe(true)
  })

  it("standard preset produces no cautions (mild drift from baseline)", () => {
    const ins = generateInsights(computeFor("standard"), baseline)
    expect(ins.every((i) => i.tone !== "caution")).toBe(true)
  })
})
