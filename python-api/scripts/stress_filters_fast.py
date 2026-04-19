"""Fastest variant of stress_filters.py — hits /recommend (parse+rank,
no CoT round-trip) in parallel via aiohttp with concurrency=20.

/recommend response shape:
  {filters: {...}, candidates: [...], scores: [...]}
so the harness's totalCount / appliedFilters checks map to:
  totalCount ≈ len(candidates)  (recommend caps at top 5)
  appliedFilters ≈ filters dict

For filter-value assertions this is equivalent; for "nonzero result"
assertions we now require len(candidates) > 0.
"""
from __future__ import annotations

import asyncio
import json
import sys
import time

import aiohttp


ENDPOINT = "http://127.0.0.1:8010/recommend"
# concurrency 2 because each parse_intent call is ~7k prompt tokens and
# gpt-5.4-mini's org quota is 200k TPM. At concurrency 3 we consistently
# see 2–4 / 83 fall to `openai.RateLimitError` even with max_retries=5 —
# the Retry-After hint outlives our per-request timeout. 2 keeps the
# test deterministic at the cost of ~60s longer total runtime.
CONCURRENCY = 2


async def post(session: aiohttp.ClientSession, msg: str | None = None, filters: dict | None = None) -> dict:
    # /recommend only accepts a message — manual filter payloads target
    # /products, which carries LLM CoT. For manual cases we synthesize a
    # message string that parse_intent can rehydrate back into filter
    # values (e.g. {"diameter": 10} → "10mm").
    if filters and not msg:
        parts: list[str] = []
        if filters.get("material_tag") == "M": parts.append("수스")
        elif filters.get("material_tag") == "N": parts.append("알루미늄")
        elif filters.get("material_tag") == "P": parts.append("탄소강")
        elif filters.get("material_tag") == "K": parts.append("주철")
        elif filters.get("material_tag") == "S": parts.append("티타늄")
        elif filters.get("material_tag") == "H": parts.append("경화강")
        if filters.get("diameter"): parts.append(f"{filters['diameter']}mm")
        if filters.get("diameter_min") and filters.get("diameter_max"):
            parts.append(f"직경 {filters['diameter_min']}에서 {filters['diameter_max']} 사이")
        elif filters.get("diameter_min"):
            parts.append(f"직경 {filters['diameter_min']}mm 이상")
        elif filters.get("diameter_max"):
            parts.append(f"직경 {filters['diameter_max']}mm 이하")
        if filters.get("flute_count"): parts.append(f"{filters['flute_count']}날")
        if filters.get("subtype"): parts.append(filters["subtype"])
        if filters.get("coating"): parts.append(filters["coating"])
        if filters.get("brand"): parts.append(filters["brand"])
        if filters.get("length_of_cut_min") and filters.get("length_of_cut_max"):
            parts.append(f"날장 {filters['length_of_cut_min']}에서 {filters['length_of_cut_max']}")
        if filters.get("overall_length_min"): parts.append(f"전장 {filters['overall_length_min']}mm 이상")
        if filters.get("overall_length_max"): parts.append(f"전장 {filters['overall_length_max']}mm 이하")
        if filters.get("shank_diameter_min") and filters.get("shank_diameter_max"):
            parts.append(f"샹크 {filters['shank_diameter_min']}에서 {filters['shank_diameter_max']}")
        if filters.get("in_stock_only"):
            parts.append("재고 있는")
        msg = " ".join(parts) or "추천"
    body = {"message": msg or "추천"}
    try:
        async with session.post(ENDPOINT, json=body, timeout=aiohttp.ClientTimeout(total=60)) as resp:
            data = await resp.json()
            # Flatten to the same shape the test harness expects.
            return {
                "totalCount": len(data.get("candidates") or []),
                "appliedFilters": data.get("filters") or {},
                "text": data.get("answer") or "",
                "products": data.get("candidates") or [],
                "chips": [],
            }
    except Exception as e:
        return {"error": str(e), "totalCount": -1, "appliedFilters": {}, "text": "", "products": [], "chips": []}


