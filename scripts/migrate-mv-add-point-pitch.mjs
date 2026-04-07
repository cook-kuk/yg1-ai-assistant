#!/usr/bin/env node
/**
 * Migration: catalog_app.product_recommendation_mv 에
 *   - holemaking_point_angle
 *   - threading_pitch
 *   - threading_tpi
 * 3개 컬럼을 추가한다.
 *
 * 방식: 현재 view def (reports/mv-definition.sql)을 읽어, 마지막 projection
 * (search_shank_type) 바로 뒤에 세 컬럼을 삽입한 CREATE OR REPLACE VIEW 를 실행.
 *
 * CREATE OR REPLACE VIEW는 "기존 컬럼 뒤에 추가"만 허용하므로 순서 안전.
 *
 * --dry-run: SQL만 출력하고 실제 실행 안 함.
 */
import fs from "node:fs"
import path from "node:path"
import { Client } from "pg"

function readEnv(p) {
  if (!fs.existsSync(p)) return {}
  const o = {}
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#") || !t.includes("=")) continue
    const i = t.indexOf("=")
    o[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")
  }
  return o
}

const DRY_RUN = process.argv.includes("--dry-run")

async function main() {
  const defPath = path.join(process.cwd(), "reports", "mv-definition.sql")
  if (!fs.existsSync(defPath)) {
    console.error(`missing ${defPath} — run scripts/probe-mv-columns.mjs first`)
    process.exit(1)
  }
  const body = fs.readFileSync(defPath, "utf8")

  // Insert the 3 new columns immediately after `AS search_shank_type` and before `FROM dedup_edp pe`.
  const NEW_COLS = `,
    ph.option_holemaking_pointangle AS holemaking_point_angle,
    pt.option_threading_pitch AS threading_pitch,
    pt.option_threading_tpi AS threading_tpi`

  const anchorRe = /AS search_shank_type(\s*)\n(\s+)FROM dedup_edp pe/
  if (!anchorRe.test(body)) {
    console.error("anchor 'AS search_shank_type ... FROM dedup_edp pe' not found — view shape changed, aborting")
    process.exit(1)
  }
  const patched = body.replace(anchorRe, `AS search_shank_type${NEW_COLS}$1\n$2FROM dedup_edp pe`)
  // product_recommendation_mv is a MATERIALIZED view — must DROP + CREATE.
  // Recreate all 7 indexes that existed before. No dependent objects.
  const INDEXES = [
    "CREATE INDEX product_recommendation_mv_code_idx ON catalog_app.product_recommendation_mv USING btree (normalized_code)",
    "CREATE INDEX product_recommendation_mv_diameter_idx ON catalog_app.product_recommendation_mv USING btree (search_diameter_mm)",
    "CREATE INDEX product_recommendation_mv_material_tags_idx ON catalog_app.product_recommendation_mv USING gin (material_tags)",
    "CREATE INDEX product_recommendation_mv_country_codes_idx ON catalog_app.product_recommendation_mv USING gin (country_codes)",
    "CREATE INDEX product_recommendation_mv_series_trgm_idx ON catalog_app.product_recommendation_mv USING gin (edp_series_name gin_trgm_ops)",
    "CREATE INDEX product_recommendation_mv_coating_trgm_idx ON catalog_app.product_recommendation_mv USING gin (search_coating gin_trgm_ops)",
    "CREATE INDEX product_recommendation_mv_subtype_trgm_idx ON catalog_app.product_recommendation_mv USING gin (search_subtype gin_trgm_ops)",
    "CREATE INDEX product_recommendation_mv_appshape_trgm_idx ON catalog_app.product_recommendation_mv USING gin (series_application_shape gin_trgm_ops)",
  ]
  const sql =
    `DROP MATERIALIZED VIEW catalog_app.product_recommendation_mv;\n` +
    `CREATE MATERIALIZED VIEW catalog_app.product_recommendation_mv AS\n${patched.trimEnd()};\n` +
    INDEXES.map(s => s + ";").join("\n") + "\n"

  const outPath = path.join(process.cwd(), "reports", "migrations", "20260408_add_point_angle_thread_pitch.sql")
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, sql)
  console.log(`[saved] ${path.relative(process.cwd(), outPath)}  (${sql.length} bytes)`)

  if (DRY_RUN) {
    console.log("\n--dry-run: skipping execution")
    return
  }

  const env = {
    ...readEnv(path.join(process.cwd(), ".env")),
    ...readEnv(path.join(process.cwd(), ".env.local")),
    ...readEnv(path.join(process.cwd(), ".env.vercel")),
    ...process.env,
  }
  const cfg = env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL }
    : {
        host: env.PGHOST || env.POSTGRES_HOST,
        port: Number(env.PGPORT || env.POSTGRES_PORT || 5432),
        database: env.PGDATABASE || env.POSTGRES_DB,
        user: env.PGUSER || env.POSTGRES_USER,
        password: env.PGPASSWORD || env.POSTGRES_PASSWORD,
      }
  const c = new Client(cfg)
  await c.connect()
  console.log("[migrate] connected; applying CREATE OR REPLACE VIEW ...")
  try {
    await c.query("BEGIN")
    await c.query(sql)
    await c.query("COMMIT")
    console.log("[migrate] committed ✓")
    // Verify AFTER commit (pg_class catalog reads are snapshot-bound inside tx for some edge cases)
    const check = await c.query(`
      SELECT a.attname FROM pg_attribute a
      JOIN pg_class r ON r.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname='catalog_app' AND r.relname='product_recommendation_mv'
        AND a.attname = ANY(ARRAY['holemaking_point_angle','threading_pitch','threading_tpi'])
      ORDER BY a.attname
    `)
    console.log(`[migrate] verified columns: ${check.rows.map(r=>r.attname).join(", ")} (${check.rowCount}/3)`)
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {})
    console.error("[migrate] FAILED, rolled back:", e.message)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
