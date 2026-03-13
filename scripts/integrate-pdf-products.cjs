/**
 * Parse ALL products from PDF pages and integrate into products.json
 * Includes seriesIconUrl from YG-1 website (checked existence)
 */
const fs = require('fs');
const path = require('path');

const pages = require('./pdf_pages.json');

// Series with confirmed images on yg1.solutions
const IMAGE_EXISTS = new Set(["CE7659","CE7406","CE7401","CE7412","CE7A63","CGPH02","CGPH01","E2498","E2030","E2406","E2031","E2032","E2412","E2463","E2401","E2509","E2462","E2461","E2750","E2480","CGPH38","E2751","E2749","E2464","E2659","E2411","E2714","E2753","E5D73","E5D71","E5D80","E2752","E2759","E2754","E2756","E2760","E2755","E5D70","E2762","E5D72","E2806","E2768","E5D78","E5D79","E5D74","E2758","E5E88","E5E84","E5E89","EHD84","E5E83","E5E87","EHD85","EHD87","EIE21","EIE24","EIE23","EIE22","EL612","EIE25","EMD88","EIE37","EIE26","EIE38","EMD81","EIE27","EMD83","EMD92","EMD82","EMH78","EMH79","EMH77","ESE94","ESE93","GAC25","GA931","GAA22","GAD33","GAD52","GAB58","GA932","GMG86","GMH62","GMH63","GMG87","GMG30","GMG40","GMG26","GMH60","GMH61","GMH42","GMH64","GNX35","GNX36","GNX01","GNX66","GNX46","GNX61","GNX64","GNX73","GNX67","GNX98","GNX45","GMI41","GNX75","GNX74","GMI47","GNX99","SEM810","SEM813","SEM846","SEMD98","SEM818","SEM838","SEM816","SEM845","SEM811","SEM812","SEM817","SEM819","SEM814","SEME35","SEME58","SEME59","SEME57","SEME56","SEME61","SEME64","SEME66","SEME65","SEME62","SEME60","SEME01","SEMD99","SEME70","SEME36","SEME63","SEME67","SEME71","SEME69","SEME68","SEME72","SEME73","SEME78","SEME81","SEME79","SEME82","SEME95","SG8A37","SG8A47","SG8A45","SG8A46","SG8B89","SG8A60","SEME75","SEME74","SG8A01","SG8A36","SG8A02","SG8B91","SG8A38","XMB110D","XMB260T","XMR110D","XMR260T","ZBC","XMR120C","SG9E76","SG9E77","XMB120C","ZBS","ZRC","ZBT","ZMT","ZMS"]);

const IMAGE_BASE = 'https://www.yg1.solutions/toolselection/data/images/milling/detail/thumb/';

function getImageUrl(series) {
  if (IMAGE_EXISTS.has(series)) return IMAGE_BASE + series + '.jpg';
  return null;
}

