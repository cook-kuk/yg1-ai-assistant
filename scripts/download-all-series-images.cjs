/**
 * Download ALL series thumbnail images from YG-1 website
 * Queries DB for all distinct series names, then downloads from yg1.solutions
 * Saves to public/images/series/{SERIES}.jpg
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE_URLS = [
  'https://www.yg1.solutions/toolselection/data/images/milling/detail/thumb/',
  'https://www.yg1.solutions/toolselection/data/images/holemaking/detail/thumb/',
  'https://www.yg1.solutions/toolselection/data/images/threading/detail/thumb/',
  'https://www.yg1.solutions/toolselection/data/images/tooling/detail/thumb/',
];
const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'series');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function downloadOne(series, baseUrl) {
  return new Promise((resolve) => {
    const url = baseUrl + encodeURIComponent(series) + '.jpg';
    https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 500) { resolve(null); return; } // skip tiny/empty files
        resolve(buf);
      });
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

async function tryAllUrls(series) {
  const outPath = path.join(OUT_DIR, series + '.jpg');
  if (fs.existsSync(outPath)) return 'skip';

  for (const baseUrl of BASE_URLS) {
    const buf = await downloadOne(series, baseUrl);
    if (buf) {
      fs.writeFileSync(outPath, buf);
      return 'ok';
    }
  }
  return 'fail';
}

async function getSeriesFromDB() {
  const connStr = process.env.DATABASE_URL || 'postgresql://smart_catalog:smart_catalog@20.119.98.136:5432/smart_catalog';
  const pool = new Pool({ connectionString: connStr });
  try {
    const r = await pool.query(
      "SELECT DISTINCT edp_series_name FROM catalog_app.product_recommendation_mv WHERE edp_series_name IS NOT NULL AND edp_series_name != '' ORDER BY edp_series_name"
    );
    return r.rows.map(row => row.edp_series_name.trim());
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log('Querying DB for all series...');
  const allSeries = await getSeriesFromDB();
  console.log(`Found ${allSeries.length} series in DB`);

  // Filter to series names that look like valid image candidates
  // (skip Insert types, tooling systems, accessories, etc.)
  const skipPatterns = [/insert$/i, /^accessory$/i, /^nut$/i, /^tooling/i, /^straight/i, /^din/i, /^jis/i, /^ansi/i, /^iso/i, /^nc-/i, /^cbt/i, /^bridgeport/i];
  const candidates = allSeries.filter(s => !skipPatterns.some(p => p.test(s)));
  console.log(`${candidates.length} candidates after filtering (skipped ${allSeries.length - candidates.length} non-product series)`);

  let ok = 0, fail = 0, skip = 0;
  const failed = [];

  // Batch of 10
  for (let i = 0; i < candidates.length; i += 10) {
    const batch = candidates.slice(i, i + 10);
    const results = await Promise.all(batch.map(async (s) => {
      const status = await tryAllUrls(s);
      return { series: s, status };
    }));

    results.forEach(r => {
      if (r.status === 'ok') { ok++; process.stdout.write('.'); }
      else if (r.status === 'skip') { skip++; }
      else { fail++; failed.push(r.series); }
    });

    // Progress every 100
    if ((i + 10) % 100 === 0) {
      process.stdout.write(` [${i + 10}/${candidates.length}]\n`);
    }
  }

  const totalFiles = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.jpg')).length;

  console.log('\n\n=== Download Complete ===');
  console.log(`  New downloads: ${ok}`);
  console.log(`  Already existed: ${skip}`);
  console.log(`  Not found: ${fail}`);
  console.log(`  Total image files: ${totalFiles}`);
  console.log(`  DB series total: ${allSeries.length}`);

  if (failed.length > 0 && failed.length <= 50) {
    console.log(`\n  Failed series (sample): ${failed.slice(0, 50).join(', ')}`);
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
