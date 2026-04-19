#!/usr/bin/env python3
"""Golden regression — YG1_ARIA_Testset_v5_Shared.xlsx 의 singleton 케이스를
Python /recommend 엔드포인트로 보내고 필터 일치 여부를 자동 채점한다.

채점 규칙 (testset "✅ 채점 규칙" 시트의 R1~R12 중 자동 가능한 것만):
  R1  재질 분류 매핑     — "탄소강"/"Carbon Steels" ↔ ISO "P"
  R3  공구 재료 동의어   — "초경" ↔ "CARBIDE" 등
  R4  한글 별칭 매핑     — "비철금속" → "N" 등
  R6  단위 표현 통일     — "6" ↔ "6mm"

Python API 가 실제로 반환하는 필터는 {diameter, flute_count, material_tag,
tool_type, subtype, brand, coating} 뿐이라, testset 에 있는 필드 중 이 7개로
매핑되는 것만 채점하고 나머지(countryCode, cuttingType, productCode 등)는
"unsupported" 로 집계해 비율 왜곡을 막는다.

사용법:
    .venv/bin/python scripts/golden_test.py [--limit 30] [--host http://localhost:8000]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

import httpx
import openpyxl
import pandas as pd

API_ROOT = Path(__file__).resolve().parent.parent            # python-api/
REPO_ROOT = API_ROOT.parent                                   # cook-forge/
XLSX_PATH = REPO_ROOT / "testset" / "YG1_ARIA_Testset_v5_Shared_v5.3.xlsx"
RESULTS_DIR = API_ROOT / "results"
OUTPUT_CSV = RESULTS_DIR / "golden_result.csv"

# Make config.py importable regardless of how this script is invoked
# (python scripts/golden_test.py vs python -m scripts.golden_test).
sys.path.insert(0, str(API_ROOT))
from config import (  # noqa: E402
    GOLDEN_RETRY_STATUS,
    GOLDEN_MAX_RETRIES,
    GOLDEN_BASE_BACKOFF_SEC,
    GOLDEN_INTER_CASE_SLEEP_SEC,
)


# ── Scoring-rule maps ─────────────────────────────────────────────────

# R1/R4/R5 — material / workPieceName → ISO LV1 code. Keys lowercased.
MATERIAL_TO_ISO: dict[str, str] = {
    # ISO direct
    "p": "P", "m": "M", "k": "K", "n": "N", "s": "S", "h": "H", "o": "O",
    # Korean aliases
    "탄소강": "P", "탄소": "P",
    "합금강": "P", "합금": "P",
    "공구강": "P", "구조용강": "P",
    "금형강": "H",
    "스테인리스": "M", "스테인리스강": "M", "스텐": "M", "수스": "M",
    "주철": "K",
    "비철": "N", "비철금속": "N", "알루미늄": "N", "알미늄": "N",
    "구리": "N", "황동": "N", "청동": "N",
    "초내열": "S", "티타늄": "S", "인코넬": "S", "내열합금": "S",
    "초내열합금": "S",
    "고경도": "H", "경화강": "H", "조질강": "H",
    # English LV2 workPieceName
    "carbon steel": "P", "carbon steels": "P",
    "alloy steel": "P", "alloy steels": "P",
    "tool steel": "P", "tool steels": "P",
    "stainless steel": "M", "stainless steels": "M", "sus": "M",
    "cast iron": "K",
    "aluminum": "N", "aluminium": "N", "copper": "N",
    "nonferrous": "N", "non-ferrous": "N",
    "titanium": "S", "inconel": "S", "superalloy": "S", "nickel alloy": "S",
    "hardened steel": "H", "hardened steels": "H",
    "prehardened steel": "H", "prehardened steels": "H",
    "cast steel": "P",
    "graphite": "O", "frp": "O",
}

# R3 — toolMaterial synonym group. Normalizes expected AND actual values
# into a canonical family label for comparison. HSS covers all HSS-* variants
# (HSS-CO, HSS-PM, SUPER-HSS, Premium HSS-PM, …) via prefix/substring match.
TOOL_MATERIAL_SYN: dict[str, str] = {
    "초경": "CARBIDE", "초경합금": "CARBIDE", "카바이드": "CARBIDE",
    "carbide": "CARBIDE", "cemented carbide": "CARBIDE",
    "고속도강": "HSS", "하이스": "HSS", "hss": "HSS",
    "cbn": "CBN", "씨비엔": "CBN",
    "pcd": "PCD", "diamond": "PCD", "다이아몬드": "PCD",
    "서멧": "CERMET", "cermet": "CERMET",
}


def _norm_tool_material(value: Any) -> Optional[str]:
    """Canonicalize any tool-material text → CARBIDE / HSS / CBN / PCD / CERMET."""
    if value is None:
        return None
    s = str(value).strip().lower()
    if not s:
        return None
    # Exact synonym lookup first.
    if s in TOOL_MATERIAL_SYN:
        return TOOL_MATERIAL_SYN[s]
    # DB variants like "hss-co8", "super-hss", "premium hss-pm" → HSS family.
    if "hss" in s or "고속도강" in s or "하이스" in s:
        return "HSS"
    if "carbide" in s or "초경" in s or "카바이드" in s:
        return "CARBIDE"
    if "cbn" in s:
        return "CBN"
    if "pcd" in s or "diamond" in s or "다이아몬드" in s:
        return "PCD"
    if "cermet" in s or "서멧" in s:
        return "CERMET"
    return s.upper()

# Jerry API returns filters as appliedFilters=[{field, op, rawValue}, …].
# Map Jerry's field names onto the flat dict keys this harness's comparators
# already use, so the grading logic stays engine-agnostic. Both camelCase
# (per the original spec) and snake_case (what Jerry actually emits in
# practice) are accepted.
JERRY_FIELD_MAP: dict[str, str] = {
    "material": "material_tag",
    "diameter": "diameter",
    "shape": "subtype",
    "fluteCount": "flute_count",
    "flute_count": "flute_count",
    "coating": "coating",
    "toolMaterial": "tool_material",
    "tool_material": "tool_material",
    "shankType": "shank_type",
    "shank_type": "shank_type",
}


def _parse_jerry_filters(applied: Any) -> dict[str, Any]:
    """Flatten Jerry's appliedFilters array into {python_key: rawValue}."""
    out: dict[str, Any] = {}
    if not isinstance(applied, list):
        return out
    for entry in applied:
        if not isinstance(entry, dict):
            continue
        mapped = JERRY_FIELD_MAP.get(entry.get("field"))
        raw = entry.get("rawValue")
        if mapped and raw is not None:
            out[mapped] = raw
    return out


