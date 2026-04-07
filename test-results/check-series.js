const { Client } = require('pg');
const SERIES = ['SUPER ALLOY', 'V7 PLUS', 'TITANOX', '티타녹스', 'E5K4', 'CGM3S37', '3S MILL', 'X-POWER', 'WIDE-CUT', 'E-FORCE'];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  // products 컬럼 확인
  const cols = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='products' ORDER BY ordinal_position`);
  console.log('products 컬럼:', cols.rows.map(r => r.column_name).join(', '));

  // 각 시리즈 검색 (이름/시리즈/카테고리 후보 컬럼 포함)
  console.log('\n=== 시리즈별 products 적재 카운트 ===');
  const textCols = cols.rows.filter(r => /text|char/.test(r.data_type)).map(r => r.column_name);
  for (const s of SERIES) {
    const where = textCols.map(col => `"${col}" ILIKE $1`).join(' OR ');
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM products WHERE ${where}`, [`%${s}%`]);
    console.log(`  ${s.padEnd(15)} → ${r.rows[0].n} 건`);
  }

  // SUPER ALLOY 한 행 샘플
  console.log('\n=== SUPER ALLOY 샘플 (있다면) ===');
  const sample = await c.query(`SELECT * FROM products WHERE ${textCols.map(c => `"${c}" ILIKE $1`).join(' OR ')} LIMIT 3`, ['%SUPER ALLOY%']);
  console.log('hits:', sample.rows.length);
  for (const row of sample.rows) {
    const compact = {};
    for (const [k, v] of Object.entries(row)) if (v !== null && v !== '' && typeof v !== 'object') compact[k] = String(v).slice(0, 60);
    console.log(JSON.stringify(compact));
  }

  // 소재 컬럼 확인 후 inconel/초내열 매핑
  console.log('\n=== 소재 매핑 (Inconel/초내열) ===');
  const matCols = textCols.filter(c => /material|workpiece|소재|피삭/i.test(c));
  console.log('소재 후보 컬럼:', matCols.join(', ') || '(없음)');
  if (matCols.length) {
    const where = matCols.map(c => `"${c}" ILIKE $1 OR "${c}" ILIKE $2 OR "${c}" ILIKE $3`).join(' OR ');
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM products WHERE ${where}`, ['%inconel%', '%초내열%', '%super alloy%']);
    console.log(`  매칭: ${r.rows[0].n}건`);
  }

  // product_variants도 검색
  console.log('\n=== product_variants 시리즈 카운트 ===');
  const vcols = await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='product_variants'`);
  const vTextCols = vcols.rows.filter(r => /text|char/.test(r.data_type)).map(r => r.column_name);
  console.log('variants 컬럼:', vTextCols.join(', '));
  for (const s of SERIES) {
    if (vTextCols.length === 0) break;
    const where = vTextCols.map(col => `"${col}" ILIKE $1`).join(' OR ');
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM product_variants WHERE ${where}`, [`%${s}%`]);
    console.log(`  ${s.padEnd(15)} → ${r.rows[0].n} 건`);
  }

  await c.end();
})().catch(e => { console.error(e); process.exit(1); });
