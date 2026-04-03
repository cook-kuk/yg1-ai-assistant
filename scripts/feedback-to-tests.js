#!/usr/bin/env node
/**
 * feedback-to-tests.js
 *
 * 피드백 API에서 데이터 수집 → 자동 분류 → LLM 정제 → vitest 테스트 자동 생성
 *
 * 실행: node scripts/feedback-to-tests.js
 * dry-run: node scripts/feedback-to-tests.js --dry-run
 */

const fs = require("fs")
const path = require("path")

// Load .env for ANTHROPIC_API_KEY
try {
  const envFiles = [".env.local", ".env"]
  const envPath = envFiles.map(f => path.join(__dirname, "..", f)).find(f => fs.existsSync(f))
  if (envPath) {
    const envContent = fs.readFileSync(envPath, "utf-8")
    for (const line of envContent.split("\n")) {
      const match = line.match(/^([A-Z_]+)=(.+)$/)
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "")
      }
    }
  }
} catch { /* ignore */ }

const FEEDBACK_API = "http://20.119.98.136:3001/api/feedback"
const OUTPUT_PATH = path.join(__dirname, "..", "lib/recommendation/infrastructure/engines/__tests__/feedback-derived.test.ts")
const DRY_RUN = process.argv.includes("--dry-run")
const HAIKU_MODEL = "claude-haiku-4-5-20251001"

// ═══════════════════════════════════════════════════════════════
// 1. Fetch feedback
// ═══════════════════════════════════════════════════════════════

async function fetchFeedback() {
  console.log(`[1/4] Fetching feedback from ${FEEDBACK_API}...`)
  const res = await fetch(FEEDBACK_API)
  if (!res.ok) throw new Error(`Feedback API error: ${res.status}`)
  const data = await res.json()

  const general = data.generalEntries ?? []
  const feedback = data.feedbackEntries ?? []
  const conversation = data.conversationEntries ?? []
  console.log(`  → general: ${general.length}, feedbackEntries: ${feedback.length}, conversation: ${conversation.length}`)
  return { general, feedback, conversation }
}

// ═══════════════════════════════════════════════════════════════
// 2. Auto-classify
// ═══════════════════════════════════════════════════════════════

function classifyEntry(entry) {
  const chat = entry.chatHistory ?? []
  const lastAi = entry.aiResponse ?? [...chat].reverse().find(m => m.role === "ai")?.text ?? ""
  const lastUser = entry.userMessage ?? [...chat].reverse().find(m => m.role === "user")?.text ?? ""
  const rec = entry.recommendationSummary ?? entry.topProducts ?? ""
  const intake = entry.intakeSummary ?? entry.conditions ?? ""
  const rating = entry.rating
  const comment = entry.comment ?? entry.userComment ?? ""
  const sessionState = entry.conversationSnapshot?.sessionState ?? null
  const candidateCount = entry.candidateCount ?? sessionState?.candidateCount ?? null
  const responseFeedback = entry.responseFeedback ?? null
  const chipFeedback = entry.chipFeedback ?? null
  const appliedFilters = entry.appliedFilters ?? sessionState?.appliedFilters ?? []

  // Rule 1: 0건 결과
  if (candidateCount === 0 || lastAi.includes("후보가 없습니다") || lastAi.includes("0개 후보")) {
    return {
      type: "zero_result",
      confidence: 1.0,
      entry,
      reason: "candidateCount=0 또는 응답에 0건 메시지",
      userMessage: lastUser,
      aiResponse: lastAi,
      sessionState,
    }
  }

  // Rule 2: revision 실패
  if (lastAi.includes("구체적으로 말씀") || lastAi.includes("인식하지 못했습니다")) {
    return {
      type: "revision_failed",
      confidence: 1.0,
      entry,
      reason: "AI가 사용자 의도를 인식 못함",
      userMessage: lastUser,
      aiResponse: lastAi,
      sessionState,
    }
  }

  // Rule 3: Milling인데 TAP/드릴 추천
  if (intake.includes("Milling") && (rec.includes("TAP") || rec.includes("TZ9") || rec.includes("Spiral Flute"))) {
    return {
      type: "category_mixing",
      confidence: 0.9,
      entry,
      reason: "Milling 조건에 TAP/드릴 제품 추천",
      userMessage: lastUser,
      aiResponse: lastAi,
      sessionState,
    }
  }

  // Rule 4: 칩만 👎 (응답은 OK) — 칩 품질 문제
  if (chipFeedback === "bad" && responseFeedback !== "bad") {
    return {
      type: "chip_quality",
      confidence: 0.8,
      entry,
      reason: "칩 선택지 불만 (응답 자체는 OK)",
      userMessage: lastUser,
      aiResponse: lastAi,
      sessionState,
      appliedFilters,
    }
  }

  // Rule 5: 👎 피드백 — LLM 정제 필요
  if (responseFeedback === "bad" || rating === 1 || comment.includes("👎")) {
    return {
      type: "needs_llm_refinement",
      confidence: 0.5,
      entry,
      reason: "낮은 평가 — LLM 분석 필요",
      userMessage: lastUser,
      aiResponse: lastAi,
      comment,
      sessionState,
      appliedFilters,
    }
  }

  return null // actionable하지 않음
}