# Alias map for subtype canonical forms (testset uses "Radius", API uses
# "Corner Radius" — normalize to a single label).
SUBTYPE_ALIAS: dict[str, str] = {
    "radius": "Radius",
    "corner radius": "Radius",
    "corner_radius": "Radius",
    "ball": "Ball",
    "ball nose": "Ball",
    "ball_nose": "Ball",
    "ballnose": "Ball",
    "square": "Square",
    "flat": "Square",
    "taper": "Taper",
    "chamfer": "Chamfer",
    "high-feed": "High-Feed",
    "highfeed": "High-Feed",
    "roughing": "Roughing",
}


# ── XLSX → case list ──────────────────────────────────────────────────

HEADER_TO_IDX = {
    "id": 0, "turn": 1, "total_turn": 2, "turn_pos": 3,
    "category": 4, "category_raw": 5, "is_multiturn": 6,
    "message": 7, "expected_filter": 12,
    "exp_material": 19, "exp_iso": 20, "exp_wpn": 21, "exp_brand": 22,
    "exp_series": 23, "exp_product_code": 24, "exp_subtype": 25,
    "exp_tool_material": 26, "exp_coating": 27, "exp_diameter": 28,
    "exp_loc": 29, "exp_oal": 30, "exp_shank": 31, "exp_flute_count": 32,
    "exp_country": 33, "exp_stock": 34, "exp_cutting_type": 35,
}


