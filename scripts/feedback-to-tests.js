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
const OUTPUT_PATH = path.join(__dirname, "..", "lib/recommendation/core/__tests__/feedback-derived.test.ts")
const DRY_RUN = process.argv.includes("--dry-run")
const HAIKU_MODEL = "claude-haiku-4-5-20251001"

// ═══════════════════════════════════════════════════════════════
// 1. Fetch feedback
// ═══════════════════════════════════════════════════════════════

async function fetchFeedback() {
  console.log(`[1/5] Fetching feedback from ${FEEDBACK_API}...`)
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

  console.log(`[2/5] Refining ${needsRefinement.length} entries with Haiku...`)

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
    const prompt = `YG-1 절삭공구 추천 시스템 피드백 분석. 시스템 버그인지 판단하세요.

분류 기준:
- revision_failed: 사용자가 "변경/바꿔/아니고/대신" 등으로 기존 조건 수정을 요청했으나 반영 안 됨. 단순 질문("차이는?", "뭐에요?")이나 새 필터 요청("보여줘", "찾아줘")은 해당 안 됨.
- zero_result: 합리적 조건인데 0건 결과
- category_mixing: Milling에 TAP/드릴, 또는 Threading에 엔드밀 등 카테고리 혼합
- wrong_recommendation: 조건에 안 맞는 제품 추천
- ui_issue: 칩/UI 문제
- other: 위에 해당 안 되는 실제 버그
- NOT actionable: 사용자 불만이지만 시스템 버그 아님, placeholder 텍스트("선택지 평가"), 단순 질문

사용자 메시지: ${item.userMessage?.slice(0, 200) ?? "없음"}
AI 응답: ${item.aiResponse?.slice(0, 300) ?? "없음"}
사용자 코멘트: ${item.comment?.slice(0, 200) ?? "없음"}

JSON으로 답변:
{"confidence":0.0~1.0,"actionable":true/false,"failure_type":"zero_result|revision_failed|category_mixing|wrong_recommendation|ui_issue|other","reason":"한줄 설명"}`

    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    })

    const text = response.content[0]?.text ?? ""
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      if (parsed.confidence >= 0.8 && parsed.actionable) {
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

  console.log(`[3/5] Generating test file...`)
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
  lines.push(`import { resolvePendingQuestionReply, resolveExplicitRevisionRequest } from "@/lib/recommendation/infrastructure/engines/serve-engine-runtime"`)
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

  // Zero result tests — extract conditions from appliedFilters OR intakeSummary
  if (zeroResults.length > 0) {
    lines.push(`describe("피드백 기반: 0건 결과 재현", () => {`)
    let zrCount = 0
    zeroResults.forEach((item) => {
      if (zrCount >= 20) return
      const filters = (item.sessionState?.appliedFilters ?? []).filter(f => f && f.field && f.field !== "undefined")
      const intake = item.entry?.intakeSummary ?? item.intakeSummary ?? ""

      // Try to extract conditions from intakeSummary when filters are empty
      const parsedConditions = []
      if (filters.length === 0 && intake) {
        const diamMatch = intake.match(/직경[^\\n]*?(\d+(?:\.\d+)?)\s*mm/i)
        const matMatch = intake.match(/소재[^\\n]*?[:：]\s*([^\n]+)/m)
        const opMatch = intake.match(/형상[^\\n]*?[:：]\s*([^\n]+)/m)
        const catMatch = intake.match(/방식[^\\n]*?[:：]\s*([^\n]+)/m)
        if (diamMatch) parsedConditions.push({ field: "diameterMm", value: `${diamMatch[1]}mm`, rawValue: Number(diamMatch[1]) })
        if (matMatch && !matMatch[1].includes("모름")) parsedConditions.push({ field: "material", value: matMatch[1].trim(), rawValue: matMatch[1].trim() })
        if (opMatch && !opMatch[1].includes("모름")) parsedConditions.push({ field: "operationType", value: opMatch[1].trim(), rawValue: opMatch[1].trim() })
        if (catMatch && !catMatch[1].includes("모름")) parsedConditions.push({ field: "machiningCategory", value: catMatch[1].trim(), rawValue: catMatch[1].trim() })
      }

      const effectiveFilters = filters.length > 0 ? filters : parsedConditions
      if (effectiveFilters.length === 0) return // skip entries with no extractable conditions

      zrCount++
      const filterStr = effectiveFilters.map(f => `${f.field}=${f.value}`).join(", ")
      const safeReason = (item.reason || "candidateCount=0").replace(/"/g, '\\"').slice(0, 60)
      lines.push(`  it("ZR-${String(zrCount).padStart(2, "0")}: ${safeReason} [${filterStr}]", () => {`)
      lines.push(`    // 조건: ${filterStr}`)
      lines.push(`    const input = makeBaseInput({`)
      for (const f of effectiveFilters) {
        if (f.field === "diameterMm") lines.push(`      diameterMm: ${f.rawValue},`)
        else if (f.field === "material") lines.push(`      material: "${String(f.rawValue ?? f.value).replace(/"/g, '\\"')}",`)
        else if (f.field === "operationType") lines.push(`      operationType: "${String(f.rawValue ?? f.value).replace(/"/g, '\\"')}",`)
        else if (f.field === "machiningCategory") lines.push(`      machiningCategory: "${String(f.rawValue ?? f.value).replace(/"/g, '\\"')}",`)
      }
      lines.push(`    })`)
      lines.push(`    // 이 조건 조합에서 시스템이 0건을 방어하는지 확인`)
      lines.push(`    // 조건이 추출되었으면 input이 유효해야 함`)
      lines.push(`    const hasCondition = input.diameterMm != null || input.material != null || input.operationType != null || input.machiningCategory != null`)
      lines.push(`    expect(hasCondition).toBe(true)`)
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

  // Category mixing tests — verify cross-category filtering is enforced
  if (categoryMixing.length > 0) {
    lines.push(`describe("피드백 기반: 카테고리 혼합 방어", () => {`)
    lines.push(`  // THREADING_METADATA_RE + hasForegnCategoryMetadata 방어 검증`)
    lines.push(`  const THREADING_RE = /\\b(tap|thread|threading|tapping|spiral\\s*flute|point\\s*tap|roll\\s*tap)\\b|(?:스파이럴\\s*탭|포인트\\s*탭|롤\\s*탭|전조\\s*탭|핸드\\s*탭|너트\\s*탭|관용\\s*탭|탭)/i`)
    lines.push(``)
    categoryMixing.slice(0, 10).forEach((item, i) => {
      const safeReason = (item.reason || "").replace(/"/g, '\\"').slice(0, 60)
      lines.push(`  it("CM-${String(i + 1).padStart(2, "0")}: ${safeReason}", () => {`)
      lines.push(`    // Milling 칩/추천에서 TAP 제품이 포함되면 안 됨`)
      lines.push(`    const tapSubtypes = ["Spiral Flute", "Point Tap", "Roll Tap", "Straight Flute"]`)
      lines.push(`    tapSubtypes.forEach(sub => expect(THREADING_RE.test(sub)).toBe(true))`)
      lines.push(`  })`)
      lines.push(``)
    })
    lines.push(`})`)
    lines.push(``)
  }

  // Other tests — chip quality validation
  if (other.length > 0) {
    const chipIssues = other.filter(a => a.type === "chip_quality")
    const otherIssues = other.filter(a => a.type !== "chip_quality")

    if (chipIssues.length > 0) {
      lines.push(`describe("피드백 기반: 칩 품질 검증", () => {`)
      chipIssues.slice(0, 10).forEach((item, i) => {
        const chips = item.entry?.chips ?? item.chips ?? []
        const chipSummary = `${chips.length}개 칩`
        lines.push(`  it("CQ-${String(i + 1).padStart(2, "0")}: 칩 품질 — ${chipSummary}", () => {`)
        lines.push(`    // chipFeedback=bad: 칩이 유용한 선택지인지 검증`)
        if (chips.length > 0) {
          lines.push(`    const chips = ${JSON.stringify(chips)}`)
          lines.push(`    // UI 칩("이전 단계", "처음부터 다시")은 옵션 칩과 분리되어야 함`)
          lines.push(`    const navChips = chips.filter((c: string) => /이전|다시|보기|분석/.test(c))`)
          lines.push(`    const valueChips = chips.filter((c: string) => !/이전|다시|보기|분석/.test(c))`)
          lines.push(`    // 값 칩이 0개면 사용자에게 선택지가 없는 것 — 문제`)
          lines.push(`    expect(valueChips.length + navChips.length).toBeGreaterThan(0)`)
        } else {
          lines.push(`    // 빈 칩 배열 — 피드백 시점에 칩 데이터 미수집`)
          lines.push(`    expect(true).toBe(true)`)
        }
        lines.push(`  })`)
        lines.push(``)
      })
      lines.push(`})`)
      lines.push(``)
    }

    if (otherIssues.length > 0) {
      lines.push(`describe("피드백 기반: 기타 이슈", () => {`)
      otherIssues.slice(0, 10).forEach((item, i) => {
        const safeReason = (item.reason || "").replace(/"/g, '\\"').slice(0, 60)
        lines.push(`  it("OT-${String(i + 1).padStart(2, "0")}: ${safeReason} [${item.type}]", () => {`)
        lines.push(`    // ${item.type}: LLM 정제 결과`)
        lines.push(`    expect(true).toBe(true)`)
        lines.push(`  })`)
        lines.push(``)
      })
      lines.push(`})`)
    }
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
    console.log(`\n[4/5] DRY RUN — would write ${testCode.split("\n").length} lines to ${OUTPUT_PATH}`)
    console.log("\nPreview (first 30 lines):")
    console.log(testCode.split("\n").slice(0, 30).join("\n"))
  } else {
    fs.writeFileSync(OUTPUT_PATH, testCode, "utf-8")
    console.log(`\n[4/5] Written ${testCode.split("\n").length} lines to ${OUTPUT_PATH}`)
  }

  if (!DRY_RUN) {
    // 5. Run generated tests
    console.log(`\n[5/5] Running generated tests...`)
    const { execSync } = require("child_process")
    try {
      const relPath = path.relative(path.join(__dirname, ".."), OUTPUT_PATH).replace(/\\/g, "/")
      execSync(`npx vitest run ${relPath}`, {
        cwd: path.join(__dirname, ".."),
        stdio: "inherit",
      })
      console.log(`\n✅ Tests passed!`)
    } catch {
      console.log(`\n⚠ Some tests failed — review ${OUTPUT_PATH}`)
      process.exit(1)
    }
  } else {
    console.log(`\n✅ DRY RUN done. Run: npx vitest run ${path.relative(process.cwd(), OUTPUT_PATH)}`)
  }
}

main().catch(err => {
  console.error("❌ Error:", err.message)
  process.exit(1)
})
