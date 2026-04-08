// 25 케이스 finder 비교: DB 정답값 + 수찬님(:2999) + 내(:3000)
const E = require('exceljs');
const X = require('xlsx');
const fs = require('fs');
const path = require('path');

const mine = JSON.parse(fs.readFileSync(path.join(__dirname, 'suchan-finder-stress-2026-04-07T22-50-23-322Z.json'), 'utf8'));
const such = JSON.parse(fs.readFileSync(path.join(__dirname, 'suchan-finder-stress-2026-04-07T23-00-34-292Z.json'), 'utf8'));

// suchan_test_v1.xlsx에서 DB ground truth 로드
const wb1 = X.readFile(path.join(__dirname, 'suchan_test_v1.xlsx'));
const rows = X.utils.sheet_to_json(wb1.Sheets['DB 검증 결과 v2'], { defval: '', header: 1 });
const dbCases = [];
for (const r of rows) {
  if (typeof r[0] === 'number' && r[1]) {
    dbCases.push({
      no: r[0],
      name: r[1],
      msg: r[2],
      dbCount: r[3],
      epOld: r[4], // 당시 수찬님 EP 결과
      verdictOld: r[5],
      filter: r[6],
      note: r[7],
    });
  }
}

// 서버별 cap 다름:
//   mine (precisionMode + pageSize=1000) → cap 없음, DB와 1:1 매칭 기대
//   suchan (변경 없음) → cap=50
function classifyMine(db, ep) {
  if (db == null || ep == null) return '-';
  if (db === 0 && ep === 0) return '✅';
  if (Math.abs(ep - db) <= 2) return '✅'; // ±2 tolerance
  if (ep > db) return '⚠️과다';
  if (ep > 0 && ep < db) return '⚠️과소';
  if (ep === 0 && db > 0) return '❌누락';
  if (db === 0 && ep > 0) return '❌오탐';
  return '-';
}
function classifySuch(db, ep) {
  if (db == null || ep == null) return '-';
  if (db === 0 && ep === 0) return '✅';
  const expected = Math.min(db, 50);
  if (Math.abs(ep - expected) <= 2) return '✅';
  if (ep > expected) return '⚠️과다';
  if (ep > 0 && ep < expected) return '⚠️과소';
  if (ep === 0 && db > 0) return '❌누락';
  if (db === 0 && ep > 0) return '❌오탐';
  return '-';
}
const classify = classifyMine; // legacy alias