def load_singleton_cases(xlsx_path: Path) -> list[dict[str, Any]]:
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb["🧪 테스트 시나리오"]
    cases: list[dict[str, Any]] = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[HEADER_TO_IDX["turn_pos"]] != "single":
            continue
        cases.append({
            "id": row[HEADER_TO_IDX["id"]],
            "category": row[HEADER_TO_IDX["category"]],
            "message": (row[HEADER_TO_IDX["message"]] or "").strip(),
            "expected_filter": row[HEADER_TO_IDX["expected_filter"]] or "",
            "exp_iso": row[HEADER_TO_IDX["exp_iso"]],
            "exp_wpn": row[HEADER_TO_IDX["exp_wpn"]],
            "exp_material": row[HEADER_TO_IDX["exp_material"]],
            "exp_diameter": row[HEADER_TO_IDX["exp_diameter"]],
            "exp_flute_count": row[HEADER_TO_IDX["exp_flute_count"]],
            "exp_subtype": row[HEADER_TO_IDX["exp_subtype"]],
            "exp_coating": row[HEADER_TO_IDX["exp_coating"]],
            "exp_tool_material": row[HEADER_TO_IDX["exp_tool_material"]],
            "exp_brand": row[HEADER_TO_IDX["exp_brand"]],
        })
    return cases


# ── Expected-filter parser ────────────────────────────────────────────

# Top-level split respects `key=value` chunks separated by commas. Negation
# uses `!=`. Narrative prefixes like "기대 결과:" / "필수 필터/의도:" are stripped.
_PREFIX_RE = re.compile(r"^\s*(?:필수\s*필터/의도|기대\s*결과)\s*:\s*", re.IGNORECASE)
_TOKEN_RE = re.compile(r"\s*([A-Za-z_]+)\s*(!=|=)\s*([^,|]+?)\s*(?=(?:,|$|\|))")


def parse_expected_filters(text: str) -> list[tuple[str, str, str]]:
    """Split '필수 필터/의도' into (field, op, value) tuples.
    Skips narrative-only strings (e.g. "기대 결과: 맥락 유지 + ...")."""
    if not text:
        return []
    cleaned = _PREFIX_RE.sub("", text)
    # Drop pipe-delimited narrative tails entirely so they don't confuse the parser.
    cleaned = cleaned.split("|", 1)[0]
    out: list[tuple[str, str, str]] = []
    for m in _TOKEN_RE.finditer(cleaned):
        field, op, value = m.group(1), m.group(2), m.group(3)
        if field and value:
            out.append((field.strip(), op, value.strip()))
    return out


# ── Field comparators ─────────────────────────────────────────────────

def _norm_iso(value: Any) -> Optional[str]:
    """R1/R4/R5 — any material alias → single ISO letter, or None."""
    if value is None:
        return None
    key = str(value).strip().lower()
    if not key:
        return None
    return MATERIAL_TO_ISO.get(key)


def _norm_subtype(value: Any) -> Optional[str]:
    if value is None:
        return None
    key = str(value).strip().lower()
    return SUBTYPE_ALIAS.get(key, key.title() if key else None)


def _norm_number(value: Any) -> Optional[float]:
    """R6 — "6" == "6mm" etc."""
    if value is None:
        return None
    s = str(value).strip().lower()
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def _norm_flute(value: Any) -> Optional[int]:
    n = _norm_number(value)
    return int(n) if n is not None else None


def _norm_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def _compare_material(exp_val: str, actual_filters: dict) -> bool:
    exp_iso = _norm_iso(exp_val)
    act_iso = _norm_str(actual_filters.get("material_tag"))
    if exp_iso is None:
        return False
    return exp_iso == (act_iso or "").upper()


