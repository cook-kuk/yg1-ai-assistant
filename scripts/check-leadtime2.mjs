import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const base = 'C:/Users/kuksh/Downloads/YG1_sample_extracted';
const files = fs.readdirSync(base);
const deptFile = files.find(f => f.includes('YG1') && !f.includes('STR'));

const wb = XLSX.readFile(path.join(base, deptFile));
const ws = wb.Sheets['EDP별표준납기'];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

// Check rows 0-10
console.log('Rows 0-10:');
for (let i = 0; i <= 10; i++) {
  console.log(`row${i}:`, JSON.stringify(raw[i]));
}
console.log('\nRows 95-105:');
for (let i = 95; i <= 105; i++) {
  console.log(`row${i}:`, JSON.stringify(raw[i]));
}

// Count unique plant codes
const plants = new Set();
let validRows = 0;
for (let i = 1; i < raw.length; i++) {
  const row = raw[i];
  if (row && row[0] && row[1]) {
    plants.add(String(row[1]));
    validRows++;
  }
}
console.log('\nUnique plants:', [...plants].slice(0, 20));
console.log('Valid rows:', validRows);
console.log('Total unique EDPs (approx):', Math.round(validRows / plants.size));