(async () => {
  const wb = new E.Workbook();
  const HDR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
  const WF = { color: { argb: 'FFFFFFFF' }, bold: true, name: 'Malgun Gothic', size: 11 };
  const FT = { name: 'Malgun Gothic', size: 10 };
  const BD = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  const GR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5F5E3' } };
  const RD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFADBD8' } };
  const YE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9E7' } };
  const BL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6EAF8' } };

  // 요약 시트
  const s0 = wb.addWorksheet('요약');
  s0.columns = [{ width: 26 }, { width: 22 }, { width: 22 }, { width: 22 }];
  s0.mergeCells('A1:D1');
  s0.getCell('A1').value = 'Finder 25 케이스 — DB vs 내(:3000) vs 수찬님(:2999)';
  s0.getCell('A1').font = { name: 'Malgun Gothic', size: 16, bold: true, color: { argb: 'FF1A237E' } };
  s0.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  s0.getRow(1).height = 38;

  const head = s0.addRow(['', 'DB ground truth', '내 (:3000)', '수찬님 (:2999)']);
  head.eachCell((c) => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: 'center' }; });

  // 매칭 카운트 계산
  let mineExact = 0, suchExact = 0;
  const detail = [];
  dbCases.forEach((c, i) => {
    const mr = mine.results[i] || {};
    const sr = such.results[i] || {};
    const mineCnt = mr.candidateCount;
    const suchCnt = sr.candidateCount;
    const mineV = classifyMine(c.dbCount, mineCnt);
    const suchV = classifySuch(c.dbCount, suchCnt);
    if (mineV === '✅') mineExact++;
    if (suchV === '✅') suchExact++;
    detail.push({ ...c, mineCnt, suchCnt, mineV, suchV, mineMs: mr.ms, suchMs: sr.ms });
  });

  function row(label, db, m, s, fmt = String) {
    const r = s0.addRow([label, fmt(db), fmt(m), fmt(s)]);
    r.getCell(1).font = Object.assign({}, FT, { bold: true });
    r.eachCell((c) => { c.font = c.font || FT; c.border = BD; });
  }
  row('총 케이스', 25, 25, 25);
  row('DB 정확 매칭', '—', mineExact, suchExact);
  row('정확도', '—', `${(mineExact / 25 * 100).toFixed(0)}%`, `${(suchExact / 25 * 100).toFixed(0)}%`);

  s0.addRow([]);
  // verdict 분포
  const dist = (which) => {
    const d = { '✅': 0, '⚠️과다': 0, '⚠️과소': 0, '❌누락': 0, '❌오탐': 0 };
    detail.forEach((x) => { d[x[which]] = (d[x[which]] || 0) + 1; });
    return d;
  };
  const dm = dist('mineV'), ds = dist('suchV');
  const vh = s0.addRow(['verdict 분포', '', '내', '수찬님']);
  vh.eachCell((c) => { c.fill = HDR; c.font = WF; c.border = BD; });
  for (const k of ['✅', '⚠️과다', '⚠️과소', '❌누락', '❌오탐']) {
    const r = s0.addRow([k, '', dm[k] || 0, ds[k] || 0]);
    r.eachCell((c) => { c.font = FT; c.border = BD; });
  }

  // 상세 시트
  const s1 = wb.addWorksheet('25 케이스 비교', { views: [{ state: 'frozen', ySplit: 1 }] });
  s1.columns = [
    { header: '#', width: 5 },
    { header: '케이스', width: 32 },
    { header: '메시지', width: 36 },
    { header: 'DB', width: 7 },
    { header: '내 EP', width: 7 },
    { header: '|내-DB|', width: 8 },
    { header: '내 verdict', width: 11 },
    { header: '수찬 EP', width: 7 },
    { header: '|수찬-DB|', width: 9 },
    { header: '수찬 verdict', width: 11 },
    { header: '승자', width: 11 },
    { header: '내 ms', width: 8 },
    { header: '수찬 ms', width: 8 },
  ];
  const hr = s1.getRow(1);
  hr.eachCell((c) => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  hr.height = 32;

  function fillVerdict(cell, v) {
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    if (v === '✅') cell.fill = GR;
    else if (v && v.includes('⚠️')) cell.fill = YE;
    else if (v && v.includes('❌')) cell.fill = RD;
  }

  let mineWin = 0, suchWin = 0, tie = 0;
  detail.forEach((d) => {
    const dm = (d.dbCount != null && d.mineCnt != null) ? Math.abs(d.mineCnt - d.dbCount) : null;
    const ds = (d.dbCount != null && d.suchCnt != null) ? Math.abs(d.suchCnt - d.dbCount) : null;
    let winner = '-';
    if (dm != null && ds != null) {
      if (dm < ds) { winner = '내 ↑'; mineWin++; }
      else if (ds < dm) { winner = '수찬 ↑'; suchWin++; }
      else { winner = '동일'; tie++; }
    } else if (dm != null) { winner = '내 ↑'; mineWin++; }
    else if (ds != null) { winner = '수찬 ↑'; suchWin++; }

    const r = s1.addRow([d.no, d.name, d.msg, d.dbCount, d.mineCnt ?? '-', dm ?? '-', d.mineV, d.suchCnt ?? '-', ds ?? '-', d.suchV, winner, d.mineMs ?? '-', d.suchMs ?? '-']);
    r.eachCell((c) => { c.font = FT; c.border = BD; c.alignment = { wrapText: true, vertical: 'top' }; });
    [1, 4, 5, 6, 8, 9, 11, 12, 13].forEach((n) => { r.getCell(n).alignment = { horizontal: 'center', vertical: 'middle' }; });
    fillVerdict(r.getCell(7), d.mineV);
    fillVerdict(r.getCell(10), d.suchV);
    const wc = r.getCell(11);
    if (winner === '내 ↑') wc.fill = GR;
    else if (winner === '수찬 ↑') wc.fill = RD;
    else if (winner === '동일') wc.fill = BL;
    wc.font = Object.assign({}, FT, { bold: true });
    r.height = 26;
  });
  console.log('승자: 내', mineWin, '수찬', suchWin, '동일', tie);

  // 요약에 승자 통계 추가
  s0.addRow([]);
  const wH = s0.addRow(['DB 근접도 (절대차)', '', '내', '수찬님']);
  wH.eachCell((c) => { c.fill = HDR; c.font = WF; c.border = BD; });
  const wR = s0.addRow(['승리 (DB에 더 가까움)', '', mineWin, suchWin]);
  wR.eachCell((c) => { c.font = FT; c.border = BD; });
  const tR = s0.addRow(['동일', '', tie, tie]);
  tR.eachCell((c) => { c.font = FT; c.border = BD; });

  await wb.xlsx.writeFile(path.join(__dirname, 'finder-25케이스-비교-precision.xlsx'));
  console.log('saved finder-25케이스-비교-precision.xlsx');
  console.log(`내 정확 매칭: ${mineExact}/25 (${(mineExact / 25 * 100).toFixed(0)}%)`);
  console.log(`수찬님 정확 매칭: ${suchExact}/25 (${(suchExact / 25 * 100).toFixed(0)}%)`);
})();
