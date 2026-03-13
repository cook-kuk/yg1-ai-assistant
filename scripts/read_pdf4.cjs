const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function run() {
  const buf = fs.readFileSync('C:/Users/kuksh/Downloads/YG-1+엔드밀+카달로그(최종본).pdf');
  const uint8 = new Uint8Array(buf);
  console.log('Loaded:', uint8.length, 'bytes');

  const parser = new PDFParse(uint8, { max: 20 });
  await parser.load();
  
  // Check getText return type
  const textResult = await parser.getText();
  console.log('getText type:', typeof textResult);
  if (textResult && typeof textResult === 'object') {
    console.log('Keys:', Object.keys(textResult).slice(0, 30));
    if (Array.isArray(textResult)) {
      console.log('Array length:', textResult.length);
      console.log('First item:', JSON.stringify(textResult[0]).substring(0, 500));
    } else {
      const keys = Object.keys(textResult);
      for (const k of keys.slice(0, 5)) {
        console.log(`[${k}]:`, JSON.stringify(textResult[k]).substring(0, 300));
      }
    }
  }
  
  // Try getPageText
  try {
    const p1 = await parser.getPageText(1);
    console.log('\nPage 1 type:', typeof p1);
    console.log('Page 1:', JSON.stringify(p1).substring(0, 1000));
  } catch(e) {
    console.log('getPageText error:', e.message);
  }
}
run().catch(e => { console.error(e.message); process.exit(1); });
