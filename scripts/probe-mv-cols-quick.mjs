import fs from "node:fs"
import path from "node:path"
import { Client } from "pg"
function readEnv(p){if(!fs.existsSync(p))return{};const o={};for(const l of fs.readFileSync(p,"utf8").split(/\r?\n/)){const t=l.trim();if(!t||t.startsWith("#")||!t.includes("="))continue;const i=t.indexOf("=");o[t.slice(0,i).trim()]=t.slice(i+1).trim().replace(/^['"]|['"]$/g,"")}return o}
const env={...readEnv(".env"),...readEnv(".env.local"),...readEnv(".env.vercel"),...process.env}
const cfg=env.DATABASE_URL?{connectionString:env.DATABASE_URL}:{host:env.PGHOST,port:Number(env.PGPORT||5432),database:env.PGDATABASE,user:env.PGUSER,password:env.PGPASSWORD}
const c=new Client(cfg); await c.connect()
const r=(await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='catalog_app' AND table_name='product_recommendation_mv' ORDER BY ordinal_position`)).rows
for(const x of r) console.log(`${x.column_name}\t${x.data_type}`)
await c.end()
