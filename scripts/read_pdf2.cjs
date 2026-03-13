const fs = require('fs');
const m = require('pdf-parse');
const PDFParse = m.PDFParse;
const buf = fs.readFileSync('C:/Users/kuksh/Downloads/YG-1+엔드밀+카달로그(최종본).pdf');
console.log('Buffer loaded:', buf.length, 'bytes');

async function run() {
  try {
    const parser = new PDFParse(buf, { max: 5 });
    // Try load first
    const loaded = await parser.load();
    console.log('Loaded result type:', typeof loaded);
    if (loaded) console.log('Loaded keys:', Object.keys(loaded).slice(0, 20));
    
    // Try getText
    const text = await parser.getText();
    console.log('Text type:', typeof text);
    if (typeof text === 'string') {
      console.log('Text length:', text.length);
      fs.writeFileSync('C:/Users/kuksh/Downloads/YG1_test/scripts/pdf_text.txt', text.substring(0, 100000));
      console.log('Saved! Preview:');
      console.log(text.substring(0, 3000));
    } else if (text && typeof text === 'object') {
      console.log('Text keys:', Object.keys(text));
    }
  } catch(e) {
    console.error('Error:', e.message);
    console.error('Stack:', e.stack);
  }
}
run();
