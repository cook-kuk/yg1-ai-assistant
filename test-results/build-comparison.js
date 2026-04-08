// 두 리포트(mine vs suchan) 케이스별 비교 xlsx 생성
const E = require('exceljs');
const fs = require('fs');
const path = require('path');

const mine = JSON.parse(fs.readFileSync(path.join(__dirname, 'hard-test-report-mine.json'), 'utf8'));
const such = JSON.parse(fs.readFileSync(path.join(__dirname, 'hard-test-report-suchan.json'), 'utf8'));

const mIdx = new Map(mine.items.map((i) => [i.id, i]));
const sIdx = new Map(such.items.map((i) => [i.id, i]));
const allIds = Array.from(new Set([...mIdx.keys(), ...sIdx.keys()]));

function score(v) { return v === 'PASS' ? 2 : v === 'FAIL' ? 0 : 1; }

const rows = allIds.map((id) => {
  const a = mIdx.get(id) || {};
  const b = sIdx.get(id) || {};
  const va = a.verdict || '-';
  const vb = b.verdict || '-';
  let cmp;
  if (va === vb) cmp = '=';
  else if (score(va) > score(vb)) cmp = '내가 ↑';
  else cmp = '수찬님 ↑';
  return { id, source: a.source || b.source, tags: a.tags || b.tags, turns: (a.turns || b.turns || []).slice(-1)[0] || '', opinion: a.opinion || b.opinion || '', mineV: va, mineR: a.reason || '', mineCnt: a.respCount || 0, mineTxt: (a.respText || '').slice(0, 500), suchV: vb, suchR: b.reason || '', suchCnt: b.respCount || 0, suchTxt: (b.respText || '').slice(0, 500), cmp };
});

const summary = { total: rows.length, mineP: 0, mineF: 0, mineE: 0, suchP: 0, suchF: 0, suchE: 0, mineWin: 0, suchWin: 0, tie: 0 };
rows.forEach((r) => {
  summary['mine' + r.mineV[0]]++;
  summary['such' + r.suchV[0]]++;
  if (r.cmp === '내가 ↑') summary.mineWin++;
  else if (r.cmp === '수찬님 ↑') summary.suchWin++;
  else summary.tie++;
});

