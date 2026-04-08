// 255 케이스 자연어 분석 → 키워드 태깅 + DB 쿼리 가능한 케이스 추출
const E = require('exceljs');
const fs = require('fs');
const path = require('path');

const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'hard-test-report-mine.json'), 'utf8'));
const intakeMap = {};

async function loadIntake() {
  const wb = new E.Workbook();
  await wb.xlsx.readFile(path.join(__dirname, '골든셋_공개_PUBLIC.xlsx'));
  for (const sheetName of ['단일턴 케이스', '멀티턴 시나리오']) {
    const ws = wb.getWorksheet(sheetName);
    if (!ws) continue;
    const cols = {};
    ws.getRow(1).eachCell((c, i) => { cols[String(c.value || '').trim()] = i; });
    const idCol = cols['#'] || cols['시나리오 ID'];
    const intakeCol = cols['대화 맥락 (시작 조건)'];
    for (let r = 2; r <= ws.actualRowCount; r++) {
      const id = String(ws.getRow(r).getCell(idCol).value || '').trim();
      const it = String(ws.getRow(r).getCell(intakeCol).value || '').trim();
      if (id && it && it !== '(시작 조건 입력 안 함)') intakeMap[id] = it;
    }
  }
}

// 키워드 → 정규식 (자연어 기준)
const KW = {
  '직경':   /(?:직경|파이|φ|Φ|외경|지름|D)\s*\d|\d+\s*(?:mm|파이|φ|Φ)|\bφ\d/i,
  '반경':   /R\d|\bR0\.\d|반경|코너R/i,
  '날수':   /\d\s*날|\d\s*flute|\dFL\b|단인|2날|3날|4날|6날/i,
  '날장':   /날장|loc\b|length of cut/i,
  '전장':   /전장|overall|전체\s*길이/i,
  '넥':     /\b넥\b|neck/i,
  '소재':   /탄소강|스테인|SUS|sus|알루|구리|황동|동\b|티타늄|티탄|inconel|초내열|HRc|hrc|S45C|SCM|SKD|FC|FCD|[PMKHNS]\s*군|소재|피삭재|재질|난삭|복합재|CFRP|GFRP|쿠퍼|copper|aluminum|titanium|carbon|stainless/i,
  '형상':   /square|스퀘어|볼|ball|radius|라디우스|코너|드릴|chamfer|챔퍼|면취|toroidal|toroid|러핑|roughing|taper|테이퍼|t-slot|키홈/i,
  '코팅':   /coating|코팅|tialn|altin|y[-\s]?coat|t[-\s]?coat|n[-\s]?coat|naco|nacro|무코팅|uncoated|p[-\s]?coat/i,
  '가공방식': /milling|밀링|drilling|드릴링|turning|선반|tapping|태핑|reaming|리밍|보링|boring|hsm|trochoid|트로코|peck|rough|finish|황삭|정삭|중삭|슬로팅|slot|profile|프로파일|helical|헬리컬/i,
  '브랜드': /3S MILL|GMG|CRX|TitaNox|X[\s-]?POWER|X1[-\s]?EH|X5070|E-?FORCE|V7|SUPER\s?ALLOY|YG[-\s]?1|ALU\s?CUT|SUS[-\s]?CUT|CRX[-\s]?S|GMG\d|K2|ONLY\s?ONE|YG[-\s]?BASIX|3S|GUHRING|OSG|KENNAMETAL|MITSUBISHI|SUMITOMO|HITACHI|SECO|WIDIA|SANDVIK/i,
  '국가/판매': /국가|국내|해외|유럽|독일|미국|일본|중국|한국|EU|KOREA|JAPAN|USA|CHINA|판매|수출|수입/i,
  '재고':   /재고|stock|입고|출하/i,
  '정렬':   /정렬|순서|sort|asc|desc|많은|적은|저렴|비싼|순으로/i,
  '비교/최상급': /가장|최대|최고|최저|최소|보다|비교|차이|뭐가\s*달|어느\s*게|다른|다양|이상|이하|초과|미만|범위|between/i,
  '부정/제외': /말고|아니|빼|제외|exclude|없는|단종|except|not|불가/i,
  'Edit-intent': /말고|돌아|이전|되돌|cancel|취소|reset|초기화|다시|변경|바꿔|대신|replace|교체/i,
  'Q&A':    /뭐야|무엇|뭔지|차이|설명|어떤|어떻게|왜|용도|특징|spec|스펙/i,
  '재고/실시간': /오늘|지금|당장|즉시|급|긴급/i,
  '단위/구어': /파이|짜리|개|가지|쯤|정도|좀|혹시|있나|있어/i,
  '복합필터(다중)': null, // 후처리: 필터성 키워드가 3개 이상 동시 등장
};

function detectKeywords(text) {
  const found = [];
  for (const [k, re] of Object.entries(KW)) {
    if (re && re.test(text)) found.push(k);
  }
  // 복합필터: 직경/날수/소재/형상/코팅 중 3개 이상이면 추가
  const filterTags = ['직경', '날수', '소재', '형상', '코팅', '가공방식'];
  const cnt = filterTags.filter((t) => found.includes(t)).length;
  if (cnt >= 3) found.push('복합필터(다중)');
  return found;
}