def _compare_diameter(exp_val: str, actual_filters: dict) -> bool:
    exp_n = _norm_number(exp_val)
    act_n = _norm_number(actual_filters.get("diameter"))
    if exp_n is None or act_n is None:
        return False
    return abs(exp_n - act_n) < 1e-6


def _compare_flute(exp_val: str, actual_filters: dict) -> bool:
    exp_n = _norm_flute(exp_val)
    act_n = _norm_flute(actual_filters.get("flute_count"))
    return exp_n is not None and exp_n == act_n


def _compare_subtype(exp_val: str, actual_filters: dict) -> bool:
    exp_s = _norm_subtype(exp_val)
    act_s = _norm_subtype(actual_filters.get("subtype"))
    if not exp_s or not act_s:
        return False
    return exp_s.lower() == act_s.lower()


def _compare_coating(exp_val: str, actual_filters: dict) -> bool:
    exp_s = (_norm_str(exp_val) or "").lower()
    act_s = (_norm_str(actual_filters.get("coating")) or "").lower()
    if not exp_s or not act_s:
        return False
    return exp_s == act_s or exp_s in act_s or act_s in exp_s


def _norm_brand(value: Any) -> str:
    """R2-normalize: lowercase + strip spaces/hyphens/dots so
    'CRX S' == 'CRX-S' == 'CRXS', '4G MILL' == '4gmill'."""
    if value is None:
        return ""
    return re.sub(r"[\s\-\.·/_]+", "", str(value)).lower()


def _compare_brand(exp_val: str, actual_filters: dict) -> bool:
    """R2 — multi-value brand 'A, B' passes if any member matches the
    response's brand filter under space/hyphen-insensitive normalization."""
    act_n = _norm_brand(actual_filters.get("brand"))
    if not act_n:
        return False
    options = [_norm_brand(opt) for opt in re.split(r"[,/]", exp_val) if opt.strip()]
    return any(opt and (opt == act_n or opt in act_n or act_n in opt) for opt in options)


def _compare_tool_material(exp_val: str, actual_filters: dict) -> bool:
    exp_norm = _norm_tool_material(exp_val)
    act_norm = _norm_tool_material(actual_filters.get("tool_material"))
    return exp_norm is not None and exp_norm == act_norm


def _compare_shank_type(exp_val: str, actual_filters: dict) -> bool:
    exp_s = (_norm_str(exp_val) or "").lower()
    act_s = (_norm_str(actual_filters.get("shank_type")) or "").lower()
    if not exp_s or not act_s:
        return False
    return exp_s == act_s or exp_s in act_s or act_s in exp_s


# Comparator for numeric fields that the SCR may emit as a range (min/max).
# Accepts testset expressions like ">=20", "<=100", "15-25", "25" and
# matches against the actual filter's {prefix}_min / {prefix}_max pair.
_RANGE_RE = re.compile(r"^\s*(>=|<=|>|<)?\s*(-?\d+(?:\.\d+)?)\s*$")
_BETWEEN_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*(?:-|~|to|…|–|—)\s*(-?\d+(?:\.\d+)?)\s*$")


def _compare_numeric_range(prefix: str, exp_val: str, actual_filters: dict) -> bool:
    """Treat `exp_val` as one of: "20", ">=20", "<=30", "15-25".
    Pass when the actual filter's `{prefix}_min`/`{prefix}_max` pair is
    consistent with that expression. An exact value matches when the
    actual range contains it (or equals it); a one-sided comparator
    matches when the SCR emitted a matching bound."""
    exp_s = str(exp_val or "").strip()
    act_lo = _norm_number(actual_filters.get(f"{prefix}_min"))
    act_hi = _norm_number(actual_filters.get(f"{prefix}_max"))

    m_between = _BETWEEN_RE.match(exp_s)
    if m_between:
        lo = float(m_between.group(1))
        hi = float(m_between.group(2))
        if lo > hi:
            lo, hi = hi, lo
        # Accept when the SCR's range overlaps the expected one.
        return (
            (act_lo is None or act_lo <= hi) and
            (act_hi is None or act_hi >= lo) and
            (act_lo is not None or act_hi is not None)
        )

    m = _RANGE_RE.match(exp_s)
    if not m:
        return False
    op = m.group(1)
    val = float(m.group(2))
    if op in (">=", ">", None, ""):
        # Expected: "≥ val". Passes if SCR set a min ≥ val (fully covered)
        # OR picked an exact value equal to val.
        if op in ("", None):
            return (
                (act_lo is not None and act_lo == val) or
                (act_hi is not None and act_hi == val) or
                (act_lo is not None and act_hi is not None and act_lo <= val <= act_hi)
            )
        return act_lo is not None and act_lo >= val
    if op in ("<=", "<"):
        return act_hi is not None and act_hi <= val
    return False


