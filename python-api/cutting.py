"""Cutting-condition catalog — loads the digitized YG-1 condition chart
(data/cutting_conditions.csv, ~18k rows) into pandas and exposes two
query shapes:

  get_cutting_conditions(brand, series, iso, workpiece, limit)
    → flat list, used by the /cutting-conditions browse endpoint.

  get_conditions_for_products(products, iso)
    → {edp_no: [conditions …]} bulk lookup, used by /products to attach
      recommended Vc/Fz/RPM alongside each top-10 card.

Pandas is already a dependency (scripts/golden_test.py). DataFrame is
cached in-process; the CSV is static so no TTL is needed.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import pandas as pd

_CSV_PATH = Path(__file__).resolve().parent / "data" / "cutting_conditions.csv"

_NUMERIC_COLS = ("Vc", "Fz", "RPM", "Feed", "Ap", "Ae")

_DF: pd.DataFrame | None = None


def _load() -> pd.DataFrame:
    """Read and normalize the CSV once per process. Numeric columns are
    coerced (invalid rows become NaN, not exceptions)."""
    global _DF
    if _DF is not None:
        return _DF
    try:
        df = pd.read_csv(_CSV_PATH, encoding="utf-8-sig")
    except FileNotFoundError:
        _DF = pd.DataFrame()
        return _DF
    for col in _NUMERIC_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    _DF = df
    return _DF


def _records(df: pd.DataFrame) -> list[dict]:
    """DataFrame → list[dict] with NaN replaced by None (JSON-safe)."""
    if df.empty:
        return []
    return df.where(df.notna(), None).to_dict("records")


def get_cutting_conditions(
    brand: Optional[str] = None,
    series: Optional[str] = None,
    iso: Optional[str] = None,
    workpiece: Optional[str] = None,
    limit: int = 20,
) -> list[dict]:
    """Filter the condition chart. All filters are optional and AND-combined.
    Brand/series/iso match exactly (case-insensitive); workpiece does a
    case-insensitive contains so "SUS" matches "SUS304", "SUS316 L", etc."""
    df = _load()
    if df.empty:
        return []
    out = df
    if brand:
        out = out[out["brand"].astype(str).str.upper() == brand.upper()]
    if series:
        out = out[out["series"].astype(str).str.upper() == series.upper()]
    if iso:
        out = out[out["iso"].astype(str).str.upper() == iso.upper()]
    if workpiece:
        out = out[out["workpiece"].astype(str).str.contains(workpiece, case=False, na=False)]
    return _records(out.head(limit))


def get_conditions_for_products(
    products: list[dict],
    iso: Optional[str] = None,
    per_product_limit: int = 5,
) -> dict[str, list[dict]]:
    """Bulk lookup for ranked product cards. Keys are edp_no strings; value
    is up to `per_product_limit` condition rows matching the product's
    brand+series (and optional ISO group)."""
    df = _load()
    result: dict[str, list[dict]] = {}
    if df.empty:
        return result

    iso_up = iso.upper() if iso else None
    brand_series_col = df["brand"].astype(str).str.upper()
    series_col = df["series"].astype(str).str.upper()
    iso_col = df["iso"].astype(str).str.upper() if "iso" in df.columns else None

    for p in products:
        edp = p.get("edp_no")
        if not edp:
            continue
        brand = (p.get("brand") or "").upper()
        series = (p.get("series") or "").upper()
        if not brand and not series:
            continue
        mask = pd.Series(True, index=df.index)
        if brand:
            mask &= (brand_series_col == brand)
        if series:
            mask &= (series_col == series)
        if iso_up and iso_col is not None:
            mask &= (iso_col == iso_up)
        matched = df[mask].head(per_product_limit)
        if not matched.empty:
            result[str(edp)] = _records(matched)
    return result