// ---- Known series list from PDF index ----
const KNOWN_SERIES = [
  'GNX98','GNX46','GNX99','GNX61','GNX01','GNX64','GNX67','GNX66','GNX35','GNX45','GNX36','GNX73','GNX74','GNX75',
  'SEMD98','SEM846','SEME56','SEME57','SEME58','SEME59','SEME60','SEMD99','SEME61','SEME62','SEME63','SEME01','SEME64','SEME65','SEME66','SEME67','SEME68',
  'SEME35','SEME69','SEME70','SEM845','SEME36','SEME71','SEME72','SEME73','SEME74','SEME75',
  'SG9E76','SG9E77','SEME79','SEME82','SEME78','SEME81','SEME95',
  'ESE93','ESE94',
  'SG8A38','SG8A46','SG8A36','SG8A60','SG8A37','SG8A47','SG8A01','SG8A45','SG8A02','SG8B89','SG8B91',
  'EIE21','EIE22','EIE23','EIE38','EIE24','EIE25','EIE26','EIE27','EIE37',
  'SEM813','SEM838','SEM818','SEM819','SEM810','SEM816','SEM811','SEM817','SEM812','SEM814',
  'EMD88','EMD83','EMD81','EHD84','EMD82','GMI47','GMI41','GMH42','EHD85','EMD92','EHD87',
  'E5D72','GED72','E5D71','GED71','E5D70','GED70','E5D74','GED74','E5E83','GEE83','E5D73','GED73','E5E84','GEE84',
  'E5I44','JAI44','E5I45','JAI45','E5I46','JAI46','E5I49','JAI49',
  'GMI48','GMG86','GMH60','GMG87','GMH61','GMH62','GMH63','GMH64','GMI35','GMI24','GMI25',
  'GMH54','GMH55','GMG40','GMG30','GMG26',
  'EMH77','EMH78','EMH79',
  'E5E88','GEE88','E5E89','GEE89','E5D80','G9D80','GED80','E5D78','G9D78','GED78','E5E87','G9E87','GEE87','E5D79','G9D79','GED79',
  'GA931','GA932','GAC25','GAA22','GAD33','GAB58','GAD52',
  'E2480','EQ480','E2401','EQ401','E2406','EQ406','E2749','E2411','E2412','EQ412','E2659','EQ659','E2750','GB750',
  'E2461','E2462','E2463','E2759','EQ759','E2714','EQ714','E2753','EQ753','E2755','EQ755','E2758','EQ758',
  'EL612','E2464','EQ464','E2509','E2030','E2031','E2032',
  'E2756','EQ756','E2751','EQ751','E2752','EQ752','E2762','EQ762','E2754','EQ754','E2768','EQ768','E2806','E2760','EQ760',
  'CGM3S38','CGM3S46','CGM3S36','CGM3S60','CGM3S37','CGM3S47','CGM3S01','CGM3S45','CGM3S02',
  'CGPH38','CGPH01','CGPH02',
  'CGMG63','CGMG62',
  'CE5G60','CE5G61',
  'CE7401','CE7406','CE7412','CE7659','CE7A63',
  'XMS120C','XMB120C','XMR120C','XMB110D','XMR110D','XMB260T','XMR260T','XMM220T',
  'ZBC','ZBS','ZBT','ZRC','ZMC','ZMS','ZMT','MIXB','MIXR',
  'E5I28','EHI28','E5I29','EHI29','E5I30','EHI30',
  'E5E18','EHE18','E5E19','EHE19','E5E20','EHE20',
  'E5E96','EHE96','E2498',
];

// Sort by length descending so longer matches first
const KNOWN_SERIES_SORTED = [...new Set(KNOWN_SERIES)].sort((a, b) => b.length - a.length);

// Extract series from a product code
function extractSeries(code) {
  for (const s of KNOWN_SERIES_SORTED) {
    if (code.startsWith(s)) return s;
  }
  return null;
}

// Brand mapping
function getBrand(series) {
  if (/^SEME|^SEM8|^SEMD/.test(series)) return '4G MILLS';
  if (/^GNX|^SG8A|^SG8B|^SG9E/.test(series)) return 'E-FORCE';
  if (/^ESE/.test(series)) return 'X5070 S';
  if (/^EIE/.test(series)) return 'G-CUT';
  if (/^EMD|^EHD|^GMI4[178]|^GMH42/.test(series)) return 'SUS-CUT';
  if (/^E5D[7][0-4]|^GED[7][0-4]|^E5E8[34]|^GEE8[34]|^E5I4|^JAI/.test(series)) return 'ALU-CUT';
  if (/^E5D[78][89]|^E5D80|^G9D|^GED[789]|^GEE8[789]|^G9E|^E5E8[789]/.test(series)) return 'WIDE-CUT';
  if (/^GMG86|^GMH6[0-4]|^GMG87|^GMH61|^GMI[23]/.test(series)) return 'V7 PLUS';
  if (/^GMH5[45]|^GMG[234]0|^GMG26/.test(series)) return 'TitaNox Power';
  if (/^EMH/.test(series)) return 'Super Alloy';
  if (/^GA/.test(series)) return 'TANK-POWER';
  if (/^E2[0-9]|^EQ[0-9]|^EL6|^GB7/.test(series)) return 'M42 HSS';
  if (/^CGM3S/.test(series)) return '3S PLUS';
  if (/^CGPH/.test(series)) return 'PH MILLS';
  if (/^CGMG/.test(series)) return 'SUS-PLUS';
  if (/^CE5G/.test(series)) return 'ALU-PLUS';
  if (/^CE7/.test(series)) return 'GENERAL HSS';
  if (/^XM[BSR]|^XMM|^ZB|^ZR|^ZM|^MIX/.test(series)) return 'i-Xmill S';
  if (/^E5E[12]|^EHE|^EHI|^E5I[23]/.test(series)) return 'Chamfer/Rounding';
  return 'YG-1';
}

