/**
 * Extract cutting conditions from PDF pages and export to Excel
 * Parses 173+ pages of cutting condition tables from YG-1 catalog
 *
 * Structure per page:
 *   - Diameter header row (0.2, 0.3, ... 20.0)
 *   - For each ISO material group: Vc, Fz, RPM, Feed rows + Ap, Ae
 *   - ISO labels at bottom: P (~35), P (35~45), H (45~55), H (55~65), etc.
 *   - Series name: "2날 볼 GNX98 시리즈"
 */
const fs = require('fs');
const path = require('path');

const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'pdf_pages.json'), 'utf8'));

// Known series for matching
const KNOWN_SERIES = [
  "CGPH02","CGPH01","CGPH38",
  "CE7659","CE7406","CE7401","CE7412","CE7A63",
  "E2498","E2030","E2406","E2031","E2032","E2412","E2463","E2401","E2509","E2462","E2461",
  "E2750","E2480","E2751","E2749","E2464","E2659","E2411","E2714","E2753",
  "E2752","E2759","E2754","E2756","E2760","E2755","E2762","E2806","E2768","E2758",
  "E5D73","E5D71","E5D80","E5D70","E5D72","E5D74","E5D78","E5D79",
  "E5E88","E5E84","E5E89","E5E83","E5E87",
  "EHD84","EHD85","EHD87",
  "EIE21","EIE24","EIE23","EIE22","EIE25","EIE37","EIE26","EIE38","EIE27",
  "EL612",
  "EMD88","EMD81","EMD83","EMD92","EMD82",
  "EMH78","EMH79","EMH77",
  "ESE94","ESE93",
  "GAC25","GA931","GAA22","GAD33","GAD52","GAB58","GA932",
  "GMG86","GMH62","GMH63","GMG87","GMG30","GMG40","GMG26","GMH60","GMH61","GMH42","GMH64",
  "GMI41","GMI47",
  "GNX35","GNX36","GNX01","GNX66","GNX46","GNX61","GNX64","GNX73","GNX67","GNX98","GNX45","GNX75","GNX74","GNX99",
  "SEM810","SEM813","SEM846","SEMD98","SEM818","SEM838","SEM816","SEM845","SEM811","SEM812","SEM817","SEM819","SEM814",
  "SEME35","SEME58","SEME59","SEME57","SEME56","SEME61","SEME64","SEME66","SEME65","SEME62","SEME60",
  "SEME01","SEMD99","SEME70","SEME36","SEME63","SEME67","SEME71","SEME69","SEME68","SEME72","SEME73",
  "SEME78","SEME81","SEME79","SEME82","SEME95","SEME75","SEME74",
  "SG8A37","SG8A47","SG8A45","SG8A46","SG8B89","SG8A60","SG8A01","SG8A36","SG8A02","SG8B91","SG8A38",
  "SG9E76","SG9E77",
  "XMB110D","XMB260T","XMR110D","XMR260T","XMB120C","XMR120C",
  "ZBC","ZBS","ZRC","ZBT","ZMT","ZMS",
  "CE5G60","CE5G61",
  "GED70","GED71","GED72","GED73","GED74",
  "GEE83","GEE84",
];

// ── Parse cutting condition pages ──────────────────────────────

function isNumberRow(line) {
  // A row of tab/space separated numbers (diameter header or data row)
  const parts = line.trim().split(/[\t\s]+/).filter(Boolean);
  if (parts.length < 3) return false;
  const numCount = parts.filter(p => /^\d+\.?\d*$/.test(p)).length;
  return numCount >= parts.length * 0.7;
}

function extractNumbers(line) {
  return line.trim().split(/[\t\s]+/).filter(Boolean).map(s => {
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }).filter(n => n !== null);
}

function isDiameterRow(nums) {
  // Diameter rows have small values like 0.2-20.0, typically starting < 1 or between 1-20
  if (nums.length < 3) return false;
  const allSmall = nums.every(n => n >= 0.1 && n <= 30);
  const hasIncrease = nums[nums.length - 1] > nums[0];
  return allSmall && hasIncrease;
}

function isApAeRow(line) {
  return /^\s*\d*\.?\d+D\s*$/.test(line.trim());
}

