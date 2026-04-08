// 골든셋 케이스 → DB 쿼리 실행 + 다중 검증
// 대상 mv: catalog_app.product_recommendation_mv (수찬님 finder가 보는 ground truth)
// 검증 방식 (각 케이스 3중):
//   q_main:    DISTINCT ON dedup + 모든 필터
//   q_raw:     dedup 안 한 raw count (sanity 1)
//   q_relaxed: 카테고리+직경(또는 카테고리만) — 상위집합 (sanity 2)
//   ⇒ relaxed >= main 이면 OK / main > relaxed 이면 ❌
const E = require('exceljs');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const DB_URL = 'postgresql://smart_catalog:smart_catalog@20.119.98.136:5432/smart_catalog';
const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'hard-test-report-mine.json'), 'utf8'));

// ── intake 로드 ──
async function loadIntake() {
  const wb = new E.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, '골든셋_공개_PUBLIC.xlsx'));
  const map = {};
  for (const sn of ['단일턴 케이스', '멀티턴 시나리오']) {
    const ws = wb.getWorksheet(sn);
    if (!ws) continue;
    const cols = {};
    ws.getRow(1).eachCell((c, i) => { cols[String(c.value || '').trim()] = i; });
    const idCol = cols['#'] || cols['시나리오 ID'];
    const intCol = cols['대화 맥락 (시작 조건)'];
    for (let r = 2; r <= ws.actualRowCount; r++) {
      const id = String(ws.getRow(r).getCell(idCol).value || '').trim();
      const it = String(ws.getRow(r).getCell(intCol).value || '').trim();
      if (id && it && it !== '(시작 조건 입력 안 함)') map[id] = it;
    }
  }
  return map;
}

// ── 필터 추출 (자연어 → 구조화 필터) ──
function extractFilters(text) {
  const f = {};
  const dia = text.match(/(?:직경|파이|φ|Φ|외경|지름)\s*(\d+(?:\.\d+)?)/i) ||
              text.match(/(\d+(?:\.\d+)?)\s*(?:mm|파이|φ|Φ)/i);
  if (dia) f.diameter = parseFloat(dia[1]);
  // 범위는 단일 직경 없을 때만 (mm/직경 단어가 명시된 경우만)
  if (!f.diameter) {
    const range = text.match(/(\d+)\s*[~\-]\s*(\d+)\s*(?:mm|파이|φ|직경)/i);
    if (range && +range[1] < +range[2] && +range[2] < 200) { f.diameterMin = +range[1]; f.diameterMax = +range[2]; }
  }
  const flutes = text.match(/(\d)\s*(?:날\b|flute|F\b|FL\b)/i);
  if (flutes) f.flutes = +flutes[1];

  const matMap = {
    P: /탄소강|S45C|SCM|carbon|\bP군\b/i,
    M: /스테인|SUS|stainless|\bM군\b/i,
    K: /주철|FC\b|FCD|cast\s?iron|\bK군\b/i,
    N: /알루|aluminum|구리|황동|copper|\bN군\b|비철/i,
    S: /inconel|초내열|티타늄|titanium|난삭|\bS군\b/i,
    H: /HRc|hrc|고경도|hardened|\bH군\b/i,
  };
  const mats = [];
  for (const [m, re] of Object.entries(matMap)) if (re.test(text)) mats.push(m);
  if (mats.length) f.material = mats;

  // 카테고리 (root_category)
  if (/drilling|드릴링|drill\b|peck/i.test(text)) f.category = 'Holemaking';
  else if (/threading|태핑|tapping|tap\b|나사|reaming|리밍|thread/i.test(text)) f.category = 'Threading';
  else if (/milling|밀링|슬로팅|slot|trochoid|트로코|profile|면취|chamfer|챔퍼|러핑|roughing|finish|황삭|정삭/i.test(text)) f.category = 'Milling';

  // 형상 (search_subtype ILIKE)
  if (/ball\b|볼\b/i.test(text)) f.shape = 'Ball';
  else if (/radius|라디우스|코너\s?r|코너R|corner\s?r/i.test(text)) f.shape = 'Radius';
  else if (/chamfer|챔퍼|면취/i.test(text)) f.shape = 'Chamfer';
  else if (/square|스퀘어|사각/i.test(text)) f.shape = 'Square';

  return f;
}