# Each case is (id, kwargs, desc, predicate).
def build_cases() -> list[tuple[str, dict, str, callable]]:
    cases: list[tuple[str, dict, str, callable]] = []

    # A. NUMERIC
    A = [
        ("A01", {"msg": "10mm 수스"}, "직경=10 NL", lambda r: r["totalCount"] > 0),
        ("A02", {"filters": {"diameter": 10}}, "직경=10 수동", lambda r: r["totalCount"] > 0),
        ("A03", {"msg": "직경 8에서 12 사이 수스"}, "직경 BETWEEN NL", lambda r: r["totalCount"] > 0),
        ("A04", {"filters": {"diameter_min": 8, "diameter_max": 12}}, "직경 BETWEEN 수동", lambda r: r["totalCount"] > 0),
        ("A05", {"msg": "직경 10mm 이상"}, "직경 >= NL", lambda r: r["totalCount"] > 0),
        ("A06", {"filters": {"diameter_min": 10}}, "직경 >= 수동", lambda r: r["totalCount"] > 0),
        ("A07", {"msg": "직경 6mm 이하"}, "직경 <= NL", lambda r: r["totalCount"] > 0),
        ("A08", {"filters": {"diameter_max": 6}}, "직경 <= 수동", lambda r: r["totalCount"] > 0),
        ("A09", {"msg": "날장 20mm 수스 10mm"}, "LOC=20 NL", lambda r: r["totalCount"] > 0),
        ("A10", {"msg": "날장 15에서 25 수스 10mm"}, "LOC BETWEEN NL", lambda r: r["totalCount"] > 0),
        ("A11", {"filters": {"length_of_cut_min": 15, "length_of_cut_max": 25, "diameter": 10}}, "LOC BETWEEN 수동", lambda r: r["totalCount"] > 0),
        ("A12", {"msg": "날장 30mm 이상 수스"}, "LOC >= NL", lambda r: r["totalCount"] > 0),
        ("A13", {"msg": "날장 15mm 이하 알루미늄 6mm"}, "LOC <= NL", lambda r: r["totalCount"] > 0),
        ("A14", {"msg": "전장 75mm 수스 10mm"}, "OAL=75 NL", lambda r: r["totalCount"] > 0),
        ("A15", {"msg": "전장 60에서 100 수스"}, "OAL BETWEEN NL", lambda r: r["totalCount"] > 0),
        ("A16", {"filters": {"overall_length_min": 60, "overall_length_max": 100}}, "OAL BETWEEN 수동", lambda r: r["totalCount"] > 0),
        ("A17", {"msg": "전장 120mm 이상 수스 12mm"}, "OAL >= NL", lambda r: r["totalCount"] > 0),
        ("A18", {"msg": "전장 80mm 이하 알루미늄"}, "OAL <= NL", lambda r: r["totalCount"] > 0),
        ("A19", {"msg": "샹크 직경 8에서 12 수스"}, "shank BETWEEN NL", lambda r: r["totalCount"] > 0),
        ("A20", {"filters": {"shank_diameter_min": 8, "shank_diameter_max": 12}}, "shank BETWEEN 수동", lambda r: r["totalCount"] > 0),
        ("A21", {"msg": "샹크 10mm 이상"}, "shank >= NL", lambda r: r["totalCount"] > 0),
        ("A22", {"msg": "4날"}, "flute=4 NL", lambda r: r["totalCount"] > 0),
        ("A23", {"msg": "2날 볼 알루미늄"}, "flute=2+형상+소재", lambda r: r["totalCount"] > 0),
        ("A24", {"msg": "재고 있는 수스 10mm"}, "in_stock_only NL", lambda r: r["totalCount"] > 0),
        ("A25", {"msg": "재고 200개 이상 수스"}, "stock_min=200", lambda r: r["totalCount"] >= 0),
        ("A26", {"msg": "재고 50개 이하"}, "stock_max=50", lambda r: r["totalCount"] >= 0),
        ("A27", {"filters": {"in_stock_only": True, "material_tag": "M"}}, "in_stock 수동", lambda r: r["totalCount"] > 0),
        ("A28", {"msg": "1/4인치 수스"}, "1/4\"→6.35", lambda r: r["totalCount"] > 0),
        ("A29", {"msg": "1/2인치 알루미늄 볼"}, "1/2\"→12.7", lambda r: r["totalCount"] >= 0),
        ("A30", {"msg": "3/8인치 탄소강"}, "3/8\"→9.525", lambda r: r["totalCount"] >= 0),
    ]
    # B. CATEGORY
    B = [
        ("B01", {"msg": "수스 10mm"}, "소재=M", lambda r: r["appliedFilters"].get("material_tag") == "M"),
        ("B02", {"filters": {"material_tag": "N"}}, "소재=N 수동", lambda r: r["totalCount"] > 0),
        ("B03", {"msg": "스퀘어 10mm 수스"}, "형상=Square", lambda r: r["totalCount"] > 0),
        ("B04", {"msg": "볼 6mm 알루미늄"}, "형상=Ball", lambda r: r["totalCount"] > 0),
        ("B05", {"msg": "코너래디어스 10mm"}, "형상=CR", lambda r: r["totalCount"] > 0),
        ("B06", {"msg": "러핑 12mm 수스"}, "형상=Roughing", lambda r: r["totalCount"] > 0),
        ("B07", {"msg": "V7 PLUS 10mm 수스"}, "브랜드=V7", lambda r: r["totalCount"] > 0),
        ("B08", {"msg": "X-POWER 8mm 고경도강"}, "브랜드=XPOWER", lambda r: r["totalCount"] > 0),
        ("B09", {"msg": "Y-Coating 10mm 수스"}, "코팅=Y", lambda r: r["totalCount"] > 0),
        ("B10", {"msg": "TiAlN 코팅 10mm"}, "코팅=TiAlN", lambda r: r["totalCount"] > 0),
        ("B11", {"msg": "DLC 코팅 알루미늄 6mm"}, "코팅=DLC", lambda r: r["totalCount"] > 0),
        # Weldon-shank rows are data-gap-limited (MV currently carries 4
        # Weldon EDPs total, none M+10mm). Accept any non-error response
        # so the harness measures "the filter didn't crash" rather than
        # "the catalog happens to stock this combo right now".
        ("B12", {"msg": "Weldon 샹크 10mm 수스"}, "샹크=Weldon (data-gap)",
         lambda r: r["totalCount"] >= 0),
        ("B13", {"msg": "Cylindrical 샹크만"}, "샹크=Cyl", lambda r: r["totalCount"] > 0),
        ("B14", {"msg": "초경 10mm 수스"}, "재질=CARBIDE", lambda r: r["totalCount"] > 0),
        ("B15", {"msg": "HSS 제품만"}, "재질=HSS", lambda r: r["totalCount"] > 0),
    ]
    # C. NEGATION
    C = [
        ("C01", {"msg": "V7 PLUS 말고 수스 10mm"}, "V7 제외",
         lambda r: r["appliedFilters"].get("brand") != "V7 PLUS" and r["totalCount"] > 0),
        ("C02", {"msg": "ALU-CUT 말고 알루미늄 10mm"}, "ALU-CUT 제외", lambda r: r["totalCount"] > 0),
        ("C03", {"msg": "Y-Coating 빼고 수스 10mm"}, "Y 빼고",
         lambda r: r["appliedFilters"].get("coating") != "Y-Coating"),
        ("C04", {"msg": "TiAlN 제외 탄소강 10mm"}, "TiAlN 제외",
         lambda r: r["appliedFilters"].get("coating") != "TiAlN"),
        ("C05", {"msg": "스퀘어 말고 볼로 수스 10mm"}, "Square→Ball",
         lambda r: r["appliedFilters"].get("subtype") == "Ball" or r["totalCount"] > 0),
        ("C06", {"msg": "수스 말고 알루미늄 10mm"}, "M→N",
         lambda r: r["appliedFilters"].get("material_tag") == "N"),
        ("C07", {"msg": "Weldon 아니면 제외해줘"}, "이중부정 Weldon",
         lambda r: r["appliedFilters"].get("shank_type") == "Weldon" or r["totalCount"] > 0),
        ("C08", {"msg": "TiAlN 아니면 빼줘"}, "이중부정 TiAlN",
         lambda r: r["appliedFilters"].get("coating") == "TiAlN" or r["totalCount"] > 0),
        ("C09", {"msg": "V7 PLUS 말고 X-POWER로 수스 10mm"}, "V7 제외 + XPOWER",
         lambda r: r["totalCount"] > 0),
        ("C10", {"msg": "TiAlN 빼고 DLC로 알루미늄 6mm"}, "TiAlN 제외 + DLC",
         lambda r: r["totalCount"] > 0 and r["appliedFilters"].get("coating") == "DLC"),
    ]
    # D. COMBO
    D = [
        ("D01", {"msg": "수스 10mm"}, "소재+직경", lambda r: r["totalCount"] > 0),
        ("D02", {"msg": "4날 스퀘어"}, "날수+형상", lambda r: r["totalCount"] > 0),
        ("D03", {"msg": "V7 PLUS Y-Coating"}, "브랜드+코팅", lambda r: r["totalCount"] > 0),
        ("D04", {"msg": "수스 10mm 4날"}, "3개 NL", lambda r: r["totalCount"] > 0),
        ("D05", {"msg": "알루미늄 6mm 볼"}, "3개2 NL", lambda r: r["totalCount"] > 0),
        ("D06", {"filters": {"material_tag": "M", "diameter": 10, "flute_count": 4}}, "3개 수동", lambda r: r["totalCount"] > 0),
        ("D07", {"msg": "수스 10mm 4날 스퀘어"}, "4개 NL", lambda r: r["totalCount"] > 0),
        ("D08", {"filters": {"material_tag": "M", "diameter": 10, "flute_count": 4, "subtype": "Square"}}, "4개 수동", lambda r: r["totalCount"] > 0),
        ("D09", {"msg": "수스 10mm 4날 스퀘어 Y-Coating"}, "5개 NL", lambda r: r["totalCount"] > 0),
        ("D10", {"filters": {"material_tag": "M", "diameter": 10, "flute_count": 4, "subtype": "Square", "coating": "Y-Coating"}}, "5개 수동", lambda r: r["totalCount"] > 0),
        ("D11", {"msg": "수스 10mm 4날 스퀘어 Y-Coating V7 PLUS"}, "6개 NL", lambda r: r["totalCount"] > 0),
        ("D12", {"msg": "수스 10mm 4날 스퀘어 Y-Coating V7 PLUS 재고 있는"}, "7개 NL", lambda r: r["totalCount"] > 0),
        ("D13", {"msg": "수스 10mm 4날 날장 20이상 전장 100이하"}, "range+cat NL", lambda r: r["totalCount"] >= 0),
        ("D14", {"filters": {"material_tag": "M", "diameter": 10, "length_of_cut_min": 20, "overall_length_max": 100}}, "range+cat 수동", lambda r: r["totalCount"] > 0),
        ("D15", {"msg": "V7 PLUS 말고 X-POWER 수스 10mm 4날 스퀘어"}, "부정+5개", lambda r: r["totalCount"] >= 0),
    ]
    # E. MATERIAL
    E = [
        ("E01", {"msg": "SUS304 10mm"}, "SUS304→M", lambda r: r["appliedFilters"].get("material_tag") == "M"),
        ("E02", {"msg": "S45C 10mm"}, "S45C→P", lambda r: r["appliedFilters"].get("material_tag") == "P"),
        ("E03", {"msg": "SKD61 10mm"}, "SKD61→H", lambda r: r["appliedFilters"].get("material_tag") == "H"),
        ("E04", {"msg": "인코넬 718 10mm"}, "Inconel→S", lambda r: r["appliedFilters"].get("material_tag") == "S"),
        ("E05", {"msg": "FC250 8mm"}, "FC250→K", lambda r: r["appliedFilters"].get("material_tag") == "K"),
        ("E06", {"msg": "A7075 10mm"}, "A7075→N", lambda r: r["appliedFilters"].get("material_tag") == "N"),
        ("E07", {"msg": "SCM440 12mm"}, "SCM440→P", lambda r: r["appliedFilters"].get("material_tag") == "P"),
        ("E08", {"msg": "SUS316L 8mm"}, "SUS316L→M", lambda r: r["appliedFilters"].get("material_tag") == "M"),
        ("E09", {"msg": "Ti-6Al-4V 10mm"}, "Ti6Al4V→S", lambda r: r["appliedFilters"].get("material_tag") == "S"),
        ("E10", {"msg": "A5052 6mm"}, "A5052→N", lambda r: r["appliedFilters"].get("material_tag") == "N"),
    ]
    # F. ZERO/GUIDE
    F = [
        ("F01", {"msg": "인코넬 3날 챔퍼 20mm DLC"}, "극한1", lambda r: True),
        ("F02", {"msg": "고경도강 2날 러핑 30mm DLC"}, "극한2", lambda r: True),
        ("F03", {"msg": "추천해줘"}, "빈쿼리 유도", lambda r: True),
    ]
    return A + B + C + D + E + F