// Subtype
function getSubtype(name, series) {
  const n = name || '';
  if (/볼|ball/i.test(n)) return 'Ball';
  if (/래디우스|radius|코너\s*R/i.test(n)) return 'Radius';
  if (/라핑|roughing|웨이브/i.test(n)) return 'Roughing';
  if (/테이퍼|taper/i.test(n)) return 'Taper';
  if (/챔퍼|chamfer/i.test(n)) return 'Chamfer';
  if (/코너\s*라운딩|rounding/i.test(n)) return 'Corner Rounding';
  if (/스퀘어|square/i.test(n)) return 'Square';
  return 'Square';
}

function getApplicationShapes(subtype) {
  switch (subtype) {
    case 'Ball': return ['Profiling', 'Die-Sinking', '3D_Contouring'];
    case 'Radius': return ['Side_Milling', 'Profiling', 'Die-Sinking', 'Slotting'];
    case 'Square': return ['Side_Milling', 'Slotting', 'Profiling', 'Facing'];
    case 'Roughing': return ['Side_Milling', 'Slotting', 'Heavy_Cutting'];
    case 'Taper': return ['Die-Sinking', 'Profiling', 'Taper_Side_Milling'];
    case 'Chamfer': return ['Chamfering'];
    case 'Corner Rounding': return ['Corner_Rounding', 'Deburring'];
    default: return ['Side_Milling', 'Slotting'];
  }
}

function calculateCompleteness(d, ol, fl, sd, coat, mat, fc) {
  let score = 0, total = 7;
  if (d) score++;
  if (ol) score++;
  if (fl) score++;
  if (sd) score++;
  if (coat) score++;
  if (mat) score++;
  if (fc) score++;
  return Math.round(score / total * 100) / 100;
}

// Series info from index pages
const seriesInfo = {};
for (let i = 8; i < 21; i++) {
  const lines = pages[i].text.split('\n');
  for (const line of lines) {
    const m = line.match(/(\d+[~&]?\d*)\s*날?\s+([A-Z][A-Z0-9]{3,})\s+(.*?)\s+[\d.]+\s+[\d.]+\s+\d+/);
    if (m) {
      const series = m[2];
      const name = m[3].trim();
      if (!seriesInfo[series]) {
        seriesInfo[series] = { name: m[1] + '날 ' + name };
      }
    }
  }
}
console.log('Series info from index:', Object.keys(seriesInfo).length);

// ---- MAIN PARSING ----
const productMap = new Map();
let currentSeries = null;
let currentFluteCount = null;
let currentHelix = null;
let currentCoating = null;
let currentMaterial = null;
let currentProductName = null;

