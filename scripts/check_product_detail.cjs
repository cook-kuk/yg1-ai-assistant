const path = require('path');
const products = require(path.join(__dirname, '..', 'data', 'normalized', 'products.json'));

// Show full product details for key products
const interesting = ['CE5G60040', 'CE7401903', 'CE7401025'];
for (const code of interesting) {
  const p = products.find(x => x.normalizedCode === code);
  if (p) {
    console.log('\n=== ' + code + ' ===');
    console.log(JSON.stringify(p, null, 2));
  }
}

// Check what fields products have
console.log('\nAll product fields:', Object.keys(products[0]));

// Check seriesName patterns
const seriesSet = new Set(products.map(p => p.seriesName).filter(Boolean));
console.log('\nAll product series:', [...seriesSet]);