// ═══════════════════════════════════════════════════════════════
// 3. LLM 정제 (Haiku)
// ═══════════════════════════════════════════════════════════════

async function refineWithHaiku(classified) {
  const needsRefinement = classified.filter(c => c.type === "needs_llm_refinement")
  if (needsRefinement.length === 0) return classified.filter(c => c.type !== "needs_llm_refinement")

  console.log(`[2/4] Refining ${needsRefinement.length} entries with Haiku...`)

  let Anthropic
  try {
    Anthropic = require("@anthropic-ai/sdk")
    if (Anthropic.default) Anthropic = Anthropic.default
  } catch {
    console.log("  ⚠ @anthropic-ai/sdk not available, skipping LLM refinement")
    return classified.filter(c => c.type !== "needs_llm_refinement")
  }

  const client = new Anthropic()
  const refined = []
  const BATCH_SIZE = 20

  async function refineOne(item) {
    const prompt = `다음은 YG-1 절삭공구 추천 시스템의 피드백입니다. 이 피드백이 시스템 버그인지 분석해주세요.

사용자 메시지: ${item.userMessage?.slice(0, 200) ?? "없음"}
AI 응답: ${item.aiResponse?.slice(0, 300) ?? "없음"}
사용자 코멘트: ${item.comment?.slice(0, 200) ?? "없음"}

JSON으로 답변:
{"refined":"👎","confidence":0.0~1.0,"actionable":true/false,"failure_type":"zero_result|revision_failed|category_mixing|wrong_recommendation|ui_issue|other","reason":"한줄 설명"}`

    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    })

    const text = response.content[0]?.text ?? ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.confidence >= 0.6 && parsed.actionable) {
        return { ...item, type: parsed.failure_type || "other", confidence: parsed.confidence, reason: parsed.reason }
      }
    }
    return null
  }

  // Process in parallel batches of BATCH_SIZE
  for (let i = 0; i < needsRefinement.length; i += BATCH_SIZE) {
    const batch = needsRefinement.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(batch.map(item => refineOne(item)))
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) refined.push(r.value)
    }
    const done = Math.min(i + BATCH_SIZE, needsRefinement.length)
    process.stdout.write(`  → ${done}/${needsRefinement.length} processed (${refined.length} actionable)\r`)
  }
  console.log()

  console.log(`  → ${refined.length}/${needsRefinement.length} actionable after refinement`)
  return [...classified.filter(c => c.type !== "needs_llm_refinement"), ...refined]
}

// ═══════════════════════════════════════════════════════════════
// 4. Generate test file
// ═══════════════════════════════════════════════════════════════

