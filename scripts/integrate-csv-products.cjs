/**
 * Integrate CSV data into products.json
 * Reads yg1_4G_mill_extracted.csv and yg1_alu_cut_extracted.csv,
 * extracts unique products, and merges with existing products.json
 */
const fs = require('fs');
const path = require('path');

// Simple CSV parser (handles quoted fields with commas)
function parseCSV(text) {
  const lines = text.split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// Brand mapping from series name
function getBrand(series) {
  if (/^SEME|^SEM8|^SEMD/.test(series)) return '4G MILLS';
  if (/^GNX|^SG8A|^SG8B|^SG9E/.test(series)) return 'E-FORCE';
  if (/^ESE/.test(series)) return 'X5070 S';
  if (/^E5D|^GED|^E5E|^GEE/.test(series)) return 'ALU-CUT';
  if (/^CE5G6/.test(series)) return 'ALU-PLUS';
  if (/^CE74/.test(series)) return 'GENERAL HSS';
  return 'YG-1';
}

// Determine tool subtype from product name
function getSubtype(name) {
  if (/볼|ball/i.test(name)) return 'Ball';
  if (/래디우스|radius/i.test(name)) return 'Radius';
  if (/스퀘어|square/i.test(name)) return 'Square';
  if (/테이퍼|taper/i.test(name)) return 'Taper';
  if (/라핑|roughing/i.test(name)) return 'Roughing';
  if (/챔퍼|chamfer/i.test(name)) return 'Chamfer';
  if (/웨이브|wave/i.test(name)) return 'Roughing';
  return 'Square';
}

// Description from PDF catalog data (series → description mapping from index pages)
const seriesDescriptions = {
  'GNX98': '2날 볼 - 고속•고경도강용 초경엔드밀, Blue Coating, HRc50 이상',
  'GNX46': '2날 롱넥 볼 - 고속•고경도강용, 1mm 이하 더블넥 적용',
  'GNX99': '2날 래디우스 - 고속•고경도강용 초경엔드밀',
  'GNX61': '2날 롱넥 래디우스 - 고속•고경도강용',
  'GNX01': '4날 래디우스 - 고속•고경도강용',
  'GNX64': '4날 롱넥 래디우스 - 고속•고경도강용',
  'GNX67': '4날 45˚ 헬릭스 래디우스',
  'GNX66': '4날 고이송용 래디우스',
  'GNX35': '2날 스퀘어 - 고속•고경도강용',
  'GNX45': '2날 롱넥 스퀘어 - 고속•고경도강용',
  'GNX36': '4날 스퀘어 - 고속•고경도강용',
  'GNX73': '4날 롱넥 스퀘어',
  'GNX74': '4날 45˚ 헬릭스 스퀘어',
  'GNX75': '3~6날 45˚ 헬릭스 스퀘어',
  'SEMD98': '2날 볼 - 프리하든강용 초경엔드밀, Y코팅',
  'SEM846': '2날 롱넥 볼 - 프리하든강용, Y코팅',
  'SEME56': '2날 테이퍼 넥 볼 - 프리하든강용',
  'SEME57': '2날 MMC 볼 - 프리하든강용, Y코팅',
  'SEME58': '2날 스트레이트 볼 - 프리하든강용',
  'SEME59': '3날 고이송용 볼 - 프리하든강용',
  'SEME60': '4날 고이송용 볼 - 프리하든강용',
  'SEMD99': '2날 래디우스 - 프리하든강용',
  'SEME61': '2날 롱넥 래디우스 - 프리하든강용',
  'SEME62': '2날 테이퍼 넥 래디우스 - 프리하든강용',
  'SEME63': '3날 고이송용 래디우스 (더블코너)',
  'SEME01': '4날 래디우스 - 프리하든강용, Y코팅',
  'SEME64': '4날 롱넥 래디우스 - 프리하든강용',
  'SEME65': '4날 테이퍼 넥 래디우스',
  'SEME66': '4날 고이송용 래디우스',
  'SEME67': '4날 다기능용 래디우스',
  'SEME68': '6날 45˚ 헬릭스 래디우스',
  'SEME35': '2날 스퀘어 - 프리하든강용, Y코팅',
  'SEME69': '2날 강력절삭용 스퀘어',
  'SEME70': '2날 롱 스퀘어',
  'SEM845': '2날 롱넥 스퀘어 - 프리하든강용',
  'SEME36': '4날 스퀘어 - 프리하든강용, Y코팅',
  'SEME71': '4날 강력절삭용 스퀘어',
  'SEME72': '4날 롱 스퀘어',
  'SEME73': '4날 롱넥 스퀘어',
  'SEME74': '4날 45˚ 헬릭스 스퀘어',
  'SEME75': '6날 45˚ 헬릭스 스퀘어',
  'SG9E76': '3~5날 라핑 (챔퍼 타입)',
  'SG9E77': '3~5날 X-SPEED 라핑',
  'SEME79': '2날 테이퍼 볼',
  'SEME82': '4날 테이퍼 래디우스',
  'SEME78': '2날 테이퍼 스퀘어',
  'SEME81': '4날 테이퍼 스퀘어',
  'SEME95': '4날 테이퍼 리브 스퀘어',
  // ALU-CUT series
  'E5D74 / GED74': 'ALU-CUT 3날 웨이브컷 챔퍼 - DLC 코팅, 알루미늄/비철금속',
  'E5D70 / GED70': 'ALU-CUT 2날 스퀘어 - DLC 코팅',
  'E5D71 / GED71': 'ALU-CUT 3날 스퀘어 - DLC 코팅',
  'E5D72 / GED72': 'ALU-CUT 2날 볼 - DLC 코팅',
  'E5D73 / GED73': 'ALU-CUT 3날 래디우스 - DLC 코팅',
  'E5E83 / GEE83': 'ALU-CUT 2날 스퀘어 - DLC 코팅',
  'E5E84 / GEE84': 'ALU-CUT 3날 스퀘어 - DLC 코팅',
  // X5070 S
  'SG8A38': 'X5070 S 2날 볼',
  'SG8A46': 'X5070 S 2날 롱넥 볼',
  'SG8A36': 'X5070 S 2날 래디우스',
  'SG8A60': 'X5070 S 2날 롱넥 래디우스',
  'SG8A37': 'X5070 S 4날 래디우스',
  'SG8A47': 'X5070 S 4날 롱넥 래디우스',
  'SG8A01': 'X5070 S 2날 스퀘어',
  'SG8A45': 'X5070 S 2날 롱넥 스퀘어',
  'SG8A02': 'X5070 S 4날 스퀘어',
  'SG8B89': 'X5070 S 4날 롱넥 스퀘어',
  'SG8B91': 'X5070 S 3~6날 45˚ 헬릭스 스퀘어',
};

// Read existing products
const existingProducts = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'normalized', 'products.json'), 'utf8')
);
const existingIds = new Set(existingProducts.map(p => p.id));
console.log('Existing products:', existingProducts.length);