// DB 쿼리 가능 케이스 추출: 직경 또는 소재 + 가공방식 명확
function extractDbFilters(text) {
  const f = {};
  const dia = text.match(/(?:직경|파이|φ|Φ|외경|지름|D)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:mm|파이|φ|Φ)/i);
  if (dia) f.diameter = parseFloat(dia[1] || dia[2]);
  const range = text.match(/(\d+)\s*[~\-]\s*(\d+)\s*(?:mm|파이|φ)?/);
  if (range) { f.diameterMin = +range[1]; f.diameterMax = +range[2]; }
  const flutes = text.match(/(\d)\s*(?:날|flute|F\b|FL)/i);
  if (flutes) f.flutes = +flutes[1];
  const matMap = { 'P': /탄소강|S45C|SCM|carbon|P군/i, 'M': /스테인|SUS|stainless|M군/i, 'K': /주철|FC|FCD|cast\s?iron|K군/i, 'N': /알루|aluminum|구리|황동|copper|N군|비철/i, 'S': /inconel|초내열|티타늄|titanium|난삭|S군/i, 'H': /HRc|hrc|고경도|hardened|H군/i };
  const mats = [];
  for (const [m, re] of Object.entries(matMap)) if (re.test(text)) mats.push(m);
  if (mats.length) f.material = mats;
  const opMap = { 'Milling': /milling|밀링|슬로팅|profile|prof|면취|trochoid|trocho/i, 'Drilling': /drilling|드릴링|drill|peck/i, 'Turning': /turning|선반|terning/i };
  for (const [op, re] of Object.entries(opMap)) if (re.test(text)) { f.operation = op; break; }
  const shape = { 'Square': /square|스퀘어/i, 'Ball': /ball|볼/i, 'Radius': /radius|라디우스|corner\s?r|코너r|코너R|코너 r/i, 'Chamfer': /chamfer|챔퍼|면취/i };
  for (const [s, re] of Object.entries(shape)) if (re.test(text)) { f.shape = s; break; }
  return f;
}

function buildSql(f) {
  if (!f) return '';
  const where = [];
  if (f.operation) where.push(`edp_root_category='${f.operation}'`);
  if (f.diameter) where.push(`search_diameter_mm=${f.diameter}`);
  if (f.diameterMin && f.diameterMax) where.push(`search_diameter_mm BETWEEN ${f.diameterMin} AND ${f.diameterMax}`);
  if (f.flutes) where.push(`search_flute_count=${f.flutes}`);
  if (f.material) where.push(`material_tags && ARRAY[${f.material.map((m) => `'${m}'`).join(',')}]::text[]`);
  if (f.shape) where.push(`tool_subtype='${f.shape}'`);
  return `SELECT count(*) FROM (\n  SELECT DISTINCT ON (normalized_code) *\n  FROM catalog_app.product_recommendation_mv\n  WHERE ${where.join(' AND ')}\n  ORDER BY normalized_code, edp_idx DESC\n) x`;
}

