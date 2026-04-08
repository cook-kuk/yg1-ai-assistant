#!/usr/bin/env node
/**
 * golden-runner-parallel.js — golden-runner.js 를 N개 프로세스로 분할 실행
 *
 * 사용법:
 *   node test-results/golden-runner-parallel.js                  # 기본 N=4
 *   node test-results/golden-runner-parallel.js --workers 8
 *   node test-results/golden-runner-parallel.js --workers 4 --strict --prefix M
 *
 * 동작:
 *   1) golden-runner.js 를 --shard i/N 으로 N번 spawn (병렬)
 *   2) 각 프로세스는 golden-runner-result-shardI.json 으로 결과 저장
 *   3) 모두 끝나면 합쳐서 golden-runner-result.json 에 작성
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function takeFlag(name, def) {
  const eq = args.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=')[1];
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return def;
}
const workers = parseInt(takeFlag('workers', '4'), 10);
// 나머지 args (--strict, --prefix, --limit) 는 그대로 자식한테 forward
const passthroughKeys = ['strict', 'prefix', 'limit'];
const passthrough = [];
for (const k of passthroughKeys) {
  const idx = args.indexOf(`--${k}`);
  const eq = args.find(a => a.startsWith(`--${k}=`));
  if (k === 'strict' && idx >= 0) passthrough.push('--strict');
  else if (eq) passthrough.push(eq);
  else if (idx >= 0 && args[idx + 1]) { passthrough.push(`--${k}`, args[idx + 1]); }
}

console.log(`▶ Spawning ${workers} parallel workers (passthrough: ${passthrough.join(' ') || '(none)'})`);

const startAll = Date.now();

function runShard(i) {
  return new Promise((resolve) => {
    const env = { ...process.env, OUT_SUFFIX: `-shard${i}` };
    const child = spawn(
      process.execPath,
      [path.join(__dirname, 'golden-runner.js'), '--shard', `${i}/${workers}`, ...passthrough],
      { env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { process.stderr.write(`[shard${i}] ${d}`); });
    child.on('exit', (code) => {
      // shard별 마지막 RESULT 라인만 출력
      const tail = out.trim().split('\n').slice(-6).join('\n');
      console.log(`\n[shard${i} exit=${code}]\n${tail}`);
      resolve(code);
    });
  });
}

(async () => {
  const codes = await Promise.all(Array.from({ length: workers }, (_, i) => runShard(i)));
  const anyFail = codes.some(c => c !== 0);

  // merge shard results
  const merged = { pass: 0, fail: 0, error: 0, skip: 0, details: [] };
  for (let i = 0; i < workers; i++) {
    const fp = path.join(__dirname, `golden-runner-result-shard${i}.json`);
    if (!fs.existsSync(fp)) { console.warn(`! shard${i} result missing`); continue; }
    const r = JSON.parse(fs.readFileSync(fp, 'utf8'));
    merged.pass += r.pass; merged.fail += r.fail;
    merged.error += r.error; merged.skip += r.skip;
    merged.details.push(...r.details);
  }
  fs.writeFileSync(path.join(__dirname, 'golden-runner-result.json'), JSON.stringify(merged, null, 2));

  const total = merged.pass + merged.fail;
  const passRate = total ? ((merged.pass / total) * 100).toFixed(1) : '0';
  const elapsed = ((Date.now() - startAll) / 1000).toFixed(1);
  console.log('\n=== MERGED RESULT ===');
  console.log(`Workers: ${workers}, Total: ${merged.details.length}`);
  console.log(`PASS: ${merged.pass}, FAIL: ${merged.fail}, ERROR: ${merged.error}, SKIP: ${merged.skip}`);
  console.log(`Pass rate: ${passRate}% (judged ${total})`);
  console.log(`Wall time: ${elapsed}s`);
  console.log('Saved: test-results/golden-runner-result.json');
  process.exit(anyFail ? 1 : 0);
})();
