#!/usr/bin/env node
/**
 * gen-qa-tracking-report.js
 * 기존 테스트 결과에서 Q&A 트래킹 xlsx 생성
 *
 * 소스:
 *   - golden-set-v1.json (445건 질문 정의)
 *   - golden-runner-result.json (실행 결과: verdict/filters)
 *   - hard-20-*.json (멀티턴 행동 테스트)
 *   - multiturn-mine-A-*.json (멀티턴 시나리오)
 *   - suchan-finder-stress-*.json (스트레스 테스트)
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const RESULTS_DIR = path.join(__dirname, '..', 'test-results');

// ── helpers ──
function readJSON(fp) {
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}
function latestFile(prefix) {
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .sort();
  return files.length ? path.join(RESULTS_DIR, files[files.length - 1]) : null;
}
function filtersToString(arr) {
  if (!arr || !arr.length) return '';
  return arr.map(f => {
    const op = f.op || 'eq';
    const val = f.rawValue ?? f.value ?? '';
    return `${f.field} ${op} ${val}`;
  }).join(', ');
}

const HEADER_STYLE = {
  font: { bold: true, color: { argb: 'FFFFFFFF' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } },
};

function styleHeader(ws) {
  ws.getRow(1).eachCell(c => {
    c.font = HEADER_STYLE.font;
    c.fill = HEADER_STYLE.fill;
  });
}

async function main() {
  const wb = new ExcelJS.Workbook();

  // ════════════════════════════════════════
  // 1. 골든셋 Q&A (445건)
  // ════════════════════════════════════════
  const golden = readJSON(path.join(RESULTS_DIR, 'golden-set-v1.json'));
  const runnerResult = readJSON(path.join(RESULTS_DIR, 'golden-runner-result.json'));
  const detailMap = {};
  for (const d of runnerResult.details || []) detailMap[d.id] = d;

  const ws1 = wb.addWorksheet('골든셋 Q&A (445건)');
  ws1.columns = [
    { header: '#', key: 'idx', width: 5 },
    { header: 'ID', key: 'id', width: 6 },
    { header: '카테고리', key: 'cat', width: 10 },
    { header: '케이스명', key: 'name', width: 35 },
    { header: '사용자 질문 (input)', key: 'input', width: 50 },
    { header: '기대 라우터', key: 'router', width: 12 },
    { header: '기대 필터', key: 'expectedFilters', width: 45 },
    { header: '기대 액션', key: 'expectedAction', width: 20 },
    { header: '실행 결과', key: 'verdict', width: 10 },
    { header: '실제 추출 필터', key: 'actualFilters', width: 45 },
    { header: '소요시간(ms)', key: 'elapsed', width: 12 },
    { header: '출처', key: 'source', width: 10 },
  ];

  let idx = 0;
  for (const c of golden.cases) {
    // multi-turn sequence cases
    if (c.sequence) {
      for (let ti = 0; ti < c.sequence.length; ti++) {
        const turn = c.sequence[ti];
        idx++;
        const det = detailMap[c.id] || {};
        const turnResult = det.runResult?.turnResults?.[ti];
        ws1.addRow({
          idx,
          id: `${c.id}[${ti}]`,
          cat: c.category,
          name: c.name,
          input: turn.input || '',
          router: turn.expectedRouter || c.expected?.router || '',
          expectedFilters: filtersToString(turn.expectedFilters || turn.expectedAction?.filtersAdded),
          expectedAction: turn.expectedAction?.lastAction || '',
          verdict: det.verdict || '',
          actualFilters: turnResult ? filtersToString(turnResult.filters) : '',
          elapsed: det.elapsedMs || '',
          source: c.source || '',
        });
      }
      continue;
    }

    idx++;
    const det = detailMap[c.id] || {};
    const actualFilters = Array.isArray(det.runResult)
      ? filtersToString(det.runResult)
      : filtersToString(det.runResult?.lastFilters);

    ws1.addRow({
      idx,
      id: c.id,
      cat: c.category,
      name: c.name,
      input: c.input || '',
      router: c.expected?.router || '',
      expectedFilters: filtersToString(c.expected?.filtersAdded),
      expectedAction: c.expected?.lastAction || '',
      verdict: det.verdict || 'NOT_RUN',
      actualFilters,
      elapsed: det.elapsedMs || '',
      source: c.source || '',
    });
  }
  styleHeader(ws1);

  // Color verdict
  for (let i = 2; i <= idx + 1; i++) {
    const v = ws1.getCell(`I${i}`).value;
    if (v === 'PASS') ws1.getCell(`I${i}`).font = { color: { argb: 'FF008000' }, bold: true };
    else if (v === 'FAIL') {
      ws1.getCell(`I${i}`).font = { color: { argb: 'FFFF0000' }, bold: true };
      ws1.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
    } else if (v === 'ERROR') {
      ws1.getCell(`I${i}`).font = { color: { argb: 'FFFF8C00' }, bold: true };
      ws1.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    }
  }

  // ════════════════════════════════════════
  // 2. Hard-20 멀티턴 Q&A
  // ════════════════════════════════════════
  const hard20File = latestFile('hard-20-');
  if (hard20File) {
    const hard20 = readJSON(hard20File);
    const ws2 = wb.addWorksheet('Hard-20 멀티턴 Q&A');
    ws2.columns = [
      { header: 'ID', key: 'id', width: 6 },
      { header: '시나리오명', key: 'name', width: 45 },
      { header: 'Turn', key: 'turn', width: 6 },
      { header: '사용자 질문', key: 'user', width: 50 },
      { header: '적용된 필터', key: 'filters', width: 55 },
      { header: '후보 수', key: 'candidates', width: 10 },
      { header: 'Turn 통과', key: 'turnPass', width: 10 },
      { header: '시나리오 통과', key: 'scenarioPass', width: 12 },
      { header: '소요시간(ms)', key: 'elapsed', width: 12 },
    ];
    for (const r of hard20.results) {
      if (!r.turnResults?.length) {
        ws2.addRow({
          id: r.id, name: r.name, turn: '-', user: '(timeout/error)',
          filters: '', candidates: '', turnPass: '', scenarioPass: r.pass ? 'PASS' : 'FAIL',
          elapsed: r.elapsed,
        });
        continue;
      }
      for (const t of r.turnResults) {
        ws2.addRow({
          id: r.id, name: r.name, turn: t.turn,
          user: t.user || '', filters: t.filters || '',
          candidates: t.candidateCount ?? '', turnPass: t.pass ? 'PASS' : 'FAIL',
          scenarioPass: r.pass ? 'PASS' : 'FAIL', elapsed: t.elapsed,
        });
      }
    }
    styleHeader(ws2);
    for (let i = 2; i <= ws2.rowCount; i++) {
      const sp = ws2.getCell(`H${i}`).value;
      if (sp === 'FAIL') ws2.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
    }
  }

  // ════════════════════════════════════════
  // 3. 멀티턴 시나리오 Q&A
  // ════════════════════════════════════════
  const mtFile = latestFile('multiturn-mine-A-');
  if (mtFile) {
    const mt = readJSON(mtFile);
    const ws3 = wb.addWorksheet('멀티턴 시나리오');
    ws3.columns = [
      { header: '#', key: 'idx', width: 4 },
      { header: '시나리오명', key: 'name', width: 40 },
      { header: 'Turn', key: 'turn', width: 6 },
      { header: '사용자 질문', key: 'nl', width: 45 },
      { header: 'AI 응답 (미리보기)', key: 'aiPreview', width: 60 },
      { header: '적용된 필터', key: 'filters', width: 45 },
      { header: '후보 수', key: 'candidates', width: 10 },
      { header: 'purpose', key: 'purpose', width: 16 },
      { header: '에러', key: 'error', width: 30 },
    ];
    let mi = 0;
    for (const r of mt.results) {
      mi++;
      if (r.error) {
        ws3.addRow({
          idx: mi, name: r.name, turn: '-', nl: '', aiPreview: '',
          filters: '', candidates: '', purpose: '', error: r.error,
        });
        continue;
      }
      for (const t of r.turns || []) {
        ws3.addRow({
          idx: mi, name: r.name, turn: t.turn,
          nl: t.nl || '(초기 turn)', aiPreview: t.aiPreview || '',
          filters: filtersToString(t.appliedFilters), candidates: t.candidateCount ?? '',
          purpose: t.purpose || '', error: '',
        });
      }
    }
    styleHeader(ws3);
  }

  // ════════════════════════════════════════
  // 4. 스트레스 테스트 Q&A
  // ════════════════════════════════════════
  const stressFile = latestFile('suchan-finder-stress-');
  if (stressFile) {
    const stress = readJSON(stressFile);
    const ws4 = wb.addWorksheet('스트레스 테스트 Q&A');
    ws4.columns = [
      { header: '#', key: 'idx', width: 4 },
      { header: '시나리오명', key: 'name', width: 40 },
      { header: '사용자 메시지', key: 'msg', width: 50 },
      { header: 'AI 응답', key: 'text', width: 70 },
      { header: 'HTTP Status', key: 'status', width: 10 },
      { header: '후보 수', key: 'candidates', width: 10 },
      { header: '추천 제품', key: 'products', width: 50 },
      { header: '소요시간(ms)', key: 'ms', width: 12 },
      { header: '에러', key: 'error', width: 30 },
    ];
    stress.results.forEach((r, i) => {
      const products = (r.sampleProducts || [])
        .map(p => [p.series, p.brand, p.diameterMm ? `φ${p.diameterMm}` : ''].filter(Boolean).join(' '))
        .join(' | ');
      ws4.addRow({
        idx: i + 1, name: r.name, msg: r.msg || '', text: r.text || '',
        status: r.status, candidates: r.candidateCount ?? '',
        products, ms: r.ms, error: r.error || '',
      });
    });
    styleHeader(ws4);
    for (let i = 2; i <= ws4.rowCount; i++) {
      const st = ws4.getCell(`E${i}`).value;
      if (st === 200) ws4.getCell(`E${i}`).font = { color: { argb: 'FF008000' }, bold: true };
      else ws4.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
    }
  }

  // ════════════════════════════════════════
  // 5. 요약 (맨 앞 시트로 이동)
  // ════════════════════════════════════════
  const ws0 = wb.addWorksheet('요약');
  // move to first position
  const sheetOrder = wb.worksheets.map(s => s);
  const idx0 = sheetOrder.findIndex(s => s.name === '요약');
  if (idx0 > 0) {
    sheetOrder.splice(idx0, 1);
    sheetOrder.unshift(ws0);
    wb._worksheets = [undefined]; // exceljs internal: index 0 is unused
    sheetOrder.forEach((s, i) => { s.orderNo = i + 1; wb._worksheets.push(s); });
  }
  ws0.columns = [
    { header: '소스', key: 'source', width: 30 },
    { header: '총 건수', key: 'total', width: 10 },
    { header: 'PASS', key: 'pass', width: 10 },
    { header: 'FAIL', key: 'fail', width: 10 },
    { header: 'ERROR', key: 'error', width: 10 },
    { header: '질문 포함', key: 'hasQ', width: 10 },
    { header: 'AI 응답 포함', key: 'hasA', width: 12 },
    { header: '비고', key: 'note', width: 40 },
  ];

  ws0.addRow({
    source: '골든셋 v1', total: golden.cases.length,
    pass: runnerResult.pass, fail: runnerResult.fail,
    error: runnerResult.error, hasQ: 'O', hasA: 'X',
    note: '필터 추출 결과만 (AI 응답 전문 없음)',
  });

  if (hard20File) {
    const h = readJSON(hard20File);
    ws0.addRow({
      source: 'Hard-20 행동 테스트', total: h.results.length,
      pass: h.results.filter(r => r.pass).length,
      fail: h.results.filter(r => !r.pass).length,
      error: 0, hasQ: 'O', hasA: 'X',
      note: '멀티턴 질문+필터 (AI 응답 없음)',
    });
  }

  if (mtFile) {
    const m = readJSON(mtFile);
    const ok = m.results.filter(r => !r.error);
    ws0.addRow({
      source: '멀티턴 시나리오', total: m.results.length,
      pass: ok.length, fail: 0, error: m.results.length - ok.length,
      hasQ: 'O', hasA: '△ (미리보기)',
      note: `${ok.length}건만 성공, aiPreview 앞부분만`,
    });
  }

  if (stressFile) {
    const s = readJSON(stressFile);
    const ok = s.results.filter(r => r.status === 200);
    ws0.addRow({
      source: '스트레스 테스트', total: s.results.length,
      pass: ok.length, fail: 0, error: s.results.length - ok.length,
      hasQ: 'O', hasA: '△ (일부)',
      note: `${ok.length}건만 응답 수신`,
    });
  }

  styleHeader(ws0);

  const outPath = path.join(__dirname, '..', `qa-tracking-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  await wb.xlsx.writeFile(outPath);
  console.log(`Done: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
