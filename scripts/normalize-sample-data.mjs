/**
 * YG-1 AI Assistant — Sample Data Normalizer
 *
 * Reads raw Excel/CSV files → writes normalized JSON to data/normalized/
 * Run once before starting the app (or when data changes):
 *   node scripts/normalize-sample-data.mjs
 *
 * Data priority:
 *   1. YG1 Smart Catalog (prod_edp_option_milling + prod_series)
 *   2. YG1 Catalog CSV (evidence/notes)
 *   3. Inventory (global + dept)
 *   4. Lead time (filtered to our EDPs)
 *   5. Harvey Tool CSV (competitor reference only)
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'normalized');
const BASE = 'C:/Users/kuksh/Downloads/YG1_sample_extracted';
const CSV_DIR = 'C:/Users/kuksh/Downloads';

fs.mkdirSync(OUT, { recursive: true });

// ── helpers ──────────────────────────────────────────────────
function normalizeCode(code) {
  if (!code) return '';
  return String(code).replace(/[\s\-]/g, '').toUpperCase();
}
function stripHtml(html) {
  if (!html) return null;
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
}
function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? null : n;
}
function completeness(obj, keys) {
  const filled = keys.filter(k => obj[k] !== null && obj[k] !== undefined).length;
  return Math.round((filled / keys.length) * 100) / 100;
}
function readXlsx(filename, sheetName) {
  const files = fs.readdirSync(BASE);
  const f = files.find(fn => fn.includes(filename));
  if (!f) { console.warn(`  ⚠ File not found matching: ${filename}`); return []; }
  const wb = XLSX.readFile(path.join(BASE, f));
  const ws = wb.Sheets[sheetName];
  if (!ws) { console.warn(`  ⚠ Sheet not found: ${sheetName} in ${f}`); return []; }
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
}
function readXlsxAllSheets(filename) {
  const files = fs.readdirSync(BASE);
  const f = files.find(fn => fn.includes(filename));
  if (!f) return null;
  return XLSX.readFile(path.join(BASE, f));
}
function readCsv(filename) {
  const fpath = path.join(CSV_DIR, filename);
  if (!fs.existsSync(fpath)) { console.warn(`  ⚠ CSV not found: ${fpath}`); return []; }
  const wb = XLSX.readFile(fpath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: null });
}

// ── 1. Material Taxonomy ──────────────────────────────────────
console.log('\n[1/6] Material Taxonomy...');
const wpRows = readXlsx('STR_milling', 'prod_work_piece_by_category #소재');
const headers_wp = wpRows[0];
const materialTaxonomy = [];

for (let i = 1; i < wpRows.length; i++) {
  const row = wpRows[i];
  const obj = {};
  headers_wp.forEach((h, ci) => { obj[h] = row[ci]; });

  const tag = String(obj.tag_name || '').trim();
  const nameEn = String(obj.name || '').trim();
  const nameKo = stripHtml(obj.name_kor) || nameEn;

  // Build aliases from all locale names + common Korean variants
  const aliases = [nameEn, nameKo]
    .concat([
      obj.name_deu, obj.name_jpn, obj.name_chn,
      obj.name_pol, obj.name_prt, obj.name_rus,
      obj.name_ita, obj.name_fra,
    ].filter(Boolean).map(v => stripHtml(v)))
    .filter(Boolean);

  // Add common Korean aliases per tag
  const tagAliases = {
    P: ['탄소강', '합금강', '구조강', '일반강', '프리하든', 'carbon steel', 'alloy steel'],
    M: ['스테인리스', '스테인레스', 'STS', 'sus', '스텐', '오스테나이트', 'stainless'],
    K: ['주철', '회주철', 'cast iron', 'GC', '회색주철'],
    N: ['알루미늄', '알루', 'AL', 'alu', '구리', '비철', '비철금속', 'copper', 'graphite', '그라파이트', 'CFRP', 'acrylic', '아크릴'],
    S: ['티타늄', 'Ti', 'Inconel', '인코넬', '내열합금', 'heat resistant', 'superalloy'],
    H: ['고경도', '경화강', '담금질강', 'hardened', 'HRC', 'hard steel'],
  };

  const extraAliases = tagAliases[tag] || [];
  const allAliases = [...new Set([...aliases, ...extraAliases])].filter(Boolean);

  const locales = {};
  headers_wp.forEach((h, ci) => {
    if (h && h.startsWith('name_')) locales[h] = stripHtml(row[ci]);
  });

  materialTaxonomy.push({
    tag,
    displayNameKo: nameKo,
    displayNameEn: nameEn,
    aliases: allAliases,
    rawNamesByLocale: locales,
  });
}

fs.writeFileSync(path.join(OUT, 'material-taxonomy.json'), JSON.stringify(materialTaxonomy, null, 2));
console.log(`  ✓ ${materialTaxonomy.length} material tags`);

// ── 2. Products (Smart Catalog) ───────────────────────────────
console.log('\n[2/6] Products (Smart Catalog)...');

const seriesRows = readXlsx('STR_milling', 'prod_series #시리즈 정보');
const headers_series = seriesRows[0];
const seriesMap = new Map();
for (let i = 1; i < seriesRows.length; i++) {
  const row = seriesRows[i];
  const obj = {};
  headers_series.forEach((h, ci) => { obj[h] = row[ci]; });
  seriesMap.set(Number(obj.idx), obj);
}

const edpRows = readXlsx('STR_milling', 'prod_edp_option_milling #상세');
const headers_edp = edpRows[0];
const products = [];

// Build work_piece lookup: idx → tag
const wpTagMap = new Map();
for (const mat of materialTaxonomy) {
  // we'll use tag directly; build a reverse idx lookup
}
for (let i = 1; i < wpRows.length; i++) {
  const row = wpRows[i];
  const obj = {};
  headers_wp.forEach((h, ci) => { obj[h] = row[ci]; });
  if (obj.idx) wpTagMap.set(Number(obj.idx), String(obj.tag_name || ''));
}

const KEY_FIELDS = ['diameterMm', 'fluteCount', 'coating', 'toolMaterial', 'lengthOfCutMm', 'overallLengthMm'];

for (let i = 1; i < edpRows.length; i++) {
  const row = edpRows[i];
  const obj = {};
  headers_edp.forEach((h, ci) => { obj[h] = row[ci]; });

  if (obj.flag_del === 'Y') continue; // deleted

  const edp = String(obj.edp_no || '').trim();
  if (!edp) continue;

  const seriesIdx = Number(obj.series_idx);
  const series = seriesMap.get(seriesIdx) || {};

  // Material tags from series.work_piece_idx (comma-separated idx list)
  const matTags = [];
  if (series.work_piece_idx) {
    String(series.work_piece_idx).split(',').forEach(idxStr => {
      const tag = wpTagMap.get(Number(idxStr.trim()));
      if (tag) matTags.push(tag);
    });
  }

  // Application shapes from series.application_shape
  const appShapes = series.application_shape
    ? String(series.application_shape).split(',').map(s => s.trim()).filter(Boolean)
    : [];

  // Detect subtype from series
  const edgeShape = String(series.cutting_Edge_shape || '').trim();
  const subtype = edgeShape || null;

  // Coolant
  const coolant = obj.option_milling_CoolantHole;
  const hasCoolant = coolant === 'Y' || coolant === true || coolant === 1;

  const diamMm = toNum(obj.option_milling_OutsideDia);
  const fluteCount = toNum(obj.option_milling_NumberofFlute);

  const product = {
    id: `edp_${normalizeCode(edp)}`,
    manufacturer: 'YG-1',
    brand: String(series.brand_name || obj.brand_name || 'YG-1').trim(),
    sourcePriority: 1,
    sourceType: 'smart-catalog',
    rawSourceFile: 'YG1_STR_milling_info.xlsx',
    rawSourceSheet: 'prod_edp_option_milling #상세',

    normalizedCode: normalizeCode(edp),
    displayCode: edp,
    seriesName: String(obj.series_name || series.series_name || '').trim() || null,
    productName: stripHtml(series.description),

    toolType: String(series.tool_type || '').trim() || null,
    toolSubtype: subtype,
    diameterMm: diamMm,
    diameterInch: diamMm ? Math.round((diamMm / 25.4) * 10000) / 10000 : null,
    fluteCount: fluteCount ? Math.round(fluteCount) : null,
    coating: String(obj.option_milling_Coating || '').trim() || null,
    toolMaterial: String(obj.option_milling_ToolMaterial || '').trim() || null,
    shankDiameterMm: toNum(obj.option_milling_ShankDia),
    lengthOfCutMm: toNum(obj.option_milling_LengthofCut),
    overallLengthMm: toNum(obj.option_milling_OverAllLength),
    helixAngleDeg: toNum(obj.option_milling_HelixAngle),
    ballRadiusMm: toNum(obj.option_milling_RadiusofBallNose),
    taperAngleDeg: toNum(obj.option_milling_TaperAngle),
    coolantHole: coolant !== null ? hasCoolant : null,

    applicationShapes: appShapes,
    materialTags: matTags,

    region: String(obj.country || '').trim() || null,
    description: stripHtml(series.description),
    featureText: stripHtml(series.feature),
    seriesIconUrl: series.file1 ? String(series.file1) : null,

    sourceConfidence: 'high',
    dataCompletenessScore: 0,
    evidenceRefs: [edp],
  };

  // Compute completeness
  const tempObj = { diameterMm: product.diameterMm, fluteCount: product.fluteCount, coating: product.coating, toolMaterial: product.toolMaterial, lengthOfCutMm: product.lengthOfCutMm, overallLengthMm: product.overallLengthMm };
  product.dataCompletenessScore = completeness(tempObj, KEY_FIELDS);

  products.push(product);
}

// ── 3. Add YG1 CSV products (evidence source, supplement) ────
const yg1Csv = readCsv('yg1 카탈로그 추출 샘플.csv');
const evidenceRecords = [];
const csvEdpSet = new Set(products.map(p => p.normalizedCode));

for (const row of yg1Csv) {
  const code = String(row.product_code || '').trim();
  if (!code) continue;
  const norm = normalizeCode(code);

  evidenceRecords.push({
    productCode: code,
    normalizedCode: norm,
    pdfFile: row.pdf_file || null,
    referencePages: row.reference_pages ? String(row.reference_pages).split(',').map(s => s.trim()) : [],
    dataPage: row.data_page ? String(row.data_page) : null,
    pageTitle: row.page_title || null,
    imagePath: row.image_path || null,
    markdownPath: row.markdown_path || null,
    notes: row.notes || null,
    confidence: row.confidence || null,
  });

  // If this EDP is not in Smart Catalog, add as priority-2 product
  if (!csvEdpSet.has(norm)) {
    const diamMm = toNum(row.cutting_diameter_mm);
    const fluteCount = toNum(row.flute_count);
    const product = {
      id: `csv_${norm}`,
      manufacturer: 'YG-1',
      brand: row.brand_name || 'YG-1',
      sourcePriority: 2,
      sourceType: 'catalog-csv',
      rawSourceFile: 'yg1 카탈로그 추출 샘플.csv',
      rawSourceSheet: null,
      normalizedCode: norm,
      displayCode: code,
      seriesName: row.series_name || null,
      productName: row.product_name || null,
      toolType: row.tool_type || null,
      toolSubtype: row.tool_subtype || null,
      diameterMm: diamMm,
      diameterInch: diamMm ? Math.round((diamMm / 25.4) * 10000) / 10000 : null,
      fluteCount: fluteCount ? Math.round(fluteCount) : null,
      coating: row.coating || null,
      toolMaterial: row.tool_material || null,
      shankDiameterMm: toNum(row.shank_diameter_mm),
      lengthOfCutMm: toNum(row.flute_length_mm),
      overallLengthMm: toNum(row.overall_length_mm),
      helixAngleDeg: toNum(row.helix_angle_deg),
      ballRadiusMm: null,
      taperAngleDeg: null,
      coolantHole: row.coolant_type ? String(row.coolant_type).toLowerCase().includes('coolant') : null,
      applicationShapes: row.application_type ? [row.application_type] : [],
      materialTags: row.iso_group ? String(row.iso_group).split(',').map(s => s.trim()).filter(Boolean) : [],
      region: null,
      description: row.product_name || null,
      featureText: row.notes || null,
      seriesIconUrl: row.image_path || null,
      sourceConfidence: row.confidence || 'medium',
      dataCompletenessScore: 0,
      evidenceRefs: [code],
    };
    const tmp = { diameterMm: product.diameterMm, fluteCount: product.fluteCount, coating: product.coating, toolMaterial: product.toolMaterial, lengthOfCutMm: product.lengthOfCutMm, overallLengthMm: product.overallLengthMm };
    product.dataCompletenessScore = completeness(tmp, KEY_FIELDS);
    products.push(product);
    csvEdpSet.add(norm);
  }
}

fs.writeFileSync(path.join(OUT, 'products.json'), JSON.stringify(products, null, 2));
fs.writeFileSync(path.join(OUT, 'product-evidence.json'), JSON.stringify(evidenceRecords, null, 2));
console.log(`  ✓ ${products.length} products (${products.filter(p => p.sourcePriority === 1).length} Smart Catalog, ${products.filter(p => p.sourcePriority === 2).length} CSV)`);
console.log(`  ✓ ${evidenceRecords.length} evidence records`);

// ── 4. Inventory ──────────────────────────────────────────────
console.log('\n[4/6] Inventory...');
const inventorySnapshots = [];
const ourEdpSet = new Set(products.map(p => p.normalizedCode));

function parseInventoryRows(rawRows, headerRowIdx, dateRowIdx, sourceFile) {
  const headerRow = rawRows[headerRowIdx];
  const dateRow = rawRows[dateRowIdx] || [];
  const warehouseCols = [];

  for (let c = 6; c < headerRow.length; c++) {
    const wh = headerRow[c];
    const dt = dateRow[c];
    if (wh) {
      warehouseCols.push({
        colIdx: c,
        warehouse: String(wh).trim(),
        date: dt ? String(dt).trim() : null,
      });
    }
  }

  for (let r = headerRowIdx + 2; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!row || !row[0]) continue;
    const edp = String(row[0]).trim();
    if (!edp || edp === 'Material') continue;

    const normEdp = normalizeCode(edp);
    const price = toNum(row[3]);
    const currency = row[4] ? String(row[4]).trim() : null;
    const unit = row[5] ? String(row[5]).trim() : null;
    const description = row[1] ? String(row[1]).trim() : null;
    const spec = row[2] ? String(row[2]).trim() : null;

    for (const { colIdx, warehouse, date } of warehouseCols) {
      const qty = toNum(row[colIdx]);
      // Only add if EDP is in our product set OR we want all inventory
      inventorySnapshots.push({
        edp,
        normalizedEdp: normEdp,
        description,
        spec,
        warehouseOrRegion: warehouse,
        quantity: qty,
        snapshotDate: date,
        price: price,
        currency,
        unit,
        sourceFile,
      });
    }
  }
}

// Global inventory (header row 0, date row 1, data from row 2)
const globalInvFile = fs.readdirSync(BASE).find(f => f.toLowerCase().includes('global_inventory') || f.includes('inventory'));
if (globalInvFile) {
  const wb = XLSX.readFile(path.join(BASE, globalInvFile));
  const ws = wb.Sheets['Sheet1'];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  parseInventoryRows(raw, 0, 1, 'global_inventory.xlsx');
}

// Dept inventory (header at row 30, date at row 31)
const deptFile = fs.readdirSync(BASE).find(f => f.includes('YG1') && !f.includes('STR'));
if (deptFile) {
  const wb2 = XLSX.readFile(path.join(BASE, deptFile));
  const ws2 = wb2.Sheets['재고데이터'];
  if (ws2) {
    const raw2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: null });
    // find header row dynamically
    let hdr = -1;
    for (let i = 0; i < raw2.length; i++) {
      if (raw2[i] && raw2[i][0] === 'Material') { hdr = i; break; }
    }
    if (hdr >= 0) parseInventoryRows(raw2, hdr, hdr + 1, '부서별_재고데이터.xlsx');
  }
}

fs.writeFileSync(path.join(OUT, 'inventory.json'), JSON.stringify(inventorySnapshots, null, 2));
console.log(`  ✓ ${inventorySnapshots.length} inventory records (${[...new Set(inventorySnapshots.map(i => i.normalizedEdp))].length} unique EDPs)`);

// ── 5. Lead Times (filtered to our product EDPs) ──────────────
console.log('\n[5/6] Lead Times (streaming large file)...');
const leadTimes = [];

if (deptFile) {
  const wb3 = XLSX.readFile(path.join(BASE, deptFile));
  const ws3 = wb3.Sheets['EDP별표준납기'];
  if (ws3) {
    const raw3 = XLSX.utils.sheet_to_json(ws3, { header: 1, defval: null });
    // Find actual data start (skip title + empty rows)
    // Format: [EDP, Plant, LeadTimeDays]
    // Find header row with "Plant" in col1
    let dataStart = 1;
    for (let i = 0; i < Math.min(100, raw3.length); i++) {
      if (raw3[i] && String(raw3[i][1] || '').trim() === 'Plant') {
        dataStart = i + 1;
        break;
      }
      // or start where actual EDP data appears
      if (raw3[i] && raw3[i][0] && String(raw3[i][0]).match(/^[A-Z]/)) {
        dataStart = i;
        break;
      }
    }

    let processed = 0;
    for (let i = dataStart; i < raw3.length; i++) {
      const row = raw3[i];
      if (!row || !row[0]) continue;
      const edp = String(row[0]).trim();
      const plant = String(row[1] || '').trim();
      const days = toNum(row[2]);

      if (!edp || edp === 'EDP' || plant === 'Plant') continue;

      // Keep ALL lead times (not just our 100 EDPs) — they are future-useful
      // but for initial load, only keep if EDP matches our products
      const normEdp = normalizeCode(edp);
      if (ourEdpSet.has(normEdp) || products.some(p => p.normalizedCode === normEdp)) {
        leadTimes.push({ edp, normalizedEdp: normEdp, plant, leadTimeDays: days });
        processed++;
      }
    }
    console.log(`  ✓ ${leadTimes.length} lead time records for our product EDPs`);
  }
}

fs.writeFileSync(path.join(OUT, 'lead-times.json'), JSON.stringify(leadTimes, null, 2));

// ── 6. Harvey Tool Competitor ─────────────────────────────────
console.log('\n[6/6] Harvey Tool (competitor)...');
const harveyRows = readCsv('harveytool 카탈로그 추출 샘플.csv');
const competitors = [];

for (const row of harveyRows) {
  const code = String(row.product_code || '').trim();
  if (!code) continue;
  const norm = normalizeCode(code);

  // Parse diameter: handle "1.5x", "3x", etc. → just extract numeric part
  let diamMm = toNum(row.cutting_diameter_mm);
  if (!diamMm && row.cutting_diameter_mm) {
    const match = String(row.cutting_diameter_mm).match(/[\d.]+/);
    if (match) {
      // Harvey uses fractional inches (1.5 = 1.5mm if it's already mm, or inches?)
      // From context "1.5x" looks like a ratio, so treat as null
      diamMm = null;
    }
  }

  const fluteCount = toNum(row.flute_count);

  // Coating: Harvey has semicolon-separated options
  const coatings = row.coating
    ? String(row.coating).split(';').map(s => s.trim()).filter(Boolean)
    : [];

  competitors.push({
    id: `harvey_${norm}`,
    manufacturer: 'Harvey Tool',
    brand: 'Harvey Tool',
    sourcePriority: 4,
    sourceType: 'competitor',
    rawSourceFile: 'harveytool 카탈로그 추출 샘플.csv',
    rawSourceSheet: null,
    normalizedCode: norm,
    displayCode: code,
    seriesName: row.series_name || null,
    productName: row.product_name || null,
    toolType: row.tool_type || null,
    toolSubtype: row.tool_subtype || null,
    diameterMm: diamMm,
    diameterInch: null,
    fluteCount: fluteCount ? Math.round(fluteCount) : null,
    coating: coatings[0] || null,   // primary coating option
    coatingOptions: coatings,
    toolMaterial: row.tool_material || null,
    shankDiameterMm: toNum(row.shank_diameter_mm),
    lengthOfCutMm: toNum(row.flute_length_mm),
    overallLengthMm: toNum(row.overall_length_mm),
    helixAngleDeg: null,
    ballRadiusMm: null,
    taperAngleDeg: null,
    coolantHole: null,
    applicationShapes: row.application_type ? [row.application_type] : [],
    materialTags: row.iso_group ? String(row.iso_group).split(',').map(s => s.trim()).filter(Boolean) : [],
    region: null,
    description: row.product_name || null,
    featureText: row.notes || null,
    seriesIconUrl: null,
    sourceConfidence: row.confidence || 'medium',
    dataCompletenessScore: completeness(
      { diameterMm: diamMm, fluteCount, coating: coatings[0] || null, toolMaterial: row.tool_material || null, lengthOfCutMm: null, overallLengthMm: null },
      KEY_FIELDS
    ),
    evidenceRefs: [code],
    pdfFile: row.pdf_file || null,
  });
}

fs.writeFileSync(path.join(OUT, 'competitors.json'), JSON.stringify(competitors, null, 2));
console.log(`  ✓ ${competitors.length} Harvey Tool competitor products`);

// ── Summary ───────────────────────────────────────────────────
console.log('\n✅ Normalization complete!');
console.log(`   Output: ${OUT}`);
console.log('   Files:');
fs.readdirSync(OUT).forEach(f => {
  const size = fs.statSync(path.join(OUT, f)).size;
  console.log(`     ${f} (${Math.round(size / 1024)} KB)`);
});
