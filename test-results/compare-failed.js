#!/usr/bin/env node
/**
 * Compare 18 failed test cases: our API vs VP's Vercel site
 */
const http = require('http');
const https = require('https');

// Two targets
const TARGETS = {
  ours: { protocol: 'http', hostname: '20.119.98.136', port: 3000, path: '/api/recommend', label: '우리(cook_ver1)' },
  vp:   { protocol: 'https', hostname: 'yg1-demo-seo.vercel.app', port: 443, path: '/api/recommend', label: '부사장님(Vercel)' }
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function callAPI(target, body, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const mod = target.protocol === 'https' ? https : http;
    const options = {
      hostname: target.hostname, port: target.port, path: target.path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(postData) }
    };
    const start = Date.now();
    const req = mod.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const elapsed = Date.now() - start;
        try { resolve({ status: res.statusCode, body: JSON.parse(data), elapsedMs: elapsed }); }
        catch(e) { reject(new Error(`Parse: ${data.substring(0,200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(postData);
    req.end();
  });
}

function extractInfo(res) {
  const b = res.body || {};
  const session = b.session?.publicState || b.session || {};
  return {
    text: (b.text || '').substring(0, 200),
    purpose: b.purpose || 'unknown',
    candidateCount: session.candidateCount ?? (b.candidates?.length ?? -1),
    appliedFilters: session.appliedFilters || [],
    filterCount: (session.appliedFilters || []).length,
    session: b.session,
    error: b.error || b.detail,
    elapsedMs: res.elapsedMs
  };
}

function noError(info) {
  return !info.error && !info.text.includes('오류가 발생했습니다');
}

function buildRequest(userMessage, session, opts = {}) {
  const messages = [];
  if (opts.history) opts.history.forEach(h => messages.push(h));
  messages.push({ role: 'user', text: userMessage });
  const body = { engine: 'serve', language: 'ko', messages };
  if (session) body.session = session;
  return body;
}

async function multiTurn(target, steps) {
  let session = null;
  const history = [];
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    if (i > 0) await sleep(500);
    const body = buildRequest(steps[i], session, { history });
    const res = await callAPI(target, body);
    const info = extractInfo(res);
    results.push(info);
    session = info.session;
    history.push({ role: 'user', text: steps[i] });
    history.push({ role: 'ai', text: info.text });
  }
  return results;
}

// ===== FAILED TEST CASES =====
const tests = [
  // #14 필터변경: Square 4날 TiAlN → AlCrN으로
  {
    id: 14, cat: '2.필터변경', desc: 'TiAlN → AlCrN',
    run: async (t) => {
      const r1 = extractInfo(await callAPI(t, buildRequest('Square 4날 TiAlN')));
      await sleep(300);
      const r2 = extractInfo(await callAPI(t, buildRequest('AlCrN으로', r1.session, {
        history: [{ role: 'user', text: 'Square 4날 TiAlN' }, { role: 'ai', text: r1.text }]
      })));
      return { ok: noError(r2) && r2.candidateCount > 0, detail: `filters=${r2.filterCount} cand=${r2.candidateCount}`, ms: r2.elapsedMs };
    }
  },
  // #21~#30 부정제외 (10개)
  ...[
    { setup: 'Square 4날', msg: 'TiAlN 빼고 나머지요', id: 21 },
    { setup: 'Square 4날', msg: 'TiAlN만 아니면 돼', id: 22 },
    { setup: 'Square 4날', msg: 'TiAlN 제외하고', id: 23 },
    { setup: '4날 10mm', msg: 'Square 빼고', id: 24 },
    { setup: 'Square 10mm', msg: '4날 말고 다른거', id: 25 },
    { setup: '4날 10mm', msg: 'Ball 아닌것', id: 26 },
    { setup: '4날 10mm', msg: '코팅 없는거', id: 27 },
    { setup: '4날 10mm', msg: 'DLC 빼고 TiAlN으로', id: 28 },
    { setup: 'Square 4날', msg: '아니 TiAlN만 아니면 된다니까', id: 29 },
    { setup: '4날 10mm', msg: '코팅 없는 걸로', id: 30 },
  ].map(c => ({
    id: c.id, cat: '3.부정제외', desc: c.msg,
    run: async (t) => {
      const r1 = extractInfo(await callAPI(t, buildRequest(c.setup)));
      await sleep(300);
      const r2 = extractInfo(await callAPI(t, buildRequest(c.msg, r1.session, {
        history: [{ role: 'user', text: c.setup }, { role: 'ai', text: r1.text }]
      })));
      return { ok: noError(r2) && r2.candidateCount > 0, detail: `filters=${r2.filterCount} cand=${r2.candidateCount}`, ms: r2.elapsedMs };
    }
  })),
  // #34 네비게이션: 초기화
  {
    id: 34, cat: '4.네비게이션', desc: '초기화',
    run: async (t) => {
      const results = await multiTurn(t, ['Square 4날 10mm', '초기화']);
      const last = results[results.length - 1];
      return { ok: noError(last) && last.filterCount === 0, detail: `filters=${last.filterCount}`, ms: last.elapsedMs };
    }
  },
  // #37 네비게이션: 다시 처음부터
  {
    id: 37, cat: '4.네비게이션', desc: '다시 처음부터',
    run: async (t) => {
      const results = await multiTurn(t, ['Square', '4날', '다시 처음부터']);
      const last = results[results.length - 1];
      return { ok: noError(last) && last.filterCount === 0, detail: `filters=${last.filterCount}`, ms: last.elapsedMs };
    }
  },
  // #38 네비게이션: 5턴후 처음부터
  {
    id: 38, cat: '4.네비게이션', desc: '5턴후 처음부터',
    run: async (t) => {
      const results = await multiTurn(t, ['Square', '4날', '10mm', 'TiAlN', '스테인리스', '처음부터']);
      const last = results[results.length - 1];
      return { ok: noError(last) && last.filterCount === 0, detail: `filters=${last.filterCount}`, ms: last.elapsedMs };
    }
  },
  // #53 멀티턴H: 3개→추천→코팅변경→재추천
  {
    id: 53, cat: '6.멀티턴H', desc: '3개→추천→코팅변경→재추천',
    run: async (t) => {
      const results = await multiTurn(t, ['Square 4날 10mm', '추천해줘', '코팅만 AlCrN으로 바꿔', '추천해줘']);
      const last = results[results.length - 1];
      return { ok: noError(last) && last.candidateCount > 0, detail: `cand=${last.candidateCount}`, ms: last.elapsedMs };
    }
  },
  // #147 👎재현: 공구 형상을 코너레디우스만 보여줘
  {
    id: 147, cat: '23.👎재현', desc: '코너레디우스만 보여줘',
    run: async (t) => {
      const r = extractInfo(await callAPI(t, buildRequest('공구 형상을 코너레디우스만 보여줘')));
      return { ok: noError(r) && r.candidateCount > 0, detail: `cand=${r.candidateCount} filters=${r.filterCount}`, ms: r.elapsedMs };
    }
  },
  // #150 👎재현: 적층제조를 모르시나요?
  {
    id: 150, cat: '23.👎재현', desc: '적층제조를 모르시나요?',
    run: async (t) => {
      const r = extractInfo(await callAPI(t, buildRequest('적층제조를 모르시나요?')));
      return { ok: noError(r), detail: `cand=${r.candidateCount} err=${!!r.error}`, ms: r.elapsedMs };
    }
  },
];

// #139 응답시간은 전체 집계이므로 별도 처리 불필요 — skip

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║     실패 케이스 비교: 우리(cook_ver1) vs 부사장님(Vercel)            ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
  console.log(`테스트 수: ${tests.length}개 (응답시간 #139 제외)\n`);

  const results = [];

  for (const test of tests) {
    process.stdout.write(`#${test.id} [${test.cat}] ${test.desc} ...`);

    let oursResult, vpResult;
    try {
      oursResult = await test.run(TARGETS.ours);
    } catch(e) {
      oursResult = { ok: false, detail: `ERROR: ${e.message.substring(0,50)}`, ms: 0 };
    }

    await sleep(500);

    try {
      vpResult = await test.run(TARGETS.vp);
    } catch(e) {
      vpResult = { ok: false, detail: `ERROR: ${e.message.substring(0,50)}`, ms: 0 };
    }

    const oursIcon = oursResult.ok ? '✅' : '❌';
    const vpIcon = vpResult.ok ? '✅' : '❌';
    console.log(`\n  우리: ${oursIcon} ${oursResult.detail} (${oursResult.ms}ms)`);
    console.log(`  부사장님: ${vpIcon} ${vpResult.detail} (${vpResult.ms}ms)`);

    results.push({ id: test.id, cat: test.cat, desc: test.desc, ours: oursResult, vp: vpResult });
    await sleep(300);
  }

  // Summary
  console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║                        비교 결과 요약                                ║');
  console.log('╠═══════════════════════════════════════════════════════════════════════╣');
  console.log('║  #ID  │ 카테고리      │ 우리 │ 부사장님 │ 설명');
  console.log('╠═══════════════════════════════════════════════════════════════════════╣');

  let ourPass = 0, vpPass = 0;
  for (const r of results) {
    const o = r.ours.ok ? 'PASS' : 'FAIL';
    const v = r.vp.ok ? 'PASS' : 'FAIL';
    if (r.ours.ok) ourPass++;
    if (r.vp.ok) vpPass++;
    const marker = (r.ours.ok && !r.vp.ok) ? ' ★우리승' : (!r.ours.ok && r.vp.ok) ? ' ★VP승' : (r.ours.ok && r.vp.ok) ? ' 둘다OK' : ' 둘다FAIL';
    console.log(`║  #${String(r.id).padStart(3)} │ ${r.cat.padEnd(12)} │ ${o.padEnd(4)} │ ${v.padEnd(8)} │ ${r.desc.substring(0,25)}${marker}`);
  }

  console.log('╠═══════════════════════════════════════════════════════════════════════╣');
  console.log(`║  우리: ${ourPass}/${results.length} PASS    부사장님: ${vpPass}/${results.length} PASS`);
  console.log('╚═══════════════════════════════════════════════════════════════════════╝');
}

main().catch(e => console.error('Fatal:', e));