// Read CSVs
const csv4G = parseCSV(
  fs.readFileSync('C:/Users/kuksh/Downloads/yg1_4G_mill_extracted.csv', 'utf8')
);
const csvAlu = parseCSV(
  fs.readFileSync('C:/Users/kuksh/Downloads/yg1_alu_cut_extracted.csv', 'utf8')
);
console.log('4G Mill CSV rows:', csv4G.length);
console.log('ALU-CUT CSV rows:', csvAlu.length);

// Aggregate unique products by product_code (first occurrence keeps specs)
const productMap = new Map();

function processRow(row) {
  const code = (row.product_code || '').replace(/\s+/g, '');
  if (!code) return;

  const series = (row.series_name || '').trim();
  const id = `edp_${code}`;

  // Skip if already in existing products
  if (existingIds.has(id)) return;

  // Skip if we already have this product from CSV
  if (productMap.has(code)) {
    // But collect additional ISO groups
    const existing = productMap.get(code);
    const iso = (row.iso_group || '').trim();
    if (iso && !existing.materialTags.includes(iso)) {
      existing.materialTags.push(iso);
    }
    return;
  }

  const diameter = parseFloat(row.cutting_diameter_mm) || null;
  const overallLength = parseFloat(row.overall_length_mm) || null;
  const fluteLength = parseFloat(row.flute_length_mm) || null;
  const shankDiameter = parseFloat(row.shank_diameter_mm) || null;
  const fluteCount = parseInt(row.flute_count) || null;
  const helixAngle = parseFloat(row.helix_angle_deg) || null;
  const coating = (row.coating || '').trim() || null;
  const toolMaterial = (row.tool_material || '').trim() || null;
  const productName = (row.product_name || '').trim();
  const iso = (row.iso_group || '').trim();
  const subtype = getSubtype(productName);

  const product = {
    id,
    manufacturer: 'YG-1',
    brand: getBrand(series),
    sourcePriority: 2,
    sourceType: 'catalog-csv',
    rawSourceFile: row.pdf_file || 'yg1_catalog_extracted.csv',
    rawSourceSheet: null,
    normalizedCode: code,
    displayCode: code,
    seriesName: series,
    productName: `${productName} ${series} 시리즈`,
    toolType: 'Solid',
    toolSubtype: subtype,
    diameterMm: diameter,
    diameterInch: diameter ? Math.round(diameter / 25.4 * 10000) / 10000 : null,
    fluteCount,
    coating,
    toolMaterial,
    shankDiameterMm: shankDiameter,
    lengthOfCutMm: fluteLength,
    overallLengthMm: overallLength,
    helixAngleDeg: helixAngle,
    ballRadiusMm: subtype === 'Ball' && diameter ? diameter / 2 : null,
    taperAngleDeg: null,
    coolantHole: null,
    applicationShapes: getApplicationShapes(subtype),
    materialTags: iso ? [iso] : [],
    region: 'KOREA',
    description: seriesDescriptions[series] || `${productName} ${series}`,
    featureText: seriesDescriptions[series] || productName,
    seriesIconUrl: null,
    sourceConfidence: 'high',
    dataCompletenessScore: calculateCompleteness(diameter, overallLength, fluteLength, shankDiameter, coating, toolMaterial, fluteCount),
    evidenceRefs: [code]
  };

  productMap.set(code, product);
}

