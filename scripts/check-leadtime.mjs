import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const base = 'C:/Users/kuksh/Downloads/YG1_sample_extracted';
const files = fs.readdirSync(base);
const deptFile = files.find(f => f.includes('YG1') && !f.includes('STR'));
console.log('Dept file:', deptFile);

const wb = XLSX.readFile(path.join(base, deptFile));
const ws = wb.Sheets['EDP별표준납기'];
const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

console.log('Total rows:', raw.length);
for (let i = 0; i < 15; i++) {
  const row = raw[i];
  if (row && row.some(v => v !== null && v !== undefined && v !== '')) {
    console.log(`row${i}:`, row.slice(0, 5).map(v => String(v ?? '').substring(0, 25)).join(' | '));
  }
}
// Show a few mid-rows to understand data shape
console.log('\nSample mid rows:');
[100, 500, 1000].forEach(i => {
  if (raw[i]) console.log(`row${i}:`, raw[i].slice(0, 5).map(v => String(v ?? '').substring(0, 25)).join(' | '));
});