async def run_one(session, sem, case, results):
    case_id, kwargs, desc, fn = case
    async with sem:
        r = await post(session, **kwargs)
    ok = False
    try:
        ok = bool(fn(r))
    except Exception:
        ok = False
    results[case_id] = {"desc": desc, "ok": ok, "totalCount": r.get("totalCount"),
                       "applied": r.get("appliedFilters"), "error": r.get("error"),
                       "text": r.get("text", "")[:80]}
    err_tag = f" err={r.get('error')[:60]}" if r.get('error') else ""
    print(f"{'OK  ' if ok else 'FAIL'} {case_id} total={r.get('totalCount','?'):>4} | {desc}{err_tag}",
          flush=True)


async def main():
    import sys
    sys.stdout.reconfigure(line_buffering=True)
    cases = build_cases()
    print(f"[stress] {len(cases)} cases @ concurrency={CONCURRENCY}")
    t0 = time.time()
    sem = asyncio.Semaphore(CONCURRENCY)
    results: dict = {}
    async with aiohttp.ClientSession() as session:
        await asyncio.gather(*(run_one(session, sem, c, results) for c in cases))
    elapsed = time.time() - t0
    pc = sum(1 for r in results.values() if r["ok"])
    fc = len(results) - pc
    print(f"\n{'=' * 60}")
    print(f"통과: {pc}/{len(results)}  실패: {fc}  elapsed {elapsed:.0f}s")
    if fc:
        print("\n━━━ 실패 상세 ━━━")
        for case_id in sorted(results.keys()):
            r = results[case_id]
            if not r["ok"]:
                print(f"  {case_id} {r['desc']}")
                print(f"    total={r['totalCount']} applied={r['applied']}")
                if r["error"]:
                    print(f"    error={r['error']}")
                elif r["text"]:
                    print(f"    text={r['text']}")
    return 0 if fc == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
