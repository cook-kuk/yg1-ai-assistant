#!/usr/bin/env node
/**
 * VP 데모용 10개 케이스 — 부사장님 Vercel URL 직접 호출
 * 잘 되는 5개 + 심각한 5개
 */
const https = require('https');

const API_HOST = 'yg1-demo-seo.vercel.app';
const API_PATH = '/api/recommend';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function callAPI(body, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const start = Date.now();
    const req = https.request({
      hostname: API_HOST, port: 443, path: API_PATH, method: 'POST',
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

// ═══════════════════════════════════════
// 데모 10선
// ═══════════════════════════════════════
const GOOD_TESTS = [
  { id: 135, label: '오타 인식', input: 'squre', check: r => ok(r) },
  { id: 134, label: '일본어 인식', input: 'ボールエンドミル', check: r => ok(r) },
  { id: 65, label: '제품코드 비교', input: 'SEME71 vs SEME72', check: r => ok(r) },
  { id: 116, label: '도메인 자연어', input: '떨림 적은 거', check: r => ok(r) },
  { id: 38, label: '5턴 리셋', steps: ['Square','4날','10mm','TiAlN','스테인리스','처음부터'], check: rs => ok(rs.at(-1)) && rs.at(-1).fCnt === 0 },
];

const BAD_TESTS = [
  { id: 91, label: '한글 구리+10mm→DB에러', input: '구리 스퀘어 2날 10mm', check: r => ok(r) && r.cand > 0 },
  { id: 148, label: '인치→mm 변환 실패', input: '3/8" 직경 제품으로 가공하고자 하며 좀 더 hardend steel 탄소강으로 추천해주실 수 있나요?', check: r => ok(r) && r.cand > 0 },
  { id: 30, label: '무코팅 필터 안됨', setup: '4날 10mm', input: '코팅 없는 걸로', check: r => ok(r) && r.cand > 0 },
  { id: 14, label: 'AlCrN 코팅변경 실패', setup: 'Square 4날 TiAlN', input: 'AlCrN으로', check: r => ok(r) && r.cand > 0 },
  { id: 144, label: '직경만 입력→DB에러', input: '직경이 10mm인애들 추천해줘', check: r => ok(r) && r.cand > 0 },
];

function truncate(s, n) { return s.length > n ? s.substring(0, n) + '…' : s; }

async function runTest(test) {
  try {
    if (test.steps) {
      // 멀티턴
      const rs = await multi(test.steps);
      const last = rs.at(-1);
      const pass = test.check(rs);
      return { pass, r: last };
    } else if (test.setup) {
      // 2턴 (setup → input)
      const r1 = ext(await callRetry(req(test.setup)));
      await sleep(400);
      const r2 = ext(await callRetry(req(test.input, r1.session, [{role:'user',text:test.setup},{role:'ai',text:r1.text}])));
      const pass = test.check(r2);
      return { pass, r: r2 };
    } else {
      // 싱글턴
      const r = ext(await callRetry(req(test.input)));
      const pass = test.check(r);
      return { pass, r };
    }
  } catch(e) {
    return { pass: false, r: { text: `ERROR: ${e.message}`, cand: -1, fCnt: 0, filterStr: '', chips: '', ms: 0 } };
  }
}

(async () => {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     VP 데모용 10선 — yg1-demo-seo.vercel.app 직접 호출     ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  테스트 시각: ${new Date().toLocaleString('ko-KR')}`)
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('');

  // ── 잘 되는 것 5개 ──
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│  ★ 잘 되는 것 5개 (데모용 자랑 케이스)                      │');
  console.log('├──────────────────────────────────────────────────────────────┤');

  let goodPass = 0;
  for (const t of GOOD_TESTS) {
    const display = t.steps ? t.steps.join('→') : t.input;
    process.stdout.write(`│  #${t.id} ${t.label}: 호출 중...`);
    const { pass, r } = await runTest(t);
    if (pass) goodPass++;
    const icon = pass ? '✅ PASS' : '❌ FAIL';
    process.stdout.clearLine?.(0);
    process.stdout.cursorTo?.(0);
    console.log(`│  #${String(t.id).padEnd(3)} [${icon}] ${t.label}`);
    console.log(`│       입력: ${truncate(display, 50)}`);
    console.log(`│       응답: ${truncate(r.text.replace(/\n/g, ' '), 60)}`);
    console.log(`│       필터: ${r.filterStr || '없음'} | 후보: ${r.cand}개 | ${r.ms}ms`);
    console.log('│');
    await sleep(500);
  }
  console.log(`├──────────────────────────────────────────────────────────────┤`);
  console.log(`│  결과: ${goodPass}/5 PASS                                              │`);
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('');

  // ── 심각하게 안 되는 것 5개 ──
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│  ✗ 심각하게 안 되는 것 5개 (수정 대상)                       │');
  console.log('├──────────────────────────────────────────────────────────────┤');

  let badPass = 0;
  for (const t of BAD_TESTS) {
    const display = t.setup ? `[${t.setup}] ${t.input}` : t.input;
    process.stdout.write(`│  #${t.id} ${t.label}: 호출 중...`);
    const { pass, r } = await runTest(t);
    if (pass) badPass++;
    const icon = pass ? '✅ PASS' : '❌ FAIL';
    process.stdout.clearLine?.(0);
    process.stdout.cursorTo?.(0);
    console.log(`│  #${String(t.id).padEnd(3)} [${icon}] ${t.label}`);
    console.log(`│       입력: ${truncate(display, 55)}`);
    console.log(`│       응답: ${truncate(r.text.replace(/\n/g, ' '), 60)}`);
    console.log(`│       필터: ${r.filterStr || '없음'} | 후보: ${r.cand}개 | ${r.ms}ms`);
    console.log('│');
    await sleep(500);
  }
  console.log(`├──────────────────────────────────────────────────────────────┤`);
  console.log(`│  결과: ${badPass}/5 PASS                                              │`);
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('');

  // ── 총합 ──
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  총합: ${goodPass + badPass}/10 PASS                                           ║`);
  console.log(`║  잘 되는 것: ${goodPass}/5    심각한 것: ${badPass}/5                            ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
})();
