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

const API_HOST = '20.119.98.136';
const API_PORT = 3000;
const API_PATH = '/api/recommend';

// DB 컬럼명 → 엔진 필드명 alias (best-effort)
const FIELD_ALIAS = {
  OutsideDia: ['diameterMm', 'outsideDia', 'OutsideDia'],
  ShankDia: ['shankDiameterMm', 'shankDia'],
  OverAllLength: ['overallLengthMm', 'oal'],
  LengthofCut: ['lengthOfCutMm', 'loc'],
  NumberofFlute: ['fluteCount', 'numberOfFlute'],
  HelixAngle: ['helixAngleDeg', 'helixAngle'],
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

function callAPI(body, timeoutMs = 30000) {
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

async function runSequence(caseObj) {
  let session = null;
  const history = [];
  let lastFilters = [];
  for (const msg of caseObj.sequence) {
    const messages = history.concat([{ role: 'user', text: msg }]);
    const body = { engine: 'serve', language: 'ko', messages };
    if (session) body.session = session;
    const resp = await callAPI(body);
    session = resp.session;
    lastFilters = extractFilters(resp);
    history.push({ role: 'user', text: msg });
    history.push({ role: 'ai', text: resp.text || '' });
    await sleep(300);
  }
  return lastFilters;
}

function judge(caseObj, actualFilters, strict) {
  const expectedAdded = caseObj.expected?.filtersAdded || [];
  if (expectedAdded.length === 0) {
    // 추가 기대 없음 → 항상 PASS
    return { verdict: 'PASS', detail: 'no-expected' };
  }
  if (actualFilters.length === 0) {
    return { verdict: 'FAIL', detail: 'no-filter-extracted' };
  }
  if (!strict) {
    return { verdict: 'PASS', detail: `loose:${actualFilters.length}filter` };
  }
  // STRICT: 기대 필드 중 하나라도 alias로 매칭되어야 함
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

  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set-v1.json'), 'utf8'));
  let cases = golden.cases;
  if (prefix) cases = cases.filter(c => c.id.startsWith(prefix));
  cases = cases.slice(0, limit);

  console.log(`▶ Running ${cases.length} cases (strict=${strict})`);
  const results = { pass: 0, fail: 0, error: 0, skip: 0, details: [] };
  const startAll = Date.now();

  for (const c of cases) {
    if (c.preState) {
      results.skip++;
      console.log(`⏭  ${c.id} SKIP (preState)`);
      results.details.push({ id: c.id, verdict: 'SKIP' });
      continue;
    }
    try {
      const t0 = Date.now();
      const filters = c.sequence ? await runSequence(c) : await runSingle(c);
      const elapsed = Date.now() - t0;
      const r = judge(c, filters, strict);
      if (r.verdict === 'PASS') results.pass++;
      else results.fail++;
      const icon = r.verdict === 'PASS' ? '✅' : '❌';
      console.log(`${icon} ${c.id} ${(c.input || c.sequence?.join('|') || '').substring(0, 40).padEnd(40)} ${r.verdict} ${r.detail} (${elapsed}ms)`);
      results.details.push({ id: c.id, verdict: r.verdict, detail: r.detail, elapsedMs: elapsed, filters });
    } catch (e) {
      results.error++;
      console.log(`💥 ${c.id} ERROR ${e.message}`);
      results.details.push({ id: c.id, verdict: 'ERROR', error: e.message });
    }
    await sleep(200);
  }

  const totalSec = ((Date.now() - startAll) / 1000).toFixed(1);
  const total = results.pass + results.fail;
  const passRate = total ? ((results.pass / total) * 100).toFixed(1) : '0';
  console.log('\n=== RESULT ===');
  console.log(`Total: ${cases.length}, PASS: ${results.pass}, FAIL: ${results.fail}, ERROR: ${results.error}, SKIP: ${results.skip}`);
  console.log(`Pass rate: ${passRate}% (judged ${total})`);
  console.log(`Elapsed: ${totalSec}s`);

  fs.writeFileSync(path.join(__dirname, 'golden-runner-result.json'), JSON.stringify(results, null, 2));
  console.log('Saved: test-results/golden-runner-result.json');
}

main().catch(e => { console.error(e); process.exit(1); });
