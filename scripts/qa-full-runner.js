#!/usr/bin/env node
/**
 * qa-full-runner.js — AI 응답 전문까지 캡처하는 Q&A 러너
 *
 * 사용법:
 *   node scripts/qa-full-runner.js                         # golden-set-v1 전체
 *   node scripts/qa-full-runner.js --prefix M --limit 30   # M카테고리 30건
 *   node scripts/qa-full-runner.js --cases cases.json      # 커스텀 케이스
 *   node scripts/qa-full-runner.js --concurrency 4         # 동시 4개 (기본 3)
 *
 * 출력:
 *   test-results/qa-full-{timestamp}.json   — 전체 결과 (질문+응답+필터+제품)
 *   qa-full-report-{date}.xlsx              — xlsx 리포트 (자동 생성)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_HOST = process.env.API_HOST || '20.119.98.136';
const API_PORT = parseInt(process.env.API_PORT || '3000', 10);
const API_PATH = '/api/recommend';
const TIMEOUT_MS = parseInt(process.env.TIMEOUT || '120000', 10);
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);

// ── CLI args ──
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const PREFIX = arg('prefix', '');
const LIMIT = parseInt(arg('limit', '0'), 10);
const CUSTOM_CASES = arg('cases', '');

// ── load cases ──
function loadCases() {
  if (CUSTOM_CASES) {
    return JSON.parse(fs.readFileSync(CUSTOM_CASES, 'utf8'));
  }
  const gs = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'test-results', 'golden-set-v1.json'), 'utf8'
  ));
  let cases = [];
  for (const c of gs.cases) {
    if (c.sequence) {
      // multi-turn: flatten to single entry with turns
      cases.push({
        id: c.id, name: c.name, category: c.category,
        turns: c.sequence.map(t => t.input),
        preState: c.preState,
      });
    } else {
      cases.push({
        id: c.id, name: c.name, category: c.category,
        turns: [c.input],
        preState: c.preState,
      });
    }
  }
  if (PREFIX) cases = cases.filter(c => c.id.startsWith(PREFIX));
  if (LIMIT > 0) cases = cases.slice(0, LIMIT);
  return cases;
}

// ── API call ──
function callAPI(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    }, TIMEOUT_MS);

    const req = http.request({
      hostname: API_HOST, port: API_PORT, path: API_PATH,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let buf = '';
      res.on('data', chunk => buf += chunk);
      res.on('end', () => {
        clearTimeout(timer);
        try {
          resolve({ status: res.statusCode, body: JSON.parse(buf) });
        } catch (e) {
          resolve({ status: res.statusCode, body: null, raw: buf.slice(0, 500) });
        }
      });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.write(data);
    req.end();
  });
}

// ── run single case ──
async function runCase(c) {
  const result = {
    id: c.id, name: c.name, category: c.category,
    turns: [], pass: null, totalMs: 0,
  };

  let sessionId = `qa-runner-${c.id}-${Date.now()}`;
  let chatHistory = [];

  for (let ti = 0; ti < c.turns.length; ti++) {
    const userText = c.turns[ti];
    const turnStart = Date.now();
    const turnResult = {
      turn: ti + 1,
      userMessage: userText,
      aiResponse: null,
      filters: [],
      candidateCount: null,
      sampleProducts: [],
      purpose: null,
      error: null,
      elapsedMs: 0,
    };

    try {
      const body = {
        sessionId,
        message: userText,
        chatHistory,
      };
      // Add preState filters for first turn if needed
      if (ti === 0 && c.preState?.filters?.length) {
        body.preStateFilters = c.preState.filters;
      }

      const resp = await callAPI(body);
      turnResult.elapsedMs = Date.now() - turnStart;

      if (resp.body) {
        const b = resp.body;
        // Extract AI response text — try multiple known fields
        turnResult.aiResponse =
          b.assistantMessage || b.text || b.response || b.message ||
          b.data?.assistantMessage || b.data?.text || b.data?.response ||
          (typeof b === 'string' ? b : null);

        // If response is an object with nested content
        if (!turnResult.aiResponse && b.data?.messages) {
          const last = b.data.messages.filter(m => m.role === 'assistant').pop();
          if (last) turnResult.aiResponse = last.content;
        }

        // Extract filters
        turnResult.filters =
          b.appliedFilters || b.filters || b.data?.appliedFilters || b.data?.filters || [];

        // Extract candidate count
        turnResult.candidateCount =
          b.candidateCount ?? b.data?.candidateCount ?? b.totalCandidates ?? null;

        // Extract sample products
        turnResult.sampleProducts =
          b.sampleProducts || b.products || b.data?.sampleProducts || b.data?.products || [];

        // Extract purpose
        turnResult.purpose = b.purpose || b.data?.purpose || null;

        // Update chat history for next turn
        chatHistory.push({ role: 'user', content: userText });
        if (turnResult.aiResponse) {
          chatHistory.push({ role: 'assistant', content:
            typeof turnResult.aiResponse === 'string'
              ? turnResult.aiResponse
              : JSON.stringify(turnResult.aiResponse)
          });
        }
      } else {
        turnResult.error = `HTTP ${resp.status}: ${resp.raw || 'no body'}`;
      }
    } catch (e) {
      turnResult.elapsedMs = Date.now() - turnStart;
      turnResult.error = e.message;
    }

    result.turns.push(turnResult);
    result.totalMs += turnResult.elapsedMs;
  }

  // Simple pass heuristic: all turns got a non-error response
  result.pass = result.turns.every(t => !t.error && t.aiResponse);
  return result;
}

// ── concurrency pool ──
async function runAll(cases) {
  const results = new Array(cases.length);
  let cursor = 0;
  const total = cases.length;
  let done = 0;

  async function worker() {
    while (cursor < total) {
      const i = cursor++;
      const c = cases[i];
      process.stdout.write(`[${done + 1}/${total}] ${c.id} ${c.name.slice(0, 30)}...\r`);
      results[i] = await runCase(c);
      done++;
    }
  }

  const workers = [];
  const conc = Math.min(CONCURRENCY, total);
  for (let i = 0; i < conc; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ── xlsx generation ──
async function generateXlsx(data, outPath) {
  let ExcelJS;
  try { ExcelJS = require('exceljs'); } catch { console.log('exceljs not found, skipping xlsx'); return; }

  const wb = new ExcelJS.Workbook();

  // Sheet 1: 요약
  const ws0 = wb.addWorksheet('요약');
  ws0.columns = [
    { header: '항목', key: 'item', width: 25 },
    { header: '값', key: 'value', width: 20 },
  ];
  const passCount = data.results.filter(r => r.pass).length;
  const failCount = data.results.filter(r => !r.pass).length;
  ws0.addRow({ item: '실행 시각', value: data.runAt });
  ws0.addRow({ item: 'API', value: `${API_HOST}:${API_PORT}${API_PATH}` });
  ws0.addRow({ item: '총 케이스', value: data.results.length });
  ws0.addRow({ item: 'PASS', value: passCount });
  ws0.addRow({ item: 'FAIL/ERROR', value: failCount });
  ws0.addRow({ item: 'Pass Rate', value: (passCount / data.results.length * 100).toFixed(1) + '%' });
  ws0.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws0.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };

  // Sheet 2: 전체 Q&A
  const ws1 = wb.addWorksheet('Q&A 전체');
  ws1.columns = [
    { header: '#', key: 'idx', width: 5 },
    { header: 'ID', key: 'id', width: 6 },
    { header: '카테고리', key: 'cat', width: 8 },
    { header: '케이스명', key: 'name', width: 30 },
    { header: 'Turn', key: 'turn', width: 5 },
    { header: '사용자 질문', key: 'user', width: 45 },
    { header: 'AI 응답', key: 'ai', width: 70 },
    { header: '적용 필터', key: 'filters', width: 45 },
    { header: '후보 수', key: 'candidates', width: 10 },
    { header: '추천 제품 (top 3)', key: 'products', width: 50 },
    { header: 'purpose', key: 'purpose', width: 15 },
    { header: '소요시간(ms)', key: 'elapsed', width: 12 },
    { header: '결과', key: 'result', width: 8 },
    { header: '에러', key: 'error', width: 30 },
  ];

  let ri = 0;
  for (const r of data.results) {
    for (const t of r.turns) {
      ri++;
      const filters = (t.filters || []).map(f =>
        `${f.field} ${f.op || 'eq'} ${f.rawValue ?? f.value ?? ''}`
      ).join(', ');
      const products = (t.sampleProducts || []).slice(0, 3).map(p => {
        const parts = [p.edpNo || p.code, p.seriesName || p.series, p.brand].filter(Boolean);
        return parts.join(' ');
      }).join(' | ');
      const aiText = typeof t.aiResponse === 'string'
        ? t.aiResponse
        : t.aiResponse ? JSON.stringify(t.aiResponse).slice(0, 300) : '';

      ws1.addRow({
        idx: ri, id: r.id, cat: r.category, name: r.name,
        turn: t.turn, user: t.userMessage, ai: aiText,
        filters, candidates: t.candidateCount ?? '',
        products, purpose: t.purpose || '',
        elapsed: t.elapsedMs,
        result: t.error ? 'ERROR' : (t.aiResponse ? 'OK' : 'EMPTY'),
        error: t.error || '',
      });
    }
  }
  ws1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };

  // Color results
  for (let i = 2; i <= ri + 1; i++) {
    const v = ws1.getCell(`M${i}`).value;
    if (v === 'OK') ws1.getCell(`M${i}`).font = { color: { argb: 'FF008000' }, bold: true };
    else if (v === 'ERROR') {
      ws1.getCell(`M${i}`).font = { color: { argb: 'FFFF0000' }, bold: true };
      ws1.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
    }
  }

  await wb.xlsx.writeFile(outPath);
  console.log(`xlsx: ${outPath}`);
}

// ── main ──
async function main() {
  const cases = loadCases();
  console.log(`Loaded ${cases.length} cases (prefix=${PREFIX || 'all'}, limit=${LIMIT || 'none'})`);
  console.log(`Target: http://${API_HOST}:${API_PORT}${API_PATH}`);
  console.log(`Concurrency: ${CONCURRENCY}, Timeout: ${TIMEOUT_MS}ms\n`);

  const startTime = Date.now();
  const results = await runAll(cases);
  const elapsed = Date.now() - startTime;

  const data = {
    runAt: new Date().toISOString(),
    api: `http://${API_HOST}:${API_PORT}${API_PATH}`,
    totalCases: results.length,
    pass: results.filter(r => r.pass).length,
    fail: results.filter(r => !r.pass).length,
    elapsedMs: elapsed,
    results,
  };

  // Save JSON
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonPath = path.join(__dirname, '..', 'test-results', `qa-full-${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  console.log(`\n\nJSON: ${jsonPath}`);
  console.log(`Total: ${data.totalCases} | Pass: ${data.pass} | Fail: ${data.fail} | ${(elapsed / 1000).toFixed(1)}s`);

  // Generate xlsx
  const xlsxPath = path.join(__dirname, '..', `qa-full-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  await generateXlsx(data, xlsxPath);
}

main().catch(e => { console.error(e); process.exit(1); });