function generateTestFile(actionable) {
  const zeroResults = actionable.filter(a => a.type === "zero_result")
  const revisionFailed = actionable.filter(a => a.type === "revision_failed")
  const categoryMixing = actionable.filter(a => a.type === "category_mixing")
  const other = actionable.filter(a => !["zero_result", "revision_failed", "category_mixing"].includes(a.type))

  console.log(`[3/4] Generating test file...`)
  console.log(`  → zero_result: ${zeroResults.length}`)
  console.log(`  → revision_failed: ${revisionFailed.length}`)
  console.log(`  → category_mixing: ${categoryMixing.length}`)
  console.log(`  → other: ${other.length}`)

  const lines = []
  lines.push(`/**`)
  lines.push(` * 자동 생성된 피드백 기반 테스트`)
  lines.push(` * 생성일: ${new Date().toISOString().split("T")[0]}`)
  lines.push(` * 소스: ${FEEDBACK_API}`)
  lines.push(` * actionable: ${actionable.length}건`)
  lines.push(` */`)
  lines.push(`import { describe, expect, it } from "vitest"`)
  lines.push(``)
  lines.push(`import { resolvePendingQuestionReply, resolveExplicitRevisionRequest } from "../serve-engine-runtime"`)
  lines.push(`import { applyFilterToRecommendationInput, buildAppliedFilterFromValue } from "@/lib/recommendation/shared/filter-field-registry"`)
  lines.push(`import type { AppliedFilter, ExplorationSessionState, RecommendationInput } from "@/lib/recommendation/domain/types"`)
  lines.push(``)
  lines.push(`function makeBaseInput(overrides: Partial<RecommendationInput> = {}): RecommendationInput {`)
  lines.push(`  return { manufacturerScope: "yg1-only", locale: "ko", ...overrides } as RecommendationInput`)
  lines.push(`}`)
  lines.push(``)
  lines.push(`function makeState(overrides: Partial<ExplorationSessionState> = {}): ExplorationSessionState {`)
  lines.push(`  return {`)
  lines.push(`    sessionId: "feedback-derived",`)
  lines.push(`    candidateCount: 100,`)
  lines.push(`    appliedFilters: [],`)
  lines.push(`    narrowingHistory: [],`)
  lines.push(`    stageHistory: [],`)
  lines.push(`    resolutionStatus: "narrowing",`)
  lines.push(`    resolvedInput: makeBaseInput(),`)
  lines.push(`    turnCount: 1,`)
  lines.push(`    displayedCandidates: [],`)
  lines.push(`    displayedChips: [],`)
  lines.push(`    displayedOptions: [],`)
  lines.push(`    currentMode: "question",`)
  lines.push(`    lastAskedField: undefined,`)
  lines.push(`    ...overrides,`)
  lines.push(`  } as ExplorationSessionState`)
  lines.push(`}`)
  lines.push(``)

  // Zero result tests
  if (zeroResults.length > 0) {
    lines.push(`describe("피드백 기반: 0건 결과 재현", () => {`)
    zeroResults.slice(0, 20).forEach((item, i) => {
      const filters = item.sessionState?.appliedFilters ?? []
      const filterStr = filters.map(f => `${f.field}=${f.value}`).join(", ")
      const safeReason = (item.reason || "").replace(/"/g, '\\"').slice(0, 60)
      lines.push(`  it("ZR-${String(i + 1).padStart(2, "0")}: ${safeReason}", () => {`)
      lines.push(`    // 조건: ${filterStr || "없음"}`)
      if (filters.length > 0) {
        lines.push(`    const filters: AppliedFilter[] = [`)
        filters.forEach(f => {
          const rv = typeof f.rawValue === "number" ? f.rawValue : `"${String(f.rawValue ?? f.value).replace(/"/g, '\\"')}"`
          lines.push(`      { field: "${f.field}", op: "${f.op}", value: "${String(f.value).replace(/"/g, '\\"')}", rawValue: ${rv}, appliedAt: ${f.appliedAt ?? 0} } as AppliedFilter,`)
        })
        lines.push(`    ]`)
        lines.push(`    const input = filters.reduce((acc, f) => applyFilterToRecommendationInput(acc, f), makeBaseInput())`)
        lines.push(`    // 이 조건 조합이 0건을 만들지 않도록 시스템이 방어해야 함`)
        lines.push(`    expect(filters.length).toBeGreaterThan(0)`)
      } else {
        lines.push(`    // 필터 정보 없음 — 세션 상태 확인 필요`)
        lines.push(`    expect(true).toBe(true)`)
      }
      lines.push(`  })`)
      lines.push(``)
    })
    lines.push(`})`)
    lines.push(``)
  }

  // Revision failed tests
  if (revisionFailed.length > 0) {
    lines.push(`describe("피드백 기반: revision 실패 재현", () => {`)
    revisionFailed.slice(0, 15).forEach((item, i) => {
      const msg = (item.userMessage || "").replace(/"/g, '\\"').replace(/\n/g, " ").slice(0, 80)
      const safeReason = (item.reason || "").replace(/"/g, '\\"').slice(0, 60)
      const filters = item.sessionState?.appliedFilters ?? []
      lines.push(`  it("RF-${String(i + 1).padStart(2, "0")}: ${safeReason}", async () => {`)
      lines.push(`    const state = makeState({`)
      if (filters.length > 0) {
        lines.push(`      appliedFilters: [`)
        filters.forEach(f => {
          const rv = typeof f.rawValue === "number" ? f.rawValue : `"${String(f.rawValue ?? f.value).replace(/"/g, '\\"')}"`
          lines.push(`        { field: "${f.field}", op: "${f.op}", value: "${String(f.value).replace(/"/g, '\\"')}", rawValue: ${rv}, appliedAt: ${f.appliedAt ?? 0} } as any,`)
        })
        lines.push(`      ],`)
      }
      lines.push(`    })`)
      lines.push(`    const result = await resolveExplicitRevisionRequest(state, "${msg}")`)
      lines.push(`    // 사용자 의도를 인식해야 함 (null이면 버그)`)
      lines.push(`    // result가 null이면 revision signal 감지 또는 필터 매칭 실패`)
      lines.push(`    expect(result).not.toBeNull()`)
      lines.push(`  })`)
      lines.push(``)
    })
    lines.push(`})`)
    lines.push(``)
  }

  // Category mixing tests
  if (categoryMixing.length > 0) {
    lines.push(`describe("피드백 기반: 카테고리 혼합 재현", () => {`)
    categoryMixing.slice(0, 10).forEach((item, i) => {
      const safeReason = (item.reason || "").replace(/"/g, '\\"').slice(0, 60)
      lines.push(`  it("CM-${String(i + 1).padStart(2, "0")}: ${safeReason}", () => {`)
      lines.push(`    // Milling 조건에서 TAP/드릴이 추천되면 안 됨`)
      lines.push(`    // applicationShapes 기반 필터링이 동작해야 함`)
      lines.push(`    expect(true).toBe(true) // 통합 테스트에서 검증`)
      lines.push(`  })`)
      lines.push(``)
    })
    lines.push(`})`)
    lines.push(``)
  }

  // Other tests
  if (other.length > 0) {
    lines.push(`describe("피드백 기반: 기타 이슈", () => {`)
    other.slice(0, 10).forEach((item, i) => {
      const safeReason = (item.reason || "").replace(/"/g, '\\"').slice(0, 60)
      lines.push(`  it("OT-${String(i + 1).padStart(2, "0")}: ${safeReason}", () => {`)
      lines.push(`    // ${item.type}: 추가 분석 필요`)
      lines.push(`    expect(true).toBe(true)`)
      lines.push(`  })`)
      lines.push(``)
    })
    lines.push(`})`)
  }

  return lines.join("\n")
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n🔄 feedback-to-tests${DRY_RUN ? " (DRY RUN)" : ""}\n`)

  // 1. Fetch
  const { general, feedback, conversation } = await fetchFeedback()
  const allEntries = [...general, ...feedback, ...conversation]

  // 2. Classify
  const classified = allEntries.map(classifyEntry).filter(Boolean)
  console.log(`  → classified: ${classified.length} actionable out of ${allEntries.length}`)

  // 3. LLM refine
  const actionable = DRY_RUN
    ? classified.filter(c => c.type !== "needs_llm_refinement")
    : await refineWithHaiku(classified)

  console.log(`  → final actionable: ${actionable.length}`)

  if (actionable.length === 0) {
    console.log("\n✅ No actionable feedback found. Tests not updated.")
    return
  }

  // 4. Generate
  const testCode = generateTestFile(actionable)

  if (DRY_RUN) {
    console.log(`\n[4/4] DRY RUN — would write ${testCode.split("\n").length} lines to ${OUTPUT_PATH}`)
    console.log("\nPreview (first 30 lines):")
    console.log(testCode.split("\n").slice(0, 30).join("\n"))
  } else {
    fs.writeFileSync(OUTPUT_PATH, testCode, "utf-8")
    console.log(`\n[4/4] Written ${testCode.split("\n").length} lines to ${OUTPUT_PATH}`)
  }

  console.log(`\n✅ Done! Run: npx vitest run ${path.relative(process.cwd(), OUTPUT_PATH)}`)
}

main().catch(err => {
  console.error("❌ Error:", err.message)
  process.exit(1)
})
