#!/usr/bin/env node
/**
 * Step 1+2+4+5: Feedback → Test Cases + Issue Tracker + Report + Metrics
 * 입력: test-results/feedback-full-dump.json
 * 출력:
 *  - test-results/test-cases-from-feedback.json
 *  - test-results/issue-tracker.json
 *  - test-results/feedback-test-report.tsv
 *  - test-results/feedback-metrics.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const dump = JSON.parse(fs.readFileSync(path.join(ROOT, 'feedback-full-dump.json'), 'utf8'));
const general = dump.generalEntries || [];
const feedback = dump.feedbackEntries || [];

// ---------- helpers ----------
const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
const commentKey = (c) => normalize(c).slice(0, 50).toLowerCase();

function categorize(text, tags = []) {
  const t = (text || '').toLowerCase();
  const tagSet = new Set(tags);
  if (tagSet.has('wrong-product')) return 'WRONG_PRODUCT';
  if (tagSet.has('wrong-condition')) return 'WRONG_CONDITION';
  if (tagSet.has('missing-evidence')) return 'MISSING_EVIDENCE';
  if (tagSet.has('slow-response')) return 'SLOW';
  if (tagSet.has('ui-issue')) return 'UI';
  if (/국내|korea|한국|해외|수입/.test(t)) return 'COUNTRY';
  if (/코팅|coating|dlc|tial|tin/.test(t)) return 'COATING';
  if (/초경|carbide|hss|하이스/.test(t)) return 'TOOL_MATERIAL';
  if (/너무 ?많|혼동|줄여|선택지/.test(t)) return 'TOO_MANY';
  if (/느리|slow|지연/.test(t)) return 'SLOW';
  if (/없|누락|missing|보여주지/.test(t)) return 'MISSING_INFO';
  return 'OTHER';
}

function severity(rating, tags = []) {
  if (rating === 1) return 'critical';
  if (rating === 2) return 'major';
  if ((tags || []).includes('wrong-product')) return 'major';
  return 'minor';
}

// ---------- Step 2: Issue tracker (dedup) ----------
const issuesByKey = new Map(); // dedup key -> issue
const sessionToIssue = new Map();
let issueSeq = 0;

function getIssue({ sessionId, comment, category, tags, severity: sev }) {
  if (sessionId && sessionToIssue.has(sessionId)) {
    const iss = sessionToIssue.get(sessionId);
    iss.occurrences += 1;
    return iss;
  }
  const key = commentKey(comment) || `cat:${category}:${sessionId}`;
  if (issuesByKey.has(key)) {
    const iss = issuesByKey.get(key);
    iss.occurrences += 1;
    if (sessionId) {
      iss.sessionIds.add(sessionId);
      sessionToIssue.set(sessionId, iss);
    }
    return iss;
  }
  issueSeq += 1;
  const iss = {
    id: `ISS-${String(issueSeq).padStart(3, '0')}`,
    category,
    severity: sev,
    commentSample: normalize(comment).slice(0, 120),
    tags: tags || [],
    sessionIds: new Set(sessionId ? [sessionId] : []),
    occurrences: 1,
  };
  issuesByKey.set(key, iss);
  if (sessionId) sessionToIssue.set(sessionId, iss);
  return iss;
}

// ---------- Step 1: extract test cases ----------
const testCases = [];
let caseSeq = 0;
const nextId = () => `FB-${String(++caseSeq).padStart(4, '0')}`;

// Index feedbackEntries by sessionId
const fbBySession = new Map();
for (const f of feedback) {
  if (!f.sessionId) continue;
  if (!fbBySession.has(f.sessionId)) fbBySession.set(f.sessionId, []);
  fbBySession.get(f.sessionId).push(f);
}

// (A) general low-rating sessions
const lowRated = general.filter((g) => g.rating && g.rating <= 2);
for (const g of lowRated) {
  const cat = categorize(g.comment, g.tags);
  const sev = severity(g.rating, g.tags);
  const issue = getIssue({
    sessionId: g.sessionId,
    comment: g.comment,
    category: cat,
    tags: g.tags,
    severity: sev,
  });

  const userTurns = (g.chatHistory || []).filter((m) => m.role === 'user');
  // last user turn = the actionable input
  const lastUser = userTurns[userTurns.length - 1];
  if (!lastUser) continue;

  const top = (g.candidateHighlights || [])[0];

  testCases.push({
    id: nextId(),
    issueId: issue.id,
    source: 'general',
    feedbackId: g.id,
    sessionId: g.sessionId,
    category: cat,
    severity: sev,
    rating: g.rating,
    turnNumber: userTurns.length,
    turnFeedback: 'session-bad',
    input: {
      intakeSummary: g.intakeSummary || null,
      userMessage: lastUser.text,
      prevMessages: userTurns.slice(0, -1).map((m) => m.text),
      prevFilters: g.sessionSummary?.appliedFilters || [],
    },
    expect: buildExpect(g.comment, cat, top?.productCode),
    actual_at_feedback: {
      candidateCount: g.sessionSummary?.candidateCount ?? null,
      topProduct: top?.productCode || null,
      appliedFilters: g.sessionSummary?.appliedFilters || [],
      aiResponse: ((g.chatHistory || []).filter((m) => m.role === 'ai').slice(-1)[0] || {}).text || null,
    },
    comment: g.comment,
    tags: g.tags || [],
  });
}

// (B) bad turn-level feedback
const badTurns = feedback.filter((f) => f.responseFeedback === 'bad');
for (const f of badTurns) {
  const cat = categorize(f.userComment || f.lastUserMessage, []);
  const sev = f.userComment ? 'major' : 'minor';
  const issue = getIssue({
    sessionId: f.sessionId,
    comment: f.userComment || `bad-turn:${f.lastUserMessage || ''}`.slice(0, 80),
    category: cat,
    tags: ['turn-bad'],
    severity: sev,
  });

  testCases.push({
    id: nextId(),
    issueId: issue.id,
    source: 'turn',
    feedbackId: f.id,
    sessionId: f.sessionId,
    category: cat,
    severity: sev,
    rating: null,
    turnNumber: f.turnNumber,
    turnFeedback: 'bad',
    input: {
      intakeSummary: null,
      userMessage: f.lastUserMessage || f.userMessage || '',
      prevMessages: [],
      prevFilters: f.appliedFilters || [],
    },
    expect: buildExpect(f.userComment, cat, (f.topProducts || [])[0]),
    actual_at_feedback: {
      candidateCount: f.candidateCount ?? null,
      topProduct: (f.topProducts || [])[0] || null,
      appliedFilters: f.appliedFilters || [],
      aiResponse: f.lastAiResponse || null,
    },
    comment: f.userComment || null,
    tags: ['turn-bad'],
  });
}

function buildExpect(comment, category, currentTop) {
  const expect = {
    filters_should_include: [],
    filters_should_not_include: [],
    candidates_should_decrease: false,
    top_product_should_not: currentTop ? [currentTop] : [],
    invariants: [],
  };
  const c = (comment || '').toLowerCase();
  if (category === 'COUNTRY' || /국내|korea|한국/.test(c)) {
    expect.filters_should_include.push({ field: 'country', value: 'KOREA' });
    expect.candidates_should_decrease = true;
    expect.invariants.push('country=KOREA 적용 시 해외 제품 미포함');
  }
  if (category === 'TOOL_MATERIAL' || /초경|carbide/.test(c)) {
    expect.filters_should_include.push({ field: 'toolMaterial', value: 'Carbide' });
    expect.invariants.push('toolMaterial=Carbide 적용 시 HSS 제외');
  }
  if (category === 'COATING' || /코팅/.test(c)) {
    expect.invariants.push('요청된 coating 종류만 추천');
  }
  if (category === 'TOO_MANY' || /너무 ?많|줄여/.test(c)) {
    expect.candidates_should_decrease = true;
    expect.invariants.push('candidate 수 축소');
  }
  return expect;
}

// dedup test cases (same sessionId + same userMessage)
const seen = new Set();
const dedupedCases = [];
for (const tc of testCases) {
  const k = `${tc.sessionId}|${normalize(tc.input.userMessage)}`;
  if (seen.has(k)) continue;
  seen.add(k);
  dedupedCases.push(tc);
}

// ---------- Write outputs ----------
fs.writeFileSync(
  path.join(ROOT, 'test-cases-from-feedback.json'),
  JSON.stringify(dedupedCases, null, 2)
);

const issuesArr = [...new Set(issuesByKey.values())].map((i) => ({
  id: i.id,
  category: i.category,
  severity: i.severity,
  occurrences: i.occurrences,
  sessionCount: i.sessionIds.size,
  commentSample: i.commentSample,
  tags: i.tags,
  sessionIds: [...i.sessionIds].slice(0, 10),
}));
fs.writeFileSync(
  path.join(ROOT, 'issue-tracker.json'),
  JSON.stringify(issuesArr, null, 2)
);

// ---------- Step 4: TSV report ----------
const tsvLines = [
  ['이슈ID', '카테고리', '심각도', '입력요약', '시스템이해', 'DB반영', '최종추천', '이전결과', '현재결과', '판정', '개선여부', 'comment'].join('\t'),
];
for (const tc of dedupedCases) {
  const inputSum = normalize(tc.input.userMessage).slice(0, 40);
  const understand = tc.expect.filters_should_include.map((f) => `${f.field}=${f.value}`).join(',') || '-';
  const dbApplied = tc.actual_at_feedback.appliedFilters?.length ? `${tc.actual_at_feedback.appliedFilters.length}개` : '-';
  const finalRec = tc.actual_at_feedback.topProduct || '-';
  const prev = tc.actual_at_feedback.candidateCount != null ? `후보 ${tc.actual_at_feedback.candidateCount}` : '-';
  const curr = '미실행';
  const verdict = 'PENDING';
  const improved = '-';
  tsvLines.push([
    tc.issueId,
    tc.category,
    tc.severity,
    inputSum,
    understand,
    dbApplied,
    finalRec,
    prev,
    curr,
    verdict,
    improved,
    normalize(tc.comment || '').slice(0, 60),
  ].join('\t'));
}
fs.writeFileSync(path.join(ROOT, 'feedback-test-report.tsv'), tsvLines.join('\n'));

// ---------- Step 5: metrics ----------
const byCat = {};
for (const tc of dedupedCases) {
  byCat[tc.category] = byCat[tc.category] || { total: 0, critical: 0, major: 0, minor: 0 };
  byCat[tc.category].total += 1;
  byCat[tc.category][tc.severity] = (byCat[tc.category][tc.severity] || 0) + 1;
}

const metrics = {
  generated_at: new Date().toISOString(),
  source: 'test-results/feedback-full-dump.json',
  총_피드백: general.length,
  총_턴별_피드백: feedback.length,
  low_rating_세션: lowRated.length,
  bad_턴: badTurns.length,
  생성된_이슈: issuesArr.length,
  테스트_케이스: dedupedCases.length,
  카테고리별: byCat,
  상위_이슈: issuesArr
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 15)
    .map((i) => ({ id: i.id, category: i.category, occurrences: i.occurrences, sample: i.commentSample })),
  note: '러너 미실행 — 모든 케이스 verdict=PENDING. run-feedback-tests.js 실행 시 갱신됨.',
};
fs.writeFileSync(path.join(ROOT, 'feedback-metrics.json'), JSON.stringify(metrics, null, 2));

console.log(JSON.stringify({
  testCases: dedupedCases.length,
  issues: issuesArr.length,
  lowRatedSessions: lowRated.length,
  badTurns: badTurns.length,
  byCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, v.total])),
}, null, 2));
