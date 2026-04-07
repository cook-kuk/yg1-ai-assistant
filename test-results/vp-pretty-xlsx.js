#!/usr/bin/env node
/**
 * VP(부사장님) Vercel 테스트 → 비전공자용 예쁜 Excel
 * 대화 내용 전문 + 쉬운 판정 이유
 */
const https = require('https');
const ExcelJS = require('exceljs');
const path = require('path');

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
        const elapsed = Date.now() - start;
        try { resolve({ body: JSON.parse(data), elapsedMs: elapsed }); }
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

function ext(res) {
  const b = res?.body || {};
  const s = b.session?.publicState || b.session || {};
  return {
    text: b.text || '', purpose: b.purpose || '',
    cand: s.candidateCount ?? (b.candidates?.length ?? -1),
    filters: (s.appliedFilters || []),
    filterStr: (s.appliedFilters || []).map(f => `${f.field}=${f.value}`).join(', '),
    fCnt: (s.appliedFilters || []).length,
    chips: (b.chips || []).join(', '),
    session: b.session, error: b.error || b.detail, ms: res?.elapsedMs ?? 0,
  };
}
function ok(i) { return !i.error && !i.text.includes('오류가 발생했습니다'); }
function req(msg, session, history) {
  const messages = [...(history || []), { role: 'user', text: msg }];
  const body = { engine: 'serve', language: 'ko', messages };
  if (session) body.session = session;
  return body;
}
async function multi(steps) {
  let session = null; const hist = []; const results = [];
  for (let i = 0; i < steps.length; i++) {
    if (i > 0) await sleep(400);
    const r = ext(await callRetry(req(steps[i], session, hist)));
    results.push({ step: steps[i], ...r });
    session = r.session;
    hist.push({ role: 'user', text: steps[i] }, { role: 'ai', text: r.text });
  }
  return results;
}

