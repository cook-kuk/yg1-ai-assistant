import XLSX from 'xlsx';
import fs from 'fs';

const BASE = 'C:/Users/kuksh/Downloads/YG1_sample_extracted';
const files = fs.readdirSync(BASE);
const f = files.find(fn => fn.includes('STR_milling'));
const wb = XLSX.readFile(BASE + '/' + f);

// Check prod_series - how many have work_piece_idx?
const ws = wb.Sheets['prod_series #시리즈 정보'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
const headers = rows[0];
const wpIdxCol = headers.indexOf('work_piece_idx');
const withWp = rows.slice(1).filter(r => r[wpIdxCol] !== null && r[wpIdxCol] !== undefined && r[wpIdxCol] !== '');
console.log('work_piece_idx 있는 rows:', withWp.length, '/', rows.length - 1);
if (withWp.length > 0) {
  console.log('샘플:', withWp.slice(0, 3).map(r => ({ idx: r[0], series: r[1], work_piece_idx: r[wpIdxCol] })));
}

// Check prod_work_piece_by_category sheet
const ws2 = wb.Sheets['prod_work_piece_by_category #소재'];
const wpRows = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: null });
console.log('\n=== prod_work_piece_by_category 헤더 ===');
console.log(wpRows[0].join(' | '));
console.log('\n=== 첫 5행 ===');
wpRows.slice(1, 6).forEach((r, i) => console.log('row', i + 1, ':', r.join(' | ')));

// Check prod_edp_option_milling for any material-related columns
const ws3 = wb.Sheets['prod_edp_option_milling #상세'];
const edpRows = XLSX.utils.sheet_to_json(ws3, { header: 1, defval: null });
console.log('\n=== prod_edp_option_milling 헤더 (material/work 관련) ===');
const edpHeaders = edpRows[0];
edpHeaders.forEach((h, i) => {
  if (h && (String(h).toLowerCase().includes('material') ||
    String(h).toLowerCase().includes('work') ||
    String(h).toLowerCase().includes('piece') ||
    String(h).toLowerCase().includes('iso'))) {
    console.log('  col', i, ':', h);
  }
});

// Check series_idx mapping in edp rows vs series map
const seriesRows = XLSX.utils.sheet_to_json(ws, { defval: null });
const seriesMap = new Map(seriesRows.map(r => [r.idx, r]));
console.log('\n=== prod_series - series_idx 기반 work_piece_idx 샘플 ===');
const edpData = XLSX.utils.sheet_to_json(ws3, { defval: null });
for (const edp of edpData.slice(0, 5)) {
  const series = seriesMap.get(edp.series_idx) || {};
  console.log('EDP:', edp.edp_no, '| series_idx:', edp.series_idx, '| series_name:', series.series_name, '| work_piece_idx:', series.work_piece_idx, '| application_shape:', series.application_shape);
}
