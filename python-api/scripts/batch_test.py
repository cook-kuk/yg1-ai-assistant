#!/usr/bin/env python3
"""Send every testMessage in testset/feedback_regression.json to the running
/recommend endpoint, collect per-case metrics, dump a CSV to results/.

Usage:
    python scripts/batch_test.py [--host http://localhost:8000] [--limit N]

Assumes `uvicorn main:app` is already running. Does not spin up a server.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import pandas as pd
import httpx

API_ROOT = Path(__file__).resolve().parent.parent          # python-api/
REPO_ROOT = API_ROOT.parent                                 # cook-forge/
CASES_PATH = REPO_ROOT / "testset" / "feedback_regression.json"
RESULTS_DIR = API_ROOT / "results"
OUTPUT_CSV = RESULTS_DIR / "batch_result.csv"


def load_cases(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        cases = json.load(f)
    if not isinstance(cases, list):
        raise ValueError(f"expected a JSON array at {path}")
    return cases


def run_case(client: httpx.Client, case: dict) -> dict:
    row: dict = {
        "id": case.get("id"),
        "message": case.get("testMessage") or "",
        "filter_count": None,
        "candidate_count": None,
        "top_brand": None,
        "top_score": None,
        "latency_ms": None,
        "status": "fail",
        "error": None,
    }
    if not row["message"]:
        row["error"] = "no testMessage"
        return row

    t0 = time.perf_counter()
    try:
        resp = client.post("/recommend", json={"message": row["message"]}, timeout=60)
        latency_ms = int((time.perf_counter() - t0) * 1000)
        row["latency_ms"] = latency_ms
        resp.raise_for_status()
        body = resp.json()

        filters = body.get("filters") or {}
        # count only non-null intent fields
        row["filter_count"] = sum(1 for v in filters.values() if v not in (None, ""))

        candidates = body.get("candidates") or []
        row["candidate_count"] = len(candidates)
        if candidates:
            row["top_brand"] = candidates[0].get("brand")
        scores = body.get("scores") or []
        if scores:
            row["top_score"] = scores[0].get("score")
        row["status"] = "ok"
    except httpx.HTTPStatusError as e:
        row["latency_ms"] = int((time.perf_counter() - t0) * 1000)
        row["error"] = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
    except Exception as e:
        row["latency_ms"] = int((time.perf_counter() - t0) * 1000)
        row["error"] = f"{type(e).__name__}: {e}"
    return row


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="http://localhost:8000")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--output", type=Path, default=OUTPUT_CSV)
    args = parser.parse_args()

    cases = load_cases(CASES_PATH)
    if args.limit:
        cases = cases[: args.limit]

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[batch] {len(cases)} cases → {args.host}")
    rows: list[dict] = []
    with httpx.Client(base_url=args.host) as client:
        for i, case in enumerate(cases, 1):
            row = run_case(client, case)
            rows.append(row)
            marker = "OK " if row["status"] == "ok" else "ERR"
            print(
                f"  [{i:>3}/{len(cases)}] {marker} {row['id']:<8} "
                f"f={row['filter_count']} c={row['candidate_count']} "
                f"brand={row['top_brand']!s:<20.20} {row['latency_ms']}ms"
                + (f"  {row['error']}" if row["error"] else "")
            )

    df = pd.DataFrame(rows, columns=[
        "id", "message", "filter_count", "candidate_count",
        "top_brand", "top_score", "latency_ms", "status", "error",
    ])
    df.to_csv(args.output, index=False)

    ok = int((df["status"] == "ok").sum())
    fail = len(df) - ok
    p50 = df.loc[df["status"] == "ok", "latency_ms"].median() if ok else float("nan")
    print()
    print(f"[batch] ok={ok} fail={fail}  latency p50={p50:.0f}ms")
    print(f"[batch] wrote {args.output}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
