#!/usr/bin/env node
/**
 * qa-full-runner.js
 * Run QA test cases against the recommendation API and save JSON/XLSX results.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const API_HOST = process.env.API_HOST || '20.119.98.136';
const API_PORT = parseInt(process.env.API_PORT || '3000', 10);
const API_PATH = '/api/recommend';
const TIMEOUT_MS = parseInt(process.env.TIMEOUT || '120000', 10);
const DEFAULT_CONCURRENCY = parseInt(process.env.CONCURRENCY || '3', 10);
const DEFAULT_CASES_FILE = path.join(__dirname, '..', 'testset', 'golden-set-v1.json');
const RESULTS_DIR = path.join(__dirname, '..', 'test-results');

const SUPPORTED_EXTS = new Set(['.json', '.xlsx', '.xls', '.csv', '.tsv']);

const args = process.argv.slice(2);

function parseIntSafe(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function argList(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== `--${name}`) continue;
    const val = args[i + 1];
    if (!val) continue;
    out.push(...val.split(',').map((v) => v.trim()).filter(Boolean));
  }
  return out;
}

function normalizeText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}

function parseMaybeJSON(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return '';
  if (text[0] !== '{' && text[0] !== '[') return text;
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    const parsed = parseMaybeJSON(value);
    if (Array.isArray(parsed)) return parsed;
    return parsed
      .split(/\r?\n|;/)
      .map(normalizeText)
      .filter(Boolean);
  }
  return [];
}

function normalizeFilterObject(item) {
  if (!item) return null;
  if (typeof item === 'string') {
    const text = normalizeText(item);
    if (!text) return null;
    return { field: 'note', op: 'eq', rawValue: text };
  }
  if (typeof item !== 'object') return null;
  return item;
}

function normalizePreState(value) {
  const parsed = parseMaybeJSON(value);
  if (!parsed) return {};
  if (Array.isArray(parsed)) {
    return { filters: parsed.map(normalizeFilterObject).filter(Boolean) };
  }
  if (typeof parsed === 'object') {
    if (Array.isArray(parsed.filters)) {
      return { ...parsed, filters: parsed.filters.map(normalizeFilterObject).filter(Boolean) };
    }
    return parsed;
  }
  return { filters: [{ field: 'note', op: 'eq', rawValue: parsed }] };
}

function extractMessageText(item) {
  if (item == null) return '';
  if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return normalizeText(item);
  if (typeof item === 'object') {
    if (typeof item.input !== 'undefined') return normalizeText(item.input);
    if (typeof item.message !== 'undefined') return normalizeText(item.message);
    if (typeof item.msg !== 'undefined') return normalizeText(item.msg);
    if (typeof item.text !== 'undefined') return normalizeText(item.text);
    if (typeof item.content !== 'undefined') return normalizeText(item.content);
  }
  return '';
}

function normalizeTurns(rawCase) {
  if (!rawCase || typeof rawCase !== 'object') return [];

  if (Array.isArray(rawCase.sequence)) {
    return rawCase.sequence.map(extractMessageText).filter(Boolean);
  }

  if (Array.isArray(rawCase.userMessages)) {
    return rawCase.userMessages.map(extractMessageText).filter(Boolean);
  }

  if (rawCase.input != null) {
    if (typeof rawCase.input === 'string') return asArray(rawCase.input);
    if (Array.isArray(rawCase.input)) return rawCase.input.map(extractMessageText).filter(Boolean);
    if (typeof rawCase.input === 'object') {
      if (Array.isArray(rawCase.input.userMessages)) {
        return rawCase.input.userMessages.map(extractMessageText).filter(Boolean);
      }
      if (Array.isArray(rawCase.input.fullConversation)) {
        return rawCase.input.fullConversation
          .filter(m => !m || m.role === 'user')
          .map(extractMessageText)
          .filter(Boolean);
      }
      if (
        typeof rawCase.input.text !== 'undefined' ||
        typeof rawCase.input.message !== 'undefined' ||
        typeof rawCase.input.input !== 'undefined'
      ) {
        return [extractMessageText(rawCase.input)].filter(Boolean);
      }
    }
  }

  if (Array.isArray(rawCase.turns)) {
    return rawCase.turns.map(extractMessageText).filter(Boolean);
  }

  if (Array.isArray(rawCase.conversation)) {
    return rawCase.conversation
      .filter(m => !m || m.role === 'user')
      .map(extractMessageText)
      .filter(Boolean);
  }

  if (Array.isArray(rawCase.fullConversation)) {
    return rawCase.fullConversation
      .filter(m => !m || m.role === 'user')
      .map(extractMessageText)
      .filter(Boolean);
  }

  const altPrompt = rawCase.prompt ?? rawCase.question ?? rawCase.message ?? rawCase.text;
  if (altPrompt != null) return asArray(altPrompt);
  return [];
}

function uniqueId(id, seenMap) {
  const base = normalizeText(id) || 'case';
  const idx = seenMap.get(base) || 0;
  seenMap.set(base, idx + 1);
  return idx === 0 ? base : `${base}_${idx + 1}`;
}

function collectCaseSources(rawInputs) {
  const inputs = rawInputs.length ? rawInputs : [DEFAULT_CASES_FILE];
  const list = [];
  const seen = new Set();

  const walkDir = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.isFile() && SUPPORTED_EXTS.has(path.extname(full).toLowerCase())) {
        list.push(full);
      }
    }
  };

  for (const raw of inputs) {
    const source = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
    if (!fs.existsSync(source)) {
      console.log(`WARNING: case source not found: ${source}`);
      continue;
    }
    const stat = fs.statSync(source);
    if (stat.isDirectory()) walkDir(source);
    else if (SUPPORTED_EXTS.has(path.extname(source).toLowerCase())) list.push(source);
    else console.log(`WARNING: unsupported file extension: ${source}`);
  }

  list.forEach((p) => seen.add(path.resolve(p)));
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

function parseCaseArrayFromJSON(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'object') return [];

  const keys = ['cases', 'testCases', 'testcases', 'scenarios', 'scenario', 'items', 'data'];
  for (const k of keys) {
    if (Array.isArray(raw[k])) return raw[k];
  }

  if (raw.id || raw.input || raw.sequence || raw.userMessages || raw.turns || raw.name) {
    return [raw];
  }
  return [];
}

function parseJSONFile(filePath) {
  return parseCaseArrayFromJSON(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function mapHeaderKey(raw) {
  const key = normalizeText(raw).toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (['id', 'caseid', 'tcid'].includes(key)) return 'id';
  if (['name', 'title', 'scenario', 'summary', 'description', 'label'].includes(key)) return 'name';
  if (['category', 'cat'].includes(key)) return 'category';
  if (['input', 'prompt', 'question', 'message', 'text', 'utterance', 'query'].includes(key)) return 'input';
  if (['turns', 'turn', 'messages', 'userinputs'].includes(key)) return 'turns';
  if (['prestate', 'prestatefilters', 'prefilters', 'precondition', 'filters'].includes(key)) return 'preState';
  return '';
}

function parseSpreadsheetFile(filePath) {
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch (e) {
    throw new Error('xlsx package missing. Install xlsx to parse csv/tsv/xlsx');
  }

  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (rows.length <= 1) return [];

  const header = rows[0].map(mapHeaderKey);
  const cases = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.some((v) => v !== '' && v != null)) continue;
    const raw = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      raw[key] = row[c];
    }
    if (raw.id || raw.name || raw.input || raw.turns || raw.preState) {
      raw._source = { filePath, row: i + 1 };
      cases.push(raw);
    }
  }
  return cases;
}

function loadCasesFromSource(filePath, seenIds, stats) {
  const ext = path.extname(filePath).toLowerCase();
  const parser = ext === '.json' ? parseJSONFile : parseSpreadsheetFile;
  const rawCases = parser(filePath);
  const normalized = [];

  for (let i = 0; i < rawCases.length; i++) {
    const norm = normalizeCase(rawCases[i], filePath, i + 1, seenIds);
    if (!norm) {
      stats.invalid += 1;
      continue;
    }
    normalized.push(norm);
  }
  return normalized;
}

function normalizeCase(rawCase, sourceFile, index, seenIds) {
  if (!rawCase || typeof rawCase !== 'object') return null;
  const turns = normalizeTurns(rawCase);
  const id = uniqueId(rawCase.id || rawCase.caseId || rawCase.testCaseId, seenIds);
  const name = normalizeText(
    rawCase.name ||
    rawCase.title ||
    rawCase.scenario ||
    rawCase.description ||
    rawCase.summary ||
    rawCase.label ||
    turns[0] ||
    rawCase.input ||
    id
  );
  const preState = normalizePreState(
    rawCase.preState ??
    rawCase.preStateFilters ??
    rawCase.preFilters ??
    rawCase.filters
  );

  if (!turns.length || !name) return null;
  return {
    id,
    name,
    category: normalizeText(rawCase.category || rawCase.type || rawCase.group),
    turns,
    preState,
    source: sourceFile,
    sourceIndex: index,
  };
}

function loadCases() {
  const rawCasePaths = argList('cases');
  const sourcePaths = collectCaseSources(rawCasePaths);
  const seenIds = new Map();
  const stats = { files: sourcePaths.length, loaded: 0, invalid: 0, skipped: 0 };
  const cases = [];

  for (const filePath of sourcePaths) {
    try {
      const parsed = loadCasesFromSource(filePath, seenIds, stats);
      stats.loaded += parsed.length;
      cases.push(...parsed);
    } catch (e) {
      stats.invalid += 1;
      console.log(`WARNING: failed to parse ${filePath} (${e.message})`);
    }
  }

  const prefix = arg('prefix', '');
  const limit = Math.max(0, parseInt(arg('limit', '0'), 10) || 0);
  let result = cases;
  if (prefix) result = result.filter((c) => normalizeText(c.id).startsWith(prefix));
  if (limit > 0) result = result.slice(0, limit);

  if (!result.length) {
    console.log(`Loaded 0 cases (raw files=${stats.files}, loaded=${stats.loaded}, invalid/skipped=${stats.invalid + stats.skipped})`);
  } else {
    console.log(`Loaded ${result.length} cases (raw files=${stats.files}, loaded=${stats.loaded}, invalid/skipped=${stats.invalid + stats.skipped})`);
  }
  return result;
}

function callAPI(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const reqOptions = {
      hostname: API_HOST,
      port: API_PORT,
      path: API_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    let req;
    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error('TIMEOUT'));
    }, TIMEOUT_MS);

    req = http.request(reqOptions, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
      });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          resolve({ status: res.statusCode, body: JSON.parse(buf) });
        } catch (e) {
          resolve({ status: res.statusCode, body: null, raw: buf.slice(0, 500) });
        }
      });
    });

    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

async function runCase(caseItem) {
  const result = {
    id: caseItem.id,
    name: caseItem.name,
    category: caseItem.category,
    turns: [],
    pass: null,
    totalMs: 0,
  };

  if (!Array.isArray(caseItem.turns) || !caseItem.turns.length) {
    result.turns.push({
      turn: 1,
      userMessage: '',
      aiResponse: null,
      filters: [],
      candidateCount: null,
      sampleProducts: [],
      purpose: null,
      error: 'NO_TURNS',
      elapsedMs: 0,
    });
    result.pass = false;
    return result;
  }

  let sessionId = `qa-runner-${caseItem.id}-${Date.now()}`;
  const chatHistory = [];

  for (let ti = 0; ti < caseItem.turns.length; ti++) {
    const userText = caseItem.turns[ti];
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
      if (ti === 0 && Array.isArray(caseItem.preState?.filters) && caseItem.preState.filters.length) {
        body.preStateFilters = caseItem.preState.filters;
      }

      const resp = await callAPI(body);
      turnResult.elapsedMs = Date.now() - turnStart;

      if (resp.body) {
        const b = resp.body;
        turnResult.aiResponse =
          b.assistantMessage || b.text || b.response || b.message ||
          b.data?.assistantMessage || b.data?.text || b.data?.response ||
          (typeof b === 'string' ? b : null);

        if (!turnResult.aiResponse && Array.isArray(b.data?.messages)) {
          const last = b.data.messages.filter((m) => m.role === 'assistant').pop();
          if (last) turnResult.aiResponse = last.content;
        }

        turnResult.filters =
          b.appliedFilters || b.filters || b.data?.appliedFilters || b.data?.filters || [];
        turnResult.candidateCount =
          b.candidateCount ?? b.data?.candidateCount ?? b.totalCandidates ?? null;
        turnResult.sampleProducts =
          b.sampleProducts || b.products || b.data?.sampleProducts || b.data?.products || [];
        turnResult.purpose = b.purpose || b.data?.purpose || null;

        chatHistory.push({ role: 'user', content: userText });
        if (turnResult.aiResponse) {
          chatHistory.push({
            role: 'assistant',
            content: typeof turnResult.aiResponse === 'string'
              ? turnResult.aiResponse
              : JSON.stringify(turnResult.aiResponse),
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

  result.pass = result.turns.every((turn) => !turn.error && !!turn.aiResponse);
  return result;
}

async function runAll(cases) {
  const results = new Array(cases.length);
  let cursor = 0;
  let done = 0;
  const total = cases.length;
  const concurrency = Math.min(
    parseIntSafe(arg('concurrency', String(DEFAULT_CONCURRENCY)), DEFAULT_CONCURRENCY),
    Math.max(total, 1),
  );

  const labelForCase = (c) => {
    const name = normalizeText(c?.name || c?.id || 'case');
    return `${name}`.slice(0, 40);
  };

  async function worker() {
    while (cursor < total) {
      const idx = cursor++;
      const c = cases[idx];
      if (!c || typeof c !== 'object') continue;
      process.stdout.write(`[${done + 1}/${total}] ${labelForCase(c)}...\r`);
      results[idx] = await runCase(c);
      done += 1;
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

async function generateXlsx(data, outPath) {
  let ExcelJS;
  try {
    ExcelJS = require('exceljs');
  } catch (e) {
    console.log('exceljs not found, skipping xlsx');
    return;
  }

  const wb = new ExcelJS.Workbook();

  const wsSummary = wb.addWorksheet('요약');
  wsSummary.columns = [
    { header: '항목', key: 'item', width: 25 },
    { header: '값', key: 'value', width: 20 },
  ];
  const passCount = data.results.filter((r) => r.pass).length;
  const failCount = data.results.filter((r) => !r.pass).length;
  wsSummary.addRow({ item: '실행 시각', value: data.runAt });
  wsSummary.addRow({ item: 'API', value: `${API_HOST}:${API_PORT}${API_PATH}` });
  wsSummary.addRow({ item: '총 케이스', value: data.results.length });
  wsSummary.addRow({ item: 'PASS', value: passCount });
  wsSummary.addRow({ item: 'FAIL/ERROR', value: failCount });
  wsSummary.addRow({ item: 'Pass Rate', value: `${(passCount / Math.max(data.results.length, 1) * 100).toFixed(1)}%` });
  wsSummary.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  wsSummary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };

  const wsRows = wb.addWorksheet('전체 Q&A');
  wsRows.columns = [
    { header: '#', key: 'idx', width: 5 },
    { header: 'ID', key: 'id', width: 6 },
    { header: '카테고리', key: 'cat', width: 8 },
    { header: '케이스명', key: 'name', width: 30 },
    { header: 'Turn', key: 'turn', width: 5 },
    { header: '입력', key: 'user', width: 45 },
    { header: 'AI 응답', key: 'ai', width: 70 },
    { header: '적용 필터', key: 'filters', width: 45 },
    { header: '후보 수', key: 'candidates', width: 10 },
    { header: '추천 제품 (top 3)', key: 'products', width: 50 },
    { header: 'purpose', key: 'purpose', width: 15 },
    { header: '경과시간(ms)', key: 'elapsed', width: 12 },
    { header: '결과', key: 'result', width: 8 },
    { header: '오류', key: 'error', width: 30 },
  ];

  let ri = 0;
  for (const r of data.results) {
    for (const t of r.turns) {
      ri += 1;
      const filters = (t.filters || []).map((f) =>
        `${f.field} ${f.op || 'eq'} ${f.rawValue ?? f.value ?? ''}`
      ).join(', ');
      const products = (t.sampleProducts || []).slice(0, 3).map((p) => {
        const parts = [p.edpNo || p.code, p.seriesName || p.series, p.brand].filter(Boolean);
        return parts.join(' ');
      }).join(' | ');
      const aiText = typeof t.aiResponse === 'string'
        ? t.aiResponse
        : t.aiResponse ? JSON.stringify(t.aiResponse).slice(0, 300) : '';

      wsRows.addRow({
        idx: ri,
        id: r.id,
        cat: r.category,
        name: r.name,
        turn: t.turn,
        user: t.userMessage,
        ai: aiText,
        filters,
        candidates: t.candidateCount ?? '',
        products,
        purpose: t.purpose || '',
        elapsed: t.elapsedMs,
        result: t.error ? 'ERROR' : (t.aiResponse ? 'OK' : 'EMPTY'),
        error: t.error || '',
      });
    }
  }

  wsRows.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  wsRows.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F5496' } };

  for (let i = 2; i <= ri + 1; i++) {
    const v = wsRows.getCell(`M${i}`).value;
    if (v === 'OK') wsRows.getCell(`M${i}`).font = { color: { argb: 'FF008000' }, bold: true };
    else if (v === 'ERROR') {
      wsRows.getCell(`M${i}`).font = { color: { argb: 'FFFF0000' }, bold: true };
      wsRows.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
    }
  }

  await wb.xlsx.writeFile(outPath);
  console.log(`xlsx: ${outPath}`);
}

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  node scripts/qa-full-runner.js [--cases <path|dir> ...] [--prefix ID] [--limit N] [--concurrency N]

  --cases: one or more files/folders. Folder input supports recursive search for:
          .json, .xlsx, .xls, .csv, .tsv
  --prefix: optional case ID prefix filter
  --limit: limit number of loaded cases
  --concurrency: parallel worker count (default: ${DEFAULT_CONCURRENCY})
`);
    process.exit(0);
  }

  const cases = loadCases();
  if (!cases.length) {
    console.log('No cases loaded. Nothing to run.');
    process.exit(0);
  }

  console.log(`Target: http://${API_HOST}:${API_PORT}${API_PATH}`);
  console.log(`Concurrency: ${parseIntSafe(arg('concurrency', String(DEFAULT_CONCURRENCY)), DEFAULT_CONCURRENCY)}, Timeout: ${TIMEOUT_MS}ms`);

  const startTime = Date.now();
  const results = await runAll(cases);
  const elapsed = Date.now() - startTime;

  const output = {
    runAt: new Date().toISOString(),
    api: `http://${API_HOST}:${API_PORT}${API_PATH}`,
    totalCases: results.length,
    pass: results.filter((r) => r.pass).length,
    fail: results.filter((r) => !r.pass).length,
    elapsedMs: elapsed,
    results,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const jsonPath = path.join(RESULTS_DIR, `qa-full-${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
  console.log(`\nJSON: ${jsonPath}`);
  console.log(`Total: ${output.totalCases} | Pass: ${output.pass} | Fail: ${output.fail} | ${(elapsed / 1000).toFixed(1)}s`);

  const xlsxPath = path.join(RESULTS_DIR, `qa-full-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  await generateXlsx(output, xlsxPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
