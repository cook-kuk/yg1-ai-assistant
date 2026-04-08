#!/usr/bin/env node
// 빡센 통합 테스트 러너
// 소스: 골든셋_공개_PUBLIC.xlsx (단일턴 + 멀티턴 시나리오) + 3001 피드백(최근)
// 대상: http://20.119.98.136:3000/api/chat (fallback: Vercel)
// 출력: test-results/hard-test-report.xlsx + .json

const E = require('exceljs');
const fs = require('fs');
const path = require('path');

const API_BASE = process.env.API_BASE || 'http://20.119.98.136:3000';
const PRIMARY = API_BASE + '/api/chat';
const FALLBACK = 'https://yg1-ai-assistant.vercel.app/api/chat';
const OUT_SUFFIX = process.env.OUT_SUFFIX || '';
const NO_FALLBACK = process.env.NO_FALLBACK === '1';
const TIMEOUT_MS = 180000;
const CONCURRENCY = 2;

async function postChat(url, messages) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: ctl.signal,
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body: j };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

async function callWithFallback(messages) {
  let r = await postChat(PRIMARY, messages);
  if (!r.ok && !NO_FALLBACK) {
    const r2 = await postChat(FALLBACK, messages);
    r2.usedFallback = true;
    return r2;
  }
  return r;
}

// ─── 케이스 로드 ───────────────────────────────────────────
async function loadCases() {
  const wb = new E.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, '골든셋_공개_PUBLIC.xlsx'));

  const cases = [];

  // 단일턴
  {
    const ws = wb.getWorksheet('단일턴 케이스');
    const cols = {};
    ws.getRow(1).eachCell((c, i) => { cols[String(c.value || '').trim()] = i; });
    for (let r = 2; r <= ws.actualRowCount; r++) {
      const row = ws.getRow(r);
      const userText = String(row.getCell(cols['사용자 입력']).value || '').trim();
      if (!userText) continue;
      const intake = String(row.getCell(cols['대화 맥락 (시작 조건)']).value || '').trim();
      cases.push({
        source: 'golden-single',
        id: String(row.getCell(cols['#']).value || `S${r}`),
        tags: String(row.getCell(cols['태그']).value || ''),
        intake,
        rating: String(row.getCell(cols['세션 평점']).value || ''),
        opinion: String(row.getCell(cols['기대 행동 / 사용자 의견']).value || ''),
        turns: [userText],
      });
    }
  }

  // 멀티턴 (시나리오 ID 단위로 묶기)
  {
    const ws = wb.getWorksheet('멀티턴 시나리오');
    const cols = {};
    ws.getRow(1).eachCell((c, i) => { cols[String(c.value || '').trim()] = i; });
    let cur = null;
    for (let r = 2; r <= ws.actualRowCount; r++) {
      const row = ws.getRow(r);
      const id = String(row.getCell(cols['시나리오 ID']).value || '').trim();
      const userText = String(row.getCell(cols['사용자 입력']).value || '').trim();
      if (id) {
        if (cur) cases.push(cur);
        cur = {
          source: 'golden-multi',
          id,
          tags: String(row.getCell(cols['태그']).value || ''),
          intake: String(row.getCell(cols['대화 맥락 (시작 조건)']).value || ''),
          rating: String(row.getCell(cols['세션 평점']).value || ''),
          opinion: String(row.getCell(cols['기대 행동 / 사용자 의견']).value || ''),
          turns: [],
        };
      }
      if (cur && userText) cur.turns.push(userText);
    }
    if (cur) cases.push(cur);
  }

  // 3001 피드백 (최근 3일, 평점 1-2 또는 평점 누락+코멘트)
  try {
    const dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'feedback-3001.json'), 'utf8'));
    const all = (dump.generalEntries || []).concat(dump.feedbackEntries || []);
    const cutoff = Date.parse('2026-04-04');
    const recent = all.filter((e) => {
      const ts = Date.parse(e.timestamp);
      if (!ts || ts < cutoff) return false;
      if (e.rating != null && Number(e.rating) <= 2) return true;
      if (e.rating == null && (e.comment || '').trim().length > 5) return true;
      return false;
    });
    for (const e of recent) {
      const turns = [];
      for (const m of (e.chatHistory || [])) {
        if (m.role !== 'user') continue;
        const t = String(m.text || '').trim();
        if (!t || t.length < 2) continue;
        if (/^[📋🧭🧱📐🛠️📏🌐✅]/.test(t)) continue;
        if (/위 조건에 맞는 YG-1 제품을 추천/.test(t)) continue;
        turns.push(t);
      }
      if (!turns.length) continue;
      cases.push({
        source: 'feedback-3001',
        id: 'FB-' + (e.id || '').slice(-8),
        tags: (e.tags || []).join(', '),
        intake: (e.intakeSummary || '').replace(/\n/g, ' / '),
        rating: e.rating != null ? `(${e.rating})` : '',
        opinion: (e.comment || '').replace(/\s+/g, ' ').trim(),
        turns,
      });
    }
  } catch (err) {
    console.warn('feedback load failed:', err.message);
  }

  return cases;
}

