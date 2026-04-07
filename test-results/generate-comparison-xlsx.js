#!/usr/bin/env node
/**
 * YG1 Full Comparison Test → Excel Report
 * Runs all 151 tests against BOTH APIs and generates a detailed .xlsx
 */
const http = require('http');
const https = require('https');
const ExcelJS = require('exceljs');
const path = require('path');

const TARGETS = {
  ours: { protocol: 'http', hostname: '20.119.98.136', port: 3000, path: '/api/recommend', label: '우리(cook_ver1)' },
  vp:   { protocol: 'https', hostname: 'yg1-demo-seo.vercel.app', port: 443, path: '/api/recommend', label: '부사장님(Vercel)' },
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
        catch(e) { reject(new Error(`Parse: ${data.substring(0,300)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(postData);
    req.end();
  });
}

function extractInfo(res) {
  const b = res?.body || {};
  const session = b.session?.publicState || b.session || {};
  return {
    text: (b.text || ''),
    purpose: b.purpose || 'unknown',
    candidateCount: session.candidateCount ?? (b.candidates?.length ?? -1),
    appliedFilters: session.appliedFilters || [],
    filterCount: (session.appliedFilters || []).length,
    filterSummary: (session.appliedFilters || []).map(f => `${f.field}=${f.value}${f.op === 'exclude' || f.op === 'neq' ? '(제외)' : ''}`).join(', '),
    chips: b.chips || [],
    chipGroups: b.chipGroups || [],
    session: b.session,
    error: b.error || b.detail,
    elapsedMs: res?.elapsedMs ?? 0,
    raw: b,
  };
}
function noError(info) { return !info.error && !info.text.includes('오류가 발생했습니다'); }

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
    if (i > 0) await sleep(400);
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

async function callWithRetry(target, body, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try { return await callAPI(target, body); }
    catch(e) { if (i === retries) throw e; await sleep(2000); }
  }
}

// ====================================================================
// ALL 151 TEST DEFINITIONS
// ====================================================================
function defineAllTests() {
  const tests = [];
  let id = 0;

  // ── 1. 멀티필터 (10) ──
  const mfCases = [
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
  for (const c of mfCases) {
    const _c = c;
    tests.push({
      id: ++id, cat: '1.멀티필터', input: _c.input, expect: _c.expect,
      run: async (t) => {
        const res = await callWithRetry(t, buildRequest(_c.input));
        const info = extractInfo(res);
        const ok = noError(info) && info.filterCount >= _c.minFilters && info.candidateCount > 0;
        const verdict = ok ? 'PASS' : (!noError(info) ? 'FAIL' : (info.candidateCount === 0 ? 'FAIL' : 'WARN'));
        return { verdict, info };
      }
    });
  }

  // ── 2. 필터변경 (10) ──
  const fcCases = [
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
  for (const c of fcCases) {
    const _c = c;
    tests.push({
      id: ++id, cat: '2.필터변경', input: `${_c.setup} → ${_c.change}`, expect: `${_c.field}→${_c.newVal}`,
      run: async (t) => {
        const r1 = extractInfo(await callWithRetry(t, buildRequest(_c.setup)));
        await sleep(300);
        const r2 = extractInfo(await callWithRetry(t, buildRequest(_c.change, r1.session, {
          history: [{ role: 'user', text: _c.setup }, { role: 'ai', text: r1.text }]
        })));
        const ok = noError(r2) && r2.candidateCount > 0;
        return { verdict: ok ? 'PASS' : 'FAIL', info: r2, setupInfo: r1 };
      }
    });
  }

  // ── 3. 부정제외 (10) ──
  const negCases = [
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
  for (const c of negCases) {
    const _c = c;
    tests.push({
      id: ++id, cat: '3.부정제외', input: `[${_c.setup}] → ${_c.msg}`, expect: _c.expect,
      run: async (t) => {
        const r1 = extractInfo(await callWithRetry(t, buildRequest(_c.setup)));
        await sleep(300);
        const r2 = extractInfo(await callWithRetry(t, buildRequest(_c.msg, r1.session, {
          history: [{ role: 'user', text: _c.setup }, { role: 'ai', text: r1.text }]
        })));
        const ok = noError(r2) && r2.candidateCount > 0;
        return { verdict: ok ? 'PASS' : 'FAIL', info: r2, setupInfo: r1 };
      }
    });
  }

  // ── 4. 네비게이션 (10) ──
  const navTests = [
    { label: '처음부터 다시', steps: ['Square 4날 10mm', '처음부터 다시'], check: (rs) => noError(rs[rs.length-1]) && rs[rs.length-1].filterCount === 0 },
    { label: '이전 단계', steps: ['Square 4날', '이전 단계'], check: (rs) => noError(rs[1]) && rs[1].filterCount < rs[0].filterCount, warnOk: true },
    { label: '3필터→이전→복원', steps: ['Square', '4날', 'TiAlN', '이전'], check: (rs) => noError(rs[3]) && rs[3].candidateCount >= rs[2].candidateCount, warnOk: true },
    { label: '초기화', steps: ['Square 4날 10mm', '초기화'], check: (rs) => noError(rs[rs.length-1]) && rs[rs.length-1].filterCount === 0 },
    { label: '리셋→새조건', steps: ['Square 4날', '처음부터 다시', 'Ball 2날'], check: (rs) => noError(rs[rs.length-1]) && rs[rs.length-1].candidateCount > 0 },
    { label: '이전x2', steps: ['Square', '4날', 'TiAlN', '이전 단계로', '이전 단계로'], check: (rs) => noError(rs[4]) && rs[4].filterCount <= rs[2].filterCount - 2, warnOk: true },
    { label: '다시 처음부터', steps: ['Square', '4날', '다시 처음부터'], check: (rs) => noError(rs[rs.length-1]) && rs[rs.length-1].filterCount === 0 },
    { label: '5턴후 처음부터', steps: ['Square', '4날', '10mm', 'TiAlN', '스테인리스', '처음부터'], check: (rs) => noError(rs[rs.length-1]) && rs[rs.length-1].filterCount === 0 },
    { label: '돌아가', steps: ['Square 4날 10mm', '돌아가'], check: (rs) => noError(rs[1]), warnOk: true },
    { label: '이전 단계로', steps: ['Square 4날 10mm', '이전 단계로'], check: (rs) => noError(rs[1]) && rs[1].filterCount < rs[0].filterCount, warnOk: true },
  ];
  for (const c of navTests) {
    const _c = c;
    tests.push({
      id: ++id, cat: '4.네비게이션', input: _c.steps.join(' → '), expect: _c.label,
      run: async (t) => {
        const results = await multiTurn(t, _c.steps);
        const last = results[results.length - 1];
        const ok = _c.check(results);
        return { verdict: ok ? 'PASS' : (_c.warnOk && noError(last) ? 'WARN' : 'FAIL'), info: last, allSteps: results };
      }
    });
  }

  // ── 5. skip (5) ──
  const skipCases = ['상관없음', '아무거나', '알아서', '패스', '넘어가'];
  for (const msg of skipCases) {
    const _msg = msg;
    tests.push({
      id: ++id, cat: '5.skip', input: `[Square 4날] → ${_msg}`, expect: 'skip 처리',
      run: async (t) => {
        const r1 = extractInfo(await callWithRetry(t, buildRequest('Square 4날')));
        await sleep(300);
        const r2 = extractInfo(await callWithRetry(t, buildRequest(_msg, r1.session, {
          history: [{ role: 'user', text: 'Square 4날' }, { role: 'ai', text: r1.text }]
        })));
        const ok = noError(r2) && r2.candidateCount > 0;
        return { verdict: ok ? 'PASS' : 'FAIL', info: r2 };
      }
    });
  }

  // ── 6. 멀티턴 A~J (10) ──
  const mtScenarios = [
    { label: 'A: Square→4날→TiAlN→추천→8mm', steps: ['Square', '4날', 'TiAlN', '추천해줘', '8mm로 좁혀줘'] },
    { label: 'B: 구리2날10mm→추천→Ball', steps: ['구리 2날 10mm', '추천해줘', 'Ball로 바꿔'] },
    { label: 'C: Square→Ball변경→4날→TiAlN', steps: ['Square', 'Ball로 바꿔', '4날', 'TiAlN'] },
    { label: 'D: 상관없음x3→추천', steps: ['Square 4날', '상관없음', '상관없음', '추천해줘'] },
    { label: 'E: 추천→이전→Ball→재추천', steps: ['Square 4날', '추천해줘', '이전', 'Ball', '추천해줘'] },
    { label: 'F: TiAlN제외→Square→4날→추천', steps: ['코팅은 TiAlN 빼고 나머지', 'Square', '4날', '추천해줘'] },
    { label: 'G: 추천→리셋→Ball2날6mm→추천', steps: ['Square 4날', '추천해줘', '처음부터 다시', 'Ball 2날 6mm', '추천해줘'] },
    { label: 'H: 3개→추천→코팅변경→재추천', steps: ['Square 4날 10mm', '추천해줘', '코팅만 AlCrN으로 바꿔', '추천해줘'] },
    { label: 'I: 구리2날10mm→Ball→재추천', steps: ['구리 2날 10mm', '추천해줘', 'Ball로 바꿔', '추천해줘'] },
    { label: 'J: Square→Radius→Ball→6mm→추천', steps: ['Square', 'Radius로', '아니 Ball로', '직경 6mm로 줄여', '추천해줘'] },
  ];
  for (const s of mtScenarios) {
    const _s = s;
    tests.push({
      id: ++id, cat: '6.멀티턴', input: _s.steps.join(' → '), expect: _s.label,
      run: async (t) => {
        const results = await multiTurn(t, _s.steps);
        const last = results[results.length - 1];
        const ok = noError(last) && last.candidateCount > 0;
        return { verdict: ok ? 'PASS' : 'FAIL', info: last, allSteps: results };
      }
    });
  }

  // ── 7. 추천 (5) ──
  const recTests = [
    { label: '추천해줘(no filter)', steps: ['추천해줘'], check: (rs) => noError(rs[0]) },
    { label: '지금 바로 제품 보기', steps: ['Square 4날', '지금 바로 제품 보기'], check: (rs) => noError(rs[1]) && rs[1].candidateCount > 0 },
    { label: 'AI 상세 분석', steps: ['Square 4날 10mm', 'AI 상세 분석'], check: (rs) => noError(rs[1]) },
    { label: '필터2개→추천', steps: ['Square 4날', '추천해줘'], check: (rs) => noError(rs[1]) && rs[1].candidateCount > 0 },
    { label: '더 보여줘', steps: ['Square 4날 10mm', '추천해줘', '더 보여줘'], check: (rs) => noError(rs[2]) },
  ];
  for (const c of recTests) {
    const _c = c;
    tests.push({
      id: ++id, cat: '7.추천', input: _c.steps.join(' → '), expect: _c.label,
      run: async (t) => {
        const results = await multiTurn(t, _c.steps);
        const ok = _c.check(results);
        return { verdict: ok ? 'PASS' : 'FAIL', info: results[results.length - 1], allSteps: results };
      }
    });
  }

  // ── 8. 비교 (5) ──
  const cmpTests = [
    '상위 3개 비교해줘', '첫번째 두번째 차이가 뭐야?', 'TiAlN이 좋아 AlCrN이 좋아?',
    '4G MILL X5070 알려줘', 'SEME71 vs SEME72'
  ];
  for (const msg of cmpTests) {
    const _msg = msg;
    tests.push({
      id: ++id, cat: '8.비교', input: _msg, expect: '정상 응답',
      run: async (t) => {
        const r = extractInfo(await callWithRetry(t, buildRequest(_msg)));
        return { verdict: noError(r) ? 'PASS' : 'FAIL', info: r };
      }
    });
  }

  // ── 9. 질문 (10) ──
  const qTests = [
    'TiAlN이 뭐야?', '4날 6날 차이', '코너 래디우스가 뭐야?', '황삭 정삭 차이',
    'YG-1 어떤 회사?', 'Square 뭐에 써?', '코팅 종류 알려줘', '절삭속도가 뭐야?',
    '헬릭스각 중요해?', '엔드밀 드릴 차이'
  ];
  for (const q of qTests) {
    const _q = q;
    tests.push({
      id: ++id, cat: '9.질문', input: _q, expect: '정상 답변',
      run: async (t) => {
        const r = extractInfo(await callWithRetry(t, buildRequest(_q)));
        return { verdict: noError(r) ? 'PASS' : 'FAIL', info: r };
      }
    });
  }

  // ── 10. 자연어 (15) ──
  const nlCases = [
    { input: '구리 전용 2날 10mm', minF: 2 }, { input: '알루미늄 고속가공', minF: 1 },
    { input: 'SUS304 황삭', minF: 1 }, { input: '스테인리스 마무리', minF: 1 },
    { input: '금형 곡면', minF: 0 }, { input: '티타늄 가공', minF: 1 },
    { input: '인코넬용', minF: 1 }, { input: '프리하든강', minF: 1 },
    { input: '칩 배출 좋은', minF: 0 }, { input: '진동 적은', minF: 0 },
    { input: '긴 가공 깊이', minF: 0 }, { input: '측면 가공', minF: 0 },
    { input: '포켓 가공', minF: 0 }, { input: '3D 곡면', minF: 0 },
    { input: '깊은 홈', minF: 0 },
  ];
  for (const c of nlCases) {
    const _c = c;
    tests.push({
      id: ++id, cat: '10.자연어', input: _c.input, expect: `필터>=${_c.minF}`,
      run: async (t) => {
        const r = extractInfo(await callWithRetry(t, buildRequest(_c.input)));
        const ok = noError(r) && r.filterCount >= _c.minF && r.candidateCount > 0;
        return { verdict: ok ? 'PASS' : (noError(r) ? 'WARN' : 'FAIL'), info: r };
      }
    });
  }

  // ── 11. CRX-S 구리 (20) ──
  const crxInputs = [
    '구리 스퀘어 2날 10mm', 'copper square 2flute 10mm', '동 가공용 엔드밀 10mm',
    'Cu 소재 Square D10', '비철 구리 Square 2날 10mm', '구리 평날 두날 열미리',
    '구리 Square 2날 6mm', '구리 Square 2날 8mm', '구리 Square 2날 12mm', '구리 Square 2날 4mm',
    '구리 엔드밀 추천해줘', '동 가공용 추천', '구리 2날 10mm 추천', 'copper endmill 10mm',
    '구리 가공 스퀘어', 'Cu Square 2F 10', '구리합금 엔드밀', '동 10파이',
    '구리 D10 2날', '순동 가공',
  ];
  for (const inp of crxInputs) {
    const _inp = inp;
    tests.push({
      id: ++id, cat: '11.CRX-S구리', input: _inp, expect: '구리 필터 + 후보',
      run: async (t) => {
        const r = extractInfo(await callWithRetry(t, buildRequest(_inp)));
        const ok = noError(r) && r.candidateCount > 0;
        return { verdict: ok ? 'PASS' : 'FAIL', info: r };
      }
    });
  }

  // ── 12. 소재점수 (5) ──
  const matInputs = ['구리 엔드밀 추천', '알루미늄 엔드밀 추천', '스테인리스 엔드밀 추천', '탄소강 엔드밀 추천', '고경도강 엔드밀 추천'];
  for (const inp of matInputs) {
    const _inp = inp;
    tests.push({
      id: ++id, cat: '12.소재점수', input: _inp, expect: '소재 필터 + 후보',
      run: async (t) => {
        const r = extractInfo(await callWithRetry(t, buildRequest(_inp)));
        const ok = noError(r) && r.candidateCount > 0;
        return { verdict: ok ? 'PASS' : 'FAIL', info: r };
      }
    });
  }

  // ── 15. 도메인지식 (5) ──
  const domInputs = ['떨림 적은 거', '면조도 좋은 거', '리브 가공용', '황삭 효율 좋은 거', '고이송 가공'];
  for (const inp of domInputs) {
    const _inp = inp;
    tests.push({
      id: ++id, cat: '15.도메인지식', input: _inp, expect: '정상 응답',
      run: async (t) => {
        const r = extractInfo(await callWithRetry(t, buildRequest(_inp)));
        return { verdict: noError(r) ? 'PASS' : 'FAIL', info: r };
      }
    });
  }

  // ── 16. 0건 fallback (3) ──
  tests.push({
    id: ++id, cat: '16.0건fallback', input: '구리 Square 2날 10mm TiAlN DLC', expect: 'fallback 안내',
    run: async (t) => {
      const r = extractInfo(await callWithRetry(t, buildRequest('구리 Square 2날 10mm TiAlN DLC')));
      return { verdict: noError(r) ? 'PASS' : 'FAIL', info: r };
    }
  });
  tests.push({
    id: ++id, cat: '16.0건fallback', input: '인코넬 16파이 Square 2날 TiAlN DLC', expect: 'fallback 안내',
    run: async (t) => {
      const r = extractInfo(await callWithRetry(t, buildRequest('인코넬 16파이 Square 2날 TiAlN DLC')));
      return { verdict: noError(r) ? 'PASS' : 'FAIL', info: r };
    }
  });
  tests.push({
    id: ++id, cat: '16.0건fallback', input: '0건→이전→복귀', expect: '이전 복귀',
    run: async (t) => {
      const results = await multiTurn(t, ['구리 Square 2날 10mm TiAlN DLC', '이전']);
      const last = results[results.length - 1];
      return { verdict: noError(last) && last.candidateCount > 0 ? 'PASS' : 'FAIL', info: last, allSteps: results };
    }
  });

  // ── 17. 인코딩 (5) ──
  const encInputs = ['스퀘어 4날', 'square 4 flute', '스퀘어 4flute TiAlN', '10', 'Ø10'];
  for (const inp of encInputs) {
    const _inp = inp;
    tests.push({
      id: ++id, cat: '17.인코딩', input: _inp, expect: '정상 처리',
      run: async (t) => {
        const r = extractInfo(await callWithRetry(t, buildRequest(_inp)));
        const ok = noError(r) && r.filterCount >= 1 && r.candidateCount > 0;
        return { verdict: ok ? 'PASS' : (noError(r) ? 'WARN' : 'FAIL'), info: r };
      }
    });
  }

  // ── 19. 에러핸들링 (10) ──
  const errInputs = [
    { input: '', expect: '에러 안 남' }, { input: '10', expect: '에러 안 남' },
    { input: '???', expect: '에러 안 남' }, { input: 'A'.repeat(200), expect: '긴 메시지' },
    { input: '4 flute TiAlN Square', expect: '영어' }, { input: 'ボールエンドミル', expect: '일본어' },
    { input: 'squre', expect: '오타' }, { input: 'ㅎㅎ 아무거나', expect: '감탄사' },
    { input: '👍', expect: '이모지' }, { input: '10미리 4날', expect: '구어체' },
  ];
  for (const c of errInputs) {
    const _c = c;
    tests.push({
      id: ++id, cat: '19.에러핸들링', input: _c.input || '(빈 문자열)', expect: _c.expect,
      run: async (t) => {
        const r = extractInfo(await callWithRetry(t, buildRequest(_c.input)));
        return { verdict: noError(r) ? 'PASS' : 'FAIL', info: r };
      }
    });
  }

  // ── 22. 응답시간 ──
  tests.push({
    id: ++id, cat: '22.응답시간', input: '(전체 집계)', expect: '<30s',
    run: async () => {
      return { verdict: 'SKIP', info: { text: '별도 집계', purpose: 'meta', candidateCount: 0, filterCount: 0, filterSummary: '', chips: [], error: null, elapsedMs: 0 } };
    }
  });

  // ── 23. 👎 재현 (12) ──
  const fbCases = [
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
    { input: '적층제조를 모르시나요?', expect: '에러 안 남' },
    { input: '3날 무코팅에 스퀘어', expect: '3날+무코팅+Square' },
  ];
  for (const c of fbCases) {
    const _c = c;
    tests.push({
      id: ++id, cat: '23.👎재현', input: _c.input, expect: _c.expect,
      run: async (t) => {
        const r = extractInfo(await callWithRetry(t, buildRequest(_c.input)));
        const ok = _c.input === '적층제조를 모르시나요?' ? noError(r) : (noError(r) && r.candidateCount > 0);
        return { verdict: ok ? 'PASS' : 'FAIL', info: r };
      }
    });
  }

  return tests;
}

// ====================================================================
// EXCEL GENERATION
// ====================================================================
async function generateExcel(results) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'YG1 Test Runner';
  wb.created = new Date();

  // ── Colors ──
  const GREEN = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5F5E3' } };
  const RED = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFADBD8' } };
  const YELLOW = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9E7' } };
  const BLUE_HEADER = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2C3E50' } };
  const LIGHT_BLUE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6EAF8' } };
  const GRAY = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F3F4' } };
  const WHITE_FONT = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
  const BORDER_THIN = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };

  // ═══════════════════════════════════════════
  // Sheet 1: 요약 (Summary)
  // ═══════════════════════════════════════════
  const ws1 = wb.addWorksheet('요약', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws1.columns = [
    { header: '카테고리', key: 'cat', width: 16 },
    { header: '테스트 수', key: 'total', width: 10 },
    { header: '우리 PASS', key: 'oursPass', width: 12 },
    { header: '우리 FAIL', key: 'oursFail', width: 12 },
    { header: '우리 WARN', key: 'oursWarn', width: 12 },
    { header: '우리 통과율', key: 'oursRate', width: 13 },
    { header: 'VP PASS', key: 'vpPass', width: 12 },
    { header: 'VP FAIL', key: 'vpFail', width: 12 },
    { header: 'VP WARN', key: 'vpWarn', width: 12 },
    { header: 'VP 통과율', key: 'vpRate', width: 13 },
    { header: '우리 우위', key: 'advantage', width: 12 },
  ];
  // Header style
  ws1.getRow(1).eachCell(c => { c.fill = BLUE_HEADER; c.font = WHITE_FONT; c.border = BORDER_THIN; c.alignment = { horizontal: 'center' }; });

  const cats = [...new Set(results.map(r => r.cat))];
  let totalOursP = 0, totalOursF = 0, totalOursW = 0, totalVpP = 0, totalVpF = 0, totalVpW = 0;
  for (const cat of cats) {
    const rows = results.filter(r => r.cat === cat);
    const oP = rows.filter(r => r.oursVerdict === 'PASS').length;
    const oF = rows.filter(r => r.oursVerdict === 'FAIL').length;
    const oW = rows.filter(r => !['PASS','FAIL'].includes(r.oursVerdict)).length;
    const vP = rows.filter(r => r.vpVerdict === 'PASS').length;
    const vF = rows.filter(r => r.vpVerdict === 'FAIL').length;
    const vW = rows.filter(r => !['PASS','FAIL'].includes(r.vpVerdict)).length;
    totalOursP += oP; totalOursF += oF; totalOursW += oW;
    totalVpP += vP; totalVpF += vF; totalVpW += vW;

    const oRate = rows.length > 0 ? Math.round(oP / rows.length * 100) : 0;
    const vRate = rows.length > 0 ? Math.round(vP / rows.length * 100) : 0;
    const diff = oRate - vRate;
    const adv = diff > 0 ? `+${diff}%p` : diff < 0 ? `${diff}%p` : '동일';

    const row = ws1.addRow({ cat, total: rows.length, oursPass: oP, oursFail: oF, oursWarn: oW, oursRate: `${oRate}%`, vpPass: vP, vpFail: vF, vpWarn: vW, vpRate: `${vRate}%`, advantage: adv });
    row.eachCell(c => { c.border = BORDER_THIN; c.alignment = { horizontal: 'center' }; });
    if (diff > 0) row.getCell('advantage').fill = GREEN;
    else if (diff < 0) row.getCell('advantage').fill = RED;
  }

  // Total row
  const tTotal = results.length;
  const oTotalRate = Math.round(totalOursP / tTotal * 100);
  const vTotalRate = Math.round(totalVpP / tTotal * 100);
  const totalRow = ws1.addRow({ cat: '합계', total: tTotal, oursPass: totalOursP, oursFail: totalOursF, oursWarn: totalOursW, oursRate: `${oTotalRate}%`, vpPass: totalVpP, vpFail: totalVpF, vpWarn: totalVpW, vpRate: `${vTotalRate}%`, advantage: `+${oTotalRate - vTotalRate}%p` });
  totalRow.eachCell(c => { c.border = BORDER_THIN; c.font = { bold: true, size: 12 }; c.alignment = { horizontal: 'center' }; });
  totalRow.getCell('cat').fill = LIGHT_BLUE;
  totalRow.getCell('oursRate').fill = GREEN;
  totalRow.getCell('vpRate').fill = RED;

  // ═══════════════════════════════════════════
  // Sheet 2: 전체 상세 (Detail)
  // ═══════════════════════════════════════════
  const ws2 = wb.addWorksheet('전체 상세', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws2.columns = [
    { header: '#', key: 'id', width: 5 },
    { header: '카테고리', key: 'cat', width: 14 },
    { header: '입력', key: 'input', width: 40 },
    { header: '기대결과', key: 'expect', width: 22 },
    { header: '우리 판정', key: 'oursV', width: 10 },
    { header: 'VP 판정', key: 'vpV', width: 10 },
    { header: '비교', key: 'compare', width: 12 },
    { header: '우리 응답(요약)', key: 'oursText', width: 50 },
    { header: 'VP 응답(요약)', key: 'vpText', width: 50 },
    { header: '우리 필터', key: 'oursFilters', width: 30 },
    { header: 'VP 필터', key: 'vpFilters', width: 30 },
    { header: '우리 후보수', key: 'oursCand', width: 12 },
    { header: 'VP 후보수', key: 'vpCand', width: 12 },
    { header: '우리 purpose', key: 'oursPurpose', width: 14 },
    { header: 'VP purpose', key: 'vpPurpose', width: 14 },
    { header: '우리 ms', key: 'oursMs', width: 10 },
    { header: 'VP ms', key: 'vpMs', width: 10 },
    { header: '우리 칩', key: 'oursChips', width: 30 },
    { header: 'VP 칩', key: 'vpChips', width: 30 },
  ];
  ws2.getRow(1).eachCell(c => { c.fill = BLUE_HEADER; c.font = WHITE_FONT; c.border = BORDER_THIN; c.alignment = { horizontal: 'center', wrapText: true }; });

  for (const r of results) {
    const ov = r.oursVerdict, vv = r.vpVerdict;
    let compare = '';
    if (ov === 'PASS' && vv !== 'PASS') compare = '우리 승';
    else if (vv === 'PASS' && ov !== 'PASS') compare = 'VP 승';
    else if (ov === 'PASS' && vv === 'PASS') compare = '둘 다 OK';
    else compare = '둘 다 FAIL';

    const row = ws2.addRow({
      id: r.id, cat: r.cat, input: r.input, expect: r.expect,
      oursV: ov, vpV: vv, compare,
      oursText: r.oursText.substring(0, 200), vpText: r.vpText.substring(0, 200),
      oursFilters: r.oursFilters, vpFilters: r.vpFilters,
      oursCand: r.oursCand, vpCand: r.vpCand,
      oursPurpose: r.oursPurpose, vpPurpose: r.vpPurpose,
      oursMs: r.oursMs, vpMs: r.vpMs,
      oursChips: r.oursChips, vpChips: r.vpChips,
    });

    row.eachCell(c => { c.border = BORDER_THIN; c.alignment = { wrapText: true, vertical: 'top' }; });

    // Color verdict cells
    const oCell = row.getCell('oursV');
    const vCell = row.getCell('vpV');
    const cCell = row.getCell('compare');
    oCell.fill = ov === 'PASS' ? GREEN : ov === 'FAIL' ? RED : YELLOW;
    vCell.fill = vv === 'PASS' ? GREEN : vv === 'FAIL' ? RED : YELLOW;
    if (compare === '우리 승') cCell.fill = GREEN;
    else if (compare === 'VP 승') cCell.fill = RED;
    else if (compare === '둘 다 FAIL') cCell.fill = RED;

    // Alternate row shading
    if (r.id % 2 === 0) {
      ['id','cat','input','expect'].forEach(k => { row.getCell(k).fill = row.getCell(k).fill || GRAY; });
    }
  }

  // ═══════════════════════════════════════════
  // Sheet 3: FAIL 분석 (우리 or VP가 FAIL인 것만)
  // ═══════════════════════════════════════════
  const ws3 = wb.addWorksheet('FAIL 분석', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws3.columns = [
    { header: '#', key: 'id', width: 5 },
    { header: '카테고리', key: 'cat', width: 14 },
    { header: '입력', key: 'input', width: 40 },
    { header: '기대결과', key: 'expect', width: 22 },
    { header: '우리 판정', key: 'oursV', width: 10 },
    { header: 'VP 판정', key: 'vpV', width: 10 },
    { header: '누가 실패', key: 'who', width: 12 },
    { header: '우리 응답 전문', key: 'oursText', width: 60 },
    { header: 'VP 응답 전문', key: 'vpText', width: 60 },
    { header: '우리 필터', key: 'oursFilters', width: 30 },
    { header: 'VP 필터', key: 'vpFilters', width: 30 },
    { header: '분석', key: 'analysis', width: 50 },
  ];
  ws3.getRow(1).eachCell(c => { c.fill = BLUE_HEADER; c.font = WHITE_FONT; c.border = BORDER_THIN; c.alignment = { horizontal: 'center', wrapText: true }; });

  const failRows = results.filter(r => r.oursVerdict === 'FAIL' || r.vpVerdict === 'FAIL');
  for (const r of failRows) {
    let who = '';
    if (r.oursVerdict === 'FAIL' && r.vpVerdict === 'FAIL') who = '둘 다';
    else if (r.oursVerdict === 'FAIL') who = '우리만';
    else who = 'VP만';

    // Auto-analysis
    let analysis = '';
    if (r.vpCand === -1 && r.oursCand > 0) analysis = 'VP는 후보를 반환하지 않음 (session 구조 다름)';
    else if (r.vpCand === -1 && r.oursCand <= 0) analysis = '양쪽 모두 후보 없음';
    else if (who === 'VP만') analysis = `VP: cand=${r.vpCand}, 우리: cand=${r.oursCand} — VP만 실패`;
    else if (who === '우리만') analysis = `우리: cand=${r.oursCand}, VP: cand=${r.vpCand} — 우리만 실패, 수정 필요`;
    else analysis = `양쪽 모두 실패 — 공통 미구현 기능`;

    const row = ws3.addRow({
      id: r.id, cat: r.cat, input: r.input, expect: r.expect,
      oursV: r.oursVerdict, vpV: r.vpVerdict, who,
      oursText: r.oursText, vpText: r.vpText,
      oursFilters: r.oursFilters, vpFilters: r.vpFilters,
      analysis,
    });
    row.eachCell(c => { c.border = BORDER_THIN; c.alignment = { wrapText: true, vertical: 'top' }; });
    row.getCell('oursV').fill = r.oursVerdict === 'PASS' ? GREEN : r.oursVerdict === 'FAIL' ? RED : YELLOW;
    row.getCell('vpV').fill = r.vpVerdict === 'PASS' ? GREEN : r.vpVerdict === 'FAIL' ? RED : YELLOW;
    if (who === '우리만') row.getCell('who').fill = RED;
    else if (who === 'VP만') row.getCell('who').fill = GREEN;
  }

  // ═══════════════════════════════════════════
  // Sheet 4: 우리 우위 항목
  // ═══════════════════════════════════════════
  const ws4 = wb.addWorksheet('우리 우위', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws4.columns = [
    { header: '#', key: 'id', width: 5 },
    { header: '카테고리', key: 'cat', width: 14 },
    { header: '입력', key: 'input', width: 40 },
    { header: '기대결과', key: 'expect', width: 22 },
    { header: '우리 응답', key: 'oursText', width: 60 },
    { header: 'VP 응답', key: 'vpText', width: 60 },
    { header: '우리 후보수', key: 'oursCand', width: 12 },
    { header: '우리 필터', key: 'oursFilters', width: 30 },
  ];
  ws4.getRow(1).eachCell(c => { c.fill = BLUE_HEADER; c.font = WHITE_FONT; c.border = BORDER_THIN; c.alignment = { horizontal: 'center', wrapText: true }; });

  const winRows = results.filter(r => r.oursVerdict === 'PASS' && r.vpVerdict !== 'PASS');
  for (const r of winRows) {
    const row = ws4.addRow({ id: r.id, cat: r.cat, input: r.input, expect: r.expect, oursText: r.oursText.substring(0,200), vpText: r.vpText.substring(0,200), oursCand: r.oursCand, oursFilters: r.oursFilters });
    row.eachCell(c => { c.border = BORDER_THIN; c.alignment = { wrapText: true, vertical: 'top' }; });
  }

  // ═══════════════════════════════════════════
  // Sheet 5: 응답 시간 비교
  // ═══════════════════════════════════════════
  const ws5 = wb.addWorksheet('응답시간', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws5.columns = [
    { header: '#', key: 'id', width: 5 },
    { header: '카테고리', key: 'cat', width: 14 },
    { header: '입력', key: 'input', width: 40 },
    { header: '우리 ms', key: 'oursMs', width: 12 },
    { header: 'VP ms', key: 'vpMs', width: 12 },
    { header: '차이', key: 'diff', width: 12 },
    { header: '우리 purpose', key: 'oursPurpose', width: 14 },
    { header: 'VP purpose', key: 'vpPurpose', width: 14 },
  ];
  ws5.getRow(1).eachCell(c => { c.fill = BLUE_HEADER; c.font = WHITE_FONT; c.border = BORDER_THIN; c.alignment = { horizontal: 'center' }; });

  for (const r of results) {
    const diff = r.oursMs - r.vpMs;
    const row = ws5.addRow({ id: r.id, cat: r.cat, input: r.input.substring(0,50), oursMs: r.oursMs, vpMs: r.vpMs, diff: `${diff > 0 ? '+' : ''}${diff}`, oursPurpose: r.oursPurpose, vpPurpose: r.vpPurpose });
    row.eachCell(c => { c.border = BORDER_THIN; c.alignment = { horizontal: 'center' }; });
    row.getCell('input').alignment = { horizontal: 'left' };
  }

  const outPath = path.join(__dirname, 'YG1_테스트_비교_리포트.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log(`\n📊 Excel saved: ${outPath}`);
  return outPath;
}

// ====================================================================
// MAIN
// ====================================================================
async function main() {
  const tests = defineAllTests();
  console.log(`🚀 총 ${tests.length}개 테스트 시작 — 양쪽 API 동시 비교`);
  console.log(`   우리: ${TARGETS.ours.hostname}:${TARGETS.ours.port}`);
  console.log(`   VP:   ${TARGETS.vp.hostname}\n`);

  const results = [];

  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    process.stdout.write(`[${i+1}/${tests.length}] #${t.id} [${t.cat}] ${t.input.substring(0,45)}...`);

    let oursResult, vpResult;
    try { oursResult = await t.run(TARGETS.ours); }
    catch(e) { oursResult = { verdict: 'FAIL', info: { text: `ERROR: ${e.message}`, purpose: 'error', candidateCount: 0, filterCount: 0, filterSummary: '', chips: [], error: e.message, elapsedMs: 0 } }; }

    await sleep(200);

    try { vpResult = await t.run(TARGETS.vp); }
    catch(e) { vpResult = { verdict: 'FAIL', info: { text: `ERROR: ${e.message}`, purpose: 'error', candidateCount: 0, filterCount: 0, filterSummary: '', chips: [], error: e.message, elapsedMs: 0 } }; }

    const oI = oursResult.info, vI = vpResult.info;
    const ov = oursResult.verdict, vv = vpResult.verdict;
    const icon = ov === 'PASS' ? '✅' : ov === 'FAIL' ? '❌' : '⚠️';
    const vIcon = vv === 'PASS' ? '✅' : vv === 'FAIL' ? '❌' : '⚠️';
    console.log(` 우리${icon} VP${vIcon}`);

    results.push({
      id: t.id, cat: t.cat, input: t.input, expect: t.expect,
      oursVerdict: ov, vpVerdict: vv,
      oursText: oI.text || '', vpText: vI.text || '',
      oursFilters: oI.filterSummary || '', vpFilters: vI.filterSummary || '',
      oursCand: oI.candidateCount, vpCand: vI.candidateCount,
      oursPurpose: oI.purpose, vpPurpose: vI.purpose,
      oursMs: oI.elapsedMs, vpMs: vI.elapsedMs,
      oursChips: (oI.chips || []).join(', '), vpChips: (vI.chips || []).join(', '),
    });

    await sleep(300);
  }

  // Summary
  const oP = results.filter(r => r.oursVerdict === 'PASS').length;
  const vP = results.filter(r => r.vpVerdict === 'PASS').length;
  console.log(`\n═══ 최종: 우리 ${oP}/${results.length} PASS (${Math.round(oP/results.length*100)}%) │ VP ${vP}/${results.length} PASS (${Math.round(vP/results.length*100)}%) ═══`);

  await generateExcel(results);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
