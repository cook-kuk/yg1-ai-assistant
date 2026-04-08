const {Client} = require('pg');
(async () => {
  const c = new Client({connectionString: 'postgresql://smart_catalog:smart_catalog@20.119.98.136:5432/smart_catalog'});
  await c.connect();
  console.log('1) DROP if exists');
  await c.query('DROP MATERIALIZED VIEW IF EXISTS catalog_app.product_inventory_summary_mv CASCADE');
  console.log('2) CREATE MV');
  await c.query(`CREATE MATERIALIZED VIEW catalog_app.product_inventory_summary_mv AS
SELECT
  edp,
  normalized_edp,
  SUM(quantity)::bigint AS total_stock,
  COUNT(DISTINCT warehouse_or_region) FILTER (WHERE quantity > 0) AS warehouse_count,
  MAX(snapshot_date) AS snapshot_date
FROM catalog_app.inventory_snapshot
WHERE edp IS NOT NULL
GROUP BY edp, normalized_edp`);
  console.log('3) Indexes');
  await c.query('CREATE UNIQUE INDEX product_inventory_summary_mv_edp_idx ON catalog_app.product_inventory_summary_mv(edp)');
  await c.query('CREATE INDEX product_inventory_summary_mv_norm_idx ON catalog_app.product_inventory_summary_mv(normalized_edp)');
  await c.query('CREATE INDEX product_inventory_summary_mv_stock_idx ON catalog_app.product_inventory_summary_mv(total_stock) WHERE total_stock > 0');
  console.log('4) Verify');
  const r1 = await c.query('SELECT count(*) total, count(*) FILTER (WHERE total_stock > 0) instock FROM catalog_app.product_inventory_summary_mv');
  console.log('  mv rows:', r1.rows[0]);
  const r2 = await c.query('SELECT edp, total_stock, warehouse_count FROM catalog_app.product_inventory_summary_mv ORDER BY total_stock DESC NULLS LAST LIMIT 5');
  console.log('  top stock:');
  r2.rows.forEach(x => console.log('   ', x.edp, '×', x.total_stock, 'in', x.warehouse_count, 'wh'));
  const r3 = await c.query(`SELECT count(*) FROM catalog_app.product_recommendation_mv mv JOIN catalog_app.product_inventory_summary_mv inv ON inv.edp=mv.edp_no WHERE inv.total_stock > 0`);
  console.log('  mv rows joined with stock>0:', r3.rows[0].count);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
