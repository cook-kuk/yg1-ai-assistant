#!/usr/bin/env node
import fs from "node:fs"
import { Client } from "pg"
function readEnv(p){if(!fs.existsSync(p))return{};const o={};for(const l of fs.readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#")||!t.includes("="))continue;const i=t.indexOf("=");o[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^['"]|['"]$/g,"")}return o}
const env={...readEnv(".env"),...readEnv(".env.local"),...readEnv(".env.vercel"),...process.env}
const cfg=env.DATABASE_URL?{connectionString:env.DATABASE_URL}:{host:env.PGHOST,port:Number(env.PGPORT||5432),database:env.PGDATABASE,user:env.PGUSER,password:env.PGPASSWORD}
const c=new Client(cfg);await c.connect()

const {rows}=await c.query(`
  SELECT attname FROM pg_attribute
  WHERE attrelid='catalog_app.product_recommendation_mv'::regclass AND attnum>0 AND NOT attisdropped
  ORDER BY attnum`)
const mvCols=rows.map(r=>r.attname)

const src=fs.readFileSync("lib/recommendation/core/sql-agent-schema-cache.ts","utf8")
const kosMatch=src.match(/COLUMN_KO_DESCRIPTIONS:\s*Record<string,\s*string>\s*=\s*\{([\s\S]+?)\n\}/)
const currentKeys=[]
if(kosMatch){
  const body=kosMatch[1]
  for(const m of body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)){
    currentKeys.push(m[1])
  }
}

console.log("=== MV columns not in COLUMN_KO_DESCRIPTIONS (need add) ===")
const missing=mvCols.filter(c=>!currentKeys.includes(c))
for(const c of missing) console.log(`  ${c}`)
console.log(`Total missing: ${missing.length}`)

console.log("\n=== COLUMN_KO_DESCRIPTIONS keys not in MV (orphan — remove or keep as option_* alias) ===")
const orphan=currentKeys.filter(k=>!mvCols.includes(k))
for(const k of orphan) console.log(`  ${k}`)
console.log(`Total orphan: ${orphan.length}`)

await c.end()
