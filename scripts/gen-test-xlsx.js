const fs = require('fs');
const json = JSON.parse(fs.readFileSync('test-result-raw.json', 'utf8'));
const rows = [];
for (const file of json.testResults) {
  const parts = file.name.split('lib');
  const rel = parts.length > 1 ? 'lib' + parts.slice(1).join('lib') : file.name;
  const fpath = rel.replace(/\\/g, '/');
  const ar = file.assertionResults || [];
  const passed = ar.filter(t => t.status === 'passed').length;
  const failed = ar.filter(t => t.status === 'failed').length;
  const skipped = ar.filter(t => t.status === 'skipped' || t.status === 'todo').length;
  const total = ar.length;
  const dur = ar.reduce((s, t) => s + (t.duration || 0), 0);
  rows.push({ file: fpath, total, passed, failed, skipped, durationMs: dur });
}
rows.sort((a, b) => a.file.localeCompare(b.file));

// Generate xlsx using exceljs
const ExcelJS = require('exceljs');
async function main() {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: Summary
  const ws1 = wb.addWorksheet('Summary');
  ws1.columns = [
    { header: '항목', key: 'item', width: 25 },
    { header: '값', key: 'value', width: 15 },
  ];
  const totalTests = rows.reduce((s, r) => s + r.total, 0);
  const totalPassed = rows.reduce((s, r) => s + r.passed, 0);
  const totalFailed = rows.reduce((s, r) => s + r.failed, 0);
  const totalSkipped = rows.reduce((s, r) => s + r.skipped, 0);
  const totalDur = rows.reduce((s, r) => s + r.durationMs, 0);
  ws1.addRow({ item: '날짜', value: '2026-04-10' });
  ws1.addRow({ item: '테스트 파일 수', value: rows.length });
  ws1.addRow({ item: '전체 테스트', value: totalTests });
  ws1.addRow({ item: 'Pass', value: totalPassed });
  ws1.addRow({ item: 'Fail', value: totalFailed });
  ws1.addRow({ item: 'Skipped', value: totalSkipped });
  ws1.addRow({ item: 'Pass Rate (%)', value: ((totalPassed / totalTests) * 100).toFixed(1) });
  ws1.addRow({ item: '총 소요 시간 (ms)', value: totalDur });

  // Style header
  ws1.getRow(1).font = { bold: true };
  ws1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  ws1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Sheet 2: Detail per file
  const ws2 = wb.addWorksheet('파일별 결과');
  ws2.columns = [
    { header: '#', key: 'idx', width: 5 },
    { header: '테스트 파일', key: 'file', width: 70 },
    { header: 'Total', key: 'total', width: 8 },
    { header: 'Pass', key: 'passed', width: 8 },
    { header: 'Fail', key: 'failed', width: 8 },
    { header: 'Skip', key: 'skipped', width: 8 },
    { header: 'Duration(ms)', key: 'durationMs', width: 14 },
  ];
  rows.forEach((r, i) => {
    ws2.addRow({ idx: i + 1, ...r });
  });

  // Style header
  ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };

  // Conditional: highlight fail > 0
  for (let i = 2; i <= rows.length + 1; i++) {
    const failCell = ws2.getCell(`E${i}`);
    if (failCell.value > 0) {
      ws2.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
    }
  }

  // Sheet 3: By category (group by folder)
  const ws3 = wb.addWorksheet('폴더별 집계');
  ws3.columns = [
    { header: '폴더', key: 'folder', width: 55 },
    { header: '파일 수', key: 'files', width: 10 },
    { header: 'Total', key: 'total', width: 10 },
    { header: 'Pass', key: 'passed', width: 10 },
    { header: 'Fail', key: 'failed', width: 10 },
  ];
  const folderMap = {};
  for (const r of rows) {
    const folder = r.file.replace(/\/[^/]+$/, '');
    if (!folderMap[folder]) folderMap[folder] = { files: 0, total: 0, passed: 0, failed: 0 };
    folderMap[folder].files++;
    folderMap[folder].total += r.total;
    folderMap[folder].passed += r.passed;
    folderMap[folder].failed += r.failed;
  }
  for (const [folder, data] of Object.entries(folderMap).sort((a, b) => a[0].localeCompare(b[0]))) {
    ws3.addRow({ folder, ...data });
  }
  ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };

  await wb.xlsx.writeFile('test-report-20260410.xlsx');
  console.log('Done: test-report-20260410.xlsx');
  console.log(`${rows.length} files, ${totalTests} tests, ${totalPassed} pass, ${totalFailed} fail`);
}
main().catch(e => { console.error(e); process.exit(1); });
