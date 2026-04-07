#!/usr/bin/env node
/**
 * 우리 서버(cook_ver1) 데모용 10개 케이스 테스트
 */
const http = require('http');

const API_HOST = '20.119.98.136';
const API_PORT = 3000;
const API_PATH = '/api/recommend';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function callAPI(body, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const start = Date.now();
    const req = http.request({
      hostname: API_HOST, port: API_PORT, path: API_PATH, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(postData) }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ body: JSON.parse(data), ms: Date.now() - start }); }
        catch(e) { reject(new Error(`Parse: ${data.substring(0,200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(postData); req.end();
  });
}

async function callRetry(body, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try { return await callAPI(body); } catch(e) { if (i === retries) throw e; await sleep(2000); }
  }
}

function req(msg, session, history) {
  const messages = [...(history || []), { role: 'user', text: msg }];
  const body = { engine: 'serve', language: 'ko', messages };
  if (session) body.session = session;
  return body;
}

function ext(res) {
  const b = res?.body || {};
  const s = b.session?.publicState || b.session || {};
  return {
    text: b.text || '',
    purpose: b.purpose || '',
    cand: s.candidateCount ?? (b.candidates?.length ?? -1),
    filters: (s.appliedFilters || []),
    filterStr: (s.appliedFilters || []).map(f => `${f.field}=${f.value}`).join(', '),
    fCnt: (s.appliedFilters || []).length,
    chips: (b.chips || []).join(', '),
    session: b.session,
    error: b.error || b.detail,
    ms: res?.ms ?? 0,
  };
}
function ok(i) { return !i.error && !i.text.includes('오류가 발생했습니다'); }

async function multi(steps) {
  let session = null; const hist = []; const results = [];
  for (let i = 0; i < steps.length; i++) {
    if (i > 0) await sleep(400);
    const r = ext(await callRetry(req(steps[i], session, hist)));
    results.push(r);
    session = r.session;
    hist.push({ role: 'user', text: steps[i] }, { role: 'ai', text: r.text });
  }
  return results;
}

function truncate(s, n) { return s.length > n ? s.substring(0, n) + '…' : s; }

// ═══ 잘 되는 것 5개 ═══
const GOOD_TESTS = [
  { id: 135, label: '오타 인식 (squre→Square)', input: 'squre', check: r => ok(r) },
  { id: 134, label: '일본어 인식 (ボール→Ball)', input: 'ボールエンドミル', check: r => ok(r) },
  { id: 65, label: '제품코드 비교', input: 'SEME71 vs SEME72', check: r => ok(r) },
  { id: 116, label: '도메인 자연어 추천', input: '떨림 적은 거', check: r => ok(r) },
  { id: 38, label: '5턴 대화 후 리셋', steps: ['Square','4날','10mm','TiAlN','스테인리스','처음부터'], check: rs => ok(rs.at(-1)) && rs.at(-1).fCnt === 0 },
];

// ═══ 심각한 것 5개 (수정 대상) ═══
const BAD_TESTS = [
  { id: 91, label: '한글 구리+10mm (DB에러→추천)', input: '구리 스퀘어 2날 10mm', check: r => ok(r) && r.cand > 0, expectFix: 'isLikelyProductLookupCandidate 측정값 제외' },
  { id: 148, label: '인치→mm 변환 (3/8"→9.525mm)', input: '3/8" 직경 제품으로 가공하고자 하며 좀 더 hardend steel 탄소강으로 추천해주실 수 있나요?', check: r => ok(r) && r.cand > 0, expectFix: 'inch parser + material map' },
  { id: 30, label: '무코팅 필터 (코팅없는→Uncoated)', setup: '4날 10mm', input: '코팅 없는 걸로', check: r => ok(r) && r.cand > 0, expectFix: '"코팅 없"→Uncoated 매핑' },
  { id: 14, label: 'AlCrN 코팅변경', setup: 'Square 4날 TiAlN', input: 'AlCrN으로', check: r => ok(r) && r.cand > 0, expectFix: 'AlCrN coatingMap 추가' },
  { id: 144, label: '직경만 입력 (10mm→필터)', input: '직경이 10mm인애들 추천해줘', check: r => ok(r) && r.cand > 0, expectFix: '10mm product code 오인식 방지' },
];

// ═══ 추가 연쇄 확인 케이스 ═══
const EXTRA_TESTS = [
  { id: 8, label: '고경도강 6mm 볼 (6MM 오인식)', input: '고경도강 6mm 볼 추천', check: r => ok(r) && r.cand > 0 },
  { id: 20, label: '직경만 6mm로 (6MM 오인식)', setup: 'Square 4날 10mm', input: '직경만 6mm로', check: r => ok(r) && r.cand > 0 },
  { id: 27, label: '코팅 없는거 (Uncoated)', setup: '4날 10mm', input: '코팅 없는거', check: r => ok(r) && r.cand > 0 },
  { id: 145, label: '블루코팅 매핑', input: '블루코팅 후보제품군을 5위까지 보여줘', check: r => ok(r) && r.cand > 0 },
  { id: 151, label: '3날+무코팅+스퀘어', input: '3날 무코팅에 스퀘어', check: r => ok(r) && r.cand > 0 },
  { id: 149, label: 'Graphite 소재 변경', input: '나는 Aluminum이 아니고 Graphite를 가공하고 싶어요', check: r => ok(r) && r.cand > 0 },
];

async function runTest(test) {
  try {
    if (test.steps) {
      const rs = await multi(test.steps);
      const last = rs.at(-1);
      return { pass: test.check(rs), r: last };
    } else if (test.setup) {
      const r1 = ext(await callRetry(req(test.setup)));
      await sleep(400);
      const r2 = ext(await callRetry(req(test.input, r1.session, [{role:'user',text:test.setup},{role:'ai',text:r1.text}])));
      return { pass: test.check(r2), r: r2 };
    } else {
      const r = ext(await callRetry(req(test.input)));
      return { pass: test.check(r), r };
    }
  } catch(e) {
    return { pass: false, r: { text: `ERROR: ${e.message}`, cand: -1, fCnt: 0, filterStr: '', chips: '', ms: 0 } };
  }
}

function printResult(t, pass, r) {
  const icon = pass ? '✅' : '❌';
  console.log(`  ${icon} #${String(t.id).padEnd(3)} ${t.label}`);
  console.log(`       입력: ${truncate(t.steps ? t.steps.join('→') : (t.setup ? `[${t.setup}] ${t.input}` : t.input), 55)}`);
  console.log(`       응답: ${truncate(r.text.replace(/\n/g, ' '), 65)}`);
  console.log(`       필터: ${r.filterStr || '없음'} | 후보: ${r.cand}개 | ${r.ms}ms`);
  if (t.expectFix) console.log(`       수정: ${t.expectFix}`);
  console.log('');
}

(async () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   우리 서버 (cook_ver1) — http://20.119.98.136:3000          ║');
  console.log('║   테스트 시각: ' + new Date().toLocaleString('ko-KR').padEnd(43) + '║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log('');

  // ── Section 1: 잘 되는 것 5개 ──
  console.log('┌────────────────────────────────────────────────────────────────┐');
  console.log('│  ★ 잘 되는 것 5개 (VP 데모용 자랑)                            │');
  console.log('└────────────────────────────────────────────────────────────────┘');
  let g = 0;
  for (const t of GOOD_TESTS) {
    const { pass, r } = await runTest(t);
    if (pass) g++;
    printResult(t, pass, r);
    await sleep(300);
  }

  // ── Section 2: 심각한 것 5개 (수정 확인) ──
  console.log('┌────────────────────────────────────────────────────────────────┐');
  console.log('│  ✗ 심각한 것 5개 → 수정 후 결과                               │');
  console.log('└────────────────────────────────────────────────────────────────┘');
  let b = 0;
  for (const t of BAD_TESTS) {
    const { pass, r } = await runTest(t);
    if (pass) b++;
    printResult(t, pass, r);
    await sleep(300);
  }

  // ── Section 3: 연쇄 해결 확인 ──
  console.log('┌────────────────────────────────────────────────────────────────┐');
  console.log('│  ⊕ 추가 연쇄 해결 확인 6개                                    │');
  console.log('└────────────────────────────────────────────────────────────────┘');
  let e = 0;
  for (const t of EXTRA_TESTS) {
    const { pass, r } = await runTest(t);
    if (pass) e++;
    printResult(t, pass, r);
    await sleep(300);
  }

  // ── 총합 ──
  const total = g + b + e;
  const totalAll = GOOD_TESTS.length + BAD_TESTS.length + EXTRA_TESTS.length;
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log(`║  총합: ${total}/${totalAll} PASS                                                ║`);
  console.log(`║  ★ 잘 되는 것: ${g}/${GOOD_TESTS.length}                                                 ║`);
  console.log(`║  ✗ 수정 대상:  ${b}/${BAD_TESTS.length}  ${b===5?'← 전부 해결!':'← 아직 남은 것 있음'}                                  ║`);
  console.log(`║  ⊕ 연쇄 해결:  ${e}/${EXTRA_TESTS.length}                                                 ║`);
  console.log('╚════════════════════════════════════════════════════════════════╝');
})();