function getApplicationShapes(subtype) {
  switch (subtype) {
    case 'Ball': return ['Profiling', 'Die-Sinking', '3D_Contouring'];
    case 'Radius': return ['Side_Milling', 'Profiling', 'Die-Sinking', 'Slotting'];
    case 'Square': return ['Side_Milling', 'Slotting', 'Profiling', 'Facing'];
    case 'Roughing': return ['Side_Milling', 'Slotting', 'Heavy_Cutting'];
    case 'Taper': return ['Die-Sinking', 'Profiling', 'Taper_Side_Milling'];
    case 'Chamfer': return ['Chamfering'];
    default: return ['Side_Milling', 'Slotting'];
  }
}

function calculateCompleteness(d, ol, fl, sd, coat, mat, fc) {
  let score = 0;
  let total = 7;
  if (d) score++;
  if (ol) score++;
  if (fl) score++;
  if (sd) score++;
  if (coat) score++;
  if (mat) score++;
  if (fc) score++;
  return Math.round(score / total * 100) / 100;
}

// Process all rows
csv4G.forEach(processRow);
csvAlu.forEach(processRow);

const newProducts = [...productMap.values()];
console.log('New unique products from CSV:', newProducts.length);

// Merge with existing
const allProducts = [...existingProducts, ...newProducts];
console.log('Total products after merge:', allProducts.length);

// Write output
const outPath = path.join(__dirname, '..', 'data', 'normalized', 'products.json');
fs.writeFileSync(outPath, JSON.stringify(allProducts, null, 2));
console.log('Written to', outPath);

// Summary by brand
const brandCounts = {};
allProducts.forEach(p => {
  brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1;
});
console.log('\nProducts by brand:');
Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).forEach(([brand, count]) => {
  console.log(`  ${brand}: ${count}`);
});

// Summary by series
const seriesCounts = {};
allProducts.forEach(p => {
  seriesCounts[p.seriesName] = (seriesCounts[p.seriesName] || 0) + 1;
});
console.log('\nProducts by series:');
Object.entries(seriesCounts).sort((a, b) => b[1] - a[1]).forEach(([series, count]) => {
  console.log(`  ${series}: ${count}`);
});
