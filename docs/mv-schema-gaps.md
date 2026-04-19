# MV schema gaps — `product_recommendation_mv`

The recommendation path (`python-api/search.py`) sometimes references
columns that were defined in earlier catalog snapshots but are **not** in
the current `product_recommendation_mv`. `_build_where` skips filters on
these columns (logged at INFO level) so queries stay executable until the
MV is rebuilt.

Single source of truth: `python-api/search.py._MV_MISSING_COLUMNS`.

## Missing columns

| Column | Origin table | Type | Used for | ALTER to restore |
|---|---|---|---|---|
| `holemaking_point_angle` | `catalog_app.holemaking_specs` | `numeric(5,2)` | Drill tip angle filter (e.g. "118°", "135°") | `ALTER MATERIALIZED VIEW catalog_app.product_recommendation_mv ADD COLUMN holemaking_point_angle numeric(5,2);` (then repopulate from the source table LEFT JOIN on `edp_no`) |
| `threading_pitch` | `catalog_app.threading_specs` | `numeric(6,3)` | Metric thread pitch (e.g. M8×1.25 → 1.25) | `ALTER MATERIALIZED VIEW … ADD COLUMN threading_pitch numeric(6,3);` |
| `threading_tpi` | `catalog_app.threading_specs` | `integer` | Imperial TPI (e.g. 1/4-20 → 20) | `ALTER MATERIALIZED VIEW … ADD COLUMN threading_tpi integer;` |
| `norm_brand` | derived (`UPPER(BTRIM(edp_brand_name))`) | `text` | Fast equality brand match (bypasses ILIKE) | `ALTER MATERIALIZED VIEW … ADD COLUMN norm_brand text;` — populate with `UPDATE … SET norm_brand = UPPER(BTRIM(edp_brand_name))` at refresh |
| `norm_coating` | derived (`UPPER(BTRIM(milling_coating))`) | `text` | Fast equality coating match | Same pattern as `norm_brand` |

## Current behavior

- Filters referencing any of these columns → skipped at `_build_where`,
  info-logged as `[search._build_where] Skipping filter on {col} — MV
  column absent`.
- In-memory path (`product_index._matches`) likewise doesn't carry these
  columns, so the behavior is consistent across both search paths.

## Ordering

1. **`norm_brand` / `norm_coating`**: low-hanging — purely derivable from
   existing columns, no new source data needed. A refresh-hook update
   fills them.
2. **`holemaking_point_angle`**: needed to close the drill-filter golden
   tests. Source column exists; MV refresh rebuild.
3. **`threading_pitch` / `threading_tpi`**: same pattern as point_angle,
   for the threading family.

## Verification after a rebuild

```sql
-- Confirm all columns exist
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'catalog_app'
   AND table_name   = 'product_recommendation_mv'
   AND column_name IN (
     'holemaking_point_angle', 'threading_pitch', 'threading_tpi',
     'norm_brand', 'norm_coating'
   );

-- Spot-check a row
SELECT edp_no, norm_brand, norm_coating, holemaking_point_angle
  FROM catalog_app.product_recommendation_mv
 WHERE edp_no ILIKE 'DRL%' LIMIT 5;
```

Then drop each restored column from `_MV_MISSING_COLUMNS` in
`python-api/search.py`.
