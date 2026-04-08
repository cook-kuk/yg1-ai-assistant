#!/usr/bin/env node
// Debug J06 — print full session.publicState.appliedFilters per turn
const http = require('http');
const HOST = process.env.API_HOST || '20.119.98.136';
const PORT = parseInt(process.env.API_PORT || '3000', 10);

function call(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: HOST, port: PORT, path: '/api/recommend', method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(data); req.end();
  });
}

const turns = [
  'SUS304 가공이에요!',
  '4날',
  'Y 코팅으로 추천해줘',
];

(async () => {
  let session = null;
  const history = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    history.push({ role: 'user', text: t });
    const body = { engine: 'serve', language: 'ko', messages: [...history] };
    if (session) body.session = session;
    const resp = await call(body);
    session = resp.session;
    const af = (resp.session?.publicState || resp.session || {}).appliedFilters || [];
    const lastAsk = (resp.session?.publicState || resp.session || {}).lastAskedField;
    const text = (resp.text || '').slice(0, 200);
    console.log(`\n=== Turn ${i + 1}: ${t} ===`);
    console.log('appliedFilters:', JSON.stringify(af));
    console.log('lastAskedField:', lastAsk);
    console.log('respText:', text);
    history.push({ role: 'ai', text: resp.text || '' });
  }
})().catch(e => { console.error(e); process.exit(1); });
