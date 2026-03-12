import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

const base = 'C:/Users/kuksh/Downloads/YG1_sample_extracted';
const files = fs.readdirSync(base);

const millingFile = files.find(f => f.includes('STR_milling'));
const wb1 = XLSX.readFile(path.join(base, millingFile));

// ── prod_edp_option_milling ──
const ws_edp = wb1.Sheets['prod_edp_option_milling #상세'];
const edpData = XLSX.utils.sheet_to_json(ws_edp, { header: 1 });
console.log('=== prod_edp_option_milling COLUMNS ===');
console.log(edpData[0].map((c, i) => `${i}:${String(c).substring(0, 30)}`).join(' | '));
console.log('\n=== SAMPLE ROW 1 ===');
const r1 = edpData[1];
edpData[0].forEach((col, i) => {
  const v = r1[i];
  if (v !== undefined && v !== null && v !== '') {
    console.log(`  ${String(col).substring(0, 35)}: ${String(v).substring(0, 50)}`);
  }
});

// ── prod_series ──
const ws_series = wb1.Sheets['prod_series #시리즈 정보'];
const seriesData = XLSX.utils.sheet_to_json(ws_series, { header: 1 });
console.log('\n=== prod_series COLUMNS ===');
console.log(seriesData[0].map((c, i) => `${i}:${String(c).substring(0, 25)}`).join(' | '));
console.log('\n=== SAMPLE SERIES ROW 1 ===');
const s1 = seriesData[1];
seriesData[0].forEach((col, i) => {
  const v = s1[i];
  if (v !== undefined && v !== null && v !== '') {
    console.log(`  ${String(col).substring(0, 30)}: ${String(v).substring(0, 60)}`);
  }
});

// ── workpiece ──
const ws_wp = wb1.Sheets['prod_work_piece_by_category #소재'];
const wpData = XLSX.utils.sheet_to_json(ws_wp, { header: 1 });
console.log('\n=== prod_work_piece_by_category ALL DATA ===');
wpData.forEach((row, i) => console.log(`${i}: ${row.slice(0, 10).join(' | ')}`));

// ── 재고 데이터 (부서별) ──
const deptFile = files.find(f => f.includes('\uBD80\uC11C\uBCC4') || (f.includes('YG1') && !f.includes('STR') && !f.includes('\uBC18\uC758')));
console.log('\n=== 재고 파일:', deptFile, '===');
if (deptFile) {
  const wb2 = XLSX.readFile(path.join(base, deptFile));
  console.log('Sheets:', wb2.SheetNames);

  const ws_inv = wb2.Sheets['재고데이터'];
  if (ws_inv) {
    const invRaw = XLSX.utils.sheet_to_json(ws_inv, { header: 1 });
    console.log('\n재고데이터 rows 0-35 (first 8 cols):');
    invRaw.slice(0, 36).forEach((row, i) => {
      const preview = row.slice(0, 8).map(v => String(v ?? '').substring(0, 20)).join(' | ');
      if (preview.trim()) console.log(`  row${i}: ${preview}`);
    });
  }

  const ws_lt = wb2.Sheets['EDP별표준납기'];
  if (ws_lt) {
    const ltRaw = XLSX.utils.sheet_to_json(ws_lt, { header: 1 });
    console.log('\nEDP별표준납기 rows 0-5:');
    ltRaw.slice(0, 6).forEach((row, i) => console.log(`  row${i}: ${row.join(' | ')}`));
    console.log('  ... total rows:', ltRaw.length);
  }
}

// ── global inventory ──
const invFile = files.find(f => f.includes('global_inventory') || f.includes('inventory'));
console.log('\n=== Global Inventory:', invFile, '===');
if (invFile) {
  const wb3 = XLSX.readFile(path.join(base, invFile));
  const ws = wb3.Sheets['Sheet1'];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
  console.log('rows 0-5:');
  raw.slice(0, 6).forEach((row, i) => console.log(`  row${i}: ${row.slice(0, 12).map(v => String(v ?? '').substring(0, 15)).join(' | ')}`));
  console.log('  total rows:', raw.length, '| cols:', raw[0]?.length);
}
