from typing import Optional
from db import fetch_all, fetch_one

# DB stores most "numeric" values as text (varchar) so a cast guard is needed
# before BETWEEN. Reusable regex: accepts "10", "10.5" — rejects "10mm", "1/2".
_NUMERIC_GUARD = r"^[0-9]+(\.[0-9]+)?$"


def _range_clause(
    column: str,
    lo: Optional[float],
    hi: Optional[float],
    params: list,
) -> Optional[str]:
    """Build a WHERE fragment for a numeric-like text column given optional
    lower/upper bounds. Appends bind values to `params` and returns the SQL
    fragment, or None if no bound is set."""
    if lo is None and hi is None:
        return None
    guard = f"{column} ~ '{_NUMERIC_GUARD}'"
    if lo is not None and hi is not None:
        params.extend([lo, hi])
        return f"({guard} AND {column}::numeric BETWEEN %s AND %s)"
    if lo is not None:
        params.append(lo)
        return f"({guard} AND {column}::numeric >= %s)"
    params.append(hi)
    return f"({guard} AND {column}::numeric <= %s)"

# Extended SELECT — covers product-card display fields the /products endpoint
# surfaces. /recommend paths only read the narrower subset so adding columns
# here is backward-compatible.
#
# The two trailing scalar subqueries pull inventory from product_inventory_summary_mv
# per EDP — a correlated lookup instead of a JOIN keeps the outer row cardinality
# stable (no fan-out) and lets _build_where / get_filter_options / product_count_filtered
# reuse the same SELECT without double-counting. NULL survives as NULL so the
# client can distinguish "no snapshot" from "0 in stock".
SELECT_COLS = """
    edp_no,
    edp_brand_name        AS brand,
    edp_series_name       AS series,
    edp_series_idx        AS series_idx,
    edp_root_category     AS root_category,
    edp_unit,
    series_tool_type      AS tool_type,
    series_cutting_edge_shape AS subtype,
    series_description,
    series_feature,
    milling_outside_dia   AS diameter,
    milling_number_of_flute AS flutes,
    milling_overall_length,
    milling_length_of_cut,
    milling_helix_angle,
    milling_coolant_hole,
    milling_tool_material,
    milling_ball_radius,
    milling_diameter_tolerance,
    milling_neck_diameter,
    milling_effective_length,
    material_tags,
    milling_coating       AS coating,
    search_shank_type,
    search_diameter_mm,
    option_overall_length,
    option_oal,
    milling_shank_dia,
    holemaking_tool_material,
    holemaking_coolant_hole,
    -- holemaking_point_angle column is not present in the current MV
    -- definition; point_angle filters in _build_where still reference it
    -- but only fire when the caller sets a point_angle intent, so the
    -- default /products and /recommend paths don't hit the missing column.
    threading_tool_material,
    threading_coolant_hole,
    -- threading_pitch / threading_tpi are likewise absent from the current
    -- MV; filters that reference them are conditional in _build_where.
    series_application_shape,
    country_codes,
    -- norm_brand / norm_coating are absent from the current MV. _build_where
    -- still references them conditionally (brand_norm filter), but the
    -- default SELECT drops them to keep the query schema-safe.
    (SELECT total_stock FROM catalog_app.product_inventory_summary_mv inv
       WHERE inv.edp = edp_no) AS total_stock,
    (SELECT warehouse_count FROM catalog_app.product_inventory_summary_mv inv
       WHERE inv.edp = edp_no) AS warehouse_count
"""

MV_TABLE = "catalog_app.product_recommendation_mv"
INVENTORY_MV = "catalog_app.product_inventory_summary_mv"
INVENTORY_SNAPSHOT = "catalog_app.inventory_snapshot"