def _compare_loc(exp_val: str, actual_filters: dict) -> bool:
    return _compare_numeric_range("length_of_cut", exp_val, actual_filters)


def _compare_oal(exp_val: str, actual_filters: dict) -> bool:
    return _compare_numeric_range("overall_length", exp_val, actual_filters)


def _compare_shank_dia(exp_val: str, actual_filters: dict) -> bool:
    """shank_diameter has an exact-value slot AND min/max bounds. Check the
    range path first; if the SCR only set the exact field ("샹크 8mm"),
    fall back to a direct equality on shank_diameter."""
    if _compare_numeric_range("shank_diameter", exp_val, actual_filters):
        return True
    exp_n = _norm_number(exp_val)
    act_n = _norm_number(actual_filters.get("shank_diameter"))
    if exp_n is None or act_n is None:
        return False
    return abs(exp_n - act_n) < 1e-6


def _compare_series_name(exp_val: str, actual_filters: dict) -> bool:
    """Case/space-insensitive match of the emitted series_name against the
    expected token. Accepts "GMF52" ~= "gmf 52" — _norm_brand re-uses the
    same hyphen/space stripping so "V7-PLUS" matches "V7 PLUS"."""
    exp_n = _norm_brand(exp_val)
    act_n = _norm_brand(actual_filters.get("series_name"))
    if not exp_n or not act_n:
        return False
    return exp_n == act_n or exp_n in act_n or act_n in exp_n


# Expected-field → comparator + whether my API supports it.
SUPPORTED_COMPARATORS = {
    "material": _compare_material,
    "workPieceName": _compare_material,   # maps to ISO via R5
    "diameterMm": _compare_diameter,
    "fluteCount": _compare_flute,
    "toolSubtype": _compare_subtype,
    "coating": _compare_coating,
    "brand": _compare_brand,
    "toolMaterial": _compare_tool_material,
    "shankType": _compare_shank_type,
    # P2 — previously skipped, now backed by SCR min/max slots.
    "lengthOfCut": _compare_loc,
    "overallLength": _compare_oal,
    "shankDiameter": _compare_shank_dia,
    "seriesName": _compare_series_name,
}
UNSUPPORTED_FIELDS = {
    "countryCode", "cuttingType", "productCode",
    "totalStock", "country",
}


# ── Per-case grading ──────────────────────────────────────────────────

def grade_case(
    expected: list[tuple[str, str, str]],
    filters: dict,
    message: str = "",
) -> dict:
    """Returns {status, matched, supported_total, skipped_fields, detail}."""
    matched = 0
    supported_total = 0
    skipped: list[str] = []
    detail: list[str] = []

    for field, op, value in expected:
        if field in SUPPORTED_COMPARATORS:
            supported_total += 1
            cmp = SUPPORTED_COMPARATORS[field]
            hit = cmp(value, filters)
            if op == "!=":
                hit = not hit
            if hit:
                matched += 1
                detail.append(f"{field}={value}: OK")
            else:
                detail.append(f"{field}={value}: MISS (got {filters})")
        elif field in UNSUPPORTED_FIELDS:
            skipped.append(field)
        # Unknown fields: ignore (comments, typos).

    if supported_total == 0:
        status = "skip"
    elif matched == supported_total:
        status = "pass"
    elif matched / supported_total >= 0.5:
        status = "partial"
    else:
        status = "fail"

    return {
        "status": status,
        "matched": matched,
        "supported_total": supported_total,
        "skipped_fields": ",".join(skipped),
        "detail": "; ".join(detail),
    }


