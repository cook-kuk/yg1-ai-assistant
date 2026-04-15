#!/usr/bin/env node
import fs from "node:fs"
import { Client } from "pg"
function readEnv(p){if(!fs.existsSync(p))return{};const o={};for(const l of fs.readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#")||!t.includes("="))continue;const i=t.indexOf("=");o[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^['"]|['"]$/g,"")}return o}
const env={...readEnv(".env"),...readEnv(".env.local"),...readEnv(".env.vercel"),...process.env}
const cfg=env.DATABASE_URL?{connectionString:env.DATABASE_URL}:{host:env.PGHOST,port:Number(env.PGPORT||5432),database:env.PGDATABASE,user:env.PGUSER,password:env.PGPASSWORD}
const c=new Client(cfg); await c.connect()

const t0=Date.now()

// 사전 카운트
const {rows:[before]}=await c.query(`SELECT COUNT(*)::bigint AS n FROM catalog_app.product_recommendation_mv`)
console.log(`[before] rows=${before.n}`)
const {rows:colsBefore}=await c.query(`SELECT COUNT(*)::int AS n FROM pg_attribute WHERE attrelid='catalog_app.product_recommendation_mv'::regclass AND attnum>0 AND NOT attisdropped`)
console.log(`[before] columns=${colsBefore[0].n}`)

const sql=fs.readFileSync("reports/migrations/20260415_mv_complete_rebuild.sql","utf8")

try {
  console.log("[exec] running migration...")
  await c.query(sql)
  console.log(`[ok] migration done in ${((Date.now()-t0)/1000).toFixed(1)}s`)
} catch(e) {
  console.error(`[fail] ${e.message}`)
  console.error(`[hint] at position ${e.position||"?"}`)
  await c.end()
  process.exit(1)
}

// 사후 검증
const {rows:[after]}=await c.query(`SELECT COUNT(*)::bigint AS n FROM catalog_app.product_recommendation_mv`)
console.log(`[after] rows=${after.n}`)
const {rows:colsAfter}=await c.query(`
  SELECT attname FROM pg_attribute
  WHERE attrelid='catalog_app.product_recommendation_mv'::regclass AND attnum>0 AND NOT attisdropped
  ORDER BY attnum`)
console.log(`[after] columns=${colsAfter.length}`)

const required=["holemaking_point_angle","threading_pitch","threading_tpi","norm_brand","norm_coating","norm_cutting_edge","norm_application","norm_shank_type"]
const names=new Set(colsAfter.map(r=>r.attname))
for(const k of required) console.log(`  - ${k}: ${names.has(k)?"✅":"❌"}`)

// 복구 컬럼 non-null 카운트
const {rows:[nn]}=await c.query(`
  SELECT
    COUNT(*) FILTER (WHERE holemaking_point_angle IS NOT NULL AND BTRIM(holemaking_point_angle)<>'')::bigint AS pa,
    COUNT(*) FILTER (WHERE threading_pitch IS NOT NULL AND BTRIM(threading_pitch)<>'')::bigint AS tp,
    COUNT(*) FILTER (WHERE threading_tpi IS NOT NULL AND BTRIM(threading_tpi)<>'')::bigint AS tpi,
    COUNT(*) FILTER (WHERE norm_brand IS NOT NULL)::bigint AS nb,
    COUNT(*) FILTER (WHERE norm_coating IS NOT NULL)::bigint AS nc,
    COUNT(*) FILTER (WHERE norm_application IS NOT NULL)::bigint AS na,
    COUNT(*) FILTER (WHERE norm_shank_type IS NOT NULL)::bigint AS ns,
    COUNT(*) FILTER (WHERE milling_number_of_flute IS NULL)::bigint AS nof_null,
    COUNT(*) FILTER (WHERE milling_helix_angle IS NULL)::bigint AS ha_null
  FROM catalog_app.product_recommendation_mv
`)
console.log(`[nn] point_angle=${nn.pa} threading_pitch=${nn.tp} threading_tpi=${nn.tpi}`)
console.log(`[nn] norm_brand=${nn.nb} norm_coating=${nn.nc} norm_application=${nn.na} norm_shank_type=${nn.ns}`)
console.log(`[cleanup] flute_NULL=${nn.nof_null} helix_NULL=${nn.ha_null}`)

await c.end()
