import fs from 'fs';

const products = JSON.parse(fs.readFileSync('data/normalized/products.json', 'utf-8'));
const inventory = JSON.parse(fs.readFileSync('data/normalized/inventory.json', 'utf-8'));
const leadTimes = JSON.parse(fs.readFileSync('data/normalized/lead-times.json', 'utf-8'));
const taxonomy = JSON.parse(fs.readFileSync('data/normalized/material-taxonomy.json', 'utf-8'));
const competitors = JSON.parse(fs.readFileSync('data/normalized/competitors.json', 'utf-8'));

console.log('=== 적용된 데이터 요약 ===');
console.log('제품 (YG-1 Smart Catalog xlsx):', products.filter(p => p.sourcePriority === 1).length, '개');
console.log('제품 (YG-1 카탈로그 CSV):', products.filter(p => p.sourcePriority === 2).length, '개');
console.log('제품 전체:', products.length, '개');
console.log('재고 레코드:', inventory.length, '개');
console.log('재고 EDP 수:', new Set(inventory.map(i => i.edp)).size, '개');
console.log('납기 레코드:', leadTimes.length, '개');
console.log('소재 분류:', taxonomy.length, '개 (ISO 그룹)');
console.log('Harvey Tool (경쟁사):', competitors.length, '개');

console.log('\n=== Smart Catalog EDP 샘플 5개 ===');
products.filter(p => p.sourcePriority === 1).slice(0, 5).forEach(p => {
  console.log(` - ${p.displayCode} | ${p.seriesName} | φ${p.diameterMm}mm | ${p.fluteCount}날 | ${p.coating ?? '코팅없음'}`);
});

console.log('\n=== 재고 있는 EDP 샘플 ===');
const invByEdp = {};
inventory.forEach(i => {
  if (!invByEdp[i.edp]) invByEdp[i.edp] = 0;
  if (i.quantity) invByEdp[i.edp] += i.quantity;
});
Object.entries(invByEdp).filter(([, q]) => q > 0).slice(0, 5).forEach(([edp, qty]) => {
  console.log(` - ${edp} | 총 ${qty}개`);
});

console.log('\n=== 납기 샘플 ===');
leadTimes.slice(0, 5).forEach(lt => {
  console.log(` - ${lt.edp} | Plant ${lt.plant} | ${lt.leadTimeDays}일`);
});

console.log('\n=== 소재 분류 (ISO 그룹) ===');
taxonomy.forEach(t => console.log(` - ${t.tag}군: ${t.displayNameKo} (${t.displayNameEn})`));

console.log('\n=== 원본 파일 출처 확인 ===');
const sources = [...new Set(products.map(p => p.rawSourceFile))];
sources.forEach(s => {
  const count = products.filter(p => p.rawSourceFile === s).length;
  console.log(` - ${s}: ${count}개`);
});
