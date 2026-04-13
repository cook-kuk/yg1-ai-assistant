import type { Page, TestInfo } from "@playwright/test"

import {
  RecommendationHarness,
  buildMockRecommendResponse,
  type RecommendResponsePayload,
} from "./recommendation-test-helpers"

export type ReasoningVisibility = "hidden" | "simple" | "full"

export interface ReasoningScenario {
  prompt: string
  finalText: string
  reasoningVisibility: ReasoningVisibility
  stageFrames?: string[]
  deepFrames?: string[]
  thinkingProcess?: string | null
  thinkingDeep?: string | null
}

export const REASONING_TOGGLE_RE = /Thinking|Thought for|추론 중|추론함/u
export const FULL_REASONING_RE = /Full chain-of-thought|상세 사고 과정/u

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function installReasoningScenarioStreamRoute(page: Page, scenario: ReasoningScenario) {
  await page.unroute("**/api/recommend/stream")
  await page.route("**/api/recommend/stream", async route => {
    const rawPostData = route.request().postData()
    const body = rawPostData ? JSON.parse(rawPostData) as Record<string, unknown> : {}
    const basePayload = buildMockRecommendResponse(body)
    const messages = Array.isArray(body.messages)
      ? body.messages as Array<{ text?: unknown }>
      : []
    const lastText = messages.at(-1)?.text
    const lastUserText = typeof lastText === "string" ? lastText.trim() : ""

    if (lastUserText !== scenario.prompt) {
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: sseFrame("final", basePayload),
      })
      return
    }

    const finalPayload: RecommendResponsePayload = {
      ...basePayload,
      text: scenario.finalText,
      reasoningVisibility: scenario.reasoningVisibility,
      thinkingProcess: scenario.thinkingProcess ?? null,
      thinkingDeep: scenario.thinkingDeep ?? null,
    }

    const frames = [
      ...(scenario.stageFrames ?? []).map(text => sseFrame("thinking", {
        text,
        delta: false,
        kind: "stage",
      })),
      ...(scenario.deepFrames ?? []).map(text => sseFrame("thinking", {
        text,
        delta: false,
        kind: "deep",
      })),
      sseFrame("final", finalPayload),
    ].join("")

    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: frames,
    })
  })
}

export async function startReasoningRecommendationHarness(page: Page, testInfo: TestInfo) {
  const harness = new RecommendationHarness(page, testInfo)
  await harness.startAluminum4mmSideMillingRecommendation()
  return harness
}
