const fs = require('fs');
const { PDFParse } = require('pdf-parse');

async function run() {
  const buf = fs.readFileSync('C:/Users/kuksh/Downloads/YG-1+엔드밀+카달로그(최종본).pdf');
  const uint8 = new Uint8Array(buf);
  console.log('Buffer loaded:', uint8.length, 'bytes');

  // Read pages 1-20 first
  const parser = new PDFParse(uint8, { max: 20 });
  await parser.load();
  
  const info = await parser.getInfo();
  console.log('PDF Info:', JSON.stringify(info).substring(0, 500));
  
  const text = await parser.getText();
  console.log('Text type:', typeof text, 'length:', text.length);
  fs.writeFileSync('C:/Users/kuksh/Downloads/YG1_test/scripts/pdf_p1_20.txt', text.substring(0, 100000));
  console.log('Saved! Preview:');
  console.log(text.substring(0, 5000));
}
run().catch(e => { console.error(e.message); process.exit(1); });