for (let pageIdx = 20; pageIdx < pages.length - 10; pageIdx++) {
  const text = pages[pageIdx].text;
  const lines = text.split('\n');

  for (const line of lines) {
    // Detect series header: "X날 형상 SERIES시리즈"
    const seriesMatch = line.match(/(\d+[~&]?\d*)\s*날\s+(.*?)\s+([A-Z][A-Z0-9]{3,})\s*시리즈/);
    if (seriesMatch) {
      const fc = parseInt(seriesMatch[1]);
      currentFluteCount = fc || null;
      currentProductName = seriesMatch[1] + '날 ' + seriesMatch[2].trim();
      currentSeries = seriesMatch[3];
    }

    // Detect material/coating
    if (/CARBIDE/.test(line)) currentMaterial = 'Carbide';
    if (/HSS/.test(line) && /Co8?\b/.test(line)) currentMaterial = 'HSS-Co (M42)';

    const helixMatch = line.match(/(\d+)[°˚Û]\s*/);
    if (helixMatch) {
      const h = parseInt(helixMatch[1]);
      if (h >= 20 && h <= 60) currentHelix = h;
    }

    if (/Y코팅|Y-?Coat/i.test(line)) currentCoating = 'Y-Coating';
    else if (/TiAlN/i.test(line)) currentCoating = 'TiAlN';
    else if (/TiCN/i.test(line)) currentCoating = 'TiCN';
    else if (/DLC/i.test(line)) currentCoating = 'DLC';
    else if (/Blue\s*Coat/i.test(line)) currentCoating = 'Blue Coating';

    // Parse product rows using regex on full line
    // Formats:
    //   "GA931 010N \t1.0 \t2.5 \t55 \t6"
    //   "E2401 010K \tEQ401 010K \t1.0 \t2.5 \t55 \t6"
    //   "EIE21 001 \t0.1 \t- \t0.2 \t45 \t4"
    //   "CE7401 010 \t1.0 \t2.5 \t55 \t6"
    //   "CGM3S38 001 \t0.1 \t0.2 \t40 \t4"

    // Try to find a known series at start of line (ignoring whitespace)
    const trimmedLine = line.trim();
    let matchedSeries = null;
    for (const s of KNOWN_SERIES_SORTED) {
      if (trimmedLine.startsWith(s)) {
        matchedSeries = s;
        break;
      }
    }
    if (!matchedSeries) continue;

    // Skip EQ/GB/G9D duplicate lines (keep E2xxx, E5Dxxx primary)
    if (/^EQ|^GB7/.test(matchedSeries)) continue;

    // Extract EDP code and dimensions using TAB as separator
    // The line is: "EDP_CODE \t dim1 \t dim2 \t dim3 \t dim4"
    // EDP code may contain spaces: "GNX61 002 002 015" or "E2401 010K"
    const tabParts = trimmedLine.split('\t').map(s => s.trim()).filter(Boolean);
    if (tabParts.length < 2) continue;

    // First tab-part should start with our matched series
    const edpToken = tabParts[0];
    if (!edpToken.startsWith(matchedSeries)) continue;

    // Extract just the EDP portion (remove spaces, keep suffix)
    const rawCode = edpToken.replace(/\s+/g, '');

    // The EDP code after series should be digits + optional K/N/S/4S
    const afterSeries = rawCode.substring(matchedSeries.length);
    if (!/^\d{2,}[KNS]?$/.test(afterSeries) && !/^\d{2,}4S$/.test(afterSeries)) continue;

    // Collect dimension numbers from remaining tab parts (skip any secondary codes like EQ401)
    const dimParts = tabParts.slice(1).filter(p => !/^[A-Z]/.test(p));
    const nums = dimParts.join(' ').match(/\d+\.?\d*/g);

    if (!nums || nums.length < 3) continue;

    // Parse dimensions - find diameter, fluteLength, overallLength, shankDiameter
    // Sometimes first number is diameter, sometimes line has "-" for missing values
    const allNums = nums.map(n => parseFloat(n));

    let diameter, fluteLength, overallLength, shankDiameter;

    if (allNums.length >= 4) {
      diameter = allNums[0];
      fluteLength = allNums[1];
      overallLength = allNums[2];
      shankDiameter = allNums[3];
    } else {
      diameter = allNums[0];
      fluteLength = allNums[1];
      overallLength = allNums[2];
      shankDiameter = null;
    }

    // Sanity checks
    if (diameter <= 0 || diameter > 100) continue;
    if (overallLength <= 0 || overallLength > 500) continue;
    if (overallLength < diameter) continue;
    if (shankDiameter && shankDiameter > overallLength) continue;
    // fluteLength should be <= overallLength
    if (fluteLength > overallLength) continue;

    if (productMap.has(rawCode)) continue;

    const series = matchedSeries;
    const subtype = getSubtype(currentProductName || seriesInfo[series]?.name || '', series);
    const brand = getBrand(series);

    const product = {
      id: `edp_${rawCode}`,
      manufacturer: 'YG-1',
      brand,
      sourcePriority: 3,
      sourceType: 'catalog-pdf',
      rawSourceFile: 'YG-1_endmill_catalog.pdf',
      rawSourceSheet: null,
      normalizedCode: rawCode,
      displayCode: rawCode,
      seriesName: series,
      productName: currentProductName ? `${currentProductName} ${series} 시리즈` : (seriesInfo[series]?.name || series) + ' 시리즈',
      toolType: 'Solid',
      toolSubtype: subtype,
      diameterMm: diameter,
      diameterInch: Math.round(diameter / 25.4 * 10000) / 10000,
      fluteCount: currentFluteCount,
      coating: currentCoating,
      toolMaterial: currentMaterial || 'Carbide',
      shankDiameterMm: shankDiameter,
      lengthOfCutMm: fluteLength,
      overallLengthMm: overallLength,
      helixAngleDeg: currentHelix,
      ballRadiusMm: subtype === 'Ball' && diameter ? diameter / 2 : null,
      taperAngleDeg: null,
      coolantHole: null,
      applicationShapes: getApplicationShapes(subtype),
      materialTags: [],
      region: 'KOREA',
      description: seriesInfo[series]?.name || currentProductName || series,
      featureText: seriesInfo[series]?.name || currentProductName || series,
      seriesIconUrl: getImageUrl(series),
      sourceConfidence: 'medium',
      dataCompletenessScore: calculateCompleteness(diameter, overallLength, fluteLength, shankDiameter, currentCoating, currentMaterial, currentFluteCount),
      evidenceRefs: [rawCode]
    };

    productMap.set(rawCode, product);
  }
}

