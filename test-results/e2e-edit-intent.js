#!/usr/bin/env node
const https = require('https');

function callAPI(body, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: 'yg1-ai-assistant.vercel.app',
      port: 443,
      path: '/api/recommend',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: timeoutMs,
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const intake = {
    inquiryPurpose: { status: 'known', value: 'new' },
    material: { status: 'known', value: 'P' },
    operationType: { status: 'known', value: 'Slotting' },
    toolTypeOrCurrentProduct: { status: 'known', value: 'Milling' },
    diameterInfo: { status: 'known', value: '10mm' },
    country: { status: 'known', value: 'KOREA' },
  };

  // Step 0: build base state
  console.log('=== Step 0: Initial (Square 2날 CRX-S) ===');
  const r0 = await callAPI({ engine: 'serve', intakeForm: intake, messages: [
    { role: 'user', text: '스테인리스 Slotting 10mm Square 2날 CRX-S' }
  ] });
  const s0 = r0.sessionState;
  const f0 = s0?.appliedFilters || [];
  console.log('filters:', f0.map(f => f.field + '=' + f.rawValue + '(' + f.op + ')'));
  console.log('candidates:', s0?.candidateCount);
  console.log('top product:', r0.candidateSnapshot?.[0]?.productCode || 'none');
  if (!s0) { console.log('FATAL: no sessionState'); return; }
  await sleep(500);

  const cases = [
    { name: 'CRX S 가 아닌걸로', msg: 'CRX S 가 아닌걸로' },
    { name: 'CRX S 말고 다른 브랜드', msg: 'CRX S 말고 다른 브랜드' },
    { name: '2날 말고 4날로', msg: '2날 말고 4날로' },
    { name: '브랜드는 상관없음', msg: '브랜드는 상관없음' },
    { name: '이전으로 돌아가서 CRX S 제외', msg: '이전으로 돌아가서 CRX S 제외' },
  ];

  const results = [];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    console.log('\n=== Case ' + (i + 1) + ': ' + c.name + ' ===');
    await sleep(500);

    const r = await callAPI({
      engine: 'serve',
      intakeForm: intake,
      messages: [
        { role: 'user', text: '스테인리스 Slotting 10mm Square 2날 CRX-S' },
        { role: 'ai', text: r0.text || '추천 결과입니다.' },
        { role: 'user', text: c.msg }
      ],
      sessionState: s0,
    });

    const s = r.sessionState;
    const af = s?.appliedFilters || [];
    console.log('BEFORE:', f0.map(f => f.field + '=' + f.rawValue + '(' + f.op + ')'));
    console.log('AFTER: ', af.map(f => f.field + '=' + f.rawValue + '(' + f.op + ')'));
    console.log('candidates:', s?.candidateCount);

    // top products
    const topProducts = (r.candidateSnapshot || []).slice(0, 3);
    console.log('top 3:', topProducts.map(p => p.productCode + '(' + (p.seriesName || '?') + ')').join(', '));

    // routing source
    const traceEvents = r.meta?.debugTrace?.events || [];
    const editEvt = traceEvents.find(e => e.step === 'edit-intent');
    const kgEvt = traceEvents.find(e => e.step === 'knowledge-graph');
    const router = editEvt ? 'edit-intent' : (kgEvt ? 'KG(' + (kgEvt.outputSummary?.source || kgEvt.inputSummary?.source || '?') + ')' : 'other');
    console.log('router:', router);

    // Verify per case
    let pass = false;
    switch (i) {
      case 0: { // CRX S 가 아닌걸로
        const neq = af.find(f => f.field === 'brand' && f.op === 'neq');
        const eq = af.find(f => f.field === 'brand' && f.op === 'eq');
        pass = !!neq && !eq;
        console.log('brand neq:', neq?.rawValue || 'NONE', '| brand eq:', eq?.rawValue || 'NONE');
        // check top products don't have CRX-S
        const hasCRXS = topProducts.some(p => /crx/i.test(p.seriesName || ''));
        console.log('top has CRX-S:', hasCRXS ? 'YES (stale!)' : 'NO (ok)');
        break;
      }
      case 1: { // CRX S 말고 다른 브랜드
        const neq = af.find(f => f.field === 'brand' && f.op === 'neq');
        const eq = af.find(f => f.field === 'brand' && f.op === 'eq');
        pass = !!neq && !eq;
        console.log('brand neq:', neq?.rawValue || 'NONE', '| brand eq:', eq?.rawValue || 'NONE');
        break;
      }
      case 2: { // 2날 말고 4날로
        const fc = af.find(f => f.field === 'fluteCount');
        pass = fc && String(fc.rawValue) === '4' && fc.op === 'eq';
        console.log('fluteCount:', fc ? fc.rawValue + '(' + fc.op + ')' : 'NONE');
        break;
      }
      case 3: { // 브랜드는 상관없음
        const brandFilters = af.filter(f => f.field === 'brand');
        pass = brandFilters.length === 0;
        console.log('brand filters remaining:', brandFilters.length);
        break;
      }
      case 4: { // 이전으로 돌아가서 CRX S 제외
        const neq = af.find(f => f.field === 'brand' && f.op === 'neq');
        pass = !!neq;
        console.log('brand neq:', neq?.rawValue || 'NONE');
        console.log('lastAction:', s?.lastAction);
        break;
      }
    }

    console.log('RESULT:', pass ? 'PASS' : 'FAIL');
    results.push({ name: c.name, pass });
  }

  console.log('\n========== SUMMARY ==========');
  results.forEach((r, i) => console.log('Case ' + (i + 1) + ': ' + (r.pass ? 'PASS' : 'FAIL') + ' — ' + r.name));
  console.log('Total: ' + results.filter(r => r.pass).length + '/' + results.length);
}

run().catch(e => console.error('ERROR:', e.message));
