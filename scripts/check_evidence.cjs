const path = require('path');
const evidence = require(path.join(__dirname, '..', 'data', 'normalized', 'evidence-chunks.json'));
const series = {};
evidence.forEach(e => {
  const s = e.seriesName || 'none';
  series[s] = (series[s] || 0) + 1;
});
const sorted = Object.entries(series).sort((a,b) => b[1]-a[1]);
console.log('Evidence series names (top 30):');
sorted.slice(0, 30).forEach(([k,v]) => console.log('  ' + k + ': ' + v));

console.log('\nAny CE-prefix series?');
sorted.filter(([k]) => k.startsWith('CE')).forEach(([k,v]) => console.log('  ' + k + ': ' + v));

console.log('\nProduct code formats (first 10):');
const codes = [...new Set(evidence.map(e => e.productCode))];
codes.slice(0, 10).forEach(c => console.log('  ' + c));

// Check product data codes
const products = require(path.join(__dirname, '..', 'data', 'normalized', 'products.json'));
console.log('\nProduct normalizedCode formats (first 10):');
products.slice(0, 10).forEach(p => console.log('  ' + p.normalizedCode + ' (display: ' + p.displayCode + ', series: ' + p.seriesName + ')'));