const pdfProducts = [...productMap.values()];
console.log('Products parsed from PDF:', pdfProducts.length);

// Load existing (restore original first - re-read from CSV integration)
// We need to undo the previous broken run. Let's check if existing has catalog-pdf entries
const existingPath = path.join(__dirname, '..', 'data', 'normalized', 'products.json');
let existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));

// Remove previous PDF-sourced products (from broken run)
const beforeCount = existing.length;
existing = existing.filter(p => p.sourceType !== 'catalog-pdf');
console.log('Removed previous PDF products:', beforeCount - existing.length);
console.log('Existing products (CSV+smart):', existing.length);

// Add seriesIconUrl to existing products
let updatedExisting = 0;
existing.forEach(p => {
  if (p.seriesName) {
    // Try direct match
    let series = p.seriesName.replace(/\s*\/.*/, '').replace(/\s+시리즈$/, '').trim();
    const url = getImageUrl(series);
    if (url) {
      p.seriesIconUrl = url;
      updatedExisting++;
    } else {
      p.seriesIconUrl = null;
    }
  }
});
console.log('Existing products with image URL:', updatedExisting);

// Deduplicate
const existingIds = new Set(existing.map(p => p.id));
const existingCodes = new Set(existing.map(p => p.normalizedCode));
const newProducts = pdfProducts.filter(p => !existingIds.has(p.id) && !existingCodes.has(p.normalizedCode));
console.log('New unique products from PDF:', newProducts.length);

// Merge
const allProducts = [...existing, ...newProducts];
console.log('Total products after merge:', allProducts.length);

// Write
fs.writeFileSync(existingPath, JSON.stringify(allProducts, null, 2));
console.log('Written to', existingPath);

// Summary
const brandCounts = {};
const seriesCounts = {};
const sourceCounts = {};
let withImage = 0, withoutImage = 0;

allProducts.forEach(p => {
  brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1;
  seriesCounts[p.seriesName] = (seriesCounts[p.seriesName] || 0) + 1;
  sourceCounts[p.sourceType] = (sourceCounts[p.sourceType] || 0) + 1;
  if (p.seriesIconUrl) withImage++; else withoutImage++;
});

console.log('\n=== BY BRAND ===');
Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

console.log('\n=== BY SOURCE ===');
Object.entries(sourceCounts).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

console.log('\n=== IMAGES ===');
console.log(`  With image: ${withImage}`);
console.log(`  Without image (NA): ${withoutImage}`);

console.log('\n=== BY SERIES (top 40) ===');
Object.entries(seriesCounts).sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

console.log('\nTotal unique series:', Object.keys(seriesCounts).length);