function extractSeriesFromPage(text) {
  // Match "시리즈" with series code
  const match = text.match(/([A-Z][A-Z0-9]+)\s*시리즈/);
  if (match) return match[1].trim();

  // Try slash format "E5D70 / GED70"
  const slashMatch = text.match(/([A-Z][A-Z0-9]+)\s*\/\s*([A-Z][A-Z0-9]+)\s*시리즈/);
  if (slashMatch) return `${slashMatch[1]} / ${slashMatch[2]}`;

  return null;
}

function extractProductName(text) {
  // Match pattern like "2날 볼", "4날 래디우스" before series name
  const match = text.match(/(\d+[~\d]*날\s*[가-힣A-Z\-\s]+?)\s+[A-Z]/);
  if (match) return match[1].trim();
  return null;
}

function extractISOGroups(text) {
  const groups = [];
  const lines = text.split('\n');

  // Look for ISO group patterns
  // P ~35 합금강,탄소강 | P 35~45 프리하든강 | H 45~55 고경도강 | M | K | N | S
  for (const line of lines) {
    const trimmed = line.trim();

    // Pattern: "P \t~35 합금강..." or "P\n~35" etc
    let m;

    // "P \t~35 합금강, 탄소강"
    m = trimmed.match(/^([PMKNSH])\s+[~]?(\d+)[~]?(\d*)\s*(.*)/);
    if (m) {
      groups.push({
        iso: m[1],
        hardnessLow: m[2] ? parseInt(m[2]) : null,
        hardnessHigh: m[3] ? parseInt(m[3]) : null,
        material: m[4].trim()
      });
    }
  }

  return groups;
}

// Helper: find series from nearby product pages (look backward)
function inferSeriesFromNearby(pageIdx) {
  for (let j = pageIdx - 1; j >= Math.max(0, pageIdx - 10); j--) {
    const t = pages[j].text;
    // Look for EDP product codes like "EIE37 020 30" or "SEM814 030"
    const codeMatch = t.match(/\b([A-Z]{2,5}\d{2,3})\s+\d{3}/);
    if (codeMatch) {
      const candidate = codeMatch[1];
      if (KNOWN_SERIES.includes(candidate)) return candidate;
    }
    // Also try series name pattern
    const m = t.match(/([A-Z][A-Z0-9]+)\s*시리즈/);
    if (m) return m[1];
  }
  return null;
}

// Main parsing
const allCuttingConditions = [];
let parsedPages = 0;
let failedPages = 0;