// ─── 판정 ─────────────────────────────────────────────────
function judge(c, finalResp) {
  if (!finalResp || !finalResp.ok) {
    return { verdict: 'ERROR', reason: 'API ' + (finalResp?.status || 'fail') + ' ' + (finalResp?.error || '') };
  }
  const b = finalResp.body || {};
  const txt = String(b.text || '');
  const prods = b.recommendedProducts || b.recommendationIds || [];
  const intent = b.intent || '';

  // 명백한 실패 신호
  if (/현재 필터 기준 후보는 0개|후보가 없|결과가 없|제품을 찾지 못/.test(txt)) {
    return { verdict: 'FAIL', reason: '0 후보' };
  }
  if (/죄송|오류|에러|문제가 발생/.test(txt) && prods.length === 0) {
    return { verdict: 'FAIL', reason: '에러 응답' };
  }

  // 사용자 의견에 부정 키워드가 있고 같은 패턴이 응답에서 재현되면 FAIL
  const op = c.opinion || '';
  if (/누락|없음|틀|잘못|오류/.test(op)) {
    // 약한 신호 — 응답 길이만 체크
    if (txt.length < 30) return { verdict: 'FAIL', reason: '응답 너무 짧음 (의견에 누락 지적)' };
  }

  // 상품 추천류 인텐트인데 결과 0개
  if (intent === 'product_recommendation' && prods.length === 0 && !/형상|소재|어떤/.test(txt)) {
    return { verdict: 'FAIL', reason: '추천 인텐트인데 0개' };
  }

  return { verdict: 'PASS', reason: prods.length ? `${prods.length}개 추천` : '대화형 응답' };
}

// ─── 실행 ─────────────────────────────────────────────────
async function runCase(c) {
  const messages = [];
  // 시작 조건이 있으면 첫 메시지로 주입 (intake 형식)
  if (c.intake && c.intake !== '(시작 조건 입력 안 함)' && c.intake.trim()) {
    messages.push({
      role: 'user',
      text: `🧭 ${c.intake}\n\n위 조건에 맞는 YG-1 제품을 추천해 주세요.`,
    });
  }
  let last = null;
  for (const t of c.turns) {
    messages.push({ role: 'user', text: t });
    const r = await callWithFallback(messages);
    last = r;
    if (!r.ok) break;
    const aiText = String(r.body?.text || '');
    if (aiText) messages.push({ role: 'ai', text: aiText });
  }
  return { case: c, response: last };
}

