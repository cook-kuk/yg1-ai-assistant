const path = require('path');
const evidence = require(path.join(__dirname, '..', 'data', 'normalized', 'evidence-chunks.json'));
const products = require(path.join(__dirname, '..', 'data', 'normalized', 'products.json'));

// Collect unique evidence codes and product codes
const evCodes = new Set(evidence.map(e => e.productCode));
const prodCodes = new Set(products.map(p => p.normalizedCode));

// Check overlap
let overlap = 0;
for (const code of evCodes) {
  if (prodCodes.has(code)) overlap++;
}
console.log('Evidence unique codes:', evCodes.size);
console.log('Product unique codes:', prodCodes.size);
console.log('Direct overlap:', overlap);

// Check if any evidence code contains a product code or vice versa
console.log('\nChecking partial matches...');
const prodArr = [...prodCodes];
const evArr = [...evCodes].slice(0, 50);
let partialMatches = 0;
for (const ev of evArr) {
  for (const prod of prodArr) {
    if (ev.includes(prod) || prod.includes(ev)) {
      console.log('  PARTIAL:', ev, '<->', prod);
      partialMatches++;
    }
  }
}
console.log('Partial matches in sample:', partialMatches);

// Check the raw CSV to understand the mapping
// The product codes in products.json come from what source?
console.log('\nProduct code patterns:');
const prodPrefixes = {};
products.forEach(p => {
  const prefix = p.normalizedCode.slice(0, 4);
  prodPrefixes[prefix] = (prodPrefixes[prefix] || 0) + 1;
});
Object.entries(prodPrefixes).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log('  ' + k + ': ' + v));

console.log('\nEvidence code patterns:');
const evPrefixes = {};
evidence.forEach(e => {
  const prefix = e.productCode.slice(0, 4);
  evPrefixes[prefix] = (evPrefixes[prefix] || 0) + 1;
});
Object.entries(evPrefixes).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => console.log('  ' + k + ': ' + v));

// Check product rawSourceFile
console.log('\nProduct sources:');
const sources = {};
products.forEach(p => {
  sources[p.rawSourceFile] = (sources[p.rawSourceFile] || 0) + 1;
});
Object.entries(sources).forEach(([k,v]) => console.log('  ' + k + ': ' + v));

// Check evidence sourceFile
console.log('\nEvidence sources:');
const evSources = {};
evidence.forEach(e => {
  evSources[e.sourceFile] = (evSources[e.sourceFile] || 0) + 1;
});
Object.entries(evSources).forEach(([k,v]) => console.log('  ' + k + ': ' + v));
