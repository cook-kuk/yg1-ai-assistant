/**
 * Download all series thumbnail images from YG-1 website
 * Saves to public/images/series/{SERIES}.jpg
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const IMAGE_EXISTS = ["CE7659","CE7406","CE7401","CE7412","CE7A63","CGPH02","CGPH01","E2498","E2030","E2406","E2031","E2032","E2412","E2463","E2401","E2509","E2462","E2461","E2750","E2480","CGPH38","E2751","E2749","E2464","E2659","E2411","E2714","E2753","E5D73","E5D71","E5D80","E2752","E2759","E2754","E2756","E2760","E2755","E5D70","E2762","E5D72","E2806","E2768","E5D78","E5D79","E5D74","E2758","E5E88","E5E84","E5E89","EHD84","E5E83","E5E87","EHD85","EHD87","EIE21","EIE24","EIE23","EIE22","EL612","EIE25","EMD88","EIE37","EIE26","EIE38","EMD81","EIE27","EMD83","EMD92","EMD82","EMH78","EMH79","EMH77","ESE94","ESE93","GAC25","GA931","GAA22","GAD33","GAD52","GAB58","GA932","GMG86","GMH62","GMH63","GMG87","GMG30","GMG40","GMG26","GMH60","GMH61","GMH42","GMH64","GNX35","GNX36","GNX01","GNX66","GNX46","GNX61","GNX64","GNX73","GNX67","GNX98","GNX45","GMI41","GNX75","GNX74","GMI47","GNX99","SEM810","SEM813","SEM846","SEMD98","SEM818","SEM838","SEM816","SEM845","SEM811","SEM812","SEM817","SEM819","SEM814","SEME35","SEME58","SEME59","SEME57","SEME56","SEME61","SEME64","SEME66","SEME65","SEME62","SEME60","SEME01","SEMD99","SEME70","SEME36","SEME63","SEME67","SEME71","SEME69","SEME68","SEME72","SEME73","SEME78","SEME81","SEME79","SEME82","SEME95","SG8A37","SG8A47","SG8A45","SG8A46","SG8B89","SG8A60","SEME75","SEME74","SG8A01","SG8A36","SG8A02","SG8B91","SG8A38","XMB110D","XMB260T","XMR110D","XMR260T","ZBC","XMR120C","SG9E76","SG9E77","XMB120C","ZBS","ZRC","ZBT","ZMT","ZMS"];

const BASE_URL = 'https://www.yg1.solutions/toolselection/data/images/milling/detail/thumb/';
const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'series');

// Ensure output dir exists
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function downloadOne(series) {
  return new Promise((resolve) => {
    const url = BASE_URL + series + '.jpg';
    const outPath = path.join(OUT_DIR, series + '.jpg');

    // Skip if already downloaded
    if (fs.existsSync(outPath)) {
      resolve({ series, status: 'skip' });
      return;
    }

    https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode !== 200) {
        resolve({ series, status: 'fail', code: res.statusCode });
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        fs.writeFileSync(outPath, Buffer.concat(chunks));
        resolve({ series, status: 'ok', size: Buffer.concat(chunks).length });
      });
      res.on('error', () => resolve({ series, status: 'fail' }));
    }).on('error', () => resolve({ series, status: 'fail' }));
  });
}

async function main() {
  console.log('Downloading', IMAGE_EXISTS.length, 'series images...');
  let ok = 0, fail = 0, skip = 0;

  // Batch of 10
  for (let i = 0; i < IMAGE_EXISTS.length; i += 10) {
    const batch = IMAGE_EXISTS.slice(i, i + 10);
    const results = await Promise.all(batch.map(downloadOne));
    results.forEach(r => {
      if (r.status === 'ok') { ok++; process.stdout.write('.'); }
      else if (r.status === 'skip') { skip++; process.stdout.write('s'); }
      else { fail++; process.stdout.write('x'); }
    });
  }

  console.log('\n\nDone!');
  console.log(`  Downloaded: ${ok}`);
  console.log(`  Skipped (exists): ${skip}`);
  console.log(`  Failed: ${fail}`);
  console.log(`  Total files: ${fs.readdirSync(OUT_DIR).length}`);

  // Now update products.json to use local paths
  const productsPath = path.join(__dirname, '..', 'data', 'normalized', 'products.json');
  const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
  let updated = 0;
  products.forEach(p => {
    if (p.seriesIconUrl && p.seriesIconUrl.startsWith('https://')) {
      const series = p.seriesIconUrl.split('/').pop().replace('.jpg', '');
      const localPath = `/images/series/${series}.jpg`;
      if (fs.existsSync(path.join(OUT_DIR, series + '.jpg'))) {
        p.seriesIconUrl = localPath;
        updated++;
      }
    }
  });
  fs.writeFileSync(productsPath, JSON.stringify(products, null, 2));
  console.log(`  Updated ${updated} products to local image paths`);
}

main();