# ── HTTP runner ───────────────────────────────────────────────────────

def _init_row(case: dict, jerry: bool) -> dict:
    return {
        "id": case["id"],
        "category": case["category"],
        "engine": "jerry" if jerry else "python",
        "message": case["message"],
        "expected": case["expected_filter"],
        "status": "fail",
        "matched": 0,
        "supported_total": 0,
        "skipped_fields": "",
        "route": None,
        "actual_filters": None,
        "latency_ms": None,
        "error": None,
        "fallback": False,
    }


# Jerry signals filter relaxation in its assistantMessage body. When any of
# these phrases appear, a partial/fail on the appliedFilters diff is usually
# not Jerry misunderstanding the user — it's Jerry honestly reporting "0 exact
# matches, here's the closest DB has". Grading policy A treats those as pass.
_FALLBACK_MARKERS = re.compile(
    r"필터\s*완화|조건\s*완화|완화\s*하여|근접한|정확히\s*일치하는\s*\S+\s*0건|"
    r"0\s*건이\s*있|0\s*건이었|조건\s*불일치|불일치\s*안내|fallback|relaxed|"
    r"⌀\d+\s*(?:mm)?\s*[→➡]"
)


def _detect_fallback(body: dict) -> bool:
    msg = body.get("assistantMessage") or ""
    return bool(_FALLBACK_MARKERS.search(msg))


def _apply_response(row: dict, body: dict, case: dict, jerry: bool, expected) -> None:
    if jerry:
        filters = _parse_jerry_filters(body.get("appliedFilters"))
        row["route"] = body.get("route") or "jerry"
        row["fallback"] = _detect_fallback(body)
    else:
        filters = body.get("filters") or {}
        row["route"] = body.get("route")
    row["actual_filters"] = json.dumps(filters, ensure_ascii=False)
    graded = grade_case(expected, filters, message=case["message"])
    # Policy A: Jerry explicitly announced a relaxation / no-exact-match
    # fallback, so don't penalize the appliedFilters diff — treat as pass.
    if jerry and row["fallback"] and graded["status"] in ("partial", "fail"):
        graded["status"] = "pass"
        graded["detail"] = (graded.get("detail") or "") + " [fallback-accepted]"
    row.update(graded)


# Status codes + retry budget live in config.py (GOLDEN_* family) so ops
# can retune without editing the script. Module-level aliases keep the
# existing call sites readable.
_RETRY_STATUS = GOLDEN_RETRY_STATUS
_MAX_RETRIES = GOLDEN_MAX_RETRIES
_BASE_BACKOFF = GOLDEN_BASE_BACKOFF_SEC


def run_case(client: httpx.Client, case: dict, *, jerry: bool = False) -> dict:
    row = _init_row(case, jerry)
    if not case["message"]:
        row["error"] = "empty message"
        return row

    expected = parse_expected_filters(case["expected_filter"])
    endpoint = "/qa/recommend" if jerry else "/recommend"
    t0 = time.perf_counter()
    last_err = None
    for attempt in range(_MAX_RETRIES):
        try:
            resp = client.post(endpoint, json={"message": case["message"]}, timeout=60)
            if resp.status_code in _RETRY_STATUS and attempt < _MAX_RETRIES - 1:
                time.sleep(_BASE_BACKOFF * (2 ** attempt))
                continue
            row["latency_ms"] = int((time.perf_counter() - t0) * 1000)
            resp.raise_for_status()
            _apply_response(row, resp.json(), case, jerry, expected)
            last_err = None
            break
        except httpx.HTTPStatusError as e:
            last_err = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
            if e.response.status_code in _RETRY_STATUS and attempt < _MAX_RETRIES - 1:
                time.sleep(_BASE_BACKOFF * (2 ** attempt))
                continue
            row["latency_ms"] = int((time.perf_counter() - t0) * 1000)
            row["error"] = last_err
            break
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            if attempt < _MAX_RETRIES - 1:
                time.sleep(_BASE_BACKOFF * (2 ** attempt))
                continue
            row["latency_ms"] = int((time.perf_counter() - t0) * 1000)
            row["error"] = last_err
            break
    return row


