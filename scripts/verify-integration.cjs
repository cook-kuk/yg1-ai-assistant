const p = require('../data/normalized/products.json');
const e = require('../data/normalized/evidence-chunks.json');

console.log('=== 데이터 현황 ===');
console.log('제품 수:', p.length);
console.log('절삭조건 수:', e.length);

console.log('\n=== 브랜드별 제품 수 ===');
const brands = {};
p.forEach(x => { brands[x.brand] = (brands[x.brand]||0)+1; });
Object.entries(brands).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  '+k+': '+v));

console.log('\n=== 코팅별 분포 ===');
const coatings = {};
p.forEach(x => { const c = x.coating || '미지정'; coatings[c] = (coatings[c]||0)+1; });
Object.entries(coatings).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  '+k+': '+v));

console.log('\n=== 공구 형상별 ===');
const subtypes = {};
p.forEach(x => { subtypes[x.toolSubtype] = (subtypes[x.toolSubtype]||0)+1; });
Object.entries(subtypes).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  '+k+': '+v));

console.log('\n=== ISO 그룹별 ===');
const isoCount = {};
p.forEach(x => { (x.materialTags||[]).forEach(t => { isoCount[t] = (isoCount[t]||0)+1; }); });
Object.entries(isoCount).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  '+k+': '+v));

console.log('\n=== 직경 범위 ===');
const diams = p.map(x=>x.diameterMm).filter(Boolean);
console.log('  최소:', Math.min(...diams)+'mm');
console.log('  최대:', Math.max(...diams)+'mm');
console.log('  평균:', (diams.reduce((a,b)=>a+b,0)/diams.length).toFixed(1)+'mm');

console.log('\n=== 제품-절삭조건 매칭 확인 ===');
const evSeries = new Set(e.map(x=>x.seriesName));
const prodSeries = new Set(p.map(x=>x.seriesName));
const matched = [...prodSeries].filter(s => evSeries.has(s));
const prodOnly = [...prodSeries].filter(s => !evSeries.has(s));
const evOnly = [...evSeries].filter(s => !prodSeries.has(s));
console.log('  양쪽 다 있는 시리즈:', matched.length);
console.log('  제품만 있는 시리즈:', prodOnly.join(', ') || '없음');
console.log('  절삭조건만 있는 시리즈:', evOnly.join(', ') || '없음');

console.log('\n=== 샘플 제품 ===');
[p[0], p[134], p[500], p[2000], p[4000]].forEach(x => {
  if(!x) return;
  console.log('  ' + x.displayCode + ' | ' + x.brand + ' | ' + x.productName + ' | D' + x.diameterMm + 'mm | ' + (x.coating||'코팅미상') + ' | ISO:' + ((x.materialTags||[]).join(',')||'N/A'));
});

// Check data quality
console.log('\n=== 데이터 품질 ===');
const noCoating = p.filter(x => !x.coating).length;
const noDiam = p.filter(x => !x.diameterMm).length;
const noFlute = p.filter(x => !x.fluteCount).length;
const noISO = p.filter(x => !x.materialTags || x.materialTags.length === 0).length;
console.log('  코팅 없음:', noCoating, '(' + (noCoating/p.length*100).toFixed(1) + '%)');
console.log('  직경 없음:', noDiam, '(' + (noDiam/p.length*100).toFixed(1) + '%)');
console.log('  날수 없음:', noFlute, '(' + (noFlute/p.length*100).toFixed(1) + '%)');
console.log('  ISO 없음:', noISO, '(' + (noISO/p.length*100).toFixed(1) + '%)');
