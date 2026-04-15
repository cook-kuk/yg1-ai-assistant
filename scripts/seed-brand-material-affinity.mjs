import pg from "pg"
const { Pool } = pg

const pool = new Pool({
  host: "20.119.98.136",
  port: 5432,
  user: "smart_catalog",
  password: "smart_catalog",
  database: "smart_catalog",
})

const q = async (sql, params = [], label) => {
  const r = await pool.query(sql, params)
  if (label) console.log(`\n== ${label} ==`)
  return r
}

const schema = await q(
  `SELECT column_name, data_type FROM information_schema.columns
   WHERE table_schema='public' AND table_name='brand_material_affinity'
   ORDER BY ordinal_position`,
  [],
  "brand_material_affinity columns"
)
console.table(schema.rows)

const existingKeys = await q(
  `SELECT DISTINCT material_key FROM public.brand_material_affinity ORDER BY material_key`,
  [],
  "existing material_keys"
)
console.table(existingKeys.rows)

// 브랜드별 소재 적합도 — 연구소 지침 기반 (EXCELLENT=100, GOOD=80, FAIR=60)
// CRX S: 스테인리스/구리/알루미늄/티타늄 범용 난삭재
// ALU-CUT / ALU-POWER: 알루미늄/구리(비철) 전문
// TitaNox-Power: 티타늄/스테인리스 전문
const ROWS = [
  // COPPER (구리)
  { brand: "ALU-CUT",        material_key: "COPPER",    rating: "EXCELLENT", rating_score: 100 },
  { brand: "ALU-POWER",      material_key: "COPPER",    rating: "EXCELLENT", rating_score: 100 },
  { brand: "CRX S",          material_key: "COPPER",    rating: "GOOD",      rating_score: 80 },
  // ALUMINUM (알루미늄)
  { brand: "ALU-POWER",      material_key: "ALUMINUM",  rating: "EXCELLENT", rating_score: 100 },
  { brand: "ALU-CUT",        material_key: "ALUMINUM",  rating: "EXCELLENT", rating_score: 100 },
  { brand: "CRX S",          material_key: "ALUMINUM",  rating: "GOOD",      rating_score: 80 },
  // TITANIUM (티타늄)
  { brand: "TitaNox-Power",  material_key: "TITANIUM",  rating: "EXCELLENT", rating_score: 100 },
  { brand: "CRX S",          material_key: "TITANIUM",  rating: "EXCELLENT", rating_score: 100 },
]

const hasCol = new Set(schema.rows.map(r => r.column_name))
console.log("\nhas columns:", [...hasCol].join(", "))

// Upsert using ON CONFLICT on (brand, material_key) — fallback to DELETE+INSERT if no unique.
for (const row of ROWS) {
  try {
    await pool.query(
      `INSERT INTO public.brand_material_affinity (id, brand, material_key, material_kind, rating, rating_score)
       VALUES (gen_random_uuid(),$1,$2,'workpiece',$3,$4)
       ON CONFLICT (brand, material_key) DO UPDATE
         SET rating = EXCLUDED.rating, rating_score = EXCLUDED.rating_score`,
      [row.brand, row.material_key, row.rating, row.rating_score],
    )
    console.log(`[upsert] ${row.brand} / ${row.material_key} -> ${row.rating}(${row.rating_score})`)
  } catch (e) {
    // fallback: delete+insert
    try {
      await pool.query(
        `DELETE FROM public.brand_material_affinity WHERE brand=$1 AND material_key=$2`,
        [row.brand, row.material_key],
      )
      await pool.query(
        `INSERT INTO public.brand_material_affinity (id, brand, material_key, material_kind, rating, rating_score) VALUES (gen_random_uuid(),$1,$2,'workpiece',$3,$4)`,
        [row.brand, row.material_key, row.rating, row.rating_score],
      )
      console.log(`[del+ins] ${row.brand} / ${row.material_key} -> ${row.rating}(${row.rating_score})`)
    } catch (e2) {
      console.warn(`[fail] ${row.brand} / ${row.material_key}: ${e2.message}`)
    }
  }
}

const after = await q(
  `SELECT material_key, COUNT(*) n FROM public.brand_material_affinity
   WHERE material_key IN ('COPPER','ALUMINUM','TITANIUM')
   GROUP BY material_key ORDER BY material_key`,
  [], "after counts"
)
console.table(after.rows)

const keysNow = await q(
  `SELECT DISTINCT material_key FROM public.brand_material_affinity ORDER BY material_key`,
  [], "material_keys now"
)
console.table(keysNow.rows)

await pool.end()
