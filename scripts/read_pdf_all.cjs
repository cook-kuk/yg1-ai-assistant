const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function run() {
  const buf = fs.readFileSync('C:/Users/kuksh/Downloads/YG-1+엔드밀+카달로그(최종본).pdf');
  const uint8 = new Uint8Array(buf);
  console.log('Loaded:', uint8.length, 'bytes');

  // Read all 736 pages
  const parser = new PDFParse(uint8, { max: 0 }); // 0 = no limit
  await parser.load();
  
  const result = await parser.getText();
  console.log('Total pages:', result.total);
  console.log('Full text length:', result.text.length);
  
  // Save full text
  fs.writeFileSync('C:/Users/kuksh/Downloads/YG1_test/scripts/pdf_full_text.txt', result.text);
  console.log('Saved full text to pdf_full_text.txt');
  
  // Save per-page JSON
  fs.writeFileSync('C:/Users/kuksh/Downloads/YG1_test/scripts/pdf_pages.json', JSON.stringify(result.pages, null, 2));
  console.log('Saved', result.pages.length, 'pages to pdf_pages.json');
  
  // Show some sample pages
  for (let i = 0; i < Math.min(10, result.pages.length); i++) {
    console.log(`\n=== Page ${result.pages[i].num} ===`);
    console.log(result.pages[i].text.substring(0, 300));
  }
}
run().catch(e => { console.error(e.message); process.exit(1); });