for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
  const text = pages[pageIdx].text;
  const pageNum = pageIdx + 1;

  // Process cutting condition pages - with or without "추천 절삭조건" header
  const hasHeader = text.includes('추천 절삭조건') || text.includes('절삭 조건');
  const hasFz = text.includes('Fz');
  const hasRPM = text.includes('RPM');

  if (!hasFz || !hasRPM) continue;
  if (!hasHeader) {
    // Check if this looks like a cutting condition data page (has number tables)
    const numLines = text.split('\n').filter(l => isNumberRow(l.trim()));
    if (numLines.length < 5) continue;
  }

  let series = extractSeriesFromPage(text);
  if (!series) {
    series = inferSeriesFromNearby(pageIdx);
  }
  if (!series) { failedPages++; continue; }

  const productName = extractProductName(text);

  // Clean text: remove navigation sidebar (repeated brand names at top)
  const lines = text.split('\n');

  // Find data section
  let dataStartIdx = 0;
  if (hasHeader) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('추천 절삭조건') || lines[i].includes('절삭 조건')) {
        dataStartIdx = i + 1;
        break;
      }
    }
  }

  // Skip repeated navigation lines
  while (dataStartIdx < lines.length) {
    const l = lines[dataStartIdx].trim();
    if (l === '' || /^(E·FORCE|4G MILLS|X5070|CBN|G-CUT|X-POWER|SUS-CUT|ALU-CUT|HPC|V7 PLUS|TitaNox|Power|Super Alloy|WIDE-CUT|TANK|-POWER|M42 HSS|3S PLUS|PH MILLS|SUS-PLUS|ALU-PLUS|i-Xmill|챔퍼컷|챔퍼밀|코너라운딩|기술자료|E∙FORCE)/.test(l)) {
      dataStartIdx++;
    } else {
      break;
    }
  }

  // Extract all number rows and Ap/Ae rows
  const numberRows = [];
  const apAeValues = [];

  for (let i = dataStartIdx; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;

    // Skip label lines
    if (/^(ISO|경도|피삭재|인선|RPM\s*=|FEED|Vc\s*=|Fz\s*=|Ae|Ap|^[PMKNSH]\s)/.test(l)) continue;
    if (/시리즈/.test(l)) continue;
    if (/^[\d.]+D$/.test(l)) {
      apAeValues.push(l.trim());
      continue;
    }

    if (isNumberRow(l)) {
      numberRows.push(extractNumbers(l));
    }
  }

  if (numberRows.length < 2) { failedPages++; continue; }

  // First number row(s) should be diameter headers
  // Then groups of 4 rows: Vc, Fz, RPM, Feed
  // Sometimes there are two diameter sets (small + large diameters split across page)

  // Detect diameter rows vs data rows
  const diameterSets = [];
  const dataSets = [];
  let currentDiameters = null;
  let currentDataRows = [];

  for (const row of numberRows) {
    if (isDiameterRow(row) && currentDataRows.length === 0) {
      // New diameter header
      if (currentDiameters && currentDataRows.length > 0) {
        diameterSets.push(currentDiameters);
        dataSets.push(currentDataRows);
      }
      currentDiameters = row;
      currentDataRows = [];
    } else if (isDiameterRow(row) && currentDataRows.length >= 4) {
      // Another diameter set (second table on same page)
      if (currentDiameters) {
        diameterSets.push(currentDiameters);
        dataSets.push(currentDataRows);
      }
      currentDiameters = row;
      currentDataRows = [];
    } else if (currentDiameters) {
      currentDataRows.push(row);
    }
    // Skip data rows before first diameter header
  }

  if (currentDiameters && currentDataRows.length > 0) {
    diameterSets.push(currentDiameters);
    dataSets.push(currentDataRows);
  }

  // Extract ISO group labels from the page
  const isoGroups = extractISOGroups(text);

  // Parse each diameter set
  let conditionIndex = 0;

  for (let setIdx = 0; setIdx < diameterSets.length; setIdx++) {
    const diameters = diameterSets[setIdx];
    const dataRows = dataSets[setIdx];

    // Group data rows into sets of 4 (Vc, Fz, RPM, Feed)
    for (let r = 0; r + 3 < dataRows.length; r += 4) {
      const vcRow = dataRows[r];
      const fzRow = dataRows[r + 1];
      const rpmRow = dataRows[r + 2];
      const feedRow = dataRows[r + 3];

      // Get ISO group info
      const isoInfo = isoGroups[conditionIndex] || { iso: '?', hardnessLow: null, hardnessHigh: null, material: '' };
      conditionIndex++;

      // Build records for each diameter
      const colCount = Math.min(diameters.length, vcRow.length, fzRow.length, rpmRow.length, feedRow.length);

      for (let c = 0; c < colCount; c++) {
        // Get Ap/Ae for this condition group
        const apAeIdx = (conditionIndex - 1) * 2;
        const ap = apAeValues[apAeIdx] || null;
        const ae = apAeValues[apAeIdx + 1] || null;

        allCuttingConditions.push({
          series,
          productName: productName || series,
          pdfPage: pageNum,
          diameterMm: diameters[c],
          isoGroup: isoInfo.iso,
          hardnessRange: isoInfo.hardnessLow && isoInfo.hardnessHigh
            ? `${isoInfo.hardnessLow}~${isoInfo.hardnessHigh}`
            : isoInfo.hardnessLow ? `~${isoInfo.hardnessLow}` : '',
          materialName: isoInfo.material,
          vc_m_min: vcRow[c] || null,
          fz_mm_tooth: fzRow[c] || null,
          rpm: rpmRow[c] || null,
          feed_mm_min: feedRow[c] || null,
          ap: ap,
          ae: ae,
        });
      }
    }
  }

  parsedPages++;
}

console.log(`Parsed ${parsedPages} cutting condition pages`);
console.log(`Failed/skipped: ${failedPages} pages`);
console.log(`Total cutting condition records: ${allCuttingConditions.length}`);

// Show series distribution
const seriesCounts = {};
allCuttingConditions.forEach(cc => {
  seriesCounts[cc.series] = (seriesCounts[cc.series] || 0) + 1;
});
console.log(`Unique series with cutting conditions: ${Object.keys(seriesCounts).length}`);
console.log('\nTop 20 series:');
Object.entries(seriesCounts).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([s, c]) => {
  console.log(`  ${s}: ${c} records`);
});

// Save as JSON for the Excel export
const outJsonPath = path.join(__dirname, '..', 'data', 'cutting-conditions.json');
fs.writeFileSync(outJsonPath, JSON.stringify(allCuttingConditions, null, 2));
console.log(`\nSaved to ${outJsonPath}`);