async function main() {
  console.log('loading cases...');
  const cases = await loadCases();
  console.log('total:', cases.length);
  const bySrc = {};
  cases.forEach((c) => { bySrc[c.source] = (bySrc[c.source] || 0) + 1; });
  console.log('by source:', bySrc);

  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;
  const work = cases.slice(0, limit);
  const results = new Array(work.length);
  let done = 0;
  const t0 = Date.now();

  async function worker(start) {
    for (let i = start; i < work.length; i += CONCURRENCY) {
      results[i] = await runCase(work[i]);
      done++;
      if (done % 10 === 0 || done === work.length) {
        const el = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`  ${done}/${work.length}  (${el}s)`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  // 판정
  const judged = results.map((r) => ({ ...r, ...judge(r.case, r.response) }));
  const counts = { PASS: 0, FAIL: 0, ERROR: 0 };
  judged.forEach((j) => { counts[j.verdict]++; });
  console.log('verdict:', counts);

  // JSON 저장
  fs.writeFileSync(
    path.join(__dirname, `hard-test-report${OUT_SUFFIX}.json`),
    JSON.stringify({ runAt: new Date().toISOString(), total: judged.length, counts, bySource: bySrc, items: judged.map((j) => ({
      id: j.case.id, source: j.case.source, tags: j.case.tags, turns: j.case.turns,
      verdict: j.verdict, reason: j.reason,
      respText: String(j.response?.body?.text || '').slice(0, 800),
      respCount: (j.response?.body?.recommendedProducts || j.response?.body?.recommendationIds || []).length,
      usedFallback: !!j.response?.usedFallback,
      opinion: j.case.opinion,
    })) }, null, 2)
  );

  // XLSX 리포트
  const wb = new E.Workbook();
  const HDR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
  const WF = { color: { argb: 'FFFFFFFF' }, bold: true, name: 'Malgun Gothic', size: 11 };
  const FT = { name: 'Malgun Gothic', size: 10 };
  const BD = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  const RD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFADBD8' } };
  const GR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5F5E3' } };
  const YE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9E7' } };

  // 요약 시트
  const s0 = wb.addWorksheet('요약');
  s0.columns = [{ width: 28 }, { width: 60 }];
  s0.mergeCells('A1:B1');
  s0.getCell('A1').value = '빡센 통합 테스트 리포트';
  s0.getCell('A1').font = { name: 'Malgun Gothic', size: 16, bold: true, color: { argb: 'FF1A237E' } };
  s0.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  s0.getRow(1).height = 38;
  const summary = [
    ['실행일시', new Date().toISOString()],
    ['대상 서버', PRIMARY + ' (fallback: Vercel)'],
    ['총 케이스', String(judged.length)],
    ['PASS', String(counts.PASS) + ` (${(counts.PASS / judged.length * 100).toFixed(1)}%)`],
    ['FAIL', String(counts.FAIL) + ` (${(counts.FAIL / judged.length * 100).toFixed(1)}%)`],
    ['ERROR', String(counts.ERROR) + ` (${(counts.ERROR / judged.length * 100).toFixed(1)}%)`],
    ['', ''],
    ['소스별 분포', ''],
  ];
  summary.forEach(([k, v]) => {
    const row = s0.addRow([k, v]);
    row.getCell(1).font = Object.assign({}, FT, { bold: true });
    row.getCell(2).font = FT;
  });
  for (const [src, n] of Object.entries(bySrc)) {
    const passed = judged.filter((j) => j.case.source === src && j.verdict === 'PASS').length;
    const row = s0.addRow(['  ' + src, `${n}건 (PASS ${passed}/${n} = ${(passed / n * 100).toFixed(0)}%)`]);
    row.getCell(2).font = FT;
  }

  // 상세 시트
  const s1 = wb.addWorksheet('상세 결과', { views: [{ state: 'frozen', ySplit: 1 }] });
  s1.columns = [
    { header: 'ID', width: 14 },
    { header: '소스', width: 14 },
    { header: '판정', width: 8 },
    { header: '사유', width: 28 },
    { header: '태그', width: 18 },
    { header: '시작 조건', width: 36 },
    { header: '사용자 입력 (마지막 턴)', width: 48 },
    { header: 'AI 응답', width: 60 },
    { header: '추천 수', width: 8 },
    { header: '사용자 의견 (참고)', width: 40 },
  ];
  const hr = s1.getRow(1);
  hr.eachCell((c) => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  hr.height = 30;

  // 정렬: FAIL/ERROR 먼저
  const order = { ERROR: 0, FAIL: 1, PASS: 2 };
  judged.sort((a, b) => (order[a.verdict] - order[b.verdict]) || a.case.source.localeCompare(b.case.source));

  for (const j of judged) {
    const lastTurn = j.case.turns[j.case.turns.length - 1] || '';
    const aiText = String(j.response?.body?.text || '').slice(0, 600);
    const cnt = (j.response?.body?.recommendedProducts || j.response?.body?.recommendationIds || []).length;
    const row = s1.addRow([j.case.id, j.case.source, j.verdict, j.reason, j.case.tags, j.case.intake, lastTurn, aiText, cnt, (j.case.opinion || '').slice(0, 300)]);
    row.eachCell((c) => { c.font = FT; c.border = BD; c.alignment = { wrapText: true, vertical: 'top' }; });
    const vc = row.getCell(3);
    if (j.verdict === 'FAIL') vc.fill = RD;
    else if (j.verdict === 'ERROR') vc.fill = YE;
    else vc.fill = GR;
    vc.alignment = { horizontal: 'center', vertical: 'middle' };
    row.height = Math.min(140, Math.max(30, Math.ceil(aiText.length / 70) * 14));
  }

  await wb.xlsx.writeFile(path.join(__dirname, `hard-test-report${OUT_SUFFIX}.xlsx`));
  console.log('saved: hard-test-report.xlsx, hard-test-report.json');
  console.log(`elapsed: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
