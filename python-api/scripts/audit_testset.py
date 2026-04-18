#!/usr/bin/env python3
"""Audit YG1_ARIA_Testset_v5_Shared.xlsx singleton cases for expected-vs-message
mismatches.

Reports rows where `fluteCount` or `diameterMm` is demanded in expected_filter
but the user message contains no explicit cue for that field. These are
candidates for testset maintenance (REMOVE the over-specified token).

Read-only: does NOT modify the XLSX. Writes a review CSV to
results/testset_fixup_candidates.csv.

Usage:
    .venv/bin/python scripts/audit_testset.py
"""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from golden_test import (  # noqa: E402
    load_singleton_cases,
    parse_expected_filters,
    XLSX_PATH,
    RESULTS_DIR,
)

OUTPUT_CSV = RESULTS_DIR / "testset_fixup_candidates.csv"

# Same cue regexes as golden_test._has_explicit_mention so the audit is
# consistent with grading.
FIELD_CUES: dict[str, re.Pattern[str]] = {
    "fluteCount": re.compile(r"\d+\s*(?:날|f|F|flute|플루트|낭)", re.IGNORECASE),
    "diameterMm": re.compile(
        # Accept either order: "16mm" / "phi 16" / "φ10" / "직경 12" / "1/4인치"
        r"\d+\.?\d*\s*(?:mm|파이|phi|φ|ø|인치|inch)"
        r"|(?:파이|phi|φ|ø)\s*\d+\.?\d*"
        r"|\d+\s*/\s*\d+\s*(?:인치|inch|\")"
        r"|직경|지름",
        re.IGNORECASE,
    ),
}


def audit() -> list[dict]:
    cases = load_singleton_cases(XLSX_PATH)
    findings: list[dict] = []
    for c in cases:
        msg = c["message"] or ""
        for field, op, value in parse_expected_filters(c["expected_filter"] or ""):
            cue = FIELD_CUES.get(field)
            if cue is None:
                continue
            if cue.search(msg):
                continue
            findings.append({
                "id": c["id"],
                "field": field,
                "current_value": f"{op}{value}",
                "message_excerpt": msg[:140],
                "action": "REMOVE",
            })
    return findings


def main() -> int:
    findings = audit()
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["id", "field", "current_value", "message_excerpt", "action"],
        )
        writer.writeheader()
        writer.writerows(findings)

    by_field: dict[str, int] = {}
    for r in findings:
        by_field[r["field"]] = by_field.get(r["field"], 0) + 1

    print(f"[audit] singleton cases scanned : {sum(1 for _ in load_singleton_cases(XLSX_PATH))}")
    print(f"[audit] fixup candidates        : {len(findings)}")
    for k, v in sorted(by_field.items(), key=lambda x: -x[1]):
        print(f"  {v:>4}  {k}")
    print(f"[audit] → {OUTPUT_CSV}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
