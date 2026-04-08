// 25 케이스 메시지로 deterministic SCR 즉시 검증 (로컬, LLM 호출 0)
// ts-node 없이 require 위해 inline 전사
const path = require('path');

// minimal transpile: import the .ts via tsx? Use ts-node? simpler: copy logic
// For speed, import via require by writing a JS shim
const { execSync } = require('child_process');
execSync('npx tsc --outDir /tmp/det-scr-out --target ES2020 --module CommonJS --esModuleInterop --skipLibCheck lib/recommendation/core/deterministic-scr.ts 2>&1', { stdio: 'inherit' });
const { parseDeterministic } = require('/tmp/det-scr-out/deterministic-scr.js');

const cases = [
  { no: 1, msg: '추천해줘', expected: [] },
  { no: 2, msg: '다양한 소재 다 가능한 거 추천', expected: [] },
  { no: 3, msg: '직경 8mm 이상 12mm 이하 제품만 보여줘', expected: [{ field: 'diameterMm', op: 'between', value: 8, value2: 12 }] },
  { no: 4, msg: '전체 길이 100mm 이상인 것만', expected: [{ field: 'overallLengthMm', op: 'gte', value: 100 }] },
  { no: 5, msg: '전체 길이 80mm 이하 짧은 거', expected: [{ field: 'overallLengthMm', op: 'lte', value: 80 }] },
  { no: 6, msg: '4날만', expected: [{ field: 'fluteCount', op: 'eq', value: 4 }] },
  { no: 7, msg: '날수 5개 이상', expected: [{ field: 'fluteCount', op: 'gte', value: 5 }] },
  { no: 8, msg: 'T-Coating만', expected: [{ field: 'coating', op: 'eq', value: 'T-Coating' }] },
  { no: 9, msg: '비철용인데 코팅 없는 거 (bright finish)', expected: [{ field: 'coating', op: 'eq', value: 'Bright Finish' }] },
  { no: 10, msg: '재고 있는 거만 보여줘', expected: [{ field: 'stockStatus', op: 'eq', value: 'instock' }] },
  { no: 11, msg: '재고 있고 빠른 납기 가능한 거', expected: [{ field: 'stockStatus', op: 'eq', value: 'instock' }] },
  { no: 12, msg: 'X5070 브랜드로만', expected: [{ field: 'brand', op: 'eq', value: 'X5070' }] },
  { no: 13, msg: 'ALU-POWER는 빼고', expected: [{ field: 'brand', op: 'neq', value: 'ALU-POWER' }] },
  { no: 14, msg: '직경 10mm 4날 전장 100 이상 TiAlN 코팅', expected: [{ field: 'diameterMm', value: 10 }, { field: 'fluteCount', value: 4 }, { field: 'overallLengthMm', op: 'gte', value: 100 }, { field: 'coating', value: 'TiAlN' }] },
  { no: 15, msg: '직경 8~12mm, 전장 80 이상, 4날, TiAlN 코팅, 재고 있는 거', expected: [{ field: 'diameterMm', op: 'between', value: 8, value2: 12 }, { field: 'overallLengthMm', op: 'gte', value: 80 }, { field: 'fluteCount', value: 4 }, { field: 'coating', value: 'TiAlN' }, { field: 'stockStatus', value: 'instock' }] },
  { no: 16, msg: '헬릭스 각도 45도 이상', expected: [{ field: 'helixAngleDeg', op: 'gte', value: 45 }] },
  { no: 17, msg: '샹크 직경 6에서 10 사이', expected: [{ field: 'shankDiameterMm', op: 'between', value: 6, value2: 10 }] },
  { no: 18, msg: '절삭 길이 20mm 이상', expected: [{ field: 'lengthOfCutMm', op: 'gte', value: 20 }] },
  { no: 19, msg: '포인트 각도 140도', expected: [{ field: 'pointAngleDeg', op: 'eq', value: 140 }] },
  { no: 20, msg: '전장 100 이상이고 쿨런트홀 있는 거', expected: [{ field: 'overallLengthMm', op: 'gte', value: 100 }, { field: 'coolantHole', value: 'true' }] },
  { no: 21, msg: 'M10 P1.5 관통탭', expected: [{ field: 'diameterMm', value: 10 }, { field: 'threadPitchMm', value: 1.5 }] },
  { no: 22, msg: '직경 999mm 추천', expected: [{ field: 'diameterMm', value: 999 }] },
  { no: 23, msg: '직경 20 이상이면서 5 이하', expected: [{ field: 'diameterMm' }] },
  { no: 24, msg: '1/4인치 4날 추천', expected: [{ field: 'diameterMm', value: 6.35 }, { field: 'fluteCount', value: 4 }] },
  { no: 25, msg: '한국 재고로 4날 TiAlN 전장 100 이상', expected: [{ field: 'country', value: '한국' }, { field: 'stockStatus', value: 'instock' }, { field: 'fluteCount', value: 4 }, { field: 'coating', value: 'TiAlN' }, { field: 'overallLengthMm', op: 'gte', value: 100 }] },
];

let pass = 0, partial = 0, fail = 0;
console.log('No  | 결과');
console.log('----+------');
for (const c of cases) {
  const got = parseDeterministic(c.msg);
  const expectedFields = new Set(c.expected.map(e => e.field));
  const gotFields = new Set(got.map(a => a.field));
  const missing = [...expectedFields].filter(f => !gotFields.has(f));
  const extra = [...gotFields].filter(f => !expectedFields.has(f));
  let mark, status;
  if (c.expected.length === 0) {
    mark = got.length === 0 ? '✅' : '⚠️';
    status = got.length === 0 ? '(no filter expected, got 0)' : `unexpected: ${got.map(a => a.field).join(',')}`;
  } else if (missing.length === 0 && extra.length === 0) {
    mark = '✅'; pass++;
    status = `${got.length} actions OK`;
  } else if (missing.length === 0) {
    mark = '⚠️'; partial++;
    status = `extra: ${extra.join(',')}`;
  } else {
    mark = '❌'; fail++;
    status = `missing: ${missing.join(',')}` + (extra.length ? `, extra: ${extra.join(',')}` : '');
  }
  if (mark === '✅') pass++;
  console.log(String(c.no).padStart(2) + '  | ' + mark + ' ' + status);
  if (mark !== '✅') {
    console.log('    msg:', c.msg);
    console.log('    got:', JSON.stringify(got.map(a => ({ field: a.field, op: a.op, value: a.value, value2: a.value2 }))));
  }
}
console.log('\\n=== pass:', pass, '/ partial:', partial, '/ fail:', fail);
