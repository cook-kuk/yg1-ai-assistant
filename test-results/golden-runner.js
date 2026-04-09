#!/usr/bin/env node
/**
 * golden-runner.js — golden-set-v1.json 어댑터 러너
 *
 * 사용법:
 *   node test-results/golden-runner.js                  # 전체
 *   node test-results/golden-runner.js --prefix M       # M로 시작하는 케이스만
 *   node test-results/golden-runner.js --limit 20       # 처음 N개
 *   node test-results/golden-runner.js --prefix M --limit 30
 *
 * 판정 (loose mode):
 *   PASS  = expected.filtersAdded가 비어있지 않은데 응답에서 1개 이상의 필터가 잡혔음
 *   FAIL  = expected가 필터를 기대했는데 0개
 *   ERROR = HTTP/parse 에러
 *   SKIP  = preState가 필요한데 시드를 못함 (현재는 그냥 스킵)
 *
 * STRICT 모드 (--strict):
 *   field alias 매핑으로 expected field와 actual field가 일치해야 PASS
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_HOST = process.env.API_HOST || '20.119.98.136';
const API_PORT = parseInt(process.env.API_PORT || '3000', 10);
const API_PATH = '/api/recommend';
const OUT_SUFFIX = process.env.OUT_SUFFIX || '';

// DB 컬럼명 → 엔진 필드명 alias (best-effort)
const FIELD_ALIAS = {
  OutsideDia: ['diameterMm', 'outsideDia', 'OutsideDia'],
  ShankDia: ['shankDiameterMm', 'shankDia'],
  OverAllLength: ['overallLengthMm', 'oal'],
  LengthofCut: ['lengthOfCutMm', 'loc'],
  NumberofFlute: ['fluteCount', 'numberOfFlute'],
  HelixAngle: ['helixAngleDeg', 'helixAngle', 'helix_angle'],
  TaperAngle: ['taperAngleDeg', 'taperAngle'],
  RadiusAll: ['cornerRadiusMm', 'ballRadiusMm', 'radiusAll'],
  RadiusofBallNose: ['ballNoseRadiusMm', 'ballRadiusMm', 'radiusOfBallNose'],
  NeckDiameter: ['neckDiameterMm', 'neckDiameter', 'diameterMm'],
  LengthbelowShank: ['lengthBelowShankMm', 'lengthBelowShank'],
  Cutter_Diameter: ['cutterDiameterMm', 'cutterDiameter', 'diameterMm'],
  Maximum_Cutting_Depth: ['maxCuttingDepthMm', 'maximumCuttingDepth'],
  Number_of_Effective_Teeth: ['effectiveTeeth', 'numberOfEffectiveTeeth'],
  ToolMaterial: ['toolMaterial'],
  Coating: ['coating'],
  ShankType: ['shankType'],
  CutterShape: ['cutterShape', 'toolSubtype'],
  SingleDoubleEnd: ['singleDoubleEnd', 'toolSubtype'],
  RoughingFinishtype: ['roughingFinishType', 'toolSubtype'],
  CoolantHole: ['coolantHole'],
  CFRP: ['workPieceName', 'cfrp'],
  GFRP: ['workPieceName', 'gfrp'],
  KFRP: ['workPieceName', 'kfrp'],
  HONEYCOMB: ['workPieceName', 'honeycomb'],
  Dry: ['coolantType', 'dry'],
  Oil_mist: ['coolantType', 'oilMist'],
  Air: ['coolantType', 'air'],
  Coolant: ['coolantType'],
  GeometryStandard: ['geometryStandard'],
  CuttingDirection: ['cuttingDirection'],
  Connection_Type: ['connectionType'],
};

function aliasFor(field) {
  return FIELD_ALIAS[field] || [field, field.toLowerCase()];
}

function callAPIOnce(body, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: API_HOST, port: API_PORT, path: API_PATH, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch (e) { reject(new Error('parse: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(data); req.end();
  });
}

// Retry transient network errors (ECONNRESET / socket hang up / TIMEOUT) up to 2 times.
// Real engine FAILs are not retried — those bubble up via the parsed response.
async function callAPI(body, timeoutMs = 90000) {
  const TRANSIENT = /ECONNRESET|socket hang up|TIMEOUT|EPIPE|ETIMEDOUT|ECONNREFUSED/i;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await callAPIOnce(body, timeoutMs);
    } catch (e) {
      lastErr = e;
      if (!TRANSIENT.test(e.message || '')) throw e;
      const backoff = 2000 * (attempt + 1);
      console.error(`[retry] ${e.message} → wait ${backoff}ms (attempt ${attempt + 1}/3)`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

function extractFilters(resp) {
  const s = resp.session?.publicState || resp.session || {};
  return s.appliedFilters || [];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runSingle(caseObj) {
  const messages = [{ role: 'user', text: caseObj.input }];
  const resp = await callAPI({ engine: 'serve', language: 'ko', messages });
  return extractFilters(resp);
}

// sequence 원소는 string (M포맷) 또는 {input, expectedFilters?, expectedAction?} (J포맷)
function turnText(turn) {
  return typeof turn === 'string' ? turn : (turn?.input || turn?.text || '')
}
function turnExpectedFilters(turn) {
  return typeof turn === 'object' && Array.isArray(turn?.expectedFilters) ? turn.expectedFilters : null
}

// "brand=CRX S(neq)" / "fluteCount=4" / "coating=Y-Coating" 등 파싱
function parseExpectedFilterSpec(spec) {
  if (typeof spec !== 'string') return null
  const m = spec.match(/^([a-zA-Z]+)\s*=\s*(.+?)(?:\(([a-z]+)\))?$/)
  if (!m) return null
  return { field: m[1], value: m[2].trim(), op: m[3] || 'eq' }
}

async function runSequence(caseObj) {
  let session = null;
  const history = [];
  const turnResults = []; // per-turn: { filters, expected, verdict, detail }
  for (const rawTurn of caseObj.sequence) {
    const text = turnText(rawTurn);
    const messages = history.concat([{ role: 'user', text }]);
    const body = { engine: 'serve', language: 'ko', messages };
    if (session) body.session = session;
    const resp = await callAPI(body);
    session = resp.session;
    const filters = extractFilters(resp);
    const expected = turnExpectedFilters(rawTurn);
    turnResults.push({ text, filters, expected });
    history.push({ role: 'user', text });
    history.push({ role: 'ai', text: resp.text || '' });
    await sleep(300);
  }
  return { lastFilters: turnResults.at(-1)?.filters ?? [], turnResults };
}

function judgeTurnExpectations(turnResults) {
  // 각 턴의 expectedFilters 가 실제 filters 에 있는지 strict 체크
  // 모든 턴이 OK 면 PASS, 하나라도 틀리면 FAIL
  const fails = []
  turnResults.forEach((tr, i) => {
    if (!tr.expected || tr.expected.length === 0) return
    const actualFields = new Set(tr.filters.map(f => f.field))
    const actualFieldVals = new Map(tr.filters.map(f => [f.field, { value: String(f.value ?? f.rawValue ?? '').toLowerCase(), op: f.op || 'eq' }]))
    for (const expSpec of tr.expected) {
      const exp = parseExpectedFilterSpec(expSpec)
      if (!exp) continue
      const aliases = aliasFor(exp.field)
      const matchedField = aliases.find(a => actualFields.has(a))
      if (!matchedField) {
        fails.push(`t${i + 1}:${exp.field}=missing`)
        continue
      }
      const actual = actualFieldVals.get(matchedField)
      if (exp.op === 'neq' && actual.op !== 'neq') {
        fails.push(`t${i + 1}:${exp.field}:op(want=neq,got=${actual.op})`)
        continue
      }
      if (exp.op === 'eq' && !actual.value.includes(String(exp.value).toLowerCase())) {
        fails.push(`t${i + 1}:${exp.field}:val(want=${exp.value},got=${actual.value})`)
      }
    }
  })
  return fails.length > 0
    ? { verdict: 'FAIL', detail: fails.join(' ') }
    : { verdict: 'PASS', detail: `${turnResults.length}turns` }
}

function judge(caseObj, runResult, strict) {
  // sequence 케이스 — 턴별 expectedFilters 우선 검증
  if (caseObj.sequence && Array.isArray(runResult?.turnResults)) {
    const hasPerTurn = runResult.turnResults.some(t => t.expected && t.expected.length > 0)
    if (hasPerTurn) return judgeTurnExpectations(runResult.turnResults)
    // per-turn expected 없으면 smoke (API 응답만 확인)
    return { verdict: 'PASS', detail: 'smoke:seq' }
  }

  const actualFilters = Array.isArray(runResult) ? runResult : (runResult?.lastFilters ?? [])
  const expectedAdded = caseObj.expected?.filtersAdded || [];
  if (expectedAdded.length === 0) {
    return { verdict: 'PASS', detail: 'no-expected' };
  }
  if (actualFilters.length === 0) {
    return { verdict: 'FAIL', detail: 'no-filter-extracted' };
  }
  if (!strict) {
    return { verdict: 'PASS', detail: `loose:${actualFilters.length}filter` };
  }
  const actualFields = new Set(actualFilters.map(f => f.field));
  for (const exp of expectedAdded) {
    if (!exp.field) continue;
    const aliases = aliasFor(exp.field);
    if (aliases.some(a => actualFields.has(a))) {
      return { verdict: 'PASS', detail: `strict:${exp.field}` };
    }
  }
  return { verdict: 'FAIL', detail: `strict:${expectedAdded.map(e => e.field).join(',')}≠${[...actualFields].join(',')}` };
}

async function main() {
  const args = process.argv.slice(2);
  const prefix = (args.find(a => a.startsWith('--prefix=')) || '').split('=')[1] || (args.includes('--prefix') ? args[args.indexOf('--prefix') + 1] : '');
  const limitArg = (args.find(a => a.startsWith('--limit=')) || '').split('=')[1] || (args.includes('--limit') ? args[args.indexOf('--limit') + 1] : '');
  const limit = limitArg ? parseInt(limitArg, 10) : Infinity;
  const strict = args.includes('--strict');
  // --shard i/N : 케이스를 N개로 쪼개서 i번째 (0-indexed) 만 실행 (멀티프로세스용)
  const shardArg = (args.find(a => a.startsWith('--shard=')) || '').split('=')[1] || (args.includes('--shard') ? args[args.indexOf('--shard') + 1] : '');
  let shardIdx = 0, shardTotal = 1;
  if (shardArg) {
    const m = shardArg.match(/^(\d+)\/(\d+)$/);
    if (!m) { console.error('--shard must be i/N (e.g. 0/4)'); process.exit(1); }
    shardIdx = parseInt(m[1], 10); shardTotal = parseInt(m[2], 10);
    if (shardIdx >= shardTotal) { console.error('shard index out of range'); process.exit(1); }
  }

  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set-v1.json'), 'utf8'));
  let cases = golden.cases;
  if (prefix) cases = cases.filter(c => c.id.startsWith(prefix));
  cases = cases.slice(0, limit);
  if (shardTotal > 1) {
    cases = cases.filter((_, i) => i % shardTotal === shardIdx);
    console.log(`▶ Shard ${shardIdx}/${shardTotal}: ${cases.length} cases`);
  }

  // Resume support: skip case IDs already present in the JSONL log.
  // The JSONL file is append-only so each completed case survives container
  // restarts and re-runs simply pick up where the previous run left off.
  // PROGRESS_DIR env var lets us write the resume log to a host-mounted volume
  // (e.g. /app/data/feedback) so it survives container restarts even though
  // /app/test-results lives only inside the image.
  const progressDir = process.env.PROGRESS_DIR || __dirname;
  const jsonlPath = path.join(progressDir, `golden-runner-progress${OUT_SUFFIX}.jsonl`);
  const completedIds = new Set();
  if (fs.existsSync(jsonlPath)) {
    for (const line of fs.readFileSync(jsonlPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const obj = JSON.parse(line); if (obj.id) completedIds.add(obj.id); } catch {}
    }
    if (completedIds.size > 0) console.log(`▶ Resume: ${completedIds.size} cases already done, skipping`);
  }
  const remaining = cases.filter(c => !completedIds.has(c.id));
  console.log(`▶ Running ${remaining.length} cases (strict=${strict})`);
  const results = { pass: 0, fail: 0, error: 0, skip: 0, details: [] };
  const startAll = Date.now();
  const appendJsonl = (obj) => fs.appendFileSync(jsonlPath, JSON.stringify(obj) + '\n');

  for (const c of remaining) {
    if (c.preState) {
      results.skip++;
      console.log(`⏭  ${c.id} SKIP (preState)`);
      results.details.push({ id: c.id, verdict: 'SKIP' });
      appendJsonl({ id: c.id, verdict: 'SKIP' });
      continue;
    }
    let row;
    try {
      const t0 = Date.now();
      const runResult = c.sequence ? await runSequence(c) : await runSingle(c);
      const elapsed = Date.now() - t0;
      const r = judge(c, runResult, strict);
      if (r.verdict === 'PASS') results.pass++;
      else results.fail++;
      const icon = r.verdict === 'PASS' ? '✅' : '❌';
      const preview = c.input || (c.sequence || []).map(turnText).join('|')
      console.log(`${icon} ${c.id} ${String(preview).substring(0, 40).padEnd(40)} ${r.verdict} ${r.detail} (${elapsed}ms)`);
      row = { id: c.id, verdict: r.verdict, detail: r.detail, elapsedMs: elapsed };
      results.details.push({ ...row, runResult });
    } catch (e) {
      results.error++;
      console.log(`💥 ${c.id} ERROR ${e.message}`);
      row = { id: c.id, verdict: 'ERROR', error: e.message };
      results.details.push(row);
    }
    appendJsonl(row);
    await sleep(200);
  }

  const totalSec = ((Date.now() - startAll) / 1000).toFixed(1);
  const total = results.pass + results.fail;
  const passRate = total ? ((results.pass / total) * 100).toFixed(1) : '0';
  console.log('\n=== RESULT ===');
  console.log(`Total: ${cases.length}, PASS: ${results.pass}, FAIL: ${results.fail}, ERROR: ${results.error}, SKIP: ${results.skip}`);
  console.log(`Pass rate: ${passRate}% (judged ${total})`);
  console.log(`Elapsed: ${totalSec}s`);

  fs.writeFileSync(path.join(__dirname, `golden-runner-result${OUT_SUFFIX}.json`), JSON.stringify(results, null, 2));
  console.log('Saved: test-results/golden-runner-result.json');
}

main().catch(e => { console.error(e); process.exit(1); });
