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
SELECT_COLS = """
    edp_no,
    edp_brand_name        AS brand,
    edp_series_name       AS series,
    edp_series_idx        AS series_idx,
    edp_root_category     AS root_category,
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
    material_tags,
    milling_coating       AS coating,
    search_shank_type,
    option_overall_length,
    option_oal,
    milling_shank_dia,
    holemaking_tool_material,
    threading_tool_material,
    series_application_shape,
    country_codes
"""

MV_TABLE = "catalog_app.product_recommendation_mv"


def _build_where(filters: dict, exclude: Optional[str] = None) -> tuple[list[str], list]:
    """Build the WHERE clauses + params list from a normalized filter dict.
    If `exclude` is set, the clause for that field is skipped — used by
    get_filter_options so toggling a field still counts candidates that
    differ *only* in that field."""
    where: list[str] = [
        "edp_root_category ILIKE %s",
        "milling_outside_dia IS NOT NULL",
    ]
    params: list = ["%mill%"]

    def _skip(name: str) -> bool:
        return exclude == name

    # Explicit numeric ranges win over the heuristic ±10% tolerance. When a
    # user provides diameter_min/max the exact-value tolerance is skipped.
    dia_min = filters.get("diameter_min")
    dia_max = filters.get("diameter_max")
    diameter = filters.get("diameter")
    if (dia_min is not None or dia_max is not None) and not _skip("diameter"):
        clause = _range_clause("milling_outside_dia", dia_min, dia_max, params)
        if clause:
            where.append(clause)
    elif diameter is not None and not _skip("diameter"):
        lo, hi = diameter * 0.9, diameter * 1.1
        where.append(
            "milling_outside_dia ~ '^[0-9]+(\\.[0-9]+)?$' "
            "AND milling_outside_dia::numeric BETWEEN %s AND %s"
        )
        params.extend([lo, hi])

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
        where.append("series_tool_type ILIKE %s")
        params.append(f"%{tool_type}%")

    subtype = filters.get("subtype")
    if subtype and not _skip("subtype"):
        where.append("series_cutting_edge_shape ILIKE %s")
        params.append(f"%{subtype}%")

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
