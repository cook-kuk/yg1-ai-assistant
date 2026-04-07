#!/usr/bin/env node
/**
 * 우리 Vercel (cook_ver1) 전체 151개 테스트
 * VP 테스트 스크립트 기반 — 호스트만 변경
 */
const https = require('https');

const API_HOST = 'yg1-ai-assistant.vercel.app';
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

// ═══ TEST DEFINITIONS (151개 — VP 테스트와 동일) ═══
function allTests() {
  const T = [];
  let id = 0;

  // 1. 멀티필터 (10)
  for (const c of [
    { i: '피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘', e: 'material+subtype+flute+dia', mf: 2 },
    { i: '탄소강 10mm 4날 Square TiAlN 추천해줘', e: '5개 필터', mf: 3 },
    { i: '스테인리스 8mm Ball 추천', e: '3개 필터', mf: 2 },
    { i: '알루미늄 12mm Radius', e: '3개 필터', mf: 2 },
    { i: '구리 2날 10mm', e: '3개 필터', mf: 2 },
    { i: 'copper square 2flute 10mm', e: '영어 4개 필터', mf: 2 },
    { i: 'SUS304 황삭용 추천', e: '소재+가공방식', mf: 1 },
    { i: '고경도강 6mm 볼 추천', e: '3개 필터', mf: 2 },
    { i: '주철 4날 Square', e: '3개 필터', mf: 2 },
    { i: '티타늄 합금 2날 Ball', e: '3개 필터', mf: 2 },
  ]) { const _c=c; T.push({ id:++id, cat:'1.멀티필터', input:_c.i, expect:_c.e, run: async()=>{ const r=ext(await callRetry(req(_c.i))); const pass=ok(r)&&r.fCnt>=_c.mf&&r.cand>0; return { v: pass?'PASS':(!ok(r)?'FAIL':'WARN'), r }; }}); }

  // 2. 필터변경 (10)
  for (const c of [
    { s:'Square 4날 10mm 추천', ch:'Ball로 바꿔줘', e:'toolSubtype→Ball' },
    { s:'Square 4날 10mm', ch:'6날로 변경', e:'fluteCount→6' },
    { s:'Square 4날 10mm', ch:'8mm로 바꿔', e:'dia→8' },
    { s:'Square 4날 TiAlN', ch:'AlCrN으로', e:'coating→AlCrN' },
    { s:'탄소강 Square 4날', ch:'스테인리스로', e:'material→Stainless' },
    { s:'Square 4날 12mm', ch:'10mm로 줄여줘', e:'dia→10' },
    { s:'Square 4날 TiCN', ch:'TiAlN으로 교체', e:'coating→TiAlN' },
    { s:'Square 4날 10mm', ch:'Radius로 바꿔', e:'subtype→Radius' },
    { s:'Square 4날 10mm', ch:'3날로 줄여줘', e:'flute→3' },
    { s:'Square 4날 10mm', ch:'직경만 6mm로', e:'dia→6' },
  ]) { const _c=c; T.push({ id:++id, cat:'2.필터변경', input:`${_c.s} → ${_c.ch}`, expect:_c.e, run: async()=>{ const r1=ext(await callRetry(req(_c.s))); await sleep(300); const r2=ext(await callRetry(req(_c.ch, r1.session, [{role:'user',text:_c.s},{role:'ai',text:r1.text}]))); return { v: ok(r2)&&r2.cand>0?'PASS':'FAIL', r:r2 }; }}); }

  // 3. 부정제외 (10)
  for (const c of [
    { s:'Square 4날', m:'TiAlN 빼고 나머지요', e:'TiAlN 제외' },
    { s:'Square 4날', m:'TiAlN만 아니면 돼', e:'TiAlN 제외' },
    { s:'Square 4날', m:'TiAlN 제외하고', e:'TiAlN 제외' },
    { s:'4날 10mm', m:'Square 빼고', e:'Square 제외' },
    { s:'Square 10mm', m:'4날 말고 다른거', e:'4날 제외' },
    { s:'4날 10mm', m:'Ball 아닌것', e:'Ball 제외' },
    { s:'4날 10mm', m:'코팅 없는거', e:'Uncoated' },
    { s:'4날 10mm', m:'DLC 빼고 TiAlN으로', e:'DLC제외+TiAlN' },
    { s:'Square 4날', m:'아니 TiAlN만 아니면 된다니까', e:'TiAlN 제외' },
    { s:'4날 10mm', m:'코팅 없는 걸로', e:'Uncoated' },
  ]) { const _c=c; T.push({ id:++id, cat:'3.부정제외', input:`[${_c.s}] ${_c.m}`, expect:_c.e, run: async()=>{ const r1=ext(await callRetry(req(_c.s))); await sleep(300); const r2=ext(await callRetry(req(_c.m, r1.session, [{role:'user',text:_c.s},{role:'ai',text:r1.text}]))); return { v: ok(r2)&&r2.cand>0?'PASS':'FAIL', r:r2 }; }}); }

  // 4. 네비게이션 (10)
  const navs = [
    { l:'처음부터 다시', st:['Square 4날 10mm','처음부터 다시'], ck:(rs)=>ok(rs.at(-1))&&rs.at(-1).fCnt===0 },
    { l:'이전 단계', st:['Square 4날','이전 단계'], ck:(rs)=>ok(rs[1])&&rs[1].fCnt<rs[0].fCnt, w:1 },
    { l:'3필터→이전→복원', st:['Square','4날','TiAlN','이전'], ck:(rs)=>ok(rs[3])&&rs[3].cand>=rs[2].cand, w:1 },
    { l:'초기화', st:['Square 4날 10mm','초기화'], ck:(rs)=>ok(rs.at(-1))&&rs.at(-1).fCnt===0 },
    { l:'리셋→새조건', st:['Square 4날','처음부터 다시','Ball 2날'], ck:(rs)=>ok(rs.at(-1))&&rs.at(-1).cand>0 },
    { l:'이전x2', st:['Square','4날','TiAlN','이전 단계로','이전 단계로'], ck:(rs)=>ok(rs[4])&&rs[4].fCnt<=rs[2].fCnt-2, w:1 },
    { l:'다시 처음부터', st:['Square','4날','다시 처음부터'], ck:(rs)=>ok(rs.at(-1))&&rs.at(-1).fCnt===0 },
    { l:'5턴후 처음부터', st:['Square','4날','10mm','TiAlN','스테인리스','처음부터'], ck:(rs)=>ok(rs.at(-1))&&rs.at(-1).fCnt===0 },
    { l:'돌아가', st:['Square 4날 10mm','돌아가'], ck:(rs)=>ok(rs[1]), w:1 },
    { l:'이전 단계로', st:['Square 4날 10mm','이전 단계로'], ck:(rs)=>ok(rs[1])&&rs[1].fCnt<rs[0].fCnt, w:1 },
  ];
  for (const c of navs) { const _c=c; T.push({ id:++id, cat:'4.네비게이션', input:_c.st.join('→'), expect:_c.l, run: async()=>{ const rs=await multi(_c.st); const last=rs.at(-1); const pass=_c.ck(rs); return { v: pass?'PASS':(_c.w&&ok(last)?'WARN':'FAIL'), r:last }; }}); }

  // 5. skip (5)
  for (const m of ['상관없음','아무거나','알아서','패스','넘어가']) { const _m=m; T.push({ id:++id, cat:'5.skip', input:`[Square 4날] ${_m}`, expect:'skip 처리', run: async()=>{ const r1=ext(await callRetry(req('Square 4날'))); await sleep(300); const r2=ext(await callRetry(req(_m, r1.session, [{role:'user',text:'Square 4날'},{role:'ai',text:r1.text}]))); return { v: ok(r2)&&r2.cand>0?'PASS':'FAIL', r:r2 }; }}); }

  // 6. 멀티턴 A~J (10)
  const mts = [
    { l:'A', st:['Square','4날','TiAlN','추천해줘','8mm로 좁혀줘'] },
    { l:'B', st:['구리 2날 10mm','추천해줘','Ball로 바꿔'] },
    { l:'C', st:['Square','Ball로 바꿔','4날','TiAlN'] },
    { l:'D', st:['Square 4날','상관없음','상관없음','추천해줘'] },
    { l:'E', st:['Square 4날','추천해줘','이전','Ball','추천해줘'] },
    { l:'F', st:['코팅은 TiAlN 빼고 나머지','Square','4날','추천해줘'] },
    { l:'G', st:['Square 4날','추천해줘','처음부터 다시','Ball 2날 6mm','추천해줘'] },
    { l:'H', st:['Square 4날 10mm','추천해줘','코팅만 AlCrN으로 바꿔','추천해줘'] },
    { l:'I', st:['구리 2날 10mm','추천해줘','Ball로 바꿔','추천해줘'] },
    { l:'J', st:['Square','Radius로','아니 Ball로','직경 6mm로 줄여','추천해줘'] },
  ];
  for (const c of mts) { const _c=c; T.push({ id:++id, cat:`6.멀티턴${_c.l}`, input:_c.st.join('→'), expect:'정상 추천', run: async()=>{ const rs=await multi(_c.st); const last=rs.at(-1); return { v: ok(last)&&last.cand>0?'PASS':'FAIL', r:last }; }}); }

  // 7. 추천 (5)
  const recs = [
    { st:['추천해줘'], l:'추천(no filter)', ck:(rs)=>ok(rs[0]) },
    { st:['Square 4날','지금 바로 제품 보기'], l:'제품 보기', ck:(rs)=>ok(rs[1])&&rs[1].cand>0 },
    { st:['Square 4날 10mm','AI 상세 분석'], l:'AI 분석', ck:(rs)=>ok(rs[1]) },
    { st:['Square 4날','추천해줘'], l:'필터2개→추천', ck:(rs)=>ok(rs[1])&&rs[1].cand>0 },
    { st:['Square 4날 10mm','추천해줘','더 보여줘'], l:'더 보여줘', ck:(rs)=>ok(rs[2]) },
  ];
  for (const c of recs) { const _c=c; T.push({ id:++id, cat:'7.추천', input:_c.st.join('→'), expect:_c.l, run: async()=>{ const rs=await multi(_c.st); return { v: _c.ck(rs)?'PASS':'FAIL', r:rs.at(-1) }; }}); }

  // 8. 비교 (5)
  for (const m of ['상위 3개 비교해줘','첫번째 두번째 차이가 뭐야?','TiAlN이 좋아 AlCrN이 좋아?','4G MILL X5070 알려줘','SEME71 vs SEME72']) { const _m=m; T.push({ id:++id, cat:'8.비교', input:_m, expect:'정상 응답', run: async()=>{ const r=ext(await callRetry(req(_m))); return { v: ok(r)?'PASS':'FAIL', r }; }}); }

  // 9. 질문 (10)
  for (const m of ['TiAlN이 뭐야?','4날 6날 차이','코너 래디우스가 뭐야?','황삭 정삭 차이','YG-1 어떤 회사?','Square 뭐에 써?','코팅 종류 알려줘','절삭속도가 뭐야?','헬릭스각 중요해?','엔드밀 드릴 차이']) { const _m=m; T.push({ id:++id, cat:'9.질문', input:_m, expect:'정상 답변', run: async()=>{ const r=ext(await callRetry(req(_m))); return { v: ok(r)?'PASS':'FAIL', r }; }}); }

  // 10. 자연어 (15)
  for (const c of [
    {i:'구리 전용 2날 10mm',mf:2},{i:'알루미늄 고속가공',mf:1},{i:'SUS304 황삭',mf:1},{i:'스테인리스 마무리',mf:1},{i:'금형 곡면',mf:0},{i:'티타늄 가공',mf:1},{i:'인코넬용',mf:1},{i:'프리하든강',mf:1},{i:'칩 배출 좋은',mf:0},{i:'진동 적은',mf:0},{i:'긴 가공 깊이',mf:0},{i:'측면 가공',mf:0},{i:'포켓 가공',mf:0},{i:'3D 곡면',mf:0},{i:'깊은 홈',mf:0},
  ]) { const _c=c; T.push({ id:++id, cat:'10.자연어', input:_c.i, expect:`필터>=${_c.mf}`, run: async()=>{ const r=ext(await callRetry(req(_c.i))); const pass=ok(r)&&r.fCnt>=_c.mf&&r.cand>0; return { v: pass?'PASS':(ok(r)?'WARN':'FAIL'), r }; }}); }

  // 11. CRX-S (20)
  for (const m of ['구리 스퀘어 2날 10mm','copper square 2flute 10mm','동 가공용 엔드밀 10mm','Cu 소재 Square D10','비철 구리 Square 2날 10mm','구리 평날 두날 열미리','구리 Square 2날 6mm','구리 Square 2날 8mm','구리 Square 2날 12mm','구리 Square 2날 4mm','구리 엔드밀 추천해줘','동 가공용 추천','구리 2날 10mm 추천','copper endmill 10mm','구리 가공 스퀘어','Cu Square 2F 10','구리합금 엔드밀','동 10파이','구리 D10 2날','순동 가공']) { const _m=m; T.push({ id:++id, cat:'11.CRX-S', input:_m, expect:'구리 필터+후보', run: async()=>{ const r=ext(await callRetry(req(_m))); return { v: ok(r)&&r.cand>0?'PASS':'FAIL', r }; }}); }

  // 12. 소재점수 (5)
  for (const m of ['구리 엔드밀 추천','알루미늄 엔드밀 추천','스테인리스 엔드밀 추천','탄소강 엔드밀 추천','고경도강 엔드밀 추천']) { const _m=m; T.push({ id:++id, cat:'12.소재점수', input:_m, expect:'소재필터+후보', run: async()=>{ const r=ext(await callRetry(req(_m))); return { v: ok(r)&&r.cand>0?'PASS':'FAIL', r }; }}); }

  // 15. 도메인지식 (5)
  for (const m of ['떨림 적은 거','면조도 좋은 거','리브 가공용','황삭 효율 좋은 거','고이송 가공']) { const _m=m; T.push({ id:++id, cat:'15.도메인지식', input:_m, expect:'정상 응답', run: async()=>{ const r=ext(await callRetry(req(_m))); return { v: ok(r)?'PASS':'FAIL', r }; }}); }

  // 16. 0건fallback (3)
  T.push({ id:++id, cat:'16.0건fallback', input:'구리 Square 2날 10mm TiAlN DLC', expect:'fallback 안내', run: async()=>{ const r=ext(await callRetry(req('구리 Square 2날 10mm TiAlN DLC'))); return { v: ok(r)?'PASS':'FAIL', r }; }});
  T.push({ id:++id, cat:'16.0건fallback', input:'인코넬 16파이 Square 2날 TiAlN DLC', expect:'fallback', run: async()=>{ const r=ext(await callRetry(req('인코넬 16파이 Square 2날 TiAlN DLC'))); return { v: ok(r)?'PASS':'FAIL', r }; }});
  T.push({ id:++id, cat:'16.0건fallback', input:'0건→이전→복귀', expect:'복귀', run: async()=>{ const rs=await multi(['구리 Square 2날 10mm TiAlN DLC','이전']); return { v: ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', r:rs.at(-1) }; }});

  // 17. 인코딩 (5)
  for (const c of [{i:'스퀘어 4날',mf:1},{i:'square 4 flute',mf:1},{i:'스퀘어 4flute TiAlN',mf:1},{i:'10',mf:1},{i:'Ø10',mf:1}]) { const _c=c; T.push({ id:++id, cat:'17.인코딩', input:_c.i, expect:'정상 처리', run: async()=>{ const r=ext(await callRetry(req(_c.i))); return { v: ok(r)&&r.fCnt>=_c.mf&&r.cand>0?'PASS':(ok(r)?'WARN':'FAIL'), r }; }}); }

  // 19. 에러핸들링 (10)
  for (const c of [{i:'',e:'빈값'},{i:'10',e:'숫자만'},{i:'???',e:'특수문자'},{i:'A'.repeat(200),e:'긴 메시지'},{i:'4 flute TiAlN Square',e:'영어'},{i:'ボールエンドミル',e:'일본어'},{i:'squre',e:'오타'},{i:'ㅎㅎ 아무거나',e:'감탄사'},{i:'👍',e:'이모지'},{i:'10미리 4날',e:'구어체'}]) { const _c=c; T.push({ id:++id, cat:'19.에러핸들링', input:_c.i||'(빈문자열)', expect:_c.e, run: async()=>{ const r=ext(await callRetry(req(_c.i))); return { v: ok(r)?'PASS':'FAIL', r }; }}); }

  // 22. 응답시간
  T.push({ id:++id, cat:'22.응답시간', input:'(전체 집계)', expect:'<30s', run: async()=>({ v:'SKIP', r:{ text:'별도집계', purpose:'meta', cand:0, fCnt:0, filterStr:'', chips:'', error:null, ms:0 } }) });

  // 23. 👎재현 (12)
  for (const c of [
    {i:'R1짜리 10파이 추천해줘',e:'Radius R1 10mm'},{i:'인코넬 가공하는데 16파이 스퀘어 제품 추천해줘',e:'인코넬 Square 16mm'},{i:'4날이 좋겠고, 가장 인기있는 아이템을 추천해줘',e:'4날+추천'},{i:'코팅은 상관없고, 소재는 알루미늄입니다',e:'coating skip+알루미늄'},{i:'직경이 10mm인애들 추천해줘',e:'10mm 필터'},{i:'블루코팅 후보제품군을 5위까지 보여줘',e:'블루코팅 매핑'},{i:'ALU-CUT이나 ALU-POWER 으로 추천해줘',e:'시리즈명 인식'},{i:'공구 형상을 코너레디우스만 보여줘',e:'Radius 매핑'},{i:'3/8" 직경 제품으로 가공하고자 하며 좀 더 hardend steel 탄소강으로 추천해주실 수 있나요?',e:'인치→mm+필터'},{i:'나는 Aluminum이 아니고 Graphite를 가공하고 싶어요',e:'Graphite 변경'},{i:'적층제조를 모르시나요?',e:'에러 안 남'},{i:'3날 무코팅에 스퀘어',e:'3날+무코팅+Square'},
  ]) { const _c=c; T.push({ id:++id, cat:'23.👎재현', input:_c.i, expect:_c.e, run: async()=>{ const r=ext(await callRetry(req(_c.i))); const pass=_c.i==='적층제조를 모르시나요?'?ok(r):(ok(r)&&r.cand>0); return { v: pass?'PASS':'FAIL', r }; }}); }

  return T;
}

// ═══ RUNNER ═══
(async () => {
  const tests = allTests();
  const results = [];
  const startTime = Date.now();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  우리 Vercel (cook_ver1) 전체 151개 테스트                  ║');
  console.log('║  URL: yg1-ai-assistant.vercel.app                          ║');
  console.log(`║  시작: ${new Date().toLocaleString('ko-KR').padEnd(50)}║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('');

  let currentCat = '';
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    if (t.cat !== currentCat) {
      if (currentCat) {
        const catResults = results.filter(r => r.cat === currentCat);
        const p = catResults.filter(r=>r.v==='PASS').length;
        const f = catResults.filter(r=>r.v==='FAIL').length;
        const w = catResults.filter(r=>r.v==='WARN').length;
        console.log(`  ── ${currentCat} 소계: ${p} PASS / ${f} FAIL / ${w} WARN ──\n`);
      }
      currentCat = t.cat;
      console.log(`▶ ${currentCat}`);
    }

    try {
      const { v, r } = await t.run();
      const result = { id: t.id, cat: t.cat, input: t.input, expect: t.expect, v, text: r.text, purpose: r.purpose, cand: r.cand, fCnt: r.fCnt, filterStr: r.filterStr, chips: r.chips, ms: r.ms, error: r.error };
      results.push(result);

      const icon = v === 'PASS' ? '✅' : v === 'FAIL' ? '❌' : v === 'WARN' ? '⚠️' : '⏭️';
      const resp = r.text.replace(/\n/g,' ').substring(0,50);
      console.log(`  ${icon} #${String(t.id).padEnd(3)} ${t.input.substring(0,40).padEnd(42)} ${String(r.cand).padStart(5)}개 ${String(r.ms).padStart(5)}ms ${r.fCnt}F`);
    } catch(e) {
      results.push({ id: t.id, cat: t.cat, input: t.input, expect: t.expect, v: 'FAIL', text: `ERROR: ${e.message}`, purpose:'', cand:-1, fCnt:0, filterStr:'', chips:'', ms:0, error: e.message });
      console.log(`  ❌ #${String(t.id).padEnd(3)} ${t.input.substring(0,40).padEnd(42)} ERROR: ${e.message.substring(0,30)}`);
    }

    // Rate limiting
    if (i < tests.length - 1) await sleep(200);
  }

  // Last category summary
  if (currentCat) {
    const catResults = results.filter(r => r.cat === currentCat);
    const p = catResults.filter(r=>r.v==='PASS').length;
    const f = catResults.filter(r=>r.v==='FAIL').length;
    const w = catResults.filter(r=>r.v==='WARN').length;
    console.log(`  ── ${currentCat} 소계: ${p} PASS / ${f} FAIL / ${w} WARN ──\n`);
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const totalPass = results.filter(r=>r.v==='PASS').length;
  const totalFail = results.filter(r=>r.v==='FAIL').length;
  const totalWarn = results.filter(r=>r.v==='WARN').length;
  const totalSkip = results.filter(r=>r.v==='SKIP').length;
  const avgMs = Math.round(results.filter(r=>r.ms>0).reduce((s,r)=>s+r.ms,0) / results.filter(r=>r.ms>0).length);

  // Category summary
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  카테고리별 요약                                            ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  const cats = [...new Set(results.map(r=>r.cat))];
  for (const cat of cats) {
    const cr = results.filter(r=>r.cat===cat);
    const p=cr.filter(r=>r.v==='PASS').length, f=cr.filter(r=>r.v==='FAIL').length, w=cr.filter(r=>r.v==='WARN').length;
    const rate = Math.round(p/cr.length*100);
    const bar = rate >= 80 ? '🟢' : rate >= 50 ? '🟡' : '🔴';
    console.log(`║ ${bar} ${cat.padEnd(14)} ${String(p).padStart(2)}/${String(cr.length).padStart(2)} PASS (${String(rate).padStart(3)}%) ${f>0?`${f} FAIL `:' '.repeat(7)}${w>0?`${w} WARN`:''}`.padEnd(61) + '║');
  }

  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  총합: ${totalPass} PASS / ${totalFail} FAIL / ${totalWarn} WARN / ${totalSkip} SKIP`.padEnd(61) + '║');
  console.log(`║  통과율: ${Math.round(totalPass/results.length*100)}% | 평균응답: ${avgMs}ms | 소요시간: ${elapsed}초`.padEnd(61) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // FAIL list
  const fails = results.filter(r=>r.v==='FAIL');
  if (fails.length > 0) {
    console.log(`\n❌ FAIL 목록 (${fails.length}건):`);
    for (const f of fails) {
      console.log(`  #${String(f.id).padEnd(3)} [${f.cat}] ${f.input.substring(0,45)} → ${f.text.replace(/\n/g,' ').substring(0,50)}`);
    }
  }

  // Save JSON
  const fs = require('fs');
  fs.writeFileSync(require('path').join(__dirname, 'our-vercel-results.json'), JSON.stringify(results, null, 2));
  console.log('\n📁 결과 저장: test-results/our-vercel-results.json');
})();
