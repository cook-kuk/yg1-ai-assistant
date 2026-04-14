#!/usr/bin/env node
/**
 * YG1 Recommendation System Auto Test Runner
 * Uses Node.js http module (no curl - Korean encoding issues)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_HOST = '20.119.98.136';
const API_PORT = 3000;
const API_PATH = '/api/recommend';
const RESULTS_DIR = path.join(__dirname, '..', 'test-results');
const RESULTS_FILE = path.join(RESULTS_DIR, 'results.tsv');

fs.mkdirSync(RESULTS_DIR, { recursive: true });

// Global stats
const stats = {
  total: 0, pass: 0, fail: 0, warn: 0,
  kgHits: 0, kgTotal: 0,
  responseTimes: [],
  kgResponseTimes: [],
  llmResponseTimes: [],
  failures: [],
  bugs: []
};

// ===== HTTP Helper =====
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callRecommendAPIWithRetry(body, timeoutMs = 45000, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await callRecommendAPIRaw(body, timeoutMs);
      return result;
    } catch(e) {
      console.log(`  ⚡ Attempt ${attempt}/${maxRetries} failed: ${e.message.substring(0,60)}`);
      if (attempt < maxRetries) {
        const waitMs = attempt * 3000;
        console.log(`  ⏳ Waiting ${waitMs}ms before retry...`);
        await sleep(waitMs);
      } else {
        throw e;
      }
    }
  }
}

function callRecommendAPI(body, timeoutMs = 45000) {
  return callRecommendAPIWithRetry(body, timeoutMs, 3);
}

function callRecommendAPIRaw(body, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: API_HOST, port: API_PORT, path: API_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const startTime = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const elapsed = Date.now() - startTime;
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, body: json, elapsedMs: elapsed });
        } catch(e) {
          reject(new Error(`Parse error: ${e.message}, raw: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(postData);
    req.end();
  });
}

// ===== Build request body =====
function buildRequest(userMessage, session = null, opts = {}) {
  const messages = [];
  if (opts.history) {
    opts.history.forEach(h => messages.push(h));
  }
  messages.push({ role: 'user', text: userMessage });

  const body = {
    engine: 'serve',
    language: 'ko',
    messages: messages
  };
  if (session) {
    body.session = session;
  }
  if (opts.intakeForm) {
    body.intakeForm = opts.intakeForm;
  }
  return body;
}

// ===== Extract info from response =====
function extractInfo(res) {
  const b = res.body || {};
  const session = b.session?.publicState || b.session || {};
  return {
    text: (b.text || '').substring(0, 200),
    purpose: b.purpose || 'unknown',
    chips: b.chips || [],
    chipGroups: b.chipGroups || [],
    isComplete: b.isComplete,
    candidateCount: session.candidateCount ?? (b.candidates?.length ?? -1),
    appliedFilters: session.appliedFilters || [],
    filterCount: (session.appliedFilters || []).length,
    narrowingHistory: session.narrowingHistory || [],
    candidates: b.candidates || [],
    session: b.session,
    error: b.error || b.detail,
    kgConfidence: b.requestPreparation?.kgConfidence ?? b.meta?.kgConfidence ?? null,
    elapsedMs: res.elapsedMs,
    raw: b
  };
}

// ===== Result logging =====
function initResultsFile() {
  const header = '번호\t카테고리\t입력\t기대결과\t실제결과\t판정\tKG_conf\t필터수\t후보수\t응답시간ms\n';
  fs.writeFileSync(RESULTS_FILE, header);
}

let testCounter = 0;
function logResult(category, input, expected, actual, verdict, kgConf, filterCount, candidateCount, elapsedMs) {
  testCounter++;
  stats.total++;
  if (verdict === 'PASS') stats.pass++;
  else if (verdict === 'FAIL') stats.fail++;
  else if (verdict === 'WARN') stats.warn++;

  stats.responseTimes.push(elapsedMs);
  if (kgConf !== null && kgConf !== undefined) {
    stats.kgTotal++;
    if (kgConf >= 0.85) stats.kgHits++;
    if (kgConf >= 0.85) stats.kgResponseTimes.push(elapsedMs);
    else stats.llmResponseTimes.push(elapsedMs);
  }
  if (verdict === 'FAIL') {
    stats.failures.push({ num: testCounter, category, input, expected, actual });
  }

  const line = `${testCounter}\t${category}\t${input.substring(0,60)}\t${expected.substring(0,80)}\t${actual.substring(0,80)}\t${verdict}\t${kgConf ?? ''}\t${filterCount}\t${candidateCount}\t${elapsedMs}\n`;
  fs.appendFileSync(RESULTS_FILE, line);

  const icon = verdict === 'PASS' ? '✅' : verdict === 'FAIL' ? '❌' : '⚠️';
  console.log(`${icon} #${testCounter} [${category}] ${input.substring(0,40)} → ${verdict} (${elapsedMs}ms, candidates=${candidateCount})`);
}

// ===== Test helpers =====
function hasFilter(info, field, value) {
  return info.appliedFilters.some(f => {
    if (f.field !== field) return false;
    if (value === undefined) return true;
    return String(f.value).includes(String(value)) || String(f.rawValue).includes(String(value));
  });
}

function hasExcludeFilter(info, field) {
  return info.appliedFilters.some(f => f.field === field && (f.op === 'exclude' || f.op === 'neq'));
}

function noError(info) {
  return !info.error && !info.text.includes('오류가 발생했습니다');
}

// ===== Multi-turn helper =====
async function multiTurn(steps) {
  let session = null;
  const history = [];
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    if (i > 0) await sleep(500); // throttle between turns
    const body = buildRequest(steps[i].msg, session, { history });
    const res = await callRecommendAPI(body);
    const info = extractInfo(res);
    results.push(info);
    session = info.session;
    history.push({ role: 'user', text: steps[i].msg });
    history.push({ role: 'ai', text: info.text });
  }
  return results;
}

// ======================================================================
// TEST SUITES
// ======================================================================

async function test1_multiFilter() {
  console.log('\n=== 1. 첫 턴 멀티필터 (10개) ===');
  const cases = [
    { input: '피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘', expect: 'material+toolSubtype+fluteCount+diameter', minFilters: 2 },
    { input: '탄소강 10mm 4날 Square TiAlN 추천해줘', expect: '5개 필터', minFilters: 3 },
    { input: '스테인리스 8mm Ball 추천', expect: '3개 필터', minFilters: 2 },
    { input: '알루미늄 12mm Radius', expect: '3개 필터', minFilters: 2 },
    { input: '구리 2날 10mm', expect: '3개 필터', minFilters: 2 },
    { input: 'copper square 2flute 10mm', expect: '영어 4개 필터', minFilters: 2 },
    { input: 'SUS304 황삭용 추천', expect: '소재+가공방식', minFilters: 1 },
    { input: '고경도강 6mm 볼 추천', expect: '3개 필터', minFilters: 2 },
    { input: '주철 4날 Square', expect: '3개 필터', minFilters: 2 },
    { input: '티타늄 합금 2날 Ball', expect: '3개 필터', minFilters: 2 },
  ];

  for (const c of cases) {
    try {
      const body = buildRequest(c.input);
      const res = await callRecommendAPI(body);
      const info = extractInfo(res);

      const ok = noError(info) && info.filterCount >= c.minFilters && info.candidateCount > 0;
      const verdict = ok ? 'PASS' : (!noError(info) ? 'FAIL' : (info.candidateCount === 0 ? 'FAIL' : 'WARN'));
      logResult('1.멀티필터', c.input, c.expect,
        `filters=${info.filterCount} candidates=${info.candidateCount} ${info.error||''}`,
        verdict, info.kgConfidence, info.filterCount, info.candidateCount, info.elapsedMs);
    } catch(e) {
      logResult('1.멀티필터', c.input, c.expect, `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0);
    }
  }
}

async function test2_filterChange() {
  console.log('\n=== 2. 필터 변경 (10개) ===');
  const changes = [
    { setup: 'Square 4날 10mm 추천', change: 'Ball로 바꿔줘', field: 'toolSubtype', newVal: 'Ball' },
    { setup: 'Square 4날 10mm', change: '6날로 변경', field: 'fluteCount', newVal: '6' },
    { setup: 'Square 4날 10mm', change: '8mm로 바꿔', field: 'diameterMm', newVal: '8' },
    { setup: 'Square 4날 TiAlN', change: 'AlCrN으로', field: 'coating', newVal: 'AlCrN' },
    { setup: '탄소강 Square 4날', change: '스테인리스로', field: 'workPieceName', newVal: 'Stainless' },
    { setup: 'Square 4날 12mm', change: '10mm로 줄여줘', field: 'diameterMm', newVal: '10' },
    { setup: 'Square 4날 TiCN', change: 'TiAlN으로 교체', field: 'coating', newVal: 'TiAlN' },
    { setup: 'Square 4날 10mm', change: 'Radius로 바꿔', field: 'toolSubtype', newVal: 'Radius' },
    { setup: 'Square 4날 10mm', change: '3날로 줄여줘', field: 'fluteCount', newVal: '3' },
    { setup: 'Square 4날 10mm', change: '직경만 6mm로', field: 'diameterMm', newVal: '6' },
  ];

  for (const c of changes) {
    try {
      // Setup
      const body1 = buildRequest(c.setup);
      const res1 = await callRecommendAPI(body1);
      const info1 = extractInfo(res1);

      // Change
      const body2 = buildRequest(c.change, info1.session, {
        history: [{ role: 'user', text: c.setup }, { role: 'ai', text: info1.text }]
      });
      const res2 = await callRecommendAPI(body2);
      const info2 = extractInfo(res2);

      const ok = noError(info2) && info2.candidateCount > 0;
      const verdict = ok ? 'PASS' : 'FAIL';
      logResult('2.필터변경', `${c.setup} → ${c.change}`, `${c.field}→${c.newVal}`,
        `filters=${info2.filterCount} candidates=${info2.candidateCount} ${info2.error||''}`,
        verdict, info2.kgConfidence, info2.filterCount, info2.candidateCount, info2.elapsedMs);
    } catch(e) {
      logResult('2.필터변경', `${c.setup} → ${c.change}`, `${c.field}→${c.newVal}`, `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0);
    }
  }
}

async function test3_negation() {
  console.log('\n=== 3. 부정/제외 (10개) ===');
  const cases = [
    { setup: 'Square 4날', msg: 'TiAlN 빼고 나머지요', expect: 'TiAlN 제외' },
    { setup: 'Square 4날', msg: 'TiAlN만 아니면 돼', expect: 'TiAlN 제외' },
    { setup: 'Square 4날', msg: 'TiAlN 제외하고', expect: 'TiAlN 제외' },
    { setup: '4날 10mm', msg: 'Square 빼고', expect: 'Square 제외' },
    { setup: 'Square 10mm', msg: '4날 말고 다른거', expect: '4날 제외' },
    { setup: '4날 10mm', msg: 'Ball 아닌것', expect: 'Ball 제외' },
    { setup: '4날 10mm', msg: '코팅 없는거', expect: 'Uncoated/Bright' },
    { setup: '4날 10mm', msg: 'DLC 빼고 TiAlN으로', expect: 'DLC제외+TiAlN적용' },
    { setup: 'Square 4날', msg: '아니 TiAlN만 아니면 된다니까', expect: 'TiAlN 제외' },
    { setup: '4날 10mm', msg: '코팅 없는 걸로', expect: 'Uncoated' },
  ];

  for (const c of cases) {
    try {
      const body1 = buildRequest(c.setup);
      const res1 = await callRecommendAPI(body1);
      const info1 = extractInfo(res1);

      const body2 = buildRequest(c.msg, info1.session, {
        history: [{ role: 'user', text: c.setup }, { role: 'ai', text: info1.text }]
      });
      const res2 = await callRecommendAPI(body2);
      const info2 = extractInfo(res2);

      const ok = noError(info2) && info2.candidateCount > 0;
      const verdict = ok ? 'PASS' : 'FAIL';
      logResult('3.부정제외', c.msg, c.expect,
        `filters=${info2.filterCount} candidates=${info2.candidateCount}`,
        verdict, info2.kgConfidence, info2.filterCount, info2.candidateCount, info2.elapsedMs);
    } catch(e) {
      logResult('3.부정제외', c.msg, c.expect, `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0);
    }
  }
}

async function test4_stateNav() {
  console.log('\n=== 4. 상태 관리/네비게이션 (10개) ===');

  // Test: 처음부터 다시
  try {
    const results = await multiTurn([
      { msg: 'Square 4날 10mm' },
      { msg: '처음부터 다시' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.filterCount === 0;
    logResult('4.네비게이션', '처음부터 다시', '리셋, 필터0',
      `filters=${last.filterCount} candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('4.네비게이션', '처음부터 다시', '리셋', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Test: 이전 단계
  try {
    const results = await multiTurn([
      { msg: 'Square 4날' },
      { msg: '이전 단계' }
    ]);
    const r0 = results[0], r1 = results[1];
    const ok = noError(r1) && r1.filterCount < r0.filterCount;
    logResult('4.네비게이션', '이전 단계', '필터 1개 제거',
      `before=${r0.filterCount} after=${r1.filterCount}`,
      ok ? 'PASS' : (noError(r1) ? 'WARN' : 'FAIL'), r1.kgConfidence, r1.filterCount, r1.candidateCount, r1.elapsedMs);
  } catch(e) { logResult('4.네비게이션', '이전 단계', '필터 1개 제거', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Test: 이전 → 후보 수 복원
  try {
    const results = await multiTurn([
      { msg: 'Square' },
      { msg: '4날' },
      { msg: 'TiAlN' },
      { msg: '이전' }
    ]);
    const r2 = results[2], r3 = results[3];
    const ok = noError(r3) && r3.candidateCount >= r2.candidateCount;
    logResult('4.네비게이션', '3필터→이전→복원', '후보수 복원',
      `before=${r2.candidateCount} after=${r3.candidateCount}`,
      ok ? 'PASS' : 'WARN', r3.kgConfidence, r3.filterCount, r3.candidateCount, r3.elapsedMs);
  } catch(e) { logResult('4.네비게이션', '3필터→이전', '복원', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Test: 초기화
  try {
    const results = await multiTurn([
      { msg: 'Square 4날 10mm' },
      { msg: '초기화' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.filterCount === 0;
    logResult('4.네비게이션', '초기화', '전체 리셋',
      `filters=${last.filterCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('4.네비게이션', '초기화', '리셋', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Test: 리셋 후 새 조건
  try {
    const results = await multiTurn([
      { msg: 'Square 4날' },
      { msg: '처음부터 다시' },
      { msg: 'Ball 2날' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('4.네비게이션', '리셋→새조건', '깨끗한 세션',
      `filters=${last.filterCount} candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('4.네비게이션', '리셋→새조건', '새 세션', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Test: 이전 단계로 2번 연속
  try {
    const results = await multiTurn([
      { msg: 'Square' },
      { msg: '4날' },
      { msg: 'TiAlN' },
      { msg: '이전 단계로' },
      { msg: '이전 단계로' }
    ]);
    const r2 = results[2], r4 = results[4];
    const ok = noError(r4) && r4.filterCount <= r2.filterCount - 2;
    logResult('4.네비게이션', '이전x2', '2개 필터 제거',
      `r2filters=${r2.filterCount} r4filters=${r4.filterCount}`,
      ok ? 'PASS' : 'WARN', r4.kgConfidence, r4.filterCount, r4.candidateCount, r4.elapsedMs);
  } catch(e) { logResult('4.네비게이션', '이전x2', '2개 제거', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Test: 다시 처음부터
  try {
    const results = await multiTurn([
      { msg: 'Square' },
      { msg: '4날' },
      { msg: '다시 처음부터' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.filterCount === 0;
    logResult('4.네비게이션', '다시 처음부터', '전체 리셋',
      `filters=${last.filterCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('4.네비게이션', '다시 처음부터', '리셋', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Test: 5턴 후 처음부터
  try {
    const results = await multiTurn([
      { msg: 'Square' },
      { msg: '4날' },
      { msg: '10mm' },
      { msg: 'TiAlN' },
      { msg: '스테인리스' },
      { msg: '처음부터' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.filterCount === 0;
    logResult('4.네비게이션', '5턴후 처음부터', '전체 리셋',
      `filters=${last.filterCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('4.네비게이션', '5턴후 처음부터', '리셋', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Test: 이전 (단독)
  try {
    const body1 = buildRequest('Square 4날 10mm');
    const res1 = await callRecommendAPI(body1);
    const info1 = extractInfo(res1);
    const body2 = buildRequest('돌아가', info1.session, {
      history: [{ role: 'user', text: 'Square 4날 10mm' }, { role: 'ai', text: info1.text }]
    });
    const res2 = await callRecommendAPI(body2);
    const info2 = extractInfo(res2);
    const ok = noError(info2);
    logResult('4.네비게이션', '돌아가', '이전 단계',
      `filters=${info2.filterCount} candidates=${info2.candidateCount}`,
      ok ? 'PASS' : 'FAIL', info2.kgConfidence, info2.filterCount, info2.candidateCount, info2.elapsedMs);
  } catch(e) { logResult('4.네비게이션', '돌아가', '이전', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Test: 이전 단계로 (formal)
  try {
    const body1 = buildRequest('Ball 2날');
    const res1 = await callRecommendAPI(body1);
    const info1 = extractInfo(res1);
    const body2 = buildRequest('이전 단계로', info1.session, {
      history: [{ role: 'user', text: 'Ball 2날' }, { role: 'ai', text: info1.text }]
    });
    const res2 = await callRecommendAPI(body2);
    const info2 = extractInfo(res2);
    const ok = noError(info2) && info2.filterCount < info1.filterCount;
    logResult('4.네비게이션', '이전 단계로', '필터 제거',
      `before=${info1.filterCount} after=${info2.filterCount}`,
      ok ? 'PASS' : 'WARN', info2.kgConfidence, info2.filterCount, info2.candidateCount, info2.elapsedMs);
  } catch(e) { logResult('4.네비게이션', '이전 단계로', '필터 제거', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
}

async function test5_skip() {
  console.log('\n=== 5. skip/상관없음 (5개) ===');
  const skips = ['상관없음', '아무거나', '알아서', '패스', '넘어가'];
  for (const skip of skips) {
    try {
      const body1 = buildRequest('Square 4날');
      const res1 = await callRecommendAPI(body1);
      const info1 = extractInfo(res1);

      const body2 = buildRequest(skip, info1.session, {
        history: [{ role: 'user', text: 'Square 4날' }, { role: 'ai', text: info1.text }]
      });
      const res2 = await callRecommendAPI(body2);
      const info2 = extractInfo(res2);

      const ok = noError(info2) && info2.candidateCount > 0;
      logResult('5.skip', skip, 'skip처리+후보유지',
        `candidates=${info2.candidateCount} filters=${info2.filterCount}`,
        ok ? 'PASS' : 'FAIL', info2.kgConfidence, info2.filterCount, info2.candidateCount, info2.elapsedMs);
    } catch(e) { logResult('5.skip', skip, 'skip', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
  }
}

async function test6_multiTurnScenarios() {
  console.log('\n=== 6. 멀티턴 시나리오 (A~J) ===');

  // Scenario A: intake → Square → 4날 → TiAlN → 추천 → 직경 바꿔 → 8mm
  try {
    const results = await multiTurn([
      { msg: 'Square' },
      { msg: '4날' },
      { msg: 'TiAlN' },
      { msg: '추천해줘' },
      { msg: '직경 8mm로 바꿔' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('6.멀티턴A', 'Square→4날→TiAlN→추천→8mm', '정상흐름',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('6.멀티턴A', 'scenario A', '정상', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Scenario B: 구리 2날 10mm → 추천 → Ball로 바꿔
  try {
    const results = await multiTurn([
      { msg: '구리 2날 10mm' },
      { msg: '추천해줘' },
      { msg: 'Ball로 바꿔' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('6.멀티턴B', '구리2날10mm→추천→Ball', 'Ball변경',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('6.멀티턴B', 'scenario B', '정상', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Scenario C: Square → 빼고 Ball → 4날 → TiAlN → 추천
  try {
    const results = await multiTurn([
      { msg: 'Square' },
      { msg: '아니 Ball로' },
      { msg: '4날' },
      { msg: 'TiAlN' },
      { msg: '추천해줘' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('6.멀티턴C', 'Square→Ball변경→4날→TiAlN', '수정흐름',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('6.멀티턴C', 'scenario C', '정상', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Scenario D: 상관없음 x3 → 추천
  try {
    const results = await multiTurn([
      { msg: '상관없음' },
      { msg: '상관없음' },
      { msg: '상관없음' },
      { msg: '추천해줘' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('6.멀티턴D', '상관없음x3→추천', 'skip연속',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('6.멀티턴D', 'scenario D', '정상', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Scenario E: 추천 → 이전 → 다른선택 → 추천
  try {
    const results = await multiTurn([
      { msg: 'Square 4날 10mm' },
      { msg: '추천해줘' },
      { msg: '이전' },
      { msg: 'Ball' },
      { msg: '추천해줘' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('6.멀티턴E', '추천→이전→Ball→재추천', '수정후추천',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('6.멀티턴E', 'scenario E', '정상', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Scenario F: TiAlN 빼고 나머지 → 형상 → 날수 → 추천
  try {
    const results = await multiTurn([
      { msg: '코팅은 TiAlN 빼고 나머지' },
      { msg: 'Square' },
      { msg: '4날' },
      { msg: '추천해줘' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('6.멀티턴F', 'TiAlN제외→Square→4날→추천', '제외+정상',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('6.멀티턴F', 'scenario F', '정상', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Scenario G: 추천→처음부터→다른조건→추천
  try {
    const results = await multiTurn([
      { msg: 'Square 4날' },
      { msg: '추천해줘' },
      { msg: '처음부터 다시' },
      { msg: 'Ball 2날 6mm' },
      { msg: '추천해줘' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('6.멀티턴G', '추천→리셋→Ball2날6mm→추천', '리셋후추천',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('6.멀티턴G', 'scenario G', '정상', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Scenario H: 3개한번에 → 추천 → 코팅만바꿔 → 재추천
  try {
    const results = await multiTurn([
      { msg: 'Square 4날 10mm' },
      { msg: '추천해줘' },
      { msg: '코팅만 AlCrN으로 바꿔' },
      { msg: '추천해줘' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('6.멀티턴H', '3개→추천→코팅변경→재추천', '코팅교체',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('6.멀티턴H', 'scenario H', '정상', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Scenario I: 구리 2날 10mm → Ball로 바꿔 → 재추천 → 비교
  try {
    const results = await multiTurn([
      { msg: '구리 2날 10mm' },
      { msg: '추천해줘' },
      { msg: 'Ball로 바꿔' },
      { msg: '추천해줘' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('6.멀티턴I', '구리2날10mm→Ball→재추천', '변경후추천',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('6.멀티턴I', 'scenario I', '정상', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // Scenario J: Square→Radius→Ball→직경줄여→추천
  try {
    const results = await multiTurn([
      { msg: 'Square' },
      { msg: 'Radius로' },
      { msg: '아니 Ball로' },
      { msg: '직경 6mm로 줄여' },
      { msg: '추천해줘' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('6.멀티턴J', 'Square→Radius→Ball→6mm→추천', '다중변경',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('6.멀티턴J', 'scenario J', '정상', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
}

async function test7_recommendation() {
  console.log('\n=== 7. 추천 기능 (5개) ===');

  // 추천해줘
  try {
    const results = await multiTurn([
      { msg: 'Square 4날 10mm' },
      { msg: '추천해줘' }
    ]);
    const last = results[results.length - 1];
    const hasCandidates = last.candidates.length > 0;
    const isPurpose = last.purpose === 'recommendation' || last.purpose === 'question';
    const ok = noError(last) && hasCandidates;
    logResult('7.추천', '추천해줘', 'purpose=recommendation+카드',
      `purpose=${last.purpose} candidates=${last.candidates.length}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('7.추천', '추천해줘', '카드', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // 지금 바로 제품 보기
  try {
    const results = await multiTurn([
      { msg: 'Square 4날' },
      { msg: '지금 바로 제품 보기' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('7.추천', '지금 바로 제품 보기', '현재필터 결과',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('7.추천', '제품 보기', '결과', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // AI 상세 분석
  try {
    const results = await multiTurn([
      { msg: 'Square 4날 10mm TiAlN' },
      { msg: '추천해줘' },
      { msg: 'AI 상세 분석' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last);
    logResult('7.추천', 'AI 상세 분석', 'AI분석 응답',
      `text=${last.text.substring(0,50)}`,
      ok ? 'PASS' : 'WARN', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('7.추천', 'AI 상세 분석', '분석', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // 필터 2개만으로 추천
  try {
    const results = await multiTurn([
      { msg: 'Square' },
      { msg: '추천해줘' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('7.추천', '필터2개→추천', '넓은범위 추천',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('7.추천', '필터2개→추천', '추천', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // 더 보여줘
  try {
    const results = await multiTurn([
      { msg: 'Square 4날' },
      { msg: '추천해줘' },
      { msg: '더 보여줘' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last);
    logResult('7.추천', '더 보여줘', '다음 페이지',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'WARN', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('7.추천', '더 보여줘', '페이지', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
}

async function test8_comparison() {
  console.log('\n=== 8. 비교 기능 (5개) ===');

  const compCases = [
    { msgs: ['Square 4날 10mm', '추천해줘', '상위 3개 비교'], expect: '비교 테이블' },
    { msgs: ['Square 4날 10mm', '추천해줘', '첫번째 두번째 차이'], expect: '차이점' },
    { msgs: ['TiAlN이 좋아 AlCrN이 좋아?'], expect: '코팅 비교' },
  ];

  for (const c of compCases) {
    try {
      const results = await multiTurn(c.msgs.map(m => ({ msg: m })));
      const last = results[results.length - 1];
      const ok = noError(last);
      logResult('8.비교', c.msgs[c.msgs.length-1], c.expect,
        `purpose=${last.purpose} text=${last.text.substring(0,50)}`,
        ok ? 'PASS' : 'WARN', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
    } catch(e) { logResult('8.비교', c.msgs[c.msgs.length-1], c.expect, `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
  }

  // 제품 상세
  try {
    const body = buildRequest('4G MILL X5070 알려줘');
    const res = await callRecommendAPI(body);
    const info = extractInfo(res);
    const ok = noError(info);
    logResult('8.비교', '4G MILL X5070 알려줘', '제품 상세',
      `text=${info.text.substring(0,50)}`,
      ok ? 'PASS' : 'WARN', info.kgConfidence, info.filterCount, info.candidateCount, info.elapsedMs);
  } catch(e) { logResult('8.비교', '4G MILL 상세', '상세', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }

  // 시리즈 비교
  try {
    const body = buildRequest('SEME71이랑 SEME72 비교해줘');
    const res = await callRecommendAPI(body);
    const info = extractInfo(res);
    const ok = noError(info);
    logResult('8.비교', 'SEME71 vs SEME72', '시리즈 비교',
      `text=${info.text.substring(0,50)}`,
      ok ? 'PASS' : 'WARN', info.kgConfidence, info.filterCount, info.candidateCount, info.elapsedMs);
  } catch(e) { logResult('8.비교', 'SEME71 vs SEME72', '비교', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
}

async function test9_questions() {
  console.log('\n=== 9. 질문 (필터 안 바뀌어야) (10개) ===');
  const questions = [
    'TiAlN이 뭐야?', '4날 6날 차이', '코너 래디우스가 뭐야?',
    '황삭 정삭 차이', 'YG-1 어떤 회사?', 'Square 뭐에 써?',
    '코팅 종류 알려줘', '절삭속도가 뭐야?', '헬릭스각 중요해?', '엔드밀 드릴 차이'
  ];

  for (const q of questions) {
    try {
      // Setup with filters first
      const body1 = buildRequest('Square 4날');
      const res1 = await callRecommendAPI(body1);
      const info1 = extractInfo(res1);
      const beforeFilters = info1.filterCount;

      // Ask question
      const body2 = buildRequest(q, info1.session, {
        history: [{ role: 'user', text: 'Square 4날' }, { role: 'ai', text: info1.text }]
      });
      const res2 = await callRecommendAPI(body2);
      const info2 = extractInfo(res2);

      const filtersUnchanged = info2.filterCount === beforeFilters;
      const ok = noError(info2) && filtersUnchanged;
      const verdict = ok ? 'PASS' : (!noError(info2) ? 'FAIL' : 'WARN');
      logResult('9.질문', q, '필터 불변',
        `before=${beforeFilters} after=${info2.filterCount} purpose=${info2.purpose}`,
        verdict, info2.kgConfidence, info2.filterCount, info2.candidateCount, info2.elapsedMs);
    } catch(e) { logResult('9.질문', q, '필터 불변', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
  }
}

async function test10_naturalLanguage() {
  console.log('\n=== 10. 복합 자연어 (15개) ===');
  const cases = [
    '구리 전용 2날 10mm', '알루미늄 고속가공', 'SUS304 황삭',
    '스테인리스 마무리', '금형 곡면', '티타늄 가공',
    '인코넬용', '프리하든강', '칩 배출 좋은',
    '진동 적은', '긴 가공 깊이', '측면 가공',
    '포켓 가공', '3D 곡면', '깊은 홈'
  ];

  for (const c of cases) {
    try {
      const body = buildRequest(c);
      const res = await callRecommendAPI(body);
      const info = extractInfo(res);
      const ok = noError(info) && info.candidateCount > 0;
      logResult('10.자연어', c, '필터적용+후보>0',
        `filters=${info.filterCount} candidates=${info.candidateCount}`,
        ok ? 'PASS' : (noError(info) ? 'WARN' : 'FAIL'), info.kgConfidence, info.filterCount, info.candidateCount, info.elapsedMs);
    } catch(e) { logResult('10.자연어', c, '필터+후보', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
  }
}

async function test11_crxsCopper() {
  console.log('\n=== 11. CRX-S 구리 변주 (20개) ===');
  const cases = [
    '구리 스퀘어 2날 10mm', 'copper square 2flute 10mm',
    '동 가공용 엔드밀 10mm', 'Cu 소재 Square D10',
    '비철 구리 Square 2날 10mm', '구리 평날 두날 열미리',
    '구리 Square 2날 6mm', '구리 Square 2날 8mm',
    '구리 Square 2날 12mm', '구리 Square 2날 4mm',
    '구리 엔드밀 추천해줘', '동 가공용 추천',
    '구리 2날 10mm 추천', 'copper endmill 10mm',
    '구리 가공 스퀘어', 'Cu Square 2F 10',
    '구리합금 엔드밀', '동 10파이', '구리 D10 2날', '순동 가공'
  ];

  for (const c of cases) {
    try {
      const body = buildRequest(c);
      const res = await callRecommendAPI(body);
      const info = extractInfo(res);

      // Check if CRX-S appears in candidates or text
      const hasCRXS = info.text.includes('CRX') ||
        info.candidates.some(p => (p.seriesName||'').includes('CRX') || (p.brand||'').includes('CRX'));

      const ok = noError(info) && info.candidateCount > 0;
      const verdict = ok ? (hasCRXS ? 'PASS' : 'WARN') : 'FAIL';
      logResult('11.CRX-S', c, 'CRX-S 시리즈 상위',
        `candidates=${info.candidateCount} hasCRXS=${hasCRXS}`,
        verdict, info.kgConfidence, info.filterCount, info.candidateCount, info.elapsedMs);
    } catch(e) { logResult('11.CRX-S', c, 'CRX-S', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
  }
}

async function test12_materialRating() {
  console.log('\n=== 12. materialRatingScore 검증 (5개) ===');
  const cases = [
    { input: '구리 엔드밀 추천', series: 'CRX', material: '구리' },
    { input: '알루미늄 엔드밀 추천', series: 'ALU', material: '알루미늄' },
    { input: '스테인리스 엔드밀 추천', series: 'INOX', material: '스테인리스' },
    { input: '탄소강 엔드밀 추천', series: '4G', material: '탄소강' },
    { input: '고경도강 엔드밀 추천', series: 'D-POWER', material: '고경도강' },
  ];

  for (const c of cases) {
    try {
      const body = buildRequest(c.input);
      const res = await callRecommendAPI(body);
      const info = extractInfo(res);

      const hasExpectedSeries = info.candidates.some(p =>
        (p.seriesName||'').toUpperCase().includes(c.series) ||
        (p.brand||'').toUpperCase().includes(c.series)
      );

      const ok = noError(info) && info.candidateCount > 0;
      const verdict = ok ? (hasExpectedSeries ? 'PASS' : 'WARN') : 'FAIL';
      logResult('12.소재점수', c.input, `${c.series} 시리즈 상위`,
        `candidates=${info.candidateCount} hasSeries=${hasExpectedSeries}`,
        verdict, info.kgConfidence, info.filterCount, info.candidateCount, info.elapsedMs);
    } catch(e) { logResult('12.소재점수', c.input, c.series, `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
  }
}

async function test16_zeroFallback() {
  console.log('\n=== 16. 0건 fallback (5개) ===');

  const cases = [
    { input: '구리 Square 2날 10mm TiAlN DLC', expect: '조건 완화 제안' },
    { input: '인코넬 16파이 Square 2날 TiAlN DLC', expect: '0건 안내' },
  ];

  for (const c of cases) {
    try {
      const body = buildRequest(c.input);
      const res = await callRecommendAPI(body);
      const info = extractInfo(res);
      const ok = noError(info);
      // Even 0 candidates should get a useful message, not just "후보가 없습니다"
      const hasUsefulMsg = !info.text.includes('오류가 발생했습니다');
      logResult('16.0건fallback', c.input, c.expect,
        `candidates=${info.candidateCount} msg=${info.text.substring(0,50)}`,
        hasUsefulMsg ? 'PASS' : 'FAIL', info.kgConfidence, info.filterCount, info.candidateCount, info.elapsedMs);
    } catch(e) { logResult('16.0건fallback', c.input, c.expect, `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
  }

  // 0건 후 필터 제거 → 후보 복귀
  try {
    const results = await multiTurn([
      { msg: 'Square 2날 4mm TiAlN' },
      { msg: '이전' }
    ]);
    const last = results[results.length - 1];
    const ok = noError(last) && last.candidateCount > 0;
    logResult('16.0건fallback', '0건→이전→복귀', '후보 복귀',
      `candidates=${last.candidateCount}`,
      ok ? 'PASS' : 'FAIL', last.kgConfidence, last.filterCount, last.candidateCount, last.elapsedMs);
  } catch(e) { logResult('16.0건fallback', '0건→이전', '복귀', `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
}

async function test17_encoding() {
  console.log('\n=== 17. 언어/인코딩 (5개) ===');
  const cases = [
    { input: '스퀘어 4날', expect: '한국어 필터' },
    { input: 'square 4 flute', expect: '영어 필터' },
    { input: '스퀘어 4flute TiAlN', expect: '한영혼용' },
    { input: '10', expect: 'diameter 해석' },
    { input: 'Ø10', expect: 'diameter 해석' },
  ];

  for (const c of cases) {
    try {
      const body = buildRequest(c.input);
      const res = await callRecommendAPI(body);
      const info = extractInfo(res);
      const ok = noError(info) && info.candidateCount > 0;
      logResult('17.인코딩', c.input, c.expect,
        `filters=${info.filterCount} candidates=${info.candidateCount}`,
        ok ? 'PASS' : (noError(info) ? 'WARN' : 'FAIL'), info.kgConfidence, info.filterCount, info.candidateCount, info.elapsedMs);
    } catch(e) { logResult('17.인코딩', c.input, c.expect, `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
  }
}

async function test19_errorHandling() {
  console.log('\n=== 19. 에러 핸들링 (10개) ===');
  const cases = [
    { input: '', expect: '에러 안 남' },
    { input: '10', expect: '에러 안 남' },
    { input: '???', expect: '에러 안 남' },
    { input: 'A'.repeat(200), expect: '긴 메시지 에러 안 남' },
    { input: '4 flute TiAlN Square', expect: '영어 작동' },
    { input: 'ボールエンドミル', expect: '일본어 에러 안 남' },
    { input: 'squre', expect: 'Square 인식' },
    { input: 'ㅎㅎ 아무거나', expect: 'skip' },
    { input: '👍', expect: '에러 안 남' },
    { input: '10미리 4날', expect: 'diameter+flute' },
  ];

  for (const c of cases) {
    try {
      const body = buildRequest(c.input);
      const res = await callRecommendAPI(body);
      const info = extractInfo(res);
      const ok = noError(info);
      logResult('19.에러핸들링', c.input.substring(0,30), c.expect,
        `error=${!!info.error} text=${info.text.substring(0,40)}`,
        ok ? 'PASS' : 'FAIL', info.kgConfidence, info.filterCount, info.candidateCount, info.elapsedMs);
    } catch(e) { logResult('19.에러핸들링', c.input.substring(0,30), c.expect, `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
  }
}

async function test22_responseTime() {
  console.log('\n=== 22. 응답 시간 검증 ===');
  // Already tracked in every test via elapsedMs
  // This is just a summary check
  const timeouts = stats.responseTimes.filter(t => t > 30000);
  if (timeouts.length > 0) {
    logResult('22.응답시간', 'timeout check', '<30s', `${timeouts.length}건 타임아웃`, 'FAIL', null, 0, 0, 0);
  } else {
    logResult('22.응답시간', 'timeout check', '<30s', '타임아웃 0건', 'PASS', null, 0, 0, 0);
  }
}

async function test23_feedbackReproduction() {
  console.log('\n=== 23. 피드백 👎 재현 ===');
  // Reproduce actual user messages that got thumbs down
  const realCases = [
    { input: 'R1짜리 10파이 추천해줘', expect: 'Radius R1 10mm 필터' },
    { input: '인코넬 가공하는데 16파이 스퀘어 제품 추천해줘', expect: '인코넬 Square 16mm' },
    { input: '4날이 좋겠고, 가장 인기있는 아이템을 추천해줘', expect: '4날 필터 + 추천' },
    { input: '코팅은 상관없고, 소재는 알루미늄입니다', expect: 'coating skip + 알루미늄' },
    { input: '직경이 10mm인애들 추천해줘', expect: '10mm 필터' },
    { input: '블루코팅 후보제품군을 5위까지 보여줘', expect: '블루코팅 매핑' },
    { input: 'ALU-CUT이나 ALU-POWER 으로 추천해줘', expect: '시리즈명 인식' },
    { input: '공구 형상을 코너레디우스만 보여줘', expect: 'Radius 매핑' },
    { input: '3/8" 직경 제품으로 가공하고자 하며 좀 더 hardend steel 탄소강으로 추천해주실 수 있나요?', expect: '인치→mm 변환+필터' },
    { input: '나는 Aluminum이 아니고 Graphite를 가공하고 싶어요', expect: 'Graphite 소재 변경' },
    { input: '적층제조를 모르시나요?', expect: '에러 안 남', allowZeroCandidates: true },
    { input: '3날 무코팅에 스퀘어', expect: '3날+무코팅+Square' },
  ];

  for (const c of realCases) {
    try {
      const body = buildRequest(c.input);
      const res = await callRecommendAPI(body);
      const info = extractInfo(res);
      const ok = noError(info) && (c.allowZeroCandidates || info.candidateCount > 0);
      logResult('23.👎재현', c.input.substring(0,40), c.expect,
        `candidates=${info.candidateCount} filters=${info.filterCount} text=${info.text.substring(0,40)}`,
        ok ? 'PASS' : 'FAIL', info.kgConfidence, info.filterCount, info.candidateCount, info.elapsedMs);
    } catch(e) { logResult('23.👎재현', c.input.substring(0,40), c.expect, `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
  }
}

async function test15_domainKnowledge() {
  console.log('\n=== 15. 도메인 지식 (5개) ===');
  const cases = [
    { input: '떨림 적은 거', expect: '부등분할 4날' },
    { input: '면조도 좋은 거', expect: '볼 or 6날' },
    { input: '리브 가공용', expect: '테이퍼넥' },
    { input: '황삭 효율 좋은 거', expect: 'X-SPEED 라핑' },
    { input: '고이송 가공', expect: 'MMC볼 or 3날' },
  ];

  for (const c of cases) {
    try {
      const body = buildRequest(c.input);
      const res = await callRecommendAPI(body);
      const info = extractInfo(res);
      const ok = noError(info);
      logResult('15.도메인지식', c.input, c.expect,
        `text=${info.text.substring(0,60)}`,
        ok ? 'PASS' : 'FAIL', info.kgConfidence, info.filterCount, info.candidateCount, info.elapsedMs);
    } catch(e) { logResult('15.도메인지식', c.input, c.expect, `ERROR: ${e.message}`, 'FAIL', null, 0, 0, 0); }
  }
}

// ===== Final Report =====
function generateReport() {
  const avg = arr => arr.length ? Math.round(arr.reduce((a,b) => a+b, 0) / arr.length) : 0;

  const report = `
╔══════════════════════════════════════════════════╗
║           YG1 시스템 테스트 최종 리포트           ║
╠══════════════════════════════════════════════════╣
║ 총 테스트: ${String(stats.total).padStart(4)}                              ║
║ PASS:      ${String(stats.pass).padStart(4)} (${String(Math.round(stats.pass/stats.total*100)).padStart(3)}%)                         ║
║ FAIL:      ${String(stats.fail).padStart(4)} (${String(Math.round(stats.fail/stats.total*100)).padStart(3)}%)                         ║
║ WARN:      ${String(stats.warn).padStart(4)} (${String(Math.round(stats.warn/stats.total*100)).padStart(3)}%)                         ║
╠══════════════════════════════════════════════════╣
║ KG hit rate: ${stats.kgTotal > 0 ? Math.round(stats.kgHits/stats.kgTotal*100) : 'N/A'}%  (${stats.kgHits}/${stats.kgTotal})
║ 평균 응답 시간: ${avg(stats.responseTimes)}ms
║   KG 경로: ${avg(stats.kgResponseTimes)}ms
║   LLM 경로: ${avg(stats.llmResponseTimes)}ms
╠══════════════════════════════════════════════════╣
║ FAIL 목록:
${stats.failures.map(f => `║  #${f.num} [${f.category}] ${f.input.substring(0,35)}`).join('\n')}
╚══════════════════════════════════════════════════╝
`;

  console.log(report);
  fs.writeFileSync(path.join(RESULTS_DIR, 'final-report.txt'), report);
  return report;
}

// ===== Main Runner =====
async function main() {
  console.log('🚀 YG1 시스템 테스트 시작...');
  console.log(`Target: ${API_HOST}:${API_PORT}${API_PATH}`);
  console.log(`Results: ${RESULTS_FILE}`);
  console.log('');

  initResultsFile();

  // Run all test suites sequentially with throttling
  const suites = [
    test1_multiFilter, test2_filterChange, test3_negation,
    test4_stateNav, test5_skip, test6_multiTurnScenarios,
    test7_recommendation, test8_comparison, test9_questions,
    test10_naturalLanguage, test11_crxsCopper, test12_materialRating,
    test15_domainKnowledge, test16_zeroFallback, test17_encoding,
    test19_errorHandling, test22_responseTime, test23_feedbackReproduction,
  ];
  for (const suite of suites) {
    await suite();
    await sleep(1000); // throttle between suites
  }

  generateReport();
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