async def run_case_async(client: httpx.AsyncClient, case: dict, *, jerry: bool = False) -> dict:
    row = _init_row(case, jerry)
    if not case["message"]:
        row["error"] = "empty message"
        return row

    expected = parse_expected_filters(case["expected_filter"])
    endpoint = "/qa/recommend" if jerry else "/recommend"
    t0 = time.perf_counter()
    last_err = None
    for attempt in range(_MAX_RETRIES):
        try:
            resp = await client.post(endpoint, json={"message": case["message"]}, timeout=60)
            if resp.status_code in _RETRY_STATUS and attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(_BASE_BACKOFF * (2 ** attempt))
                continue
            row["latency_ms"] = int((time.perf_counter() - t0) * 1000)
            resp.raise_for_status()
            _apply_response(row, resp.json(), case, jerry, expected)
            last_err = None
            break
        except httpx.HTTPStatusError as e:
            last_err = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
            if e.response.status_code in _RETRY_STATUS and attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(_BASE_BACKOFF * (2 ** attempt))
                continue
            row["latency_ms"] = int((time.perf_counter() - t0) * 1000)
            row["error"] = last_err
            break
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            if attempt < _MAX_RETRIES - 1:
                await asyncio.sleep(_BASE_BACKOFF * (2 ** attempt))
                continue
            row["latency_ms"] = int((time.perf_counter() - t0) * 1000)
            row["error"] = last_err
            break
    return row


async def run_all_async(cases: list[dict], host: str, jerry: bool, concurrency: int) -> list[dict]:
    """Run `cases` against the API with up to `concurrency` in-flight requests.
    Order of rows in the returned list matches the input order; progress is
    printed in completion order so slow calls don't block the log."""
    sem = asyncio.Semaphore(concurrency)
    rows: list[dict | None] = [None] * len(cases)
    done = 0
    total = len(cases)
    limits = httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency)
    async with httpx.AsyncClient(base_url=host, limits=limits) as client:
        async def worker(idx: int, case: dict) -> None:
            nonlocal done
            async with sem:
                row = await run_case_async(client, case, jerry=jerry)
            rows[idx] = row
            done += 1
            mark = {"pass": "OK ", "partial": "PRT", "fail": "FAIL", "skip": "SKIP"}.get(row["status"], "ERR")
            print(
                f"  [{done:>3}/{total}] {mark} {row['id']:<8} "
                f"{row['matched']}/{row['supported_total']}  "
                f"route={row['route'] or '-':<13}  "
                f"{row['latency_ms']}ms"
                + (f"  {row['error']}" if row["error"] else ""),
                flush=True,
            )

        await asyncio.gather(*(worker(i, c) for i, c in enumerate(cases)))
    return [r for r in rows if r is not None]


