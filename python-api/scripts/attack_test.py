#!/usr/bin/env python3
"""Jerry 하드코딩 공격 testset 채점기.

Usage:
    # 승호 API
    python scripts/attack_test.py --host http://127.0.0.1:8010

    # Jerry API (동일 스크립트, 라벨과 호스트만 교체)
    python scripts/attack_test.py --jerry --host http://127.0.0.1:3002

    # 자세한 실패 이유:
    python scripts/attack_test.py --host http://127.0.0.1:8010 -v
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
TESTSET_PATH = HERE.parent / "testset" / "jerry_attack.json"


def norm_scalar(value: Any) -> Any:
    """Strings compared case-insensitively with surrounding whitespace stripped.
    Numbers kept as-is. Everything else stringified."""
    if isinstance(value, str):
        return value.strip().casefold()
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return float(value)
    return str(value).strip().casefold()


def value_matches(actual: Any, expected: Any) -> bool:
    if actual is None:
        return False
    if isinstance(expected, (int, float)) and not isinstance(expected, bool):
        try:
            return abs(float(actual) - float(expected)) <= 0.01
        except (TypeError, ValueError):
            return False
    return norm_scalar(actual) == norm_scalar(expected)


# Field aliases — different backends name the same semantic slot differently.
# Expected-side uses the left key; actual-side may use any alias on the right.
FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "material_tag": ("material_tag", "material_group", "material"),
    "subtype": ("subtype", "shape", "tool_subtype"),
    "brand": ("brand",),
    "coating": ("coating",),
    "diameter": ("diameter", "diameter_mm", "diameterMm"),
    "flute_count": ("flute_count", "flute", "flutes", "fluteCount"),
}


def _flatten_applied_filters_list(raw: list) -> dict:
    """Jerry-style: list of {field, op, rawValue} → flat dict."""
    out: dict[str, Any] = {}
    for item in raw:
        if not isinstance(item, dict):
            continue
        field = item.get("field")
        if not field:
            continue
        if "rawValue" in item:
            out[field] = item["rawValue"]
        elif "value" in item:
            out[field] = item["value"]
    return out


def extract_filters(body: Any) -> dict:
    """Normalize heterogenous response shapes to a single flat dict.

    Absorbs:
    - 승호 /products: top-level `appliedFilters` as dict
    - Jerry /qa/recommend: top-level `appliedFilters` as list[{field, op, rawValue}]
      plus richer `intent` dict (merged — applied wins on conflict)
    - legacy /recommend: top-level `filters` dict
    """
    if not isinstance(body, dict):
        return {}
    merged: dict[str, Any] = {}

    # Lower-priority fallback dicts first — applied filters overlay them.
    for key in ("intent", "scrIntent", "extracted", "filters"):
        v = body.get(key)
        if isinstance(v, dict):
            merged.update({k: val for k, val in v.items() if val is not None})

    applied = body.get("appliedFilters")
    if isinstance(applied, dict):
        merged.update({k: v for k, v in applied.items() if v is not None})
    elif isinstance(applied, list):
        merged.update(_flatten_applied_filters_list(applied))

    return merged


def lookup_field(actual: dict, canonical: str) -> Any:
    """Resolve an expected-side field name to actual-side via alias table."""
    for alias in FIELD_ALIASES.get(canonical, (canonical,)):
        if alias in actual and actual[alias] is not None:
            return actual[alias]
    return None


def score_case(base_url: str, endpoint: str, case: dict, timeout: float) -> tuple[bool, list[str], str | None]:
    url = f"{base_url.rstrip('/')}/{endpoint.lstrip('/')}"
    payload = json.dumps({"message": case["message"]}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        body_preview = exc.read()[:120].decode("utf-8", errors="replace") if hasattr(exc, "read") else ""
        return False, [], f"HTTP {exc.code}: {body_preview}"
    except urllib.error.URLError as exc:
        return False, [], f"URLError: {exc.reason}"
    except Exception as exc:  # noqa: BLE001 — surface any other fetch failure
        return False, [], f"{type(exc).__name__}: {exc}"

    try:
        body = json.loads(raw.decode("utf-8"))
    except ValueError as exc:
        return False, [], f"non-JSON body: {exc}"

    actual = extract_filters(body)
    misses: list[str] = []
    for field, expected in case["expected"].items():
        got = lookup_field(actual, field)
        if not value_matches(got, expected):
            misses.append(f"{field}={got!r} (want {expected!r})")
    return len(misses) == 0, misses, None


def summarize_by_category(results: list[tuple[dict, bool]]) -> dict[str, tuple[int, int]]:
    buckets: dict[str, list[bool]] = {}
    for case, ok in results:
        buckets.setdefault(case.get("category", "misc"), []).append(ok)
    return {cat: (sum(flags), len(flags)) for cat, flags in buckets.items()}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="http://127.0.0.1:8010", help="API base URL")
    parser.add_argument("--endpoint", default="/products", help="POST endpoint path (default /products)")
    parser.add_argument("--jerry", action="store_true", help="label run as 'Jerry' (otherwise '승호')")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("-v", "--verbose", action="store_true", help="print every case, not just failures")
    parser.add_argument("--testset", default=str(TESTSET_PATH))
    args = parser.parse_args()

    cases_path = Path(args.testset)
    if not cases_path.exists():
        print(f"testset not found: {cases_path}", file=sys.stderr)
        return 2
    cases = json.loads(cases_path.read_text(encoding="utf-8"))
    label = "Jerry" if args.jerry else "승호"

    print(f"[{label}] host={args.host}{args.endpoint}  cases={len(cases)}")
    print("-" * 78)

    results: list[tuple[dict, bool]] = []
    passed = 0
    t0 = time.time()
    for case in cases:
        ok, misses, err = score_case(args.host, args.endpoint, case, args.timeout)
        results.append((case, ok))
        passed += int(ok)
        mark = "✓" if ok else "✗"
        if args.verbose or not ok:
            print(f"  {mark} {case['id']:<8} [{case.get('category','?'):<9}] {case['attack']:<22} | {case['message']}")
            if err:
                print(f"      → {err}")
            elif misses:
                print(f"      → " + "; ".join(misses))
    dt = time.time() - t0

    print("-" * 78)
    by_cat = summarize_by_category(results)
    for cat, (p, n) in sorted(by_cat.items()):
        print(f"  {cat:<10} {p}/{n}")
    print("-" * 78)
    pct = (passed / len(cases) * 100.0) if cases else 0.0
    print(f"[{label}] {passed}/{len(cases)}  ({pct:.1f}%)  in {dt:.1f}s")
    return 0 if passed == len(cases) else 1


if __name__ == "__main__":
    sys.exit(main())
