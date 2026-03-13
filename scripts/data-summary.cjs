const p = require('../data/normalized/products.json');
const e = require('../data/normalized/evidence-chunks.json');

console.log('╔══════════════════════════════════════════════╗');
console.log('║       YG-1 AI Assistant 데이터 현황          ║');
console.log('╚══════════════════════════════════════════════╝\n');

// === Products ===
console.log('■ 제품 (products.json):', p.length + '개');
const bySource = {};
p.forEach(x => { const s = x.sourceType || 'unknown'; bySource[s] = (bySource[s]||0)+1; });
console.log('  출처별:');
Object.entries(bySource).forEach(([k,v]) => console.log('    ' + k + ': ' + v + '개'));

console.log('\n  브랜드별:');
const brands = {};
p.forEach(x => { brands[x.brand] = (brands[x.brand]||0)+1; });
Object.entries(brands).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log('    ' + k + ': ' + v + '개'));

console.log('\n  시리즈별 (상위 20):');
const series = {};
p.forEach(x => { series[x.seriesName] = (series[x.seriesName]||0)+1; });
Object.entries(series).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([k,v]) => console.log('    ' + k + ': ' + v + '개'));
console.log('    ... 총 ' + Object.keys(series).length + '개 시리즈');

console.log('\n  형상별:');
const subtypes = {};
p.forEach(x => { subtypes[x.toolSubtype || 'null'] = (subtypes[x.toolSubtype || 'null']||0)+1; });
Object.entries(subtypes).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log('    ' + k + ': ' + v + '개'));

console.log('\n  코팅별:');
const coatings = {};
p.forEach(x => { coatings[x.coating || '미지정'] = (coatings[x.coating || '미지정']||0)+1; });
Object.entries(coatings).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log('    ' + k + ': ' + v + '개'));

console.log('\n  ISO 소재그룹별:');
const isos = {};
p.forEach(x => { (x.materialTags||[]).forEach(t => { isos[t] = (isos[t]||0)+1; }); });
Object.entries(isos).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log('    ' + k + ': ' + v + '개'));

const diams = p.map(x=>x.diameterMm).filter(Boolean);
console.log('\n  직경 범위: ' + Math.min(...diams) + 'mm ~ ' + Math.max(...diams) + 'mm (평균 ' + (diams.reduce((a,b)=>a+b,0)/diams.length).toFixed(1) + 'mm)');

// === Evidence ===
console.log('\n\n■ 절삭조건 (evidence-chunks.json):', e.length + '개');
const evSeries = {};
e.forEach(x => { evSeries[x.seriesName] = (evSeries[x.seriesName]||0)+1; });
console.log('  시리즈별 (상위 15):');
Object.entries(evSeries).sort((a,b)=>b[1]-a[1]).slice(0,15).forEach(([k,v]) => console.log('    ' + k + ': ' + v + '개'));
console.log('    ... 총 ' + Object.keys(evSeries).length + '개 시리즈');

const evIso = {};
e.forEach(x => { evIso[x.isoGroup || 'N/A'] = (evIso[x.isoGroup || 'N/A']||0)+1; });
console.log('\n  ISO 그룹별:');
Object.entries(evIso).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log('    ' + k + ': ' + v + '개'));

// === PDF catalog ===
console.log('\n\n■ PDF 카탈로그 (736페이지) 추출 현황:');
const fs = require('fs');
const pages = JSON.parse(fs.readFileSync('../scripts/pdf_pages.json', 'utf8'));
console.log('  총 페이지:', pages.length);
// Count pages with actual product data (series names)
const seriesPattern = /GNX|SEM|SEME|SEMD|SG8|SG9|ESE|E5D|E5E|GED|GEE|CE5|CE7|EHE/;
const productPages = pages.filter(pg => seriesPattern.test(pg.text));
console.log('  제품 데이터 포함 페이지:', productPages.length);
const condPages = pages.filter(pg => /절삭조건|Vc.*=|Fz/.test(pg.text));
console.log('  절삭조건 포함 페이지:', condPages.length);
const indexPages = pages.filter(pg => /INDEX/.test(pg.text));
console.log('  인덱스 페이지:', indexPages.length);

// PDF에서 발견된 시리즈
const pdfSeries = new Set();
pages.forEach(pg => {
  const matches = pg.text.match(/\b(GNX\d+|SEM[A-Z]*\d+|SEMD\d+|SEME\d+|SG[89][A-Z]\d+|ESE\d+|E5[DE]\d+|GE[DE]\d+|CE[57][A-Z]*\d+|EHE\d+)\b/g);
  if (matches) matches.forEach(m => pdfSeries.add(m));
});
console.log('  PDF에서 발견된 시리즈:', pdfSeries.size + '개');
console.log('    ' + [...pdfSeries].sort().join(', '));

// === 데이터 소스별 요약 ===
console.log('\n\n■ 데이터 소스 요약:');
console.log('  1. yg1_4G_mill_extracted.csv → 4618행 → 제품 ' + p.filter(x=>x.rawSourceFile && x.rawSourceFile.includes('4G')).length + '개 + 절삭조건 ' + e.filter(x=>x.sourceFile && x.sourceFile.includes('4G')).length + '개');
const aluProducts = p.filter(x => x.brand === 'ALU-CUT').length;
const aluEvidence = e.filter(x => x.seriesName && x.seriesName.includes('/')).length;
console.log('  2. yg1_alu_cut_extracted.csv → 576행 → 제품 ' + aluProducts + '개 + 절삭조건 ' + aluEvidence + '개');
const origProducts = p.filter(x => x.sourceType === 'smart-catalog').length;
console.log('  3. DB 명세서 (smart-catalog) → 제품 ' + origProducts + '개');
console.log('  4. PDF 카탈로그 (736p) → 시리즈 메타데이터 보강');