def _build_where(filters: dict, exclude: Optional[str] = None) -> tuple[list[str], list]:
    """Build the WHERE clauses + params list from a normalized filter dict.
    If `exclude` is set, the clause for that field is skipped — used by
    get_filter_options so toggling a field still counts candidates that
    differ *only* in that field.

    The root-category / outside-dia base clauses are auto-widened: if the
    caller set a drilling-specific (point_angle, holemaking_*) or
    threading-specific (thread_pitch, tpi, threading_*) filter, drop the
    milling-only gate so those families are visible. Otherwise stay Milling
    to preserve historical /recommend behavior.
    """
    def _has(*keys) -> bool:
        return any(filters.get(k) is not None for k in keys)

    drill_family = _has(
        "point_angle", "point_angle_min", "point_angle_max",
        "holemaking_coolant_hole",
    )
    thread_family = _has(
        "thread_pitch", "thread_pitch_min", "thread_pitch_max",
        "thread_tpi", "tpi_min", "tpi_max",
        "threading_coolant_hole",
    )

    where: list[str] = []
    params: list = []
    if drill_family and not thread_family:
        where.append("(edp_root_category ILIKE %s OR edp_root_category ILIKE %s)")
        params.extend(["%mill%", "%hole%"])
    elif thread_family and not drill_family:
        where.append("(edp_root_category ILIKE %s OR edp_root_category ILIKE %s)")
        params.extend(["%mill%", "%thread%"])
    elif drill_family and thread_family:
        where.append(
            "(edp_root_category ILIKE %s OR edp_root_category ILIKE %s "
            "OR edp_root_category ILIKE %s)"
        )
        params.extend(["%mill%", "%hole%", "%thread%"])
    else:
        where.append("edp_root_category ILIKE %s")
        params.append("%mill%")
        # Historical milling-only base also required a numeric diameter — keep
        # that for the milling path so zero-diameter rows stay excluded.
        where.append("milling_outside_dia IS NOT NULL")

    def _skip(name: str) -> bool:
        return exclude == name

    # Prefer the pre-normalized numeric column (search_diameter_mm) when it's
    # set — no regex cast, no string gymnastics. Fall back to the text column
    # only if search_diameter_mm is NULL so rows with inch fractions ("1/2")
    # can still be rescued by the regex path via milling_outside_dia.
    dia_min = filters.get("diameter_min")
    dia_max = filters.get("diameter_max")
    diameter = filters.get("diameter")
    if (dia_min is not None or dia_max is not None) and not _skip("diameter"):
        if dia_min is not None and dia_max is not None:
            where.append(
                "(search_diameter_mm BETWEEN %s AND %s "
                "OR (search_diameter_mm IS NULL "
                "AND milling_outside_dia ~ '^[0-9]+(\\.[0-9]+)?$' "
                "AND milling_outside_dia::numeric BETWEEN %s AND %s))"
            )
            params.extend([dia_min, dia_max, dia_min, dia_max])
        elif dia_min is not None:
            where.append(
                "(search_diameter_mm >= %s "
                "OR (search_diameter_mm IS NULL "
                "AND milling_outside_dia ~ '^[0-9]+(\\.[0-9]+)?$' "
                "AND milling_outside_dia::numeric >= %s))"
            )
            params.extend([dia_min, dia_min])
        else:
            where.append(
                "(search_diameter_mm <= %s "
                "OR (search_diameter_mm IS NULL "
                "AND milling_outside_dia ~ '^[0-9]+(\\.[0-9]+)?$' "
                "AND milling_outside_dia::numeric <= %s))"
            )
            params.extend([dia_max, dia_max])
    elif diameter is not None and not _skip("diameter"):
        lo, hi = diameter * 0.9, diameter * 1.1
        where.append(
            "(search_diameter_mm BETWEEN %s AND %s "
            "OR (search_diameter_mm IS NULL "
            "AND milling_outside_dia ~ '^[0-9]+(\\.[0-9]+)?$' "
            "AND milling_outside_dia::numeric BETWEEN %s AND %s))"
        )
        params.extend([lo, hi, lo, hi])

    oal_min = filters.get("overall_length_min")
    oal_max = filters.get("overall_length_max")
    if (oal_min is not None or oal_max is not None) and not _skip("overall_length"):
        clause = _range_clause("milling_overall_length", oal_min, oal_max, params)
        if clause:
            where.append(clause)

    loc_min = filters.get("length_of_cut_min")
    loc_max = filters.get("length_of_cut_max")
    if (loc_min is not None or loc_max is not None) and not _skip("length_of_cut"):
        clause = _range_clause("milling_length_of_cut", loc_min, loc_max, params)
        if clause:
            where.append(clause)

    shank_min = filters.get("shank_diameter_min")
    shank_max = filters.get("shank_diameter_max")
    if (shank_min is not None or shank_max is not None) and not _skip("shank_diameter"):
        clause = _range_clause("milling_shank_dia", shank_min, shank_max, params)
        if clause:
            where.append(clause)

    flute_min = filters.get("flute_count_min")
    flute_max = filters.get("flute_count_max")
    flute_count = filters.get("flute_count")
    if (flute_min is not None or flute_max is not None) and not _skip("flute_count"):
        clause = _range_clause("milling_number_of_flute", flute_min, flute_max, params)
        if clause:
            where.append(clause)
    elif flute_count is not None and not _skip("flute_count"):
        where.append("milling_number_of_flute = %s")
        params.append(str(flute_count))

    material_tag = filters.get("material_tag")
    if material_tag and not _skip("material_tag"):
        where.append("material_tags && ARRAY[%s]::text[]")
        params.append(material_tag)

    tool_type = filters.get("tool_type")
    if tool_type and not _skip("tool_type"):
        # series_tool_type is blank for the majority of end-mill rows in
        # the current MV (~2300/2340 Ball+N rows carry '' instead of
        # 'Solid'). Accept NULL/'' alongside the requested type so
        # "Solid" — scr.py's default for the word "엔드밀" — doesn't
        # silently wipe out 98%+ of the catalog.
        where.append(
            "(series_tool_type IS NULL OR series_tool_type = '' "
            "OR series_tool_type ILIKE %s)"
        )
        params.append(f"%{tool_type}%")

    subtype = filters.get("subtype")
    if subtype and not _skip("subtype"):
        # MV stores shape in two columns and they don't always agree:
        # series_cutting_edge_shape carries the series-level label
        # ("Square" even for ball-nose variants), while search_subtype
        # carries the per-EDP shape ("Ball" for the ball-nose rows).
        # OR-match both so a "볼 엔드밀" intent picks up rows where the
        # series label is Square but the individual SKU is Ball. Same for
        # Corner Radius / Taper / Chamfer / Roughing / High-Feed.
        where.append(
            "(series_cutting_edge_shape ILIKE %s OR search_subtype ILIKE %s)"
        )
        params.extend([f"%{subtype}%", f"%{subtype}%"])

    brand = filters.get("brand")
    if brand and not _skip("brand"):
        where.append("edp_brand_name ILIKE %s")
        params.append(f"%{brand}%")

    coating = filters.get("coating")
    if coating and not _skip("coating"):
        where.append("milling_coating ILIKE %s")
        params.append(f"%{coating}%")

    tool_material = filters.get("tool_material")
    if tool_material and not _skip("tool_material"):
        where.append(
            "("
            "milling_tool_material ILIKE %s "
            "OR holemaking_tool_material ILIKE %s "
            "OR threading_tool_material ILIKE %s"
            ")"
        )
        params.extend([f"%{tool_material}%"] * 3)

    shank_type = filters.get("shank_type")
    if shank_type and not _skip("shank_type"):
        where.append("search_shank_type ILIKE %s")
        params.append(f"%{shank_type}%")

    machining_category = filters.get("machining_category")
    if machining_category and not _skip("machining_category"):
        where.append("series_tool_type ILIKE %s")
        params.append(f"%{machining_category}%")

    application_shape = filters.get("application_shape")
    if application_shape and not _skip("application_shape"):
        where.append("series_application_shape ILIKE %s")
        params.append(f"%{application_shape}%")

    country = filters.get("country")
    if country and not _skip("country"):
        where.append("country_codes @> ARRAY[%s]::text[]")
        params.append(country)

    coolant_hole = filters.get("coolant_hole")
    if coolant_hole and not _skip("coolant_hole"):
        where.append("milling_coolant_hole ILIKE %s")
        params.append(f"%{coolant_hole}%")

    # ── P0/P1 dimensional filters ─────────────────────────────────────
    # All of these MV columns are stored as text (fraction/imperial rows mixed
    # in), so reuse _range_clause's regex-guarded cast for numeric ranges.

    helix_angle = filters.get("helix_angle")
    h_min = filters.get("helix_angle_min")
    h_max = filters.get("helix_angle_max")
    if (h_min is not None or h_max is not None) and not _skip("helix_angle"):
        clause = _range_clause("milling_helix_angle", h_min, h_max, params)
        if clause:
            where.append(clause)
    elif helix_angle is not None and not _skip("helix_angle"):
        # ±2° tolerance by default — "45도 헬릭스" shouldn't exclude 43° / 47°.
        lo, hi = helix_angle - 2, helix_angle + 2
        clause = _range_clause("milling_helix_angle", lo, hi, params)
        if clause:
            where.append(clause)

    point_angle = filters.get("point_angle")
    pa_min = filters.get("point_angle_min")
    pa_max = filters.get("point_angle_max")
    if (pa_min is not None or pa_max is not None) and not _skip("point_angle"):
        clause = _range_clause("holemaking_point_angle", pa_min, pa_max, params)
        if clause:
            where.append(clause)
    elif point_angle is not None and not _skip("point_angle"):
        # Drill point angles are usually discrete (118°/135°/140°) so ±1° is
        # tight enough to map "135도 선단각" onto the intended family.
        lo, hi = point_angle - 1, point_angle + 1
        clause = _range_clause("holemaking_point_angle", lo, hi, params)
        if clause:
            where.append(clause)

    pitch = filters.get("thread_pitch")
    p_min = filters.get("thread_pitch_min")
    p_max = filters.get("thread_pitch_max")
    if (p_min is not None or p_max is not None) and not _skip("thread_pitch"):
        clause = _range_clause("threading_pitch", p_min, p_max, params)
        if clause:
            where.append(clause)
    elif pitch is not None and not _skip("thread_pitch"):
        # Pitches are exact-valued (1.25 / 1.5 / 2.0) — small ±0.05 tolerance
        # just absorbs rounding in the raw spec text.
        clause = _range_clause("threading_pitch", pitch - 0.05, pitch + 0.05, params)
        if clause:
            where.append(clause)

    tpi = filters.get("thread_tpi")
    tpi_min = filters.get("tpi_min")
    tpi_max = filters.get("tpi_max")
    if (tpi_min is not None or tpi_max is not None) and not _skip("thread_tpi"):
        clause = _range_clause("threading_tpi", tpi_min, tpi_max, params)
        if clause:
            where.append(clause)
    elif tpi is not None and not _skip("thread_tpi"):
        clause = _range_clause("threading_tpi", tpi - 0.5, tpi + 0.5, params)
        if clause:
            where.append(clause)

    tol = filters.get("diameter_tolerance")
    if tol and not _skip("diameter_tolerance"):
        where.append("milling_diameter_tolerance ILIKE %s")
        params.append(f"%{tol}%")

    ball_r = filters.get("ball_radius")
    br_min = filters.get("ball_radius_min")
    br_max = filters.get("ball_radius_max")
    if (br_min is not None or br_max is not None) and not _skip("ball_radius"):
        clause = _range_clause("milling_ball_radius", br_min, br_max, params)
        if clause:
            where.append(clause)
    elif ball_r is not None and not _skip("ball_radius"):
        clause = _range_clause("milling_ball_radius", ball_r - 0.05, ball_r + 0.05, params)
        if clause:
            where.append(clause)

    neck_min = filters.get("neck_diameter_min")
    neck_max = filters.get("neck_diameter_max")
    if (neck_min is not None or neck_max is not None) and not _skip("neck_diameter"):
        clause = _range_clause("milling_neck_diameter", neck_min, neck_max, params)
        if clause:
            where.append(clause)

    eff_min = filters.get("effective_length_min")
    eff_max = filters.get("effective_length_max")
    if (eff_min is not None or eff_max is not None) and not _skip("effective_length"):
        clause = _range_clause("milling_effective_length", eff_min, eff_max, params)
        if clause:
            where.append(clause)

    holemaking_ch = filters.get("holemaking_coolant_hole")
    if holemaking_ch and not _skip("holemaking_coolant_hole"):
        where.append("holemaking_coolant_hole ILIKE %s")
        params.append(f"%{holemaking_ch}%")

    threading_ch = filters.get("threading_coolant_hole")
    if threading_ch and not _skip("threading_coolant_hole"):
        where.append("threading_coolant_hole ILIKE %s")
        params.append(f"%{threading_ch}%")

    # ── P2: unit system (Metric/Inch) + normalized brand for perf ─────

    unit_system = filters.get("unit_system")
    if unit_system and not _skip("unit_system"):
        # edp_unit values are "Metric" / "METRIC" / "Inch" — case-insensitive
        # ILIKE covers both the title-case and uppercased rows.
        where.append("edp_unit ILIKE %s")
        params.append(unit_system)

    brand_norm = filters.get("brand_norm")
    if brand_norm and not _skip("brand_norm"):
        where.append("norm_brand = %s")
        params.append(str(brand_norm).upper())

    # ── P3: in-stock gate + warehouse scope ───────────────────────────
    # Implemented as EXISTS subqueries against the inventory tables so the
    # main MV's row count stays cardinality-stable (no JOIN blow-up when a
    # single EDP has many warehouse rows).

    if filters.get("in_stock_only") and not _skip("in_stock_only"):
        where.append(
            f"EXISTS (SELECT 1 FROM {INVENTORY_MV} inv "
            "WHERE inv.edp = edp_no AND inv.total_stock > 0)"
        )

    # stock_min / stock_max — explicit quantity thresholds from SCR
    # ("재고 200개 이상" → stock_min=200). Independent of in_stock_only:
    # an aggregate total_stock ≥ N automatically implies positive stock so
    # both gates don't need to fire together. The SCR regex enforces the
    # mutual exclusion upstream (numeric threshold ⇒ in_stock_only=null).
    stock_min = filters.get("stock_min")
    stock_max = filters.get("stock_max")
    if (stock_min is not None or stock_max is not None) and not _skip("stock_range"):
        cond = ["inv.edp = edp_no"]
        if stock_min is not None:
            cond.append("COALESCE(inv.total_stock, 0) >= %s")
            params.append(int(stock_min))
        if stock_max is not None:
            cond.append("COALESCE(inv.total_stock, 0) <= %s")
            params.append(int(stock_max))
        where.append(
            f"EXISTS (SELECT 1 FROM {INVENTORY_MV} inv WHERE " + " AND ".join(cond) + ")"
        )

    warehouse = filters.get("warehouse")
    if warehouse and not _skip("warehouse"):
        where.append(
            f"EXISTS (SELECT 1 FROM {INVENTORY_SNAPSHOT} inv_s "
            "WHERE inv_s.edp = edp_no "
            "AND inv_s.warehouse_or_region ILIKE %s "
            "AND inv_s.quantity > 0)"
        )
        params.append(f"%{warehouse}%")

    return where, params


