const XLSX = require('xlsx');
const products = require('../data/normalized/products.json');

const rows = products.map(p => ({
  'ID': p.id,
  '브랜드': p.brand,
  '시리즈': p.seriesName,
  '제품명': p.productName,
  '형상': p.toolSubtype,
  '직경(mm)': p.diameterMm,
  '날수': p.fluteCount,
  '날길이(mm)': p.lengthOfCutMm,
  '전체길이(mm)': p.overallLengthMm,
  '생크직경(mm)': p.shankDiameterMm,
  '헬릭스각': p.helixAngleDeg,
  '코팅': p.coating,
  '소재': p.toolMaterial,
  '제품코드': p.normalizedCode,
  '이미지URL': p.seriesIconUrl || 'NA',
  '데이터소스': p.sourceType,
  '완성도': p.dataCompletenessScore,
}));

const ws = XLSX.utils.json_to_sheet(rows);
ws['!cols'] = [
  {wch:18},{wch:14},{wch:14},{wch:35},{wch:10},
  {wch:10},{wch:6},{wch:12},{wch:14},{wch:14},
  {wch:10},{wch:14},{wch:14},{wch:18},{wch:60},
  {wch:14},{wch:8}
];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, '전체제품');

// Brand summary
const brandSummary = {};
products.forEach(p => {
  if (!brandSummary[p.brand]) brandSummary[p.brand] = { count: 0, series: new Set() };
  brandSummary[p.brand].count++;
  brandSummary[p.brand].series.add(p.seriesName);
});
const brandRows = Object.entries(brandSummary).sort((a,b) => b[1].count - a[1].count).map(([brand, info]) => ({
  '브랜드': brand,
  '제품수': info.count,
  '시리즈수': info.series.size,
}));
const ws2 = XLSX.utils.json_to_sheet(brandRows);
ws2['!cols'] = [{wch:18},{wch:10},{wch:10}];
XLSX.utils.book_append_sheet(wb, ws2, '브랜드요약');

const outPath = 'C:/Users/kuksh/Downloads/YG1_products_9798.xlsx';
XLSX.writeFile(wb, outPath);
console.log('Excel saved:', outPath);
console.log('Total rows:', rows.length);