function buildWhere(f, mode) {
  const w = [];
  if (f.category) w.push(`edp_root_category='${f.category}'`);
  if (f.diameter && mode !== 'relaxed_nofilter') w.push(`search_diameter_mm=${f.diameter}`);
  if (f.diameterMin && f.diameterMax && mode !== 'relaxed_nofilter') w.push(`search_diameter_mm BETWEEN ${f.diameterMin} AND ${f.diameterMax}`);
  if (mode === 'main') {
    if (f.flutes) {
      // 카테고리별 flute 컬럼 분리: Milling은 milling_number_of_flute, Holemaking은 holemaking_, Threading은 option_
      if (f.category === 'Milling') w.push(`milling_number_of_flute='${f.flutes}'`);
      else if (f.category === 'Holemaking') w.push(`holemaking_number_of_flute='${f.flutes}'`);
      else if (f.category === 'Threading') w.push(`threading_number_of_flute='${f.flutes}'`);
      else w.push(`(milling_number_of_flute='${f.flutes}' OR holemaking_number_of_flute='${f.flutes}' OR threading_number_of_flute='${f.flutes}' OR option_numberofflute='${f.flutes}')`);
    }
    if (f.material) w.push(`material_tags && ARRAY[${f.material.map((m) => `'${m}'`).join(',')}]::text[]`);
    if (f.shape === 'Ball') w.push(`search_subtype ILIKE '%ball%'`);
    else if (f.shape === 'Radius') w.push(`search_subtype ILIKE '%radius%'`);
    else if (f.shape === 'Square') w.push(`search_subtype ILIKE 'square'`); // exact lower (배제 'Taper Square')
    else if (f.shape === 'Chamfer') w.push(`search_subtype ILIKE '%chamfer%'`);
  }
  return w;
}

function buildSql(f, mode) {
  const w = buildWhere(f, mode);
  if (!w.length) return null;
  if (mode === 'raw') {
    return `SELECT count(*) FROM catalog_app.product_recommendation_mv WHERE ${w.join(' AND ')}`;
  }
  return `SELECT count(*) FROM (SELECT DISTINCT ON (normalized_code) * FROM catalog_app.product_recommendation_mv WHERE ${w.join(' AND ')} ORDER BY normalized_code,edp_idx DESC) x`;
}