def search_products(
    diameter: Optional[float] = None,
    flute_count: Optional[int] = None,
    material_tag: Optional[str] = None,
    tool_type: Optional[str] = None,
    subtype: Optional[str] = None,
    brand: Optional[str] = None,
    coating: Optional[str] = None,
    tool_material: Optional[str] = None,
    shank_type: Optional[str] = None,
    machining_category: Optional[str] = None,
    application_shape: Optional[str] = None,
    country: Optional[str] = None,
    coolant_hole: Optional[str] = None,
    diameter_min: Optional[float] = None,
    diameter_max: Optional[float] = None,
    overall_length_min: Optional[float] = None,
    overall_length_max: Optional[float] = None,
    length_of_cut_min: Optional[float] = None,
    length_of_cut_max: Optional[float] = None,
    shank_diameter_min: Optional[float] = None,
    shank_diameter_max: Optional[float] = None,
    flute_count_min: Optional[int] = None,
    flute_count_max: Optional[int] = None,
    # P0 — dimensional / geometric filters that the old signature dropped.
    helix_angle: Optional[float] = None,
    helix_angle_min: Optional[float] = None,
    helix_angle_max: Optional[float] = None,
    point_angle: Optional[float] = None,
    point_angle_min: Optional[float] = None,
    point_angle_max: Optional[float] = None,
    thread_pitch: Optional[float] = None,
    thread_pitch_min: Optional[float] = None,
    thread_pitch_max: Optional[float] = None,
    thread_tpi: Optional[float] = None,
    tpi_min: Optional[float] = None,
    tpi_max: Optional[float] = None,
    diameter_tolerance: Optional[str] = None,
    # P1 — ball/neck/effective + coolant variants.
    ball_radius: Optional[float] = None,
    ball_radius_min: Optional[float] = None,
    ball_radius_max: Optional[float] = None,
    neck_diameter_min: Optional[float] = None,
    neck_diameter_max: Optional[float] = None,
    effective_length_min: Optional[float] = None,
    effective_length_max: Optional[float] = None,
    holemaking_coolant_hole: Optional[str] = None,
    threading_coolant_hole: Optional[str] = None,
    # P2 — unit switch + perf-oriented normalized brand.
    unit_system: Optional[str] = None,
    brand_norm: Optional[str] = None,
    # P3 — inventory gate.
    in_stock_only: Optional[bool] = None,
    # Numeric stock thresholds ("재고 200개 이상") — independent of
    # in_stock_only which is just the binary any-stock toggle.
    stock_min: Optional[int] = None,
    stock_max: Optional[int] = None,
    warehouse: Optional[str] = None,
    limit: int = 5000,
) -> list[dict]:
    """Filter product_recommendation_mv on SCR intent + manual filter values."""
    filters = {
        "diameter": diameter,
        "flute_count": flute_count,
        "material_tag": material_tag,
        "tool_type": tool_type,
        "subtype": subtype,
        "brand": brand,
        "coating": coating,
        "tool_material": tool_material,
        "shank_type": shank_type,
        "machining_category": machining_category,
        "application_shape": application_shape,
        "country": country,
        "coolant_hole": coolant_hole,
        "diameter_min": diameter_min,
        "diameter_max": diameter_max,
        "overall_length_min": overall_length_min,
        "overall_length_max": overall_length_max,
        "length_of_cut_min": length_of_cut_min,
        "length_of_cut_max": length_of_cut_max,
        "shank_diameter_min": shank_diameter_min,
        "shank_diameter_max": shank_diameter_max,
        "flute_count_min": flute_count_min,
        "flute_count_max": flute_count_max,
        "helix_angle": helix_angle,
        "helix_angle_min": helix_angle_min,
        "helix_angle_max": helix_angle_max,
        "point_angle": point_angle,
        "point_angle_min": point_angle_min,
        "point_angle_max": point_angle_max,
        "thread_pitch": thread_pitch,
        "thread_pitch_min": thread_pitch_min,
        "thread_pitch_max": thread_pitch_max,
        "thread_tpi": thread_tpi,
        "tpi_min": tpi_min,
        "tpi_max": tpi_max,
        "diameter_tolerance": diameter_tolerance,
        "ball_radius": ball_radius,
        "ball_radius_min": ball_radius_min,
        "ball_radius_max": ball_radius_max,
        "neck_diameter_min": neck_diameter_min,
        "neck_diameter_max": neck_diameter_max,
        "effective_length_min": effective_length_min,
        "effective_length_max": effective_length_max,
        "holemaking_coolant_hole": holemaking_coolant_hole,
        "threading_coolant_hole": threading_coolant_hole,
        "unit_system": unit_system,
        "brand_norm": brand_norm,
        "in_stock_only": in_stock_only,
        "stock_min": stock_min,
        "stock_max": stock_max,
        "warehouse": warehouse,
    }
    where, params = _build_where(filters)
    sql = f"""
        SELECT {SELECT_COLS}
        FROM {MV_TABLE}
        WHERE {' AND '.join(where)}
        LIMIT %s
    """
    params.append(limit)
    return fetch_all(sql, tuple(params))