(async () => {
  const wb = new E.Workbook();
  const HDR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
  const WF = { color: { argb: 'FFFFFFFF' }, bold: true, name: 'Malgun Gothic', size: 11 };
  const FT = { name: 'Malgun Gothic', size: 10 };
  const BD = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  const RD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFADBD8' } };
  const GR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5F5E3' } };
  const YE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9E7' } };
  const BL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6EAF8' } };
  const fillFor = (v) => v === 'PASS' ? GR : v === 'FAIL' ? RD : v === 'ERROR' ? YE : null;

  // 요약
  const s0 = wb.addWorksheet('요약');
  s0.columns = [{ width: 28 }, { width: 22 }, { width: 22 }];
  s0.mergeCells('A1:C1');
  s0.getCell('A1').value = '내 배포 vs 수찬님 배포 — 빡센 테스트 비교';
  s0.getCell('A1').font = { name: 'Malgun Gothic', size: 16, bold: true, color: { argb: 'FF1A237E' } };
  s0.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  s0.getRow(1).height = 38;

  const T = summary.total;
  const head = s0.addRow(['', '내 배포 (3000)', '수찬님 배포 (2999)']);
  head.eachCell((c) => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: 'center' }; });

  function addMetric(label, m, s, fmt) {
    const r = s0.addRow([label, fmt(m), fmt(s)]);
    r.getCell(1).font = Object.assign({}, FT, { bold: true });
    r.eachCell((c) => { c.font = c.font || FT; c.border = BD; });
    return r;
  }
  const pct = (n) => `${n} (${(n / T * 100).toFixed(1)}%)`;
  addMetric('총 케이스', T, T, String);
  addMetric('PASS', summary.mineP, summary.suchP, pct);
  addMetric('FAIL', summary.mineF, summary.suchF, pct);
  addMetric('ERROR', summary.mineE, summary.suchE, pct);
  addMetric('Pass rate', summary.mineP / T, summary.suchP / T, (n) => (n * 100).toFixed(1) + '%');

  s0.addRow([]);
  const wHead = s0.addRow(['승부', '', '']);
  wHead.getCell(1).fill = HDR; wHead.getCell(1).font = WF;
  s0.addRow(['내가 더 잘함', summary.mineWin, '']).getCell(2).fill = GR;
  s0.addRow(['수찬님이 더 잘함', summary.suchWin, '']).getCell(2).fill = RD;
  s0.addRow(['동일', summary.tie, '']).getCell(2).fill = BL;

  // 소스별
  s0.addRow([]);
  const srcHead = s0.addRow(['소스별 Pass rate', '내', '수찬님']);
  srcHead.eachCell((c) => { c.fill = HDR; c.font = WF; c.border = BD; });
  const bySource = {};
  rows.forEach((r) => {
    const s = r.source || 'unknown';
    bySource[s] = bySource[s] || { T: 0, mP: 0, sP: 0 };
    bySource[s].T++;
    if (r.mineV === 'PASS') bySource[s].mP++;
    if (r.suchV === 'PASS') bySource[s].sP++;
  });
  for (const [s, v] of Object.entries(bySource)) {
    const r = s0.addRow([s, `${(v.mP / v.T * 100).toFixed(0)}% (${v.mP}/${v.T})`, `${(v.sP / v.T * 100).toFixed(0)}% (${v.sP}/${v.T})`]);
    r.eachCell((c) => { c.border = BD; c.font = FT; });
  }

  // 상세
  const s1 = wb.addWorksheet('케이스별 비교', { views: [{ state: 'frozen', ySplit: 1 }] });
  s1.columns = [
    { header: 'ID', width: 12 },
    { header: '소스', width: 13 },
    { header: '비교', width: 11 },
    { header: '내 판정', width: 9 },
    { header: '수찬님 판정', width: 11 },
    { header: '태그', width: 16 },
    { header: '사용자 입력', width: 42 },
    { header: '내 사유', width: 22 },
    { header: '내 응답', width: 50 },
    { header: '내 추천수', width: 8 },
    { header: '수찬님 사유', width: 22 },
    { header: '수찬님 응답', width: 50 },
    { header: '수찬님 추천수', width: 8 },
    { header: '사용자 의견', width: 38 },
  ];
  const hr = s1.getRow(1);
  hr.eachCell((c) => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  hr.height = 32;

  // 정렬: 차이나는 것 먼저, 그 다음 둘 다 fail/error
  const rank = (r) => {
    if (r.cmp !== '=') return 0;
    if (r.mineV !== 'PASS') return 1;
    return 2;
  };
  rows.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));

  for (const r of rows) {
    const row = s1.addRow([r.id, r.source, r.cmp, r.mineV, r.suchV, r.tags, r.turns, r.mineR, r.mineTxt, r.mineCnt, r.suchR, r.suchTxt, r.suchCnt, r.opinion.slice(0, 250)]);
    row.eachCell((c) => { c.font = FT; c.border = BD; c.alignment = { wrapText: true, vertical: 'top' }; });
    const mc = row.getCell(4); const sc = row.getCell(5);
    const mf = fillFor(r.mineV); if (mf) mc.fill = mf;
    const sf = fillFor(r.suchV); if (sf) sc.fill = sf;
    mc.alignment = { horizontal: 'center', vertical: 'middle' };
    sc.alignment = { horizontal: 'center', vertical: 'middle' };
    const cmpC = row.getCell(3);
    if (r.cmp === '내가 ↑') cmpC.fill = GR;
    else if (r.cmp === '수찬님 ↑') cmpC.fill = RD;
    else cmpC.fill = BL;
    cmpC.alignment = { horizontal: 'center', vertical: 'middle' };
    cmpC.font = Object.assign({}, FT, { bold: true });
    row.height = Math.min(120, Math.max(28, Math.ceil(Math.max(r.mineTxt.length, r.suchTxt.length) / 60) * 14));
  }

  await wb.xlsx.writeFile(path.join(__dirname, 'hard-test-comparison.xlsx'));
  console.log('saved: hard-test-comparison.xlsx');
  console.log('mine:', summary.mineP, 'PASS', summary.mineF, 'FAIL', summary.mineE, 'ERROR');
  console.log('suchan:', summary.suchP, 'PASS', summary.suchF, 'FAIL', summary.suchE, 'ERROR');
  console.log('내 승:', summary.mineWin, '| 수찬님 승:', summary.suchWin, '| 동일:', summary.tie);
})();