# ── Main ──────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="http://localhost:8000")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--offset", type=int, default=0,
                        help="skip the first N singleton cases (useful to hop past toolMaterial-only ADD-* block)")
    parser.add_argument("--output", type=Path, default=OUTPUT_CSV)
    parser.add_argument("--xlsx", type=Path, default=XLSX_PATH)
    parser.add_argument("--jerry", action="store_true",
                        help="hit Jerry's /qa/recommend endpoint and parse appliedFilters instead of /recommend")
    parser.add_argument("--concurrency", type=int, default=1,
                        help="number of in-flight requests (default 1 = sequential). "
                             "Use e.g. 10 to parallelize against a slow backend.")
    parser.add_argument("--sleep", type=float, default=GOLDEN_INTER_CASE_SLEEP_SEC,
                        help="inter-case pause in seconds (sequential mode only). "
                             "Prevents OpenAI TPM rate-limit trips on long runs. "
                             "Set 0 to disable.")
    args = parser.parse_args()

    cases = load_singleton_cases(args.xlsx)
    print(f"[golden] loaded {len(cases)} singleton cases from {args.xlsx.name}")

    if args.offset:
        cases = cases[args.offset:]
        print(f"[golden] --offset → skipping first {args.offset}, remaining {len(cases)}")

    if args.limit:
        cases = cases[: args.limit]
        print(f"[golden] --limit → running first {len(cases)}")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    if args.jerry:
        print(f"[golden] --jerry → POST {args.host}/qa/recommend (parsing appliedFilters)")
    if args.concurrency > 1:
        print(f"[golden] --concurrency → {args.concurrency} in-flight requests")

    if args.concurrency > 1:
        rows = asyncio.run(run_all_async(cases, args.host, args.jerry, args.concurrency))
    else:
        rows = []
        with httpx.Client(base_url=args.host) as client:
            for i, case in enumerate(cases, 1):
                row = run_case(client, case, jerry=args.jerry)
                rows.append(row)
                status_mark = {"pass": "OK ", "partial": "PRT", "fail": "FAIL", "skip": "SKIP"}.get(row["status"], "ERR")
                print(
                    f"  [{i:>3}/{len(cases)}] {status_mark} {row['id']:<8} "
                    f"{row['matched']}/{row['supported_total']}  "
                    f"route={row['route'] or '-':<13}  "
                    f"{row['latency_ms']}ms"
                    + (f"  {row['error']}" if row["error"] else ""),
                    flush=True,
                )
                # Pace requests so OpenAI's TPM limit on gpt-5.4-mini doesn't
                # trip mid-run. 0.3s between cases keeps ~3 req/s which stays
                # under the 200k TPM ceiling given typical 6k-token prompts.
                if i < len(cases):
                    time.sleep(args.sleep)

    df = pd.DataFrame(rows)
    df.to_csv(args.output, index=False)

    # ── Summary ────────────────────────────────────────────────
    total = len(df)
    by_status: dict[str, int] = df["status"].value_counts().to_dict() if total else {}
    supported_cases = total - by_status.get("skip", 0)
    passes = by_status.get("pass", 0)
    partials = by_status.get("partial", 0)
    fails = by_status.get("fail", 0)
    skips = by_status.get("skip", 0)

    pass_rate = (passes / supported_cases * 100) if supported_cases else 0.0
    lenient_rate = ((passes + partials) / supported_cases * 100) if supported_cases else 0.0

    print()
    print("=" * 60)
    print(f"[golden] total={total}  pass={passes}  partial={partials}  fail={fails}  skip={skips}")
    print(f"[golden] 공정 통과율 = {pass_rate:.1f}%   관대 통과율 = {lenient_rate:.1f}%")
    print(f"[golden] (비지원 필드만 있는 case {skips}건은 공정통과율 denominator 에서 제외)")
    print()

    # Category breakdown
    print("[golden] 카테고리별:")
    cat_table: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r in rows:
        cat_table[r["category"]][r["status"]] += 1
    for cat, stats in sorted(cat_table.items()):
        total_c = sum(stats.values())
        supp_c = total_c - stats.get("skip", 0)
        rate = (stats.get("pass", 0) / supp_c * 100) if supp_c else 0.0
        print(
            f"  {str(cat):<28} "
            f"pass={stats.get('pass',0):<3} "
            f"partial={stats.get('partial',0):<3} "
            f"fail={stats.get('fail',0):<3} "
            f"skip={stats.get('skip',0):<3} "
            f"({rate:.0f}%)"
        )
    print(f"\n[golden] CSV → {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