def product_count() -> int:
    row = fetch_one(f"SELECT COUNT(*) AS n FROM {MV_TABLE}")
    return int(row["n"]) if row else 0


def product_count_filtered(filters: dict) -> int:
    """COUNT of products matching `filters` (same semantics as search_products)."""
    where, params = _build_where(filters)
    sql = f"SELECT COUNT(*) AS n FROM {MV_TABLE} WHERE {' AND '.join(where)}"
    row = fetch_one(sql, tuple(params))
    return int(row["n"]) if row else 0


def brand_material_rating(brand: str, material_key: str) -> float | None:
    row = fetch_one(
        """
        SELECT rating_score
        FROM public.brand_material_affinity
        WHERE brand = %s AND material_key = %s
        ORDER BY rating_score DESC
        LIMIT 1
        """,
        (brand, material_key),
    )
    return float(row["rating_score"]) if row else None


# ── Filter-option facets for real-time toggle UI ─────────────────────────

# Each field maps to either a plain column or an unnest expression (for array
# columns). The SELECT expression is used both in `SELECT` and `GROUP BY`.
FIELD_TO_EXPR: dict[str, str] = {
    "subtype": "search_subtype",
    "material_tag": "unnest(material_tags)",
    "coating": "search_coating",
    "brand": "edp_brand_name",
    "flute_count": "milling_number_of_flute",
    "tool_type": "series_tool_type",
    "shank_type": "search_shank_type",
    "tool_material": "milling_tool_material",
    "coolant_hole": "milling_coolant_hole",
    "country": "unnest(country_codes)",
    # P0/P1/P2 — new toggle fields so the UI can enumerate discrete values
    # (helix 30/35/45°, point 118/135/140°, tolerance h6/h7/h8, etc.).
    "helix_angle": "milling_helix_angle",
    "point_angle": "holemaking_point_angle",
    "thread_pitch": "threading_pitch",
    "thread_tpi": "threading_tpi",
    "diameter_tolerance": "milling_diameter_tolerance",
    "ball_radius": "milling_ball_radius",
    "holemaking_coolant_hole": "holemaking_coolant_hole",
    "threading_coolant_hole": "threading_coolant_hole",
    "unit_system": "edp_unit",
}


def get_filter_options(field: str, current_filters: dict) -> list[dict]:
    """Return [{value, count}] for selectable values of `field` under the
    current filter state (with `field` excluded from the WHERE clause so
    the toggle still sees sibling options)."""
    expr = FIELD_TO_EXPR.get(field)
    if expr is None:
        return []

    where, params = _build_where(current_filters, exclude=field)
    sql = f"""
        SELECT {expr} AS value, COUNT(*) AS n
        FROM {MV_TABLE}
        WHERE {' AND '.join(where)}
          AND {expr} IS NOT NULL
        GROUP BY value
        ORDER BY n DESC, value ASC
        LIMIT 50
    """
    rows = fetch_all(sql, tuple(params))
    out: list[dict] = []
    for r in rows:
        val = r.get("value")
        if val in (None, ""):
            continue
        out.append({"value": str(val), "count": int(r["n"])})
    return out