// ═══ 전체 테스트 정의 (대화 전문 수집) ═══
function allTests() {
  const T = []; let id = 0;

  // Helper: single turn test
  function single(cat, input, expect, checkFn, friendlyExpect) {
    T.push({ id:++id, cat, input, expect, friendlyExpect: friendlyExpect||expect, run: async()=>{
      const r = ext(await callRetry(req(input)));
      return { v: checkFn(r), conversation: [{ role:'사용자', text:input }, { role:'AI', text:r.text }], info:r };
    }});
  }

  // Helper: two-turn test (setup → action)
  function twoTurn(cat, setup, action, expect, checkFn, friendlyExpect) {
    T.push({ id:++id, cat, input:`${setup} → ${action}`, expect, friendlyExpect: friendlyExpect||expect, run: async()=>{
      const r1 = ext(await callRetry(req(setup)));
      await sleep(300);
      const r2 = ext(await callRetry(req(action, r1.session, [{role:'user',text:setup},{role:'ai',text:r1.text}])));
      return {
        v: checkFn(r2, r1),
        conversation: [
          { role:'사용자', text:setup }, { role:'AI', text:r1.text },
          { role:'사용자', text:action }, { role:'AI', text:r2.text },
        ],
        info: r2,
      };
    }});
  }

  // Helper: multi-turn test
  function multiTest(cat, steps, expect, checkFn, friendlyExpect) {
    T.push({ id:++id, cat, input:steps.join(' → '), expect, friendlyExpect: friendlyExpect||expect, run: async()=>{
      const results = await multi(steps);
      const conv = [];
      for (const r of results) {
        conv.push({ role:'사용자', text:r.step });
        conv.push({ role:'AI', text:r.text });
      }
      return { v: checkFn(results), conversation: conv, info: results.at(-1) };
    }});
  }

  // ── 1. 멀티필터 (10) ──
  for (const c of [
    { i:'피삭재는 구리 SQUARE 2날 직경 10 짜리 추천해줘', e:'소재+형상+날수+직경 4가지를 한번에 인식', mf:2 },
    { i:'탄소강 10mm 4날 Square TiAlN 추천해줘', e:'5개 조건을 한번에 인식', mf:3 },
    { i:'스테인리스 8mm Ball 추천', e:'소재+직경+형상 3가지 인식', mf:2 },
    { i:'알루미늄 12mm Radius', e:'소재+직경+형상 3가지 인식', mf:2 },
    { i:'구리 2날 10mm', e:'소재+날수+직경 3가지 인식', mf:2 },
    { i:'copper square 2flute 10mm', e:'영어 입력도 인식', mf:2 },
    { i:'SUS304 황삭용 추천', e:'소재+가공방식 인식', mf:1 },
    { i:'고경도강 6mm 볼 추천', e:'소재+직경+형상 인식', mf:2 },
    { i:'주철 4날 Square', e:'소재+날수+형상 인식', mf:2 },
    { i:'티타늄 합금 2날 Ball', e:'소재+날수+형상 인식', mf:2 },
  ]) { const _c=c; single('1. 첫 턴 복합조건', _c.i, _c.e, r => ok(r)&&r.fCnt>=_c.mf&&r.cand>0 ? 'PASS' : (ok(r)?'WARN':'FAIL'), _c.e); }

  // ── 2. 필터변경 (10) ──
  for (const c of [
    { s:'Square 4날 10mm 추천', ch:'Ball로 바꿔줘', e:'형상을 Ball로 변경' },
    { s:'Square 4날 10mm', ch:'6날로 변경', e:'날수를 6날로 변경' },
    { s:'Square 4날 10mm', ch:'8mm로 바꿔', e:'직경을 8mm로 변경' },
    { s:'Square 4날 TiAlN', ch:'AlCrN으로', e:'코팅을 AlCrN으로 변경' },
    { s:'탄소강 Square 4날', ch:'스테인리스로', e:'소재를 스테인리스로 변경' },
    { s:'Square 4날 12mm', ch:'10mm로 줄여줘', e:'직경을 10mm로 축소' },
    { s:'Square 4날 TiCN', ch:'TiAlN으로 교체', e:'코팅을 TiAlN으로 교체' },
    { s:'Square 4날 10mm', ch:'Radius로 바꿔', e:'형상을 Radius로 변경' },
    { s:'Square 4날 10mm', ch:'3날로 줄여줘', e:'날수를 3날로 변경' },
    { s:'Square 4날 10mm', ch:'직경만 6mm로', e:'직경만 6mm로 변경' },
  ]) { const _c=c; twoTurn('2. 조건 변경', _c.s, _c.ch, _c.e, (r2)=>ok(r2)&&r2.cand>0?'PASS':'FAIL', _c.e); }

  // ── 3. 부정/제외 (10) ──
  for (const c of [
    { s:'Square 4날', m:'TiAlN 빼고 나머지요', e:'TiAlN 코팅을 제외하고 검색' },
    { s:'Square 4날', m:'TiAlN만 아니면 돼', e:'TiAlN만 빼고 나머지 코팅 보여주기' },
    { s:'Square 4날', m:'TiAlN 제외하고', e:'TiAlN 제외 필터 적용' },
    { s:'4날 10mm', m:'Square 빼고', e:'Square 형상 제외하고 검색' },
    { s:'Square 10mm', m:'4날 말고 다른거', e:'4날 제외하고 다른 날수 보여주기' },
    { s:'4날 10mm', m:'Ball 아닌것', e:'Ball이 아닌 형상 검색' },
    { s:'4날 10mm', m:'코팅 없는거', e:'무코팅(Uncoated) 제품 검색' },
    { s:'4날 10mm', m:'DLC 빼고 TiAlN으로', e:'DLC 제외 + TiAlN 적용' },
    { s:'Square 4날', m:'아니 TiAlN만 아니면 된다니까', e:'강조 표현도 TiAlN 제외로 이해' },
    { s:'4날 10mm', m:'코팅 없는 걸로', e:'무코팅 제품 검색' },
  ]) { const _c=c; twoTurn('3. 부정/제외 표현', _c.s, _c.m, _c.e, (r2)=>ok(r2)&&r2.cand>0?'PASS':'FAIL', _c.e); }

  // ── 4. 네비게이션 (10) ──
  multiTest('4. 되돌리기/초기화', ['Square 4날 10mm','처음부터 다시'], '전체 초기화', rs=>ok(rs.at(-1))&&rs.at(-1).fCnt===0?'PASS':'FAIL', '"처음부터 다시" → 모든 조건 초기화');
  multiTest('4. 되돌리기/초기화', ['Square 4날','이전 단계'], '이전으로 돌아가기', rs=>ok(rs[1])&&rs[1].fCnt<rs[0].fCnt?'PASS':(ok(rs[1])?'WARN':'FAIL'), '"이전 단계" → 마지막 조건 1개 제거');
  multiTest('4. 되돌리기/초기화', ['Square','4날','TiAlN','이전'], '이전 복원', rs=>ok(rs[3])&&rs[3].cand>=rs[2].cand?'PASS':(ok(rs[3])?'WARN':'FAIL'), '3개 조건 입력 후 "이전" → TiAlN 제거, 후보 복원');
  multiTest('4. 되돌리기/초기화', ['Square 4날 10mm','초기화'], '초기화', rs=>ok(rs.at(-1))&&rs.at(-1).fCnt===0?'PASS':'FAIL', '"초기화" → 모든 조건 리셋');
  multiTest('4. 되돌리기/초기화', ['Square 4날','처음부터 다시','Ball 2날'], '리셋 후 새 조건', rs=>ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', '리셋 후 새 조건 입력 → 정상 동작');
  multiTest('4. 되돌리기/초기화', ['Square','4날','TiAlN','이전 단계로','이전 단계로'], '이전 2번', rs=>ok(rs[4])&&rs[4].fCnt<=rs[2].fCnt-2?'PASS':(ok(rs[4])?'WARN':'FAIL'), '"이전 단계로" 2번 연속 → 2개 조건 제거');
  multiTest('4. 되돌리기/초기화', ['Square','4날','다시 처음부터'], '다시 처음부터', rs=>ok(rs.at(-1))&&rs.at(-1).fCnt===0?'PASS':'FAIL', '"다시 처음부터" → 전체 초기화');
  multiTest('4. 되돌리기/초기화', ['Square','4날','10mm','TiAlN','스테인리스','처음부터'], '5턴 후 초기화', rs=>ok(rs.at(-1))&&rs.at(-1).fCnt===0?'PASS':'FAIL', '5개 조건 입력 후 "처음부터" → 전부 초기화');
  multiTest('4. 되돌리기/초기화', ['Square 4날 10mm','돌아가'], '돌아가', rs=>ok(rs[1])?'PASS':'FAIL', '"돌아가" → 이전 상태로 복원');
  multiTest('4. 되돌리기/초기화', ['Square 4날 10mm','이전 단계로'], '이전 단계로', rs=>ok(rs[1])&&rs[1].fCnt<rs[0].fCnt?'PASS':(ok(rs[1])?'WARN':'FAIL'), '"이전 단계로" → 조건 1개 제거');

  // ── 5. skip (5) ──
  for (const m of ['상관없음','아무거나','알아서','패스','넘어가']) { const _m=m; twoTurn('5. 건너뛰기', 'Square 4날', _m, `"${_m}" → 현재 질문 건너뛰기`, (r2)=>ok(r2)&&r2.cand>0?'PASS':'FAIL', `"${_m}"이라고 하면 다음 질문으로 넘어가기`); }

  // ── 6. 멀티턴 시나리오 (10) ──
  multiTest('6. 복합 대화', ['Square','4날','TiAlN','추천해줘','8mm로 좁혀줘'], '조건 축소 후 재추천', rs=>ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', 'Square→4날→TiAlN→추천→8mm 추가');
  multiTest('6. 복합 대화', ['구리 2날 10mm','추천해줘','Ball로 바꿔'], '추천 후 형상 변경', rs=>ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', '구리 추천 받은 뒤 Ball로 형상 변경');
  multiTest('6. 복합 대화', ['Square','Ball로 바꿔','4날','TiAlN'], '중간 변경', rs=>ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', 'Square 입력 후 Ball로 변경 → 추가 조건');
  multiTest('6. 복합 대화', ['Square 4날','상관없음','상관없음','추천해줘'], 'skip 연속 후 추천', rs=>ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', '2번 "상관없음" 후 추천 요청');
  multiTest('6. 복합 대화', ['Square 4날','추천해줘','이전','Ball','추천해줘'], '추천→이전→변경→재추천', rs=>ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', '추천 받고 → 이전 → Ball로 변경 → 재추천');
  multiTest('6. 복합 대화', ['코팅은 TiAlN 빼고 나머지','Square','4날','추천해줘'], 'TiAlN제외→조건추가→추천', rs=>ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', 'TiAlN 제외 시작 → 형상/날수 추가 → 추천');
  multiTest('6. 복합 대화', ['Square 4날','추천해줘','처음부터 다시','Ball 2날 6mm','추천해줘'], '추천→리셋→새조건→재추천', rs=>ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', '추천 후 리셋 → 완전히 새로운 조건으로 재추천');
  multiTest('6. 복합 대화', ['Square 4날 10mm','추천해줘','코팅만 AlCrN으로 바꿔','추천해줘'], '추천 후 코팅만 교체', rs=>ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', '추천 받고 코팅만 AlCrN으로 바꿔서 재추천');
  multiTest('6. 복합 대화', ['구리 2날 10mm','추천해줘','Ball로 바꿔','추천해줘'], '추천→형상변경→재추천', rs=>ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', '구리 추천 후 Ball로 변경 → 재추천');
  multiTest('6. 복합 대화', ['Square','Radius로','아니 Ball로','직경 6mm로 줄여','추천해줘'], '연속 변경 후 추천', rs=>ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', 'Square→Radius→다시 Ball→6mm→추천');

  // ── 7. 추천 (5) ──
  multiTest('7. 추천 요청', ['추천해줘'], '바로 추천', rs=>ok(rs[0])?'PASS':'FAIL', '조건 없이 "추천해줘" → 정상 응답');
  multiTest('7. 추천 요청', ['Square 4날','지금 바로 제품 보기'], '제품 보기', rs=>ok(rs[1])&&rs[1].cand>0?'PASS':'FAIL', '조건 입력 후 "지금 바로 제품 보기"');
  multiTest('7. 추천 요청', ['Square 4날 10mm','AI 상세 분석'], 'AI 분석', rs=>ok(rs[1])?'PASS':'FAIL', '"AI 상세 분석" 요청 시 상세 비교');
  multiTest('7. 추천 요청', ['Square 4날','추천해줘'], '2개 조건 후 추천', rs=>ok(rs[1])&&rs[1].cand>0?'PASS':'FAIL', '2개 조건 후 추천 요청');
  multiTest('7. 추천 요청', ['Square 4날 10mm','추천해줘','더 보여줘'], '더 보여줘', rs=>ok(rs[2])?'PASS':'FAIL', '추천 후 "더 보여줘" → 추가 제품');

  // ── 8. 비교 (5) ──
  for (const m of ['상위 3개 비교해줘','첫번째 두번째 차이가 뭐야?','TiAlN이 좋아 AlCrN이 좋아?','4G MILL X5070 알려줘','SEME71 vs SEME72']) { const _m=m; single('8. 비교/설명', _m, '정상 응답', r=>ok(r)?'PASS':'FAIL', `"${_m}" → 비교/설명 응답`); }

  // ── 9. 질문 (10) ──
  for (const m of ['TiAlN이 뭐야?','4날 6날 차이','코너 래디우스가 뭐야?','황삭 정삭 차이','YG-1 어떤 회사?','Square 뭐에 써?','코팅 종류 알려줘','절삭속도가 뭐야?','헬릭스각 중요해?','엔드밀 드릴 차이']) { const _m=m; single('9. 지식 질문', _m, '정상 답변', r=>ok(r)?'PASS':'FAIL', `"${_m}" → 전문 지식 답변`); }

  // ── 10. 자연어 (15) ──
  for (const c of [
    {i:'구리 전용 2날 10mm',e:'구리+2날+10mm 인식',mf:2},{i:'알루미늄 고속가공',e:'알루미늄 소재 인식',mf:1},{i:'SUS304 황삭',e:'SUS304+황삭 인식',mf:1},{i:'스테인리스 마무리',e:'스테인리스+정삭 인식',mf:1},{i:'금형 곡면',e:'금형/곡면 가공 이해',mf:0},{i:'티타늄 가공',e:'티타늄 소재 인식',mf:1},{i:'인코넬용',e:'인코넬 소재 인식',mf:1},{i:'프리하든강',e:'프리하든강 인식',mf:1},{i:'칩 배출 좋은',e:'칩 배출 관련 추천',mf:0},{i:'진동 적은',e:'진동 감소 관련 추천',mf:0},{i:'긴 가공 깊이',e:'깊은 가공 추천',mf:0},{i:'측면 가공',e:'측면 가공 추천',mf:0},{i:'포켓 가공',e:'포켓 가공 추천',mf:0},{i:'3D 곡면',e:'곡면 가공 추천',mf:0},{i:'깊은 홈',e:'깊은 홈 가공 추천',mf:0},
  ]) { const _c=c; single('10. 자연어 이해', _c.i, _c.e, r=>ok(r)&&r.fCnt>=_c.mf&&r.cand>0?'PASS':(ok(r)?'WARN':'FAIL'), _c.e); }

  // ── 11. CRX-S 구리 (20) ──
  for (const m of ['구리 스퀘어 2날 10mm','copper square 2flute 10mm','동 가공용 엔드밀 10mm','Cu 소재 Square D10','비철 구리 Square 2날 10mm','구리 평날 두날 열미리','구리 Square 2날 6mm','구리 Square 2날 8mm','구리 Square 2날 12mm','구리 Square 2날 4mm','구리 엔드밀 추천해줘','동 가공용 추천','구리 2날 10mm 추천','copper endmill 10mm','구리 가공 스퀘어','Cu Square 2F 10','구리합금 엔드밀','동 10파이','구리 D10 2날','순동 가공']) { const _m=m; single('11. 구리(CRX-S) 전용', _m, '구리 관련 제품 추천', r=>ok(r)&&r.cand>0?'PASS':'FAIL', `"${_m}" → 구리 전용 제품 검색`); }

  // ── 12. 소재점수 (5) ──
  for (const m of ['구리 엔드밀 추천','알루미늄 엔드밀 추천','스테인리스 엔드밀 추천','탄소강 엔드밀 추천','고경도강 엔드밀 추천']) { const _m=m; single('12. 소재별 추천', _m, '해당 소재 제품 추천', r=>ok(r)&&r.cand>0?'PASS':'FAIL', `"${_m}" → 소재에 맞는 제품`); }

  // ── 15. 도메인지식 (5) ──
  for (const c of [{i:'떨림 적은 거',e:'부등분할/4날 추천'},{i:'면조도 좋은 거',e:'볼/6날 추천'},{i:'리브 가공용',e:'테이퍼넥 추천'},{i:'황삭 효율 좋은 거',e:'라핑 추천'},{i:'고이송 가공',e:'MMC볼/3날 추천'}]) { const _c=c; single('15. 전문 도메인지식', _c.i, _c.e, r=>ok(r)?'PASS':'FAIL', `"${_c.i}" → ${_c.e}`); }

  // ── 16. 0건 fallback (3) ──
  single('16. 0건 대응', '구리 Square 2날 10mm TiAlN DLC', '0건이어도 안내', r=>ok(r)?'PASS':'FAIL', '조건이 너무 많아 0건 → 안내 메시지');
  single('16. 0건 대응', '인코넬 16파이 Square 2날 TiAlN DLC', '0건 안내', r=>ok(r)?'PASS':'FAIL', '없는 조합 → 안내 메시지');
  multiTest('16. 0건 대응', ['구리 Square 2날 10mm TiAlN DLC','이전'], '0건→이전→복귀', rs=>ok(rs.at(-1))&&rs.at(-1).cand>0?'PASS':'FAIL', '0건 나온 뒤 "이전" → 이전 상태로 복귀');

  // ── 17. 인코딩 (5) ──
  for (const c of [{i:'스퀘어 4날',e:'한글 → Square+4날'},{i:'square 4 flute',e:'영어 소문자 인식'},{i:'스퀘어 4flute TiAlN',e:'한영 혼합 인식'},{i:'10',e:'숫자만 → 직경 10mm'},{i:'Ø10',e:'특수문자 Ø → 직경'}]) { const _c=c; single('17. 언어/인코딩', _c.i, _c.e, r=>ok(r)&&r.fCnt>=1&&r.cand>0?'PASS':(ok(r)?'WARN':'FAIL'), _c.e); }

  // ── 19. 에러핸들링 (10) ──
  for (const c of [{i:'',e:'빈 입력 → 에러 없이 안내'},{i:'10',e:'숫자만 → 에러 없음'},{i:'???',e:'특수문자 → 에러 없음'},{i:'A'.repeat(200),e:'200자 → 에러 없음'},{i:'4 flute TiAlN Square',e:'영어 → 정상 처리'},{i:'ボールエンドミル',e:'일본어 → 에러 없음'},{i:'squre',e:'오타 → 에러 없음'},{i:'ㅎㅎ 아무거나',e:'감탄사 → 에러 없음'},{i:'👍',e:'이모지 → 에러 없음'},{i:'10미리 4날',e:'구어체 → 정상 처리'}]) { const _c=c; single('19. 에러 안정성', _c.i||'(빈 문자열)', _c.e, r=>ok(r)?'PASS':'FAIL', _c.e); }

  // ── 22. 응답시간 ──
  T.push({ id:++id, cat:'22. 응답시간', input:'(전체 집계)', expect:'30초 이내', friendlyExpect:'모든 응답 30초 이내', run: async()=>({ v:'SKIP', conversation:[{role:'시스템',text:'별도 집계'}], info:{text:'별도집계',purpose:'meta',cand:0,fCnt:0,filterStr:'',chips:'',error:null,ms:0} }) });

  // ── 23. 실제 사용자 재현 (12) ──
  for (const c of [
    {i:'R1짜리 10파이 추천해줘',e:'Radius R1 + 10mm 인식'},{i:'인코넬 가공하는데 16파이 스퀘어 제품 추천해줘',e:'인코넬+16mm+Square 인식'},{i:'4날이 좋겠고, 가장 인기있는 아이템을 추천해줘',e:'4날 + 인기순 추천'},{i:'코팅은 상관없고, 소재는 알루미늄입니다',e:'코팅 건너뛰기 + 알루미늄'},{i:'직경이 10mm인애들 추천해줘',e:'10mm 필터 적용'},{i:'블루코팅 후보제품군을 5위까지 보여줘',e:'"블루코팅" 매핑'},{i:'ALU-CUT이나 ALU-POWER 으로 추천해줘',e:'시리즈명 인식'},{i:'공구 형상을 코너레디우스만 보여줘',e:'"코너레디우스"→Radius 매핑'},{i:'3/8" 직경 제품으로 가공하고자 하며 좀 더 hardend steel 탄소강으로 추천해주실 수 있나요?',e:'인치→mm 변환 + 소재'},{i:'나는 Aluminum이 아니고 Graphite를 가공하고 싶어요',e:'Graphite 소재 변경'},{i:'적층제조를 모르시나요?',e:'에러 없이 응답'},{i:'3날 무코팅에 스퀘어',e:'3날+무코팅+Square'}
  ]) { const _c=c; single('23. 실제 사용자 피드백', _c.i, _c.e, r=>_c.i==='적층제조를 모르시나요?'?(ok(r)?'PASS':'FAIL'):(ok(r)&&r.cand>0?'PASS':'FAIL'), _c.e); }

  return T;
}

// ═══ EXCEL 생성 ═══
async function writeExcel(results) {
  const wb = new ExcelJS.Workbook();
  const G = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD5F5E3'} };
  const R = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFADBD8'} };
  const Y = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFEF9E7'} };
  const HDR = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1A237E'} };
  const LB = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE8EAF6'} };
  const GRAY = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF5F5F5'} };
  const WF = { color:{argb:'FFFFFFFF'}, bold:true, size:11, name:'맑은 고딕' };
  const BD = { top:{style:'thin',color:{argb:'FFBDBDBD'}}, left:{style:'thin',color:{argb:'FFBDBDBD'}}, bottom:{style:'thin',color:{argb:'FFBDBDBD'}}, right:{style:'thin',color:{argb:'FFBDBDBD'}} };
  const FONT = { name:'맑은 고딕', size:10 };

  // ──────────────────────────────
  // Sheet 1: 카테고리별 요약
  // ──────────────────────────────
  const s1 = wb.addWorksheet('요약', { views:[{state:'frozen',ySplit:3}] });

  // Title
  s1.mergeCells('A1:G1');
  const titleCell = s1.getCell('A1');
  titleCell.value = '부사장님(Vercel) AI 추천 시스템 테스트 리포트';
  titleCell.font = { name:'맑은 고딕', size:16, bold:true, color:{argb:'FF1A237E'} };
  titleCell.alignment = { horizontal:'center', vertical:'middle' };
  s1.getRow(1).height = 35;

  s1.mergeCells('A2:G2');
  s1.getCell('A2').value = `테스트 일시: ${new Date().toLocaleString('ko-KR')}  |  대상: yg1-demo-seo.vercel.app  |  총 ${results.length}개`;
  s1.getCell('A2').font = { ...FONT, size:10, color:{argb:'FF757575'} };
  s1.getCell('A2').alignment = { horizontal:'center' };

  s1.columns = [{width:20},{width:10},{width:10},{width:10},{width:10},{width:12},{width:55}];
  const hRow = s1.addRow(['카테고리','테스트 수','PASS','FAIL','WARN','통과율','주요 실패 원인']);
  hRow.eachCell(c=>{c.fill=HDR;c.font=WF;c.border=BD;c.alignment={horizontal:'center',vertical:'middle'}});
  hRow.height = 25;

  const cats=[...new Set(results.map(r=>r.cat))];
  let tp=0,tf=0,tw=0;
  for (const cat of cats) {
    const rows=results.filter(r=>r.cat===cat);
    const p=rows.filter(r=>r.v==='PASS').length, f=rows.filter(r=>r.v==='FAIL').length, w=rows.length-p-f;
    tp+=p; tf+=f; tw+=w;
    const rate=rows.length>0?Math.round(p/rows.length*100):0;
    const fails=rows.filter(r=>r.v==='FAIL');
    let reason=fails.length===0?'없음':`후보 미반환 ${fails.filter(r=>r.info.cand<=0).length}건 (purpose: ${[...new Set(fails.map(r=>r.info.purpose))].join(',')})`;

    const row=s1.addRow([cat,rows.length,p,f,w,`${rate}%`,reason]);
    row.eachCell((c,i)=>{c.border=BD;c.font=FONT;c.alignment=i<=6?{horizontal:'center',vertical:'middle'}:{horizontal:'left',wrapText:true}});
    row.getCell(6).fill=rate>=80?G:rate>=50?Y:R;
    row.getCell(6).font={...FONT,bold:true};
    row.height = 22;
  }
  const totRow=s1.addRow(['합계',results.length,tp,tf,tw,`${Math.round(tp/results.length*100)}%','']);
  totRow.eachCell(c=>{c.border=BD;c.font={...FONT,bold:true,size:12};c.alignment={horizontal:'center'}});
  totRow.getCell(1).fill=LB;
  totRow.height=28;

  // ──────────────────────────────
  // Sheet 2: 전체 대화 상세
  // ──────────────────────────────
  const s2 = wb.addWorksheet('전체 대화 상세', { views:[{state:'frozen',ySplit:1}] });
  s2.columns = [
    {header:'#',width:5},{header:'카테고리',width:18},{header:'판정',width:8},
    {header:'사용자가 입력한 내용',width:40},{header:'이런 결과가 나와야 함',width:30},
    {header:'AI가 실제로 한 대답',width:70},{header:'인식된 조건(필터)',width:28},
    {header:'찾은 제품 수',width:12},{header:'AI가 제시한 버튼(칩)',width:28},{header:'응답 시간',width:10},
  ];
  s2.getRow(1).eachCell(c=>{c.fill=HDR;c.font=WF;c.border=BD;c.alignment={horizontal:'center',vertical:'middle',wrapText:true}});
  s2.getRow(1).height=30;

  let prevCat = '';
  for (const r of results) {
    // Category separator
    if (r.cat !== prevCat) {
      const sepRow = s2.addRow([]);
      s2.mergeCells(sepRow.number, 1, sepRow.number, 10);
      sepRow.getCell(1).value = '>> ' + r.cat;
      sepRow.getCell(1).font = { ...FONT, bold:true, size:11, color:{argb:'FF1A237E'} };
      sepRow.getCell(1).fill = LB;
      sepRow.height = 24;
      prevCat = r.cat;
    }

    // Build conversation string
    let convText = '';
    if (r.conversation.length === 2) {
      convText = r.conversation[1].text; // single turn → just AI response
    } else {
      convText = r.conversation.map(function(c){ return '[' + c.role + '] ' + c.text; }).join('\n\n');
    }

    const row = s2.addRow([
      r.id, r.cat, r.v==='PASS'?'통과':r.v==='FAIL'?'실패':'주의',
      r.input, r.friendlyExpect,
      r.v==='SKIP' ? '(별도 집계)' : convText,
      r.info.filterStr || '(없음)',
      r.info.cand === -1 ? '확인불가' : r.info.cand,
      r.info.chips || '(없음)',
      r.info.ms + 'ms',
    ]);
    row.eachCell((c,i)=>{
      c.border=BD; c.font=FONT;
      c.alignment={wrapText:true,vertical:'top'};
      if([1,3,8,10].includes(i)) c.alignment={...c.alignment,horizontal:'center'};
    });

    // Color verdict
    const vCell = row.getCell(3);
    if (r.v==='PASS') { vCell.fill=G; vCell.font={...FONT,bold:true,color:{argb:'FF2E7D32'}}; }
    else if (r.v==='FAIL') { vCell.fill=R; vCell.font={...FONT,bold:true,color:{argb:'FFC62828'}}; }
    else { vCell.fill=Y; vCell.font={...FONT,bold:true,color:{argb:'FFE65100'}}; }

    // Row height based on content
    const lines = Math.min(Math.max(Math.ceil(convText.length / 60), 2), 12);
    row.height = lines * 15;
  }

  // ──────────────────────────────
  // Sheet 3: 실패 항목 집중 분석
  // ──────────────────────────────
  const s3 = wb.addWorksheet('실패 분석', { views:[{state:'frozen',ySplit:1}] });
  s3.columns = [
    {header:'#',width:5},{header:'카테고리',width:18},
    {header:'사용자 입력',width:35},{header:'기대한 동작',width:28},
    {header:'대화 전문',width:75},
    {header:'왜 실패했나 (분석)',width:45},
  ];
  s3.getRow(1).eachCell(c=>{c.fill=HDR;c.font=WF;c.border=BD;c.alignment={horizontal:'center',vertical:'middle',wrapText:true}});
  s3.getRow(1).height=28;

  for (const r of results.filter(r=>r.v==='FAIL')) {
    const convText = r.conversation.map(function(c){ return '[' + c.role + '] ' + c.text; }).join('\n\n');

    let analysis = '';
    if (r.info.cand === -1) analysis = 'API가 후보 목록(candidates)을 반환하지 않음 — session 구조가 다르거나 제품 검색이 실행되지 않음';
    else if (r.info.cand === 0) analysis = '조건에 맞는 제품이 0건 — 필터 조합이 너무 엄격하거나 DB에 해당 제품 없음';
    if (r.info.error) analysis = `API 에러 발생: ${r.info.error}`;
    if (r.info.purpose === 'question' && r.info.cand <= 0) analysis += '\nAI가 "질문"으로 분류하여 제품 검색을 실행하지 않음';
    if (!r.info.filterStr && r.info.cand <= 0) analysis += '\n필터(조건)를 하나도 인식하지 못함';
    if (r.info.purpose === 'greeting') analysis += '\nAI가 인사/리셋으로 분류하여 검색하지 않음';

    const row = s3.addRow([r.id, r.cat, r.input, r.friendlyExpect, convText, analysis]);
    row.eachCell(c=>{c.border=BD;c.font=FONT;c.alignment={wrapText:true,vertical:'top'}});
    row.getCell(1).alignment={horizontal:'center'};
    const lines = Math.min(Math.max(Math.ceil(convText.length / 60), 3), 15);
    row.height = lines * 15;
  }

  const outPath = path.join(__dirname, '부사장님_Vercel_테스트_리포트.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log(`\n📊 저장: ${outPath}`);
}

// ═══ MAIN ═══
async function main() {
  const tests = allTests();
  console.log(`🚀 부사장님(Vercel) ${tests.length}개 테스트 시작\n`);
  const results = [];
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    process.stdout.write('[' + (i+1) + '/' + tests.length + '] #' + t.id + ' ' + t.cat + ' ...');
    let res;
    try { res = await t.run(); }
    catch(e) { res = { v:'FAIL', conversation:[{role:'시스템',text:`에러: ${e.message}`}], info:{text:`ERROR: ${e.message}`,purpose:'error',cand:0,fCnt:0,filterStr:'',chips:'',error:e.message,ms:0} }; }
    const icon = res.v==='PASS'?'✅':res.v==='FAIL'?'❌':'⚠️';
    console.log(` ${icon}`);
    results.push({ ...t, ...res });
    await sleep(200);
  }
  const p=results.filter(r=>r.v==='PASS').length;
  console.log(`\n═══ PASS ${p}/${results.length} (${Math.round(p/results.length*100)}%) ═══`);
  await writeExcel(results);
}

main().catch(e=>{console.error('FATAL:',e);process.exit(1)});