(async () => {
  await loadIntake();
  const wb = new E.Workbook();
  const HDR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
  const WF = { color: { argb: 'FFFFFFFF' }, bold: true, name: 'Malgun Gothic', size: 11 };
  const FT = { name: 'Malgun Gothic', size: 10 };
  const BD = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  const YE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9E7' } };
  const LB = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };

  // 시트 0 — 설명
  const s0 = wb.addWorksheet('설명');
  s0.columns = [{ width: 22 }, { width: 80 }];
  s0.mergeCells('A1:B1');
  s0.getCell('A1').value = '추천 챗봇 골든셋 (키워드 태깅 + DB 검증)';
  s0.getCell('A1').font = { name: 'Malgun Gothic', size: 16, bold: true, color: { argb: 'FF1A237E' } };
  s0.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  s0.getRow(1).height = 38;
  const intro = [
    ['목적', '실제 사용자 발화 + 합성 케이스 255건을 키워드/의도별로 분류하고, DB로 정답을 검증할 수 있는 케이스를 별도 추출.'],
    ['', ''],
    ['시트 구성', ''],
    ['  ① 설명', '지금 이 시트'],
    ['  ② 전체 태깅', '255 케이스 전부 — 자연어 분석으로 키워드 자동 태깅'],
    ['  ③ DB 검증 가능', '필터 조건이 명확해 DB 쿼리로 정답 ground truth를 만들 수 있는 케이스'],
    ['  ④ 키워드 분포', '키워드별 케이스 수 통계'],
    ['', ''],
    ['키워드 종류', '직경 / 반경 / 날수 / 날장 / 전장 / 넥 / 소재 / 형상 / 코팅 / 가공방식 / 브랜드 / 국가·판매 / 재고 / 정렬 / 비교·최상급 / 부정·제외 / Edit-intent / Q&A / 단위·구어 / 복합필터(다중)'],
    ['복합필터(다중)', '직경·날수·소재·형상·코팅·가공방식 중 3개 이상이 동시에 등장한 케이스 (가장 복잡한 다중 필터)'],
    ['', ''],
    ['DB 검증 SQL', 'catalog_app.product_recommendation_mv (mv-dedup) 기준. SQL 컬럼의 쿼리를 그대로 실행하면 기대 후보 수가 나옴.'],
    ['Endpoint', 'http://20.119.98.136:3000 (내 배포) / :2999 (수찬님)'],
  ];
  intro.forEach(([k, v]) => {
    const r = s0.addRow([k, v]);
    r.getCell(1).font = Object.assign({}, FT, { bold: true });
    if (k) r.getCell(1).fill = LB;
    r.eachCell((c) => { c.alignment = { wrapText: true, vertical: 'top' }; c.font = c.font || FT; });
    r.height = Math.max(20, Math.ceil((v || '').length / 70) * 16);
  });

  // 시트 1 — 전체 태깅
  const s1 = wb.addWorksheet('전체 태깅', { views: [{ state: 'frozen', ySplit: 1 }] });
  s1.columns = [
    { header: 'No', width: 6 },
    { header: 'ID', width: 14 },
    { header: '소스', width: 16 },
    { header: '턴 수', width: 7 },
    { header: '사용자 입력 (전체 턴)', width: 70 },
    { header: '자동 태깅 키워드', width: 38 },
    { header: '원본 태그', width: 18 },
    { header: '사용자 의견', width: 42 },
  ];
  const hr1 = s1.getRow(1);
  hr1.eachCell((c) => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  hr1.height = 30;

  const allKwCounts = {};
  const dbCases = [];

  j.items.forEach((it, i) => {
    const turns = (it.turns || []).map((t, k) => (it.turns.length > 1 ? `[${k + 1}] ` : '') + t).join('\n');
    const allText = (it.turns || []).join(' ');
    const kws = detectKeywords(allText);
    kws.forEach((k) => { allKwCounts[k] = (allKwCounts[k] || 0) + 1; });
    const row = s1.addRow([i + 1, it.id, it.source, it.turns?.length || 0, turns, kws.join(', '), it.tags || '', (it.opinion || '').slice(0, 250)]);
    row.eachCell((c) => { c.font = FT; c.border = BD; c.alignment = { wrapText: true, vertical: 'top' }; });
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
    row.height = Math.min(140, Math.max(24, Math.ceil(turns.length / 70) * 16));

    // DB 검증 가능 후보: intake + 모든 턴 합쳐서 추출 (필터 1개라도 있으면 OK)
    const intake = intakeMap[it.id] || '';
    const fullText = [intake, ...(it.turns || [])].join(' ');
    const f = extractDbFilters(fullText);
    const hasAny = f.diameter || f.diameterMin || f.material || f.operation || f.shape || f.flutes;
    if (hasAny) {
      dbCases.push({ id: it.id, source: it.source, intake, turn: (it.turns || []).slice(-1)[0] || '', filters: f, sql: buildSql(f) });
    }
  });

  // 시트 2 — DB 검증 가능
  const s2 = wb.addWorksheet('DB 검증 가능', { views: [{ state: 'frozen', ySplit: 1 }] });
  s2.columns = [
    { header: '#', width: 6 },
    { header: 'ID', width: 14 },
    { header: '시작 조건', width: 35 },
    { header: '사용자 입력 (마지막 턴)', width: 50 },
    { header: '추출된 필터', width: 40 },
    { header: '예상 후보 수 (DB)', width: 14 },
    { header: 'verdict', width: 12 },
    { header: 'SQL (재현용)', width: 75 },
  ];
  const hr2 = s2.getRow(1);
  hr2.eachCell((c) => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  hr2.height = 30;
  dbCases.forEach((c, i) => {
    const fStr = Object.entries(c.filters).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join('+') : v}`).join(' / ');
    const row = s2.addRow([i + 1, c.id, c.intake || '', c.turn, fStr, '', '', c.sql]);
    row.eachCell((cell) => { cell.font = FT; cell.border = BD; cell.alignment = { wrapText: true, vertical: 'top' }; });
    row.getCell(8).font = { name: 'Consolas', size: 9 };
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.height = Math.min(160, Math.max(40, Math.ceil(c.sql.length / 70) * 14));
  });

  // 시트 3 — 키워드 분포
  const s3 = wb.addWorksheet('키워드 분포');
  s3.columns = [{ header: '키워드', width: 22 }, { header: '케이스 수', width: 12 }, { header: '비율', width: 12 }];
  const hr3 = s3.getRow(1);
  hr3.eachCell((c) => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: 'center' }; });
  Object.entries(allKwCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    const r = s3.addRow([k, v, (v / j.items.length * 100).toFixed(1) + '%']);
    r.eachCell((c) => { c.font = FT; c.border = BD; });
  });

  await wb.xlsx.writeFile(path.join(__dirname, '골든셋_태깅_DB검증.xlsx'));
  console.log('saved 골든셋_태깅_DB검증.xlsx');
  console.log('전체 케이스:', j.items.length);
  console.log('DB 검증 가능:', dbCases.length);
  console.log('키워드 분포:'); Object.entries(allKwCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(' ', k, v));
})();