// ── Export to Excel ──────────────────────────────────────────
try {
  const XLSX = require('xlsx');
  const products = require('../data/normalized/products.json');

  const wb = XLSX.utils.book_new();

  // Sheet 1: All Products (enhanced)
  const productRows = products.map(p => ({
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
    '적용소재': (p.materialTags || []).join(', '),
    '가공형상': (p.applicationShapes || []).join(', '),
    '이미지': p.seriesIconUrl || 'NA',
    '데이터소스': p.sourceType,
    '완성도': p.dataCompletenessScore,
    '설명': p.description || '',
  }));

  const ws1 = XLSX.utils.json_to_sheet(productRows);
  ws1['!cols'] = [
    {wch:18},{wch:14},{wch:16},{wch:35},{wch:10},
    {wch:10},{wch:6},{wch:12},{wch:14},{wch:14},
    {wch:10},{wch:14},{wch:14},{wch:18},{wch:20},
    {wch:40},{wch:30},{wch:14},{wch:8},{wch:50}
  ];
  XLSX.utils.book_append_sheet(wb, ws1, '전체제품');

  // Sheet 2: Cutting Conditions
  const ccRows = allCuttingConditions.map(cc => ({
    '시리즈': cc.series,
    '제품명': cc.productName,
    'PDF페이지': cc.pdfPage,
    '직경(mm)': cc.diameterMm,
    'ISO그룹': cc.isoGroup,
    '경도범위(HRc)': cc.hardnessRange,
    '피삭재': cc.materialName,
    'Vc(m/min)': cc.vc_m_min,
    'Fz(mm/tooth)': cc.fz_mm_tooth,
    'RPM(rev/min)': cc.rpm,
    'Feed(mm/min)': cc.feed_mm_min,
    'Ap': cc.ap,
    'Ae': cc.ae,
  }));

  const ws2 = XLSX.utils.json_to_sheet(ccRows);
  ws2['!cols'] = [
    {wch:16},{wch:30},{wch:10},{wch:10},{wch:10},
    {wch:14},{wch:20},{wch:12},{wch:14},{wch:14},
    {wch:14},{wch:10},{wch:10}
  ];
  XLSX.utils.book_append_sheet(wb, ws2, '절삭조건');

  // Sheet 3: Brand Summary
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
  const ws3 = XLSX.utils.json_to_sheet(brandRows);
  ws3['!cols'] = [{wch:18},{wch:10},{wch:10}];
  XLSX.utils.book_append_sheet(wb, ws3, '브랜드요약');

  // Sheet 4: Series Summary with cutting condition availability
  const seriesSummary = {};
  products.forEach(p => {
    if (!seriesSummary[p.seriesName]) {
      seriesSummary[p.seriesName] = {
        brand: p.brand,
        count: 0,
        subtype: p.toolSubtype,
        image: p.seriesIconUrl ? 'O' : 'X',
        cuttingConditions: seriesCounts[p.seriesName] ? seriesCounts[p.seriesName] : 0,
      };
    }
    seriesSummary[p.seriesName].count++;
  });
  const seriesRows = Object.entries(seriesSummary).sort((a,b) => b[1].count - a[1].count).map(([series, info]) => ({
    '시리즈': series,
    '브랜드': info.brand,
    '제품수': info.count,
    '형상': info.subtype,
    '이미지': info.image,
    '절삭조건수': info.cuttingConditions,
  }));
  const ws4 = XLSX.utils.json_to_sheet(seriesRows);
  ws4['!cols'] = [{wch:20},{wch:16},{wch:8},{wch:12},{wch:8},{wch:12}];
  XLSX.utils.book_append_sheet(wb, ws4, '시리즈요약');

  const outPath = 'C:/Users/kuksh/Downloads/YG1_products_full.xlsx';
  XLSX.writeFile(wb, outPath);
  console.log(`\nExcel saved: ${outPath}`);
  console.log(`  Sheet 1 - 전체제품: ${productRows.length} rows`);
  console.log(`  Sheet 2 - 절삭조건: ${ccRows.length} rows`);
  console.log(`  Sheet 3 - 브랜드요약: ${brandRows.length} rows`);
  console.log(`  Sheet 4 - 시리즈요약: ${seriesRows.length} rows`);

} catch (e) {
  console.log('\nExcel export error:', e.message);
  console.log('Run: npm install xlsx');
}