(async () => {
  const intakes = await loadIntake();
  const c = new Client({ connectionString: DB_URL });
  await c.connect();

  const results = [];
  let processed = 0;
  for (const it of j.items) {
    const intake = intakes[it.id] || '';
    const text = [intake, ...(it.turns || [])].join(' ');
    const f = extractFilters(text);
    const hasAny = f.diameter || f.diameterMin || f.material || f.category || f.shape || f.flutes;
    if (!hasAny) continue;

    const sqlMain = buildSql(f, 'main');
    const sqlRaw = buildSql(f, 'raw');
    const sqlRelax = buildSql(f, 'relaxed_nofilter'); // 직경/필터 제거 → 상위집합

    let cMain = null, cRaw = null, cRelax = null, err = null;
    try {
      if (sqlMain) cMain = +(await c.query(sqlMain)).rows[0].count;
      if (sqlRaw) cRaw = +(await c.query(sqlRaw)).rows[0].count;
      if (sqlRelax) cRelax = +(await c.query(sqlRelax)).rows[0].count;
    } catch (e) {
      err = e.message;
    }

    // 검증
    let verdict = '✅';
    let note = '';
    if (err) { verdict = '❌'; note = err; }
    else if (cMain == null) { verdict = '⚠️'; note = '쿼리 없음'; }
    else if (cMain === 0) { verdict = '⚠️'; note = '0건 (조건 너무 좁거나 DB에 없음)'; }
    else if (cRelax != null && cMain > cRelax) { verdict = '❌'; note = `main(${cMain}) > relaxed(${cRelax}) — 논리 모순`; }
    else if (cRaw != null && cMain > cRaw) { verdict = '❌'; note = `main(${cMain}) > raw(${cRaw}) — dedup 모순`; }

    results.push({
      id: it.id, source: it.source, intake,
      lastTurn: (it.turns || []).slice(-1)[0] || '',
      filters: f, cMain, cRaw, cRelax, verdict, note, sqlMain,
    });
    processed++;
    if (processed % 30 === 0) console.log(`  ${processed}...`);
  }
  await c.end();

  console.log('total verified:', results.length);
  const byVerdict = {};
  results.forEach((r) => { byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1; });
  console.log('verdict:', byVerdict);

  // ── XLSX ──
  const wb = new E.Workbook();
  const HDR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
  const WF = { color: { argb: 'FFFFFFFF' }, bold: true, name: 'Malgun Gothic', size: 11 };
  const FT = { name: 'Malgun Gothic', size: 10 };
  const BD = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  const GR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5F5E3' } };
  const RD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFADBD8' } };
  const YE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9E7' } };

  // 요약
  const s0 = wb.addWorksheet('요약');
  s0.columns = [{ width: 28 }, { width: 50 }];
  s0.mergeCells('A1:B1');
  s0.getCell('A1').value = '골든셋 DB 검증 (catalog_app.product_recommendation_mv)';
  s0.getCell('A1').font = { name: 'Malgun Gothic', size: 16, bold: true, color: { argb: 'FF1A237E' } };
  s0.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  s0.getRow(1).height = 38;
  const intro = [
    ['DB', `${DB_URL.replace(/:[^:@]+@/, ':***@')}`],
    ['기준 테이블', 'catalog_app.product_recommendation_mv (DISTINCT ON normalized_code + edp_idx DESC)'],
    ['전체 dedup 행 수', '64,589'],
    ['검증 케이스', String(results.length) + ' / 255 (필터 추출 가능)'],
    ['', ''],
    ['검증 방식 (3중)', ''],
    ['  ① main', '모든 필터 적용 + dedup → 기대 후보 수'],
    ['  ② raw', 'dedup 안 한 raw count (sanity 1)'],
    ['  ③ relaxed', '카테고리만 (직경/소재/형상 제거 → 상위집합) (sanity 2)'],
    ['', ''],
    ['판정', ''],
    ['  ✅ 정상', `main ≤ relaxed AND main ≤ raw AND main > 0 — ${byVerdict['✅'] || 0}건`],
    ['  ⚠️ 0건', `필터는 합리적이나 후보 없음 — ${byVerdict['⚠️'] || 0}건`],
    ['  ❌ 모순', `main > relaxed 또는 SQL 에러 — ${byVerdict['❌'] || 0}건`],
  ];
  intro.forEach(([k, v]) => {
    const r = s0.addRow([k, v]);
    r.getCell(1).font = Object.assign({}, FT, { bold: true });
    r.eachCell((c) => { c.font = c.font || FT; c.alignment = { wrapText: true, vertical: 'top' }; });
  });

  // 상세
  const s1 = wb.addWorksheet('DB 검증 결과', { views: [{ state: 'frozen', ySplit: 1 }] });
  s1.columns = [
    { header: '#', width: 6 },
    { header: 'ID', width: 14 },
    { header: '시작 조건', width: 32 },
    { header: '사용자 입력 (마지막 턴)', width: 45 },
    { header: '추출 필터', width: 38 },
    { header: 'main 후보수', width: 11 },
    { header: 'raw 후보수', width: 11 },
    { header: 'relaxed 상위', width: 12 },
    { header: '판정', width: 8 },
    { header: '비고', width: 35 },
    { header: 'SQL (main)', width: 70 },
  ];
  const hr = s1.getRow(1);
  hr.eachCell((c) => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  hr.height = 32;

  // 정렬: ❌ → ⚠️ → ✅
  const ord = { '❌': 0, '⚠️': 1, '✅': 2 };
  results.sort((a, b) => (ord[a.verdict] - ord[b.verdict]) || a.id.localeCompare(b.id));

  results.forEach((r, i) => {
    const fStr = Object.entries(r.filters).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('+') : v}`).join(' / ');
    const row = s1.addRow([i + 1, r.id, r.intake, r.lastTurn, fStr, r.cMain ?? '-', r.cRaw ?? '-', r.cRelax ?? '-', r.verdict, r.note, r.sqlMain || '']);
    row.eachCell((c) => { c.font = FT; c.border = BD; c.alignment = { wrapText: true, vertical: 'top' }; });
    row.getCell(11).font = { name: 'Consolas', size: 9 };
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    [6, 7, 8].forEach((n) => { row.getCell(n).alignment = { horizontal: 'center', vertical: 'middle' }; });
    const vc = row.getCell(9);
    vc.alignment = { horizontal: 'center', vertical: 'middle' };
    if (r.verdict === '✅') vc.fill = GR;
    else if (r.verdict === '⚠️') vc.fill = YE;
    else vc.fill = RD;
    row.height = Math.min(120, Math.max(30, Math.ceil((r.sqlMain || '').length / 70) * 14));
  });

  await wb.xlsx.writeFile(path.join(__dirname, '골든셋_DB검증_v2.xlsx'));
  console.log('saved 골든셋_DB검증_v2.xlsx');
})().catch((e) => { console.error(e); process.exit(1); });
