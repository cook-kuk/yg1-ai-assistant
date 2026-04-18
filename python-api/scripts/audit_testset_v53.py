#!/usr/bin/env python3
"""Testset v5.3 audit — scan all 427 singleton cases for 3 defect patterns:

  P_MISMATCH     expected material=P (or exp iso "P") but message contains
                 an M-group cue (sus/sts/stainless/스테인리스/스텐/수스)

  M_MISMATCH     expected material=M but message contains a P-group cue
                 (탄소강/S45C/SM45C/SCM/합금강/carbon steel)

  BRAND_MISSING  expected brand value not in the DB's distinct
                 edp_brand_name set (case/hyphen/whitespace insensitive)

Read-only. Writes results/testset_v53_audit.csv. Uses v5.3 XLSX by default
so the scan reflects the post-fixup state.
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # python-api root, for `db`

from golden_test import (  # noqa: E402
    load_singleton_cases,
    parse_expected_filters,
    RESULTS_DIR,
)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
XLSX_V53 = REPO_ROOT / "testset" / "YG1_ARIA_Testset_v5_Shared_v5.3.xlsx"
OUTPUT_CSV = RESULTS_DIR / "testset_v53_audit.csv"

# Group-cue regexes — match explicit national-standard or Korean aliases.
M_CUES = re.compile(
    r"\b(sus|sts)\s*\d|(?:^|\W)(sus|sts)\b|stainless|inox|스테인리스|스텐|수스|스뎅",
    re.IGNORECASE,
)
P_CUES = re.compile(
    r"(?:^|\W)(s[0-9]{2}c|sm\s*\d{2,3}c?|scm\s*\d{3,4}|skd\s*\d|skh\s*\d|carbon\s*steel|탄소강|합금강|공구강|구조용\s*강)",
    re.IGNORECASE,
)


def _normalize_brand(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"[\s\-·ㆍ./(),_]+", "", value.strip().upper())


def _load_db_brands() -> set[str]:
    """DISTINCT edp_brand_name from the MV, normalized (upper + stripped)."""
    try:
        # Reuse the same PG helper the service uses, so env/credentials match.
        from db import fetch_all
    except Exception as e:
        print(f"[audit] db import failed: {e}", file=sys.stderr)
        return set()
    try:
        rows = fetch_all(
            "SELECT DISTINCT BTRIM(edp_brand_name) AS b "
            "FROM catalog_app.product_recommendation_mv "
            "WHERE edp_brand_name IS NOT NULL "
            "AND BTRIM(edp_brand_name) <> ''"
        )
    except Exception as e:
        print(f"[audit] db query failed: {e}", file=sys.stderr)
        return set()
    return {_normalize_brand(r["b"]) for r in rows if r.get("b")}


def _material_from_expected(tokens: list[tuple[str, str, str]]) -> str | None:
    """Return expected ISO material letter (P/M/K/N/S/H), if the case pins it.
    Treats both `material=X` and `workPieceName=<name>` as indicators."""
    wpn_to_iso = {
        "stainless steel": "M", "stainless steels": "M",
        "carbon steel": "P", "carbon steels": "P",
        "alloy steel": "P", "alloy steels": "P",
        "cast iron": "K", "aluminum": "N", "aluminium": "N",
        "copper": "N", "titanium": "S", "inconel": "S",
        "hardened steel": "H", "hardened steels": "H",
    }
    for field, op, value in tokens:
        if op == "!=":
            continue
        if field == "material":
            v = value.strip().upper()
            if v in {"P", "M", "K", "N", "S", "H"}:
                return v
        elif field == "workPieceName":
            mapped = wpn_to_iso.get(value.strip().lower())
            if mapped:
                return mapped
    return None


def _brand_expected(tokens: list[tuple[str, str, str]]) -> list[str]:
    """Positive brand expectations only (ignore brand!=X excludes)."""
    return [v for f, op, v in tokens if f == "brand" and op == "=" and v]


def audit() -> list[dict]:
    cases = load_singleton_cases(XLSX_V53)
    db_brands = _load_db_brands()
    print(f"[audit] loaded {len(cases)} cases, {len(db_brands)} DB brands")

    findings: list[dict] = []
    for c in cases:
        msg = c["message"] or ""
        tokens = parse_expected_filters(c["expected_filter"] or "")
        iso = _material_from_expected(tokens)

        # Pattern 1 — P expected but M cue in message
        if iso == "P" and M_CUES.search(msg):
            findings.append({
                "id": c["id"], "pattern": "P_MISMATCH",
                "detail": f"iso=P but message has M-group cue",
                "message_excerpt": msg[:140],
                "expected": c["expected_filter"][:140],
            })
        # Pattern 2 — M expected but P cue in message
        if iso == "M" and P_CUES.search(msg):
            findings.append({
                "id": c["id"], "pattern": "M_MISMATCH",
                "detail": f"iso=M but message has P-group cue",
                "message_excerpt": msg[:140],
                "expected": c["expected_filter"][:140],
            })
        # Pattern 3 — brand not in DB
        for brand_val in _brand_expected(tokens):
            if not db_brands:
                break  # DB unavailable — don't flag false-positives
            key = _normalize_brand(brand_val)
            if not key:
                continue
            # Accept prefix match: "ALU-CUT" ~ "ALU-CUT for Korean Market"
            if key in db_brands:
                continue
            prefix_hit = any(key in b or b in key for b in db_brands if b)
            if not prefix_hit:
                findings.append({
                    "id": c["id"], "pattern": "BRAND_MISSING",
                    "detail": f"brand={brand_val!r} not found in DB",
                    "message_excerpt": msg[:140],
                    "expected": c["expected_filter"][:140],
                })

    return findings


def main() -> int:
    findings = audit()
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["id", "pattern", "detail", "message_excerpt", "expected"],
        )
        writer.writeheader()
        writer.writerows(findings)

    by_pattern: dict[str, int] = {}
    for r in findings:
        by_pattern[r["pattern"]] = by_pattern.get(r["pattern"], 0) + 1
    print(f"[audit] candidates: {len(findings)}")
    for k, v in sorted(by_pattern.items(), key=lambda x: -x[1]):
        print(f"  {v:>4}  {k}")
    print(f"[audit] → {OUTPUT_CSV}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
