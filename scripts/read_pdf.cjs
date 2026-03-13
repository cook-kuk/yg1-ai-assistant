const fs = require('fs');
const m = require('pdf-parse');
const PDFParse = m.PDFParse || m.default || m;
const buf = fs.readFileSync('C:/Users/kuksh/Downloads/YG-1+엔드밀+카달로그(최종본).pdf');
console.log('Buffer loaded:', buf.length, 'bytes');
const parser = new PDFParse(buf, { max: 10 });
const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(parser));
console.log('Methods:', methods);
if (parser.then) {
  parser.then(data => {
    console.log('Pages:', data.numpages);
    console.log('Text length:', data.text.length);
    // Save to file
    fs.writeFileSync('C:/Users/kuksh/Downloads/YG1_test/scripts/pdf_output_p1-10.txt', data.text.substring(0, 50000));
    console.log('Saved first 50000 chars to pdf_output_p1-10.txt');
    console.log('Preview:', data.text.substring(0, 3000));
  }).catch(e => console.error('Error:', e.message));
}
