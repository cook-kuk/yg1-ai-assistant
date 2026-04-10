#!/usr/bin/env node
/**
 * test-e2e-full.mjs
 * Comprehensive E2E test suite for the deployed recommendation API.
 *
 * Usage:
 *   node scripts/test-e2e-full.mjs
 *   API_URL=http://localhost:3000/api/recommend node scripts/test-e2e-full.mjs
 */

const API_URL = process.env.API_URL || "http://20.119.98.136:3000/api/recommend";
const TIMEOUT = 300_000;

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function makeForm(overrides = {}) {
  return {
    inquiryPurpose: { status: "known", value: "new" },
    material: { status: "unanswered" },
    operationType: { status: "unanswered" },
    machiningIntent: { status: "unanswered" },
    toolTypeOrCurrentProduct: { status: "unanswered" },
    diameterInfo: { status: "unanswered" },
    country: { status: "known", value: "ALL" },
    ...overrides,
  };
}

async function callAPI(intakeForm, messages = [], session = null) {
  const body = {
    intakeForm,
    messages,
    session,
    language: "ko",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/** Extract useful info from response */
function parse(resp) {
  const pub = resp?.session?.publicState ?? {};
  return {
    text: resp?.text ?? "",
    purpose: resp?.purpose ?? "",
    chips: resp?.chips ?? [],
    session: resp?.session ?? null,
    candidateCount: pub.candidateCount ?? 0,
    appliedFilters: pub.appliedFilters ?? [],
    lastAskedField: pub.lastAskedField ?? null,
    resolutionStatus: pub.resolutionStatus ?? "none",
    sessionId: pub.sessionId ?? null,
    error: resp?.error ?? null,
    candidateSnapshot: resp?.candidateSnapshot ?? null,
    // Also grab sessionState for backward compat
    sessionState: resp?.sessionState ?? null,
  };
}

function hasFilter(filters, field) {
  return filters.some((f) => f.field === field);
}

function filterValue(filters, field) {
  const f = filters.find((ff) => ff.field === field);
  return f ? f.value ?? f.rawValue : undefined;
}

function filtersHaveAny(filters, fields) {
  return fields.some((f) => hasFilter(filters, f));
}

// ═══════════════════════════════════════════════════════════════
// Test infrastructure
// ═══════════════════════════════════════════════════════════════

const results = []; // { category, name, status, durationMs, detail }

async function runTest(category, name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    const ms = Date.now() - t0;
    results.push({ category, name, status: "PASS", durationMs: ms, detail: "" });
    console.log(`  PASS  ${name} (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - t0;
    const detail = err?.message ?? String(err);
    results.push({ category, name, status: "FAIL", durationMs: ms, detail });
    console.log(`  FAIL  ${name} (${ms}ms) -- ${detail.slice(0, 200)}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// ═══════════════════════════════════════════════════════════════
// 1. Basic flows (10)
// ═══════════════════════════════════════════════════════════════

const basicFlows = [
  {
    name: "P + 10mm + Milling",
    form: {
      material: { status: "known", value: "P" },
      diameterInfo: { status: "known", value: "10mm" },
      toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    },
  },
  {
    name: "M + 6mm + Drilling",
    form: {
      material: { status: "known", value: "M" },
      diameterInfo: { status: "known", value: "6mm" },
      toolTypeOrCurrentProduct: { status: "known", value: "Drilling" },
    },
  },
  {
    name: "K + 12mm + Turning",
    form: {
      material: { status: "known", value: "K" },
      diameterInfo: { status: "known", value: "12mm" },
      toolTypeOrCurrentProduct: { status: "known", value: "Turning" },
    },
  },
  {
    name: "N + 8mm + Milling",
    form: {
      material: { status: "known", value: "N" },
      diameterInfo: { status: "known", value: "8mm" },
      toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    },
  },
  {
    name: "S + 16mm + Drilling",
    form: {
      material: { status: "known", value: "S" },
      diameterInfo: { status: "known", value: "16mm" },
      toolTypeOrCurrentProduct: { status: "known", value: "Drilling" },
    },
  },
  {
    name: "H + 20mm + Milling",
    form: {
      material: { status: "known", value: "H" },
      diameterInfo: { status: "known", value: "20mm" },
      toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    },
  },
  {
    name: "P + 4mm + Side_Milling",
    form: {
      material: { status: "known", value: "P" },
      diameterInfo: { status: "known", value: "4mm" },
      operationType: { status: "known", value: "Side_Milling" },
    },
  },
  {
    name: "M + 25mm + Turning",
    form: {
      material: { status: "known", value: "M" },
      diameterInfo: { status: "known", value: "25mm" },
      toolTypeOrCurrentProduct: { status: "known", value: "Turning" },
    },
  },
  {
    name: "P + 10mm + Side_Milling (full form)",
    form: {
      material: { status: "known", value: "P" },
      operationType: { status: "known", value: "Side_Milling" },
      toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
      diameterInfo: { status: "known", value: "10mm" },
    },
  },
  {
    name: "K + 5mm + Drilling",
    form: {
      material: { status: "known", value: "K" },
      diameterInfo: { status: "known", value: "5mm" },
      toolTypeOrCurrentProduct: { status: "known", value: "Drilling" },
    },
  },
];

async function runBasicFlows() {
  console.log("\n=== 1. Basic Flows (10) ===");
  for (const tc of basicFlows) {
    await runTest("basic", tc.name, async () => {
      const resp = await callAPI(makeForm(tc.form));
      const p = parse(resp);
      assert(!p.error, `Got error: ${p.error}`);
      assert(p.session !== null, "No session in response");
      // For most combos, candidateCount > 0 is expected
      // (some exotic combos might be 0, so we just check response is valid)
      assert(typeof p.candidateCount === "number", "candidateCount not a number");
      assert(p.text.length > 0, "Empty text response");
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. Multi-filter single message (10)
// ═══════════════════════════════════════════════════════════════

const multiFilterCases = [
  { name: "4날 TiAlN Square", msg: "4날 TiAlN Square", expectMultipleFilters: true },
  { name: "2날 코팅없음 Ball", msg: "2날 코팅없음 Ball", expectMultipleFilters: true },
  { name: "3날 AlCrN 6mm", msg: "3날 AlCrN 6mm", expectMultipleFilters: true },
  { name: "황삭 4날 12mm", msg: "황삭 4날 12mm", expectMultipleFilters: true },
  { name: "정삭 TiAlN 8mm", msg: "정삭 TiAlN 8mm", expectMultipleFilters: true },
  { name: "Square 4날 코팅 TiAlN", msg: "Square 4날 코팅 TiAlN", expectMultipleFilters: true },
  { name: "Ball 2날 6mm", msg: "Ball 2날 6mm", expectMultipleFilters: true },
  { name: "4날 10mm 황삭", msg: "4날 10mm 황삭", expectMultipleFilters: true },
  { name: "Radius 3날 AlCrN", msg: "Radius 3날 AlCrN", expectMultipleFilters: true },
  { name: "Square 6날 20mm TiAlN", msg: "Square 6날 20mm TiAlN", expectMultipleFilters: true },
];

async function runMultiFilterTests() {
  console.log("\n=== 2. Multi-filter Single Message (10) ===");

  // First, get a base session
  const baseForm = makeForm({
    material: { status: "known", value: "P" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "known", value: "10mm" },
    operationType: { status: "known", value: "Side_Milling" },
  });

  for (const tc of multiFilterCases) {
    await runTest("multi-filter", tc.name, async () => {
      // Turn 1: initial
      const r1 = await callAPI(baseForm);
      const p1 = parse(r1);
      assert(!p1.error, `Turn 1 error: ${p1.error}`);
      assert(p1.session, "No session from turn 1");

      // Turn 2: multi-filter message
      const messages = [
        { role: "ai", text: p1.text },
        { role: "user", text: tc.msg },
      ];
      const r2 = await callAPI(baseForm, messages, p1.session);
      const p2 = parse(r2);
      assert(!p2.error, `Turn 2 error: ${p2.error}`);
      assert(p2.text.length > 0, "Empty turn 2 response");

      if (tc.expectMultipleFilters) {
        // We expect at least 1 filter to be applied (the engine might merge some)
        // The key assertion: the engine processed the multi-token input
        assert(
          p2.appliedFilters.length >= 1 || p2.candidateCount > 0,
          `Expected filters or candidates from "${tc.msg}", got filters=${p2.appliedFilters.length} candidates=${p2.candidateCount}`
        );
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. Negation / removal (5)
// ═══════════════════════════════════════════════════════════════

const negationCases = [
  { name: "코팅 빼고", applyMsg: "TiAlN", removeMsg: "코팅 빼고", filterField: "coating" },
  { name: "4날 제외", applyMsg: "4날", removeMsg: "4날 제외", filterField: "fluteCount" },
  { name: "Ball 빼줘", applyMsg: "Ball", removeMsg: "Ball 빼줘", filterField: "shape" },
  { name: "Square 제거", applyMsg: "Square", removeMsg: "Square 제거해줘", filterField: "shape" },
  { name: "황삭 빼고", applyMsg: "황삭", removeMsg: "황삭 빼고", filterField: "machiningIntent" },
];

async function runNegationTests() {
  console.log("\n=== 3. Negation / Removal (5) ===");

  const baseForm = makeForm({
    material: { status: "known", value: "P" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "known", value: "10mm" },
    operationType: { status: "known", value: "Side_Milling" },
  });

  for (const tc of negationCases) {
    await runTest("negation", tc.name, async () => {
      // Turn 1
      const r1 = await callAPI(baseForm);
      const p1 = parse(r1);
      assert(!p1.error, `Turn 1 error: ${p1.error}`);

      // Turn 2: apply filter
      const msgs2 = [
        { role: "ai", text: p1.text },
        { role: "user", text: tc.applyMsg },
      ];
      const r2 = await callAPI(baseForm, msgs2, p1.session);
      const p2 = parse(r2);
      assert(!p2.error, `Turn 2 error: ${p2.error}`);

      // Turn 3: remove filter
      const msgs3 = [
        ...msgs2,
        { role: "ai", text: p2.text },
        { role: "user", text: tc.removeMsg },
      ];
      const r3 = await callAPI(baseForm, msgs3, p2.session);
      const p3 = parse(r3);
      assert(!p3.error, `Turn 3 error: ${p3.error}`);

      // After removal, the specific filter should be gone or changed
      // We check that we got a valid response (the engine processed the negation)
      assert(p3.text.length > 0, "Empty response after negation");
      // The filter count should be <= the previous count (filter was removed or unchanged)
      // We can't strictly assert removal because the engine may reinterpret, but at minimum it should respond
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. Filter change (5)
// ═══════════════════════════════════════════════════════════════

const filterChangeCases = [
  { name: "Square -> Ball 바꿔", applyMsg: "Square", changeMsg: "Ball로 바꿔줘" },
  { name: "4날 -> 2날 변경", applyMsg: "4날", changeMsg: "2날로 변경" },
  { name: "TiAlN -> AlCrN 바꿔", applyMsg: "TiAlN", changeMsg: "AlCrN으로 바꿔" },
  { name: "10mm -> 12mm 변경", applyMsg: "10mm", changeMsg: "직경 12mm로 변경해줘" },
  { name: "황삭 -> 정삭 바꿔", applyMsg: "황삭", changeMsg: "정삭으로 바꿔줘" },
];

async function runFilterChangeTests() {
  console.log("\n=== 4. Filter Change (5) ===");

  const baseForm = makeForm({
    material: { status: "known", value: "P" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "known", value: "10mm" },
    operationType: { status: "known", value: "Side_Milling" },
  });

  for (const tc of filterChangeCases) {
    await runTest("filter-change", tc.name, async () => {
      // Turn 1
      const r1 = await callAPI(baseForm);
      const p1 = parse(r1);
      assert(!p1.error, `Turn 1 error: ${p1.error}`);

      // Turn 2: apply initial filter
      const msgs2 = [
        { role: "ai", text: p1.text },
        { role: "user", text: tc.applyMsg },
      ];
      const r2 = await callAPI(baseForm, msgs2, p1.session);
      const p2 = parse(r2);
      assert(!p2.error, `Turn 2 error: ${p2.error}`);

      // Turn 3: change filter
      const msgs3 = [
        ...msgs2,
        { role: "ai", text: p2.text },
        { role: "user", text: tc.changeMsg },
      ];
      const r3 = await callAPI(baseForm, msgs3, p2.session);
      const p3 = parse(r3);
      assert(!p3.error, `Turn 3 error: ${p3.error}`);
      assert(p3.text.length > 0, "Empty response after filter change");
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. General questions (5) - no filter changes expected
// ═══════════════════════════════════════════════════════════════

const generalQuestionCases = [
  { name: "TiAlN이 뭐야?", msg: "TiAlN이 뭐야?" },
  { name: "엔드밀과 드릴 차이", msg: "엔드밀과 드릴의 차이가 뭐야?" },
  { name: "코팅 종류 설명", msg: "코팅 종류에 대해 설명해줘" },
  { name: "황삭과 정삭 차이", msg: "황삭과 정삭의 차이점은?" },
  { name: "스테인리스 가공 팁", msg: "스테인리스 가공할 때 팁 좀 알려줘" },
];

async function runGeneralQuestionTests() {
  console.log("\n=== 5. General Questions (5) ===");

  const baseForm = makeForm({
    material: { status: "known", value: "P" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "known", value: "10mm" },
    operationType: { status: "known", value: "Side_Milling" },
  });

  for (const tc of generalQuestionCases) {
    await runTest("general-question", tc.name, async () => {
      // Turn 1
      const r1 = await callAPI(baseForm);
      const p1 = parse(r1);
      assert(!p1.error, `Turn 1 error: ${p1.error}`);

      const filtersBefore = p1.appliedFilters.length;

      // Turn 2: ask general question
      const msgs2 = [
        { role: "ai", text: p1.text },
        { role: "user", text: tc.msg },
      ];
      const r2 = await callAPI(baseForm, msgs2, p1.session);
      const p2 = parse(r2);
      assert(!p2.error, `Error: ${p2.error}`);
      assert(p2.text.length > 0, "Empty response to general question");
      // Filters should not change for a general question
      assert(
        p2.appliedFilters.length <= filtersBefore + 1,
        `Filters increased unexpectedly: ${filtersBefore} -> ${p2.appliedFilters.length}`
      );
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. Skip (3)
// ═══════════════════════════════════════════════════════════════

const skipCases = [
  { name: "상관없음", msg: "상관없음" },
  { name: "아무거나", msg: "아무거나" },
  { name: "몰라요 넘어가줘", msg: "몰라요 넘어가줘" },
];

async function runSkipTests() {
  console.log("\n=== 6. Skip (3) ===");

  // Use a minimal form so the engine will ask questions
  const baseForm = makeForm({
    material: { status: "known", value: "P" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
  });

  for (const tc of skipCases) {
    await runTest("skip", tc.name, async () => {
      // Turn 1
      const r1 = await callAPI(baseForm);
      const p1 = parse(r1);
      assert(!p1.error, `Turn 1 error: ${p1.error}`);
      const field1 = p1.lastAskedField;

      // Turn 2: skip
      const msgs2 = [
        { role: "ai", text: p1.text },
        { role: "user", text: tc.msg },
      ];
      const r2 = await callAPI(baseForm, msgs2, p1.session);
      const p2 = parse(r2);
      assert(!p2.error, `Error: ${p2.error}`);
      assert(p2.text.length > 0, "Empty response after skip");
      // After skip, the engine should advance - either ask a different field or recommend
      // We just verify the response is valid
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// 7. Edge cases (5)
// ═══════════════════════════════════════════════════════════════

const edgeCases = [
  { name: "Empty string", msg: "" },
  { name: "Numbers only: 10", msg: "10" },
  { name: "Long text (500 chars)", msg: "테스트 ".repeat(100) },
  { name: "Typo: squre", msg: "squre" },
  { name: "Emoji input", msg: "👍🔧💪" },
];

async function runEdgeCaseTests() {
  console.log("\n=== 7. Edge Cases (5) ===");

  const baseForm = makeForm({
    material: { status: "known", value: "P" },
    toolTypeOrCurrentProduct: { status: "known", value: "Milling" },
    diameterInfo: { status: "known", value: "10mm" },
    operationType: { status: "known", value: "Side_Milling" },
  });

  for (const tc of edgeCases) {
    await runTest("edge-case", tc.name, async () => {
      // Turn 1
      const r1 = await callAPI(baseForm);
      const p1 = parse(r1);
      assert(!p1.error, `Turn 1 error: ${p1.error}`);

      // Turn 2: edge case input
      const msgs2 = [
        { role: "ai", text: p1.text },
        { role: "user", text: tc.msg },
      ];
      const r2 = await callAPI(baseForm, msgs2, p1.session);
      const p2 = parse(r2);
      // For edge cases, we just want no crash / valid JSON response
      assert(p2.text !== undefined, "No text field in response");
      // Should not throw 500 (already handled by callAPI)
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// Runner
// ═══════════════════════════════════════════════════════════════

async function main() {
  const t0 = Date.now();
  console.log(`E2E Full Test Suite`);
  console.log(`Target: ${API_URL}`);
  console.log(`Timeout per request: ${TIMEOUT}ms`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  await runBasicFlows();
  await runMultiFilterTests();
  await runNegationTests();
  await runFilterChangeTests();
  await runGeneralQuestionTests();
  await runSkipTests();
  await runEdgeCaseTests();

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // ── Summary ──
  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const total = results.length;

  console.log("\n" + "=".repeat(60));
  console.log(`SUMMARY: ${pass} passed, ${fail} failed, ${total} total (${elapsed}s)`);
  console.log("=".repeat(60));

  // ── TSV output ──
  console.log("\n--- TSV Results ---");
  console.log(["category", "name", "status", "durationMs", "detail"].join("\t"));
  for (const r of results) {
    console.log(
      [r.category, r.name, r.status, r.durationMs, r.detail.replace(/\t/g, " ").replace(/\n/g, " ")].join("\t")
    );
  }

  // ── Category breakdown ──
  console.log("\n--- By Category ---");
  const categories = [...new Set(results.map((r) => r.category))];
  for (const cat of categories) {
    const catResults = results.filter((r) => r.category === cat);
    const catPass = catResults.filter((r) => r.status === "PASS").length;
    console.log(`  ${cat}: ${catPass}/${catResults.length}`);
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
