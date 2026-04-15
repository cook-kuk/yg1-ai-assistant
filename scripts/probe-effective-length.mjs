import pg from "pg"
const { Pool } = pg

const pool = new Pool({
  host: "20.119.98.136",
  port: 5432,
  user: "smart_catalog",
  password: "smart_catalog",
  database: "smart_catalog",
})

const q = async (sql, label) => {
  const r = await pool.query(sql)
  console.log(`\n== ${label} ==`)
  console.table(r.rows)
}

await q(
  `SELECT milling_effective_length::text AS v, COUNT(*) AS n
   FROM catalog_app.product_recommendation_mv
   WHERE milling_effective_length IS NOT NULL
   GROUP BY v ORDER BY n DESC LIMIT 30`,
  "effective_length distinct (top 30)"
)

await q(
  `SELECT COUNT(*) FILTER (WHERE milling_effective_length IS NULL) AS null_cnt,
          COUNT(*) FILTER (WHERE milling_effective_length IS NOT NULL) AS nn_cnt,
          MIN(milling_effective_length::numeric) AS mn,
          MAX(milling_effective_length::numeric) AS mx,
          AVG(milling_effective_length::numeric) AS avg,
          COUNT(*) FILTER (WHERE milling_effective_length::numeric >= 50) AS gte50
   FROM catalog_app.product_recommendation_mv
   WHERE milling_effective_length ~ '^[0-9]+(\\.[0-9]+)?$'`,
  "effective_length stats (numeric-only rows)"
)

await q(
  `SELECT milling_effective_length, COUNT(*)
   FROM catalog_app.product_recommendation_mv
   WHERE milling_effective_length IS NOT NULL
     AND milling_effective_length !~ '^[0-9]+(\\.[0-9]+)?$'
   GROUP BY milling_effective_length LIMIT 20`,
  "non-numeric formats"
)

await pool.end()
