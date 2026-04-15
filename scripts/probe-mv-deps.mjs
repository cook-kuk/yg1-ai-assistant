#!/usr/bin/env node
import fs from "node:fs"
import { Client } from "pg"
function readEnv(p){if(!fs.existsSync(p))return{};const o={};for(const l of fs.readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#")||!t.includes("="))continue;const i=t.indexOf("=");o[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^['"]|['"]$/g,"")}return o}
const env={...readEnv(".env"),...readEnv(".env.local"),...readEnv(".env.vercel"),...process.env}
const cfg=env.DATABASE_URL?{connectionString:env.DATABASE_URL}:{host:env.PGHOST,port:Number(env.PGPORT||5432),database:env.PGDATABASE,user:env.PGUSER,password:env.PGPASSWORD}
const c=new Client(cfg);await c.connect()
const q=async(s,p=[])=>(await c.query(s,p)).rows
const out=[]
const log=s=>{console.log(s);out.push(s)}

log("# MV 재빌드 안전성 점검\n")

log("## A. MV에 의존하는 객체")
const deps=await q(`
  SELECT DISTINCT dep.relname AS name, dep.relkind AS kind, n.nspname AS schema
  FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid JOIN pg_class dep ON dep.oid=r.ev_class JOIN pg_namespace n ON n.oid=dep.relnamespace
  WHERE d.refobjid='catalog_app.product_recommendation_mv'::regclass AND dep.oid<>'catalog_app.product_recommendation_mv'::regclass
`)
if(deps.length===0) log("- ✅ 의존 객체 없음 — DROP+CREATE 안전")
else for(const r of deps) log(`- ⚠️ ${r.schema}.${r.name} (${r.kind})`)

log("\n## B. source 컬럼 실제 존재")
const srcs=[
  ["raw_catalog.prod_edp_option_holemaking","option_holemaking_pointangle"],
  ["raw_catalog.prod_edp_option_threading","option_threading_pitch"],
  ["raw_catalog.prod_edp_option_threading","option_threading_tpi"],
]
for(const [t,col] of srcs){
  const [ts,tn]=t.split(".")
  const exists=(await q(`SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3`, [ts,tn,col])).length
  try{
    const r=(await q(`SELECT COUNT(*)::bigint AS t, COUNT(*) FILTER (WHERE "${col}" IS NOT NULL AND BTRIM("${col}"::text)<>'')::bigint AS nn FROM ${t}`))[0]
    log(`- ${t}.${col}: total=${r.t}, non-null=${r.nn}`)
  }catch(e){ log(`- ${t}.${col}: ❌ ${e.message}`) }
}

log("\n## C. public.brand_material_affinity")
const affExists=(await q(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='brand_material_affinity'`))[0].n
if(!affExists) log("- ❌ 없음")
else{
  const colsX=await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='brand_material_affinity' ORDER BY ordinal_position`)
  log(`- 컬럼: ${colsX.map(c=>`${c.column_name}(${c.data_type})`).join(", ")}`)
  const total=Number((await q(`SELECT COUNT(*)::bigint AS n FROM public.brand_material_affinity`))[0].n)
  log(`- 총 행: ${total}`)
  const mats=await q(`SELECT DISTINCT material_key FROM public.brand_material_affinity ORDER BY material_key`)
  log(`- distinct material_key (${mats.length}):`)
  for(const m of mats.slice(0,50)) log(`  - \`${m.material_key}\``)
  const cu=await q(`SELECT brand, material_key, rating, rating_score FROM public.brand_material_affinity WHERE material_key ILIKE '%copper%' OR material_key ILIKE '%aluminum%' OR material_key ILIKE '%titan%' OR material_key ILIKE '%hardened%' ORDER BY material_key, rating_score DESC LIMIT 40`)
  log("\n- 주요 피삭재 샘플:")
  log("| material_key | brand | rating | score |")
  log("|---|---|---|---:|")
  for(const r of cu) log(`| ${r.material_key} | ${r.brand} | ${r.rating} | ${r.rating_score} |`)
}

log("\n## D. product_inventory_summary_mv 후보")
const invRows=await q(`SELECT table_schema, table_name FROM information_schema.tables WHERE table_name ILIKE '%inventory%' OR table_name ILIKE '%stock_summary%'`)
for(const r of invRows) log(`- ${r.table_schema}.${r.table_name}`)

log("\n## E. prod_edp_option_tooling RPM 관련 컬럼")
const toolingCols=await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='raw_catalog' AND table_name='prod_edp_option_tooling' ORDER BY ordinal_position`)
log(`- 전체 컬럼 (${toolingCols.length}):`)
for(const r of toolingCols) log(`  - ${r.column_name}`)

log("\n## F. 기존 MV 인덱스")
const idx=await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='catalog_app' AND tablename='product_recommendation_mv'`)
for(const r of idx) log(`- ${r.indexname}: ${r.indexdef}`)

log("\n## G. 기존 catalog_app MV 전체")
const mvs=await q(`SELECT matviewname FROM pg_matviews WHERE schemaname='catalog_app' ORDER BY matviewname`)
for(const r of mvs) log(`- ${r.matviewname}`)

fs.writeFileSync("reports/db-mv-deps.md", out.join("\n"))
console.error("\n[saved] reports/db-mv-deps.md")
await c.end()
