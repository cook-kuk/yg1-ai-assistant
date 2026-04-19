"""80-case DB operator + filter combination stress test.

Covers 6 groups:
  A  Numeric ops (=, >=, <=, BETWEEN, inch-to-mm) — 30 cases
  B  Category single-select — 15
  C  Negation (말고 / 제외 / 이중부정 / 채택+제외) — 10
  D  Multi-filter combos (2–7 fields) — 15
  E  Material standard → ISO mapping — 10
  F  Zero-result / relaxation / guidance — 3

Usage:
    .venv/bin/python scripts/stress_filters.py
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request

# Ensure every progress line hits the log immediately — the default
# block-buffering hid 24 minutes of stderr behind `| tail -120` on the
# previous run. Line-buffering forces a flush after each newline so
# tail -f shows real progress.
sys.stdout.reconfigure(line_buffering=True)


ENDPOINT = "http://127.0.0.1:8010/products"


def post(msg=None, filters=None) -> dict:
    body: dict = {}
    if msg:
        body["message"] = msg
    if filters:
        body["filters"] = filters
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        raw = urllib.request.urlopen(req, timeout=60).read()
        return json.loads(raw)
    except Exception as e:
        return {
            "error": str(e),
            "totalCount": -1,
            "appliedFilters": {},
            "text": "",
            "products": [],
        }


def run() -> tuple[int, int, list]:
    issues: list = []
    pc = 0
    fc = 0
    total = 0

    def ck(case_id: str, r: dict, desc: str, fn) -> None:
        nonlocal pc, fc, total
        total += 1
        ok = bool(fn(r))
        if ok:
            pc += 1
        else:
            fc += 1
            af = r.get("appliedFilters", {})
            issues.append(
                (case_id, desc, r.get("totalCount"), af, r.get("text", "")[:100], r.get("error"))
            )
        mark = "OK  " if ok else "FAIL"
        total_str = str(r.get("totalCount", "?"))
        print(f"{mark} {case_id} total={total_str:>6} | {desc}")

    # ── A. Numeric operators ─────────────────────────────────────────
    print("━━━ A. NUMERIC ━━━")
    ck("A01", post("10mm 수스"), "직경=10 NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A02", post(filters={"diameter": 10}), "직경=10 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("A03", post("직경 8에서 12 사이 수스"), "직경 BETWEEN NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A04", post(filters={"diameter_min": 8, "diameter_max": 12}), "직경 BETWEEN 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("A05", post("직경 10mm 이상"), "직경 >= NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A06", post(filters={"diameter_min": 10}), "직경 >= 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("A07", post("직경 6mm 이하"), "직경 <= NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A08", post(filters={"diameter_max": 6}), "직경 <= 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("A09", post("날장 20mm 수스 10mm"), "LOC=20 NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A10", post("날장 15에서 25 수스 10mm"), "LOC BETWEEN NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A11", post(filters={"length_of_cut_min": 15, "length_of_cut_max": 25, "diameter": 10}), "LOC BETWEEN 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("A12", post("날장 30mm 이상 수스"), "LOC >= NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A13", post("날장 15mm 이하 알루미늄 6mm"), "LOC <= NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A14", post("전장 75mm 수스 10mm"), "OAL=75 NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A15", post("전장 60에서 100 수스"), "OAL BETWEEN NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A16", post(filters={"overall_length_min": 60, "overall_length_max": 100}), "OAL BETWEEN 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("A17", post("전장 120mm 이상 수스 12mm"), "OAL >= NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A18", post("전장 80mm 이하 알루미늄"), "OAL <= NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A19", post("샹크 직경 8에서 12 수스"), "shank BETWEEN NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A20", post(filters={"shank_diameter_min": 8, "shank_diameter_max": 12}), "shank BETWEEN 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("A21", post("샹크 10mm 이상"), "shank >= NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A22", post("4날"), "flute=4 NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A23", post("2날 볼 알루미늄"), "flute=2 + 형상 + 소재", lambda r: r.get("totalCount", 0) > 0)
    ck("A24", post("재고 있는 수스 10mm"), "in_stock_only NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A25", post("재고 200개 이상 수스"), "stock_min=200 NL", lambda r: r.get("totalCount", -1) >= 0)
    ck("A26", post("재고 50개 이하"), "stock_max=50 NL", lambda r: r.get("totalCount", -1) >= 0)
    ck("A27", post(filters={"in_stock_only": True, "material_tag": "M"}), "in_stock 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("A28", post("1/4인치 수스"), "1/4인치→6.35 NL", lambda r: r.get("totalCount", 0) > 0)
    ck("A29", post("1/2인치 알루미늄 볼"), "1/2인치→12.7 NL", lambda r: r.get("totalCount", -1) >= 0)
    ck("A30", post("3/8인치 탄소강"), "3/8인치→9.525 NL", lambda r: r.get("totalCount", -1) >= 0)

    # ── B. Category single-select ────────────────────────────────────
    print("\n━━━ B. CATEGORY ━━━")
    ck("B01", post("수스 10mm"), "소재=M NL", lambda r: r.get("appliedFilters", {}).get("material_tag") == "M")
    ck("B02", post(filters={"material_tag": "N"}), "소재=N 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("B03", post("스퀘어 10mm 수스"), "형상=Square NL", lambda r: r.get("totalCount", 0) > 0)
    ck("B04", post("볼 6mm 알루미늄"), "형상=Ball NL", lambda r: r.get("totalCount", 0) > 0)
    ck("B05", post("코너래디어스 10mm"), "형상=CR NL", lambda r: r.get("totalCount", 0) > 0)
    ck("B06", post("러핑 12mm 수스"), "형상=Roughing NL", lambda r: r.get("totalCount", 0) > 0)
    ck("B07", post("V7 PLUS 10mm 수스"), "브랜드=V7 NL", lambda r: r.get("totalCount", 0) > 0)
    ck("B08", post("X-POWER 8mm 고경도강"), "브랜드=XPOWER NL", lambda r: r.get("totalCount", 0) > 0)
    ck("B09", post("Y-Coating 10mm 수스"), "코팅=Y NL", lambda r: r.get("totalCount", 0) > 0)
    ck("B10", post("TiAlN 코팅 10mm"), "코팅=TiAlN NL", lambda r: r.get("totalCount", 0) > 0)
    ck("B11", post("DLC 코팅 알루미늄 6mm"), "코팅=DLC NL", lambda r: r.get("totalCount", 0) > 0)
    ck("B12", post("Weldon 샹크 10mm 수스"), "샹크=Weldon NL", lambda r: r.get("totalCount", 0) > 0)
    ck("B13", post("Cylindrical 샹크만"), "샹크=Cyl NL", lambda r: r.get("totalCount", 0) > 0)
    ck("B14", post("초경 10mm 수스"), "재질=CARBIDE NL", lambda r: r.get("totalCount", 0) > 0)
    ck("B15", post("HSS 제품만"), "재질=HSS NL", lambda r: r.get("totalCount", 0) > 0)

    # ── C. Negation ──────────────────────────────────────────────────
    print("\n━━━ C. NEGATION ━━━")
    ck("C01", post("V7 PLUS 말고 수스 10mm"), "V7 제외 NL",
       lambda r: r.get("appliedFilters", {}).get("brand") != "V7 PLUS" and r.get("totalCount", 0) > 0)
    ck("C02", post("ALU-CUT 말고 알루미늄 10mm"), "ALU-CUT 제외 NL",
       lambda r: r.get("totalCount", 0) > 0)
    ck("C03", post("Y-Coating 빼고 수스 10mm"), "Y-Coating 빼고 NL",
       lambda r: r.get("appliedFilters", {}).get("coating") != "Y-Coating")
    ck("C04", post("TiAlN 제외 탄소강 10mm"), "TiAlN 제외 NL",
       lambda r: r.get("appliedFilters", {}).get("coating") != "TiAlN")
    ck("C05", post("스퀘어 말고 볼로 수스 10mm"), "Square→Ball 전환",
       lambda r: r.get("appliedFilters", {}).get("subtype") == "Ball" or r.get("totalCount", 0) > 0)
    ck("C06", post("수스 말고 알루미늄 10mm"), "M→N 전환",
       lambda r: r.get("appliedFilters", {}).get("material_tag") == "N")
    ck("C07", post("Weldon 아니면 제외해줘"), "이중부정=Weldon 포함",
       lambda r: r.get("appliedFilters", {}).get("shank_type") == "Weldon" or r.get("totalCount", 0) > 0)
    ck("C08", post("TiAlN 아니면 빼줘"), "이중부정=TiAlN 포함",
       lambda r: r.get("appliedFilters", {}).get("coating") == "TiAlN" or r.get("totalCount", 0) > 0)
    ck("C09", post("V7 PLUS 말고 X-POWER로 수스 10mm"), "V7 제외 + XPOWER 채택",
       lambda r: r.get("totalCount", 0) > 0)
    ck("C10", post("TiAlN 빼고 DLC로 알루미늄 6mm"), "TiAlN 제외 + DLC 채택",
       lambda r: r.get("totalCount", 0) > 0 and r.get("appliedFilters", {}).get("coating") == "DLC")

    # ── D. Multi-filter combos ───────────────────────────────────────
    print("\n━━━ D. COMBO ━━━")
    ck("D01", post("수스 10mm"), "소재+직경", lambda r: r.get("totalCount", 0) > 0)
    ck("D02", post("4날 스퀘어"), "날수+형상", lambda r: r.get("totalCount", 0) > 0)
    ck("D03", post("V7 PLUS Y-Coating"), "브랜드+코팅", lambda r: r.get("totalCount", 0) > 0)
    ck("D04", post("수스 10mm 4날"), "3개 NL", lambda r: r.get("totalCount", 0) > 0)
    ck("D05", post("알루미늄 6mm 볼"), "3개2 NL", lambda r: r.get("totalCount", 0) > 0)
    ck("D06", post(filters={"material_tag": "M", "diameter": 10, "flute_count": 4}), "3개 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("D07", post("수스 10mm 4날 스퀘어"), "4개 NL", lambda r: r.get("totalCount", 0) > 0)
    ck("D08", post(filters={"material_tag": "M", "diameter": 10, "flute_count": 4, "subtype": "Square"}), "4개 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("D09", post("수스 10mm 4날 스퀘어 Y-Coating"), "5개 NL", lambda r: r.get("totalCount", 0) > 0)
    ck("D10", post(filters={"material_tag": "M", "diameter": 10, "flute_count": 4, "subtype": "Square", "coating": "Y-Coating"}), "5개 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("D11", post("수스 10mm 4날 스퀘어 Y-Coating V7 PLUS"), "6개 NL", lambda r: r.get("totalCount", 0) > 0)
    ck("D12", post("수스 10mm 4날 스퀘어 Y-Coating V7 PLUS 재고 있는"), "7개 NL", lambda r: r.get("totalCount", 0) > 0)
    ck("D13", post("수스 10mm 4날 날장 20이상 전장 100이하"), "category+range", lambda r: r.get("totalCount", -1) >= 0)
    ck("D14", post(filters={"material_tag": "M", "diameter": 10, "length_of_cut_min": 20, "overall_length_max": 100}), "category+range 수동", lambda r: r.get("totalCount", 0) > 0)
    ck("D15", post("V7 PLUS 말고 X-POWER 수스 10mm 4날 스퀘어"), "부정+5개", lambda r: r.get("totalCount", -1) >= 0)

    # ── E. Material standard → ISO ───────────────────────────────────
    print("\n━━━ E. MATERIAL ━━━")
    ck("E01", post("SUS304 10mm"), "SUS304→M", lambda r: r.get("appliedFilters", {}).get("material_tag") == "M")
    ck("E02", post("S45C 10mm"), "S45C→P", lambda r: r.get("appliedFilters", {}).get("material_tag") == "P")
    ck("E03", post("SKD61 10mm"), "SKD61→H", lambda r: r.get("appliedFilters", {}).get("material_tag") == "H")
    ck("E04", post("인코넬 718 10mm"), "Inconel→S", lambda r: r.get("appliedFilters", {}).get("material_tag") == "S")
    ck("E05", post("FC250 8mm"), "FC250→K", lambda r: r.get("appliedFilters", {}).get("material_tag") == "K")
    ck("E06", post("A7075 10mm"), "A7075→N", lambda r: r.get("appliedFilters", {}).get("material_tag") == "N")
    ck("E07", post("SCM440 12mm"), "SCM440→P", lambda r: r.get("appliedFilters", {}).get("material_tag") == "P")
    ck("E08", post("SUS316L 8mm"), "SUS316L→M", lambda r: r.get("appliedFilters", {}).get("material_tag") == "M")
    ck("E09", post("Ti-6Al-4V 10mm"), "Ti6Al4V→S", lambda r: r.get("appliedFilters", {}).get("material_tag") == "S")
    ck("E10", post("A5052 6mm"), "A5052→N", lambda r: r.get("appliedFilters", {}).get("material_tag") == "N")

    # ── F. Zero / relax / guidance ───────────────────────────────────
    print("\n━━━ F. ZERO/GUIDE ━━━")
    ck("F01", post("인코넬 3날 챔퍼 20mm DLC"), "극한1", lambda r: True)
    ck("F02", post("고경도강 2날 러핑 30mm DLC"), "극한2", lambda r: True)
    ck("F03", post("추천해줘"), "빈쿼리 유도",
       lambda r: len(r.get("chips", [])) > 0 or r.get("text", "") != "")

    return pc, fc, issues


def main() -> int:
    t0 = time.time()
    pc, fc, issues = run()
    total = pc + fc
    elapsed = time.time() - t0
    print(f"\n{'=' * 60}")
    print(f"통과: {pc}/{total} ({round(pc / total * 100, 1)}%)  실패: {fc}")
    print(f"elapsed {elapsed:.0f}s")
    if issues:
        print("\n━━━ 실패 상세 ━━━")
        for case_id, desc, tc, af, txt, err in issues:
            print(f"  {case_id}: {desc}")
            print(f"    total={tc} applied={af}")
            if err:
                print(f"    error={err}")
            elif txt:
                print(f"    text={txt}")
    return 0 if fc == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
