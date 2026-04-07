#!/usr/bin/env node
/**
 * Step 3: Feedback test runner.
 *
 * - Reads test-cases-from-feedback.json
 * - Sends each case's userMessage to POST {BASE_URL}/api/chat
 * - Repeats N times (default 3) for consistency / unstable detection
 * - Updates feedback-test-report.tsv + feedback-metrics.json with results
 *
 * Env:
 *   BASE_URL  (default http://localhost:3000)
 *   LIMIT     (default all — set to a number for smoke runs)
 *   REPEAT    (default 3)
 *   CATEGORY  (optional — only run cases of this category)
 *
 * If the API is unreachable on the first probe, the runner exits cleanly
 * (verdict stays PENDING) — does NOT crash. Multi-turn is intentionally
 * NOT attempted (sessionState issues, see project memory).
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
const REPEAT = process.env.REPEAT ? parseInt(process.env.REPEAT, 10) : 3;
const CATEGORY = process.env.CATEGORY || null;

const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-cases-from-feedback.json'), 'utf8'));
const filtered = cases.filter((c) => !CATEGORY || c.category === CATEGORY).slice(0, LIMIT);

async function probe() {
  try {
    const r = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', text: 'ping' }] }),
    });
    return r.ok || r.status < 500;
  } catch (e) {
    return false;
  }
}

async function callOnce(userMessage) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', text: userMessage }] }),
    });
    const elapsed = Date.now() - t0;
    if (!r.ok) return { ok: false, elapsed, error: `HTTP ${r.status}` };
    const data = await r.json().catch(() => null);
    return {
      ok: true,
      elapsed,
      candidateCount:
        data?.candidateCount ??
        data?.session?.candidateCount ??
        data?.sessionSummary?.candidateCount ??
        null,
      topProduct:
        data?.topProduct ||
        data?.recommendedProducts?.[0]?.productCode ||
        data?.candidateHighlights?.[0]?.productCode ||
        null,
      appliedFilters:
        data?.appliedFilters || data?.session?.appliedFilters || data?.sessionSummary?.appliedFilters || [],
      reply: data?.reply || data?.message?.text || null,
    };
  } catch (e) {
    return { ok: false, elapsed: Date.now() - t0, error: String(e.message || e) };
  }
}

function evaluate(tc, runs) {
  const okRuns = runs.filter((r) => r.ok);
  if (okRuns.length === 0) return { verdict: 'ERROR', consistency: 0, reason: runs[0]?.error || 'no-ok-run' };

  const exp = tc.expect;
  const checks = [];

  // filters_should_include
  for (const f of exp.filters_should_include) {
    const hit = okRuns.filter((r) =>
      (r.appliedFilters || []).some((af) => {
        const field = af.field || af.key;
        const value = af.value;
        return field === f.field && String(value).toLowerCase() === String(f.value).toLowerCase();
      })
    ).length;
    checks.push({ name: `filter:${f.field}=${f.value}`, hit, total: okRuns.length });
  }

  // candidates_should_decrease
  if (exp.candidates_should_decrease && tc.actual_at_feedback.candidateCount != null) {
    const before = tc.actual_at_feedback.candidateCount;
    const hit = okRuns.filter((r) => r.candidateCount != null && r.candidateCount < before).length;
    checks.push({ name: 'candidates_decrease', hit, total: okRuns.length });
  }

  // top_product_should_not
  if (exp.top_product_should_not?.length) {
    const bad = new Set(exp.top_product_should_not);
    const hit = okRuns.filter((r) => r.topProduct && !bad.has(r.topProduct)).length;
    checks.push({ name: 'top_product_changed', hit, total: okRuns.length });
  }

  // consistency = same topProduct across runs
  const tops = okRuns.map((r) => r.topProduct || '');
  const uniq = new Set(tops);
  const consistency = uniq.size === 1 ? 1 : 1 - (uniq.size - 1) / okRuns.length;

  let verdict;
  if (checks.length === 0) {
    verdict = consistency >= 0.66 ? 'PASS' : 'UNSTABLE';
  } else {
    const passedChecks = checks.filter((c) => c.hit / c.total >= 0.66).length;
    if (passedChecks === checks.length) verdict = consistency >= 0.66 ? 'PASS' : 'UNSTABLE';
    else if (passedChecks === 0) verdict = 'FAIL';
    else verdict = 'PARTIAL';
  }

  return { verdict, consistency, checks, sampleTop: tops[0], sampleCount: okRuns[0]?.candidateCount };
}

(async () => {
  console.log(`[runner] BASE=${BASE} cases=${filtered.length} repeat=${REPEAT}`);
  const reachable = await probe();
  if (!reachable) {
    console.error(`[runner] ${BASE}/api/chat unreachable — start the server (npm run dev) then retry. No changes written.`);
    process.exit(2);
  }

  const results = [];
  for (let i = 0; i < filtered.length; i++) {
    const tc = filtered[i];
    const runs = [];
    for (let k = 0; k < REPEAT; k++) {
      runs.push(await callOnce(tc.input.userMessage));
    }
    const ev = evaluate(tc, runs);
    results.push({ id: tc.id, issueId: tc.issueId, category: tc.category, ...ev, runs });
    if ((i + 1) % 10 === 0 || i === filtered.length - 1) {
      console.log(`[runner] ${i + 1}/${filtered.length} ${tc.id} ${ev.verdict}`);
    }
  }

  // write run results
  fs.writeFileSync(
    path.join(ROOT, 'feedback-test-runs.json'),
    JSON.stringify(results, null, 2)
  );

  // tally
  const tally = { PASS: 0, FAIL: 0, PARTIAL: 0, UNSTABLE: 0, ERROR: 0 };
  for (const r of results) tally[r.verdict] = (tally[r.verdict] || 0) + 1;

  // category resolved counts
  const catStats = {};
  for (const r of results) {
    catStats[r.category] = catStats[r.category] || { total: 0, resolved: 0 };
    catStats[r.category].total += 1;
    if (r.verdict === 'PASS') catStats[r.category].resolved += 1;
  }

  // update metrics
  const metricsPath = path.join(ROOT, 'feedback-metrics.json');
  const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
  metrics.run = {
    base_url: BASE,
    repeat: REPEAT,
    cases_run: results.length,
    tally,
    카테고리별_해결: catStats,
    피드백_개선율: {
      bad_세션_해결: `${tally.PASS} / ${results.filter((r) => r.id.startsWith('FB-')).length}`,
    },
    timestamp: new Date().toISOString(),
  };
  delete metrics.note;
  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));

  // update tsv
  const tsvPath = path.join(ROOT, 'feedback-test-report.tsv');
  const lines = fs.readFileSync(tsvPath, 'utf8').split('\n');
  const header = lines[0];
  const byId = new Map(results.map((r) => [r.id, r]));
  const newLines = [header];
  // Need cases by id to map TSV rows back
  const caseById = new Map(cases.map((c) => [c.id, c]));
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 11) { newLines.push(lines[i]); continue; }
    // find the case for this row by issueId+inputSum — instead, regenerate from order
  }
  // Simpler: regenerate full TSV with run results
  const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const headerCols = ['이슈ID','카테고리','심각도','입력요약','시스템이해','DB반영','최종추천','이전결과','현재결과','판정','개선여부','comment'];
  const out = [headerCols.join('\t')];
  for (const tc of cases) {
    const r = byId.get(tc.id);
    const inputSum = normalize(tc.input.userMessage).slice(0, 40);
    const understand = tc.expect.filters_should_include.map((f) => `${f.field}=${f.value}`).join(',') || '-';
    const dbApplied = tc.actual_at_feedback.appliedFilters?.length ? `${tc.actual_at_feedback.appliedFilters.length}개` : '-';
    const finalRec = tc.actual_at_feedback.topProduct || '-';
    const prev = tc.actual_at_feedback.candidateCount != null ? `후보 ${tc.actual_at_feedback.candidateCount}` : '-';
    const curr = r ? (r.sampleCount != null ? `후보 ${r.sampleCount} top=${r.sampleTop || '-'}` : (r.sampleTop || '-')) : '미실행';
    const verdict = r ? r.verdict : 'PENDING';
    const improved = r ? (r.verdict === 'PASS' ? '개선됨' : r.verdict === 'FAIL' ? '미해결' : r.verdict === 'PARTIAL' ? '부분개선' : '-') : '-';
    out.push([
      tc.issueId, tc.category, tc.severity, inputSum, understand, dbApplied,
      finalRec, prev, curr, verdict, improved, normalize(tc.comment || '').slice(0, 60),
    ].join('\t'));
  }
  fs.writeFileSync(tsvPath, out.join('\n'));

  console.log('[runner] tally:', tally);
  console.log('[runner] wrote feedback-test-runs.json, updated feedback-metrics.json, feedback-test-report.tsv');
})();
