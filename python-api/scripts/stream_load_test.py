"""SSE stream load test — fires N queries in parallel at /products/stream,
captures per-request event timeline (filters / products / thinking /
partial_answer / answer / done) + cot_level, and reports summary stats.

Usage:
    .venv/bin/python scripts/stream_load_test.py \
        --host http://127.0.0.1:8010 --concurrency 10

Query mix is hardcoded to exercise both Light and Strong paths so we can
measure each separately:
  - 8× Light queries (single-slot spec asks)
  - 8× Strong queries (compare / why / S material / trouble / 0-result)

Output (stdout, also written to results/stream_load_<ts>.csv):
  per-request rows: id, cot_level, ttfb_ms, t_first_partial_ms, ttlt_ms,
                    total_events, partial_count, verified, error
  aggregate table:  count / pass / p50 / p95 / max per cot_level
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

import aiohttp


API_ROOT = Path(__file__).resolve().parent.parent
RESULTS_DIR = API_ROOT / "results"


LIGHT_QUERIES = [
    "수스 10mm 4날",
    "알루미늄 6mm 2날",
    "구리 8mm 3날",
    "V7 PLUS 10mm",
    "볼 6mm 2날",
    "스퀘어 12mm 4날",
    "주철 10mm 4날",
    "탄소강 8mm 4날",
]

STRONG_QUERIES = [
    "V7 PLUS랑 X-POWER 뭐가 나아? 수스 10mm",             # compare
    "TitaNox-Power vs 3S MILL 차이 설명",                   # compare
    "왜 Y-Coating을 추천한 거야?",                          # why
    "왜 고경도강에 AlCrN이 낫지?",                           # why
    "인코넬 황삭 10mm 5날",                                 # S material
    "티타늄 정삭 8mm",                                      # S material
    "열처리강 HRC 55 엔드밀 10mm",                          # H + HRC
    "HRC 58 금형강 6mm 4날",                                # H + HRC
]


@dataclass
class RunResult:
    query: str
    expected_level: str   # "light" | "strong"
    status: str           # "ok" | "error" | "timeout"
    cot_level: Optional[str]
    verified: Optional[bool]
    ttfb_ms: Optional[float]       # first event (filters)
    ttfp_ms: Optional[float]       # first partial_answer
    ttthink_ms: Optional[float]    # first thinking
    ttlt_ms: Optional[float]       # last event (done)
    total_events: int
    partial_count: int
    thinking_count: int
    error: Optional[str]


async def run_one(
    session: aiohttp.ClientSession,
    host: str,
    query: str,
    expected_level: str,
    timeout: int,
) -> RunResult:
    url = f"{host}/products/stream"
    payload = {"message": query}
    t0 = time.time()
    first_event = None
    first_partial = None
    first_thinking = None
    last_event = None
    total_events = 0
    partial_count = 0
    thinking_count = 0
    cot_level: Optional[str] = None
    verified: Optional[bool] = None
    error: Optional[str] = None

    try:
        async with session.post(
            url,
            json=payload,
            headers={"Accept": "text/event-stream"},
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            if resp.status != 200:
                return RunResult(
                    query=query, expected_level=expected_level,
                    status="error", cot_level=None, verified=None,
                    ttfb_ms=None, ttfp_ms=None, ttthink_ms=None, ttlt_ms=None,
                    total_events=0, partial_count=0, thinking_count=0,
                    error=f"HTTP {resp.status}",
                )
            buf = ""
            pending_event: Optional[str] = None
            pending_data: list[str] = []
            async for raw in resp.content:
                buf += raw.decode("utf-8", errors="replace")
                while "\n\n" in buf:
                    frame, buf = buf.split("\n\n", 1)
                    ev_name = None
                    data_lines: list[str] = []
                    for line in frame.split("\n"):
                        if line.startswith("event:"):
                            ev_name = line[6:].strip()
                        elif line.startswith("data:"):
                            data_lines.append(line[5:].strip())
                    if not ev_name:
                        continue
                    dt_ms = (time.time() - t0) * 1000
                    total_events += 1
                    if first_event is None:
                        first_event = dt_ms
                    if ev_name == "thinking":
                        thinking_count += 1
                        if first_thinking is None:
                            first_thinking = dt_ms
                    elif ev_name == "partial_answer":
                        partial_count += 1
                        if first_partial is None:
                            first_partial = dt_ms
                    elif ev_name == "answer":
                        try:
                            data = json.loads("\n".join(data_lines))
                            cot_level = data.get("cot_level")
                            verified = data.get("verified")
                        except Exception:
                            pass
                    elif ev_name == "done":
                        last_event = dt_ms
    except asyncio.TimeoutError:
        return RunResult(
            query=query, expected_level=expected_level,
            status="timeout", cot_level=cot_level, verified=verified,
            ttfb_ms=first_event, ttfp_ms=first_partial,
            ttthink_ms=first_thinking, ttlt_ms=last_event,
            total_events=total_events, partial_count=partial_count,
            thinking_count=thinking_count,
            error="client timeout",
        )
    except Exception as e:
        return RunResult(
            query=query, expected_level=expected_level,
            status="error", cot_level=cot_level, verified=verified,
            ttfb_ms=first_event, ttfp_ms=first_partial,
            ttthink_ms=first_thinking, ttlt_ms=last_event,
            total_events=total_events, partial_count=partial_count,
            thinking_count=thinking_count,
            error=f"{type(e).__name__}: {e}",
        )

    return RunResult(
        query=query, expected_level=expected_level,
        status="ok", cot_level=cot_level, verified=verified,
        ttfb_ms=first_event, ttfp_ms=first_partial,
        ttthink_ms=first_thinking, ttlt_ms=last_event,
        total_events=total_events, partial_count=partial_count,
        thinking_count=thinking_count,
        error=None,
    )


def pct(values: list[float], p: float) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    k = min(len(s) - 1, max(0, int(round((len(s) - 1) * p))))
    return s[k]


def summarize(rows: list[RunResult]) -> str:
    lines: list[str] = []
    for group in ("light", "strong"):
        hits = [r for r in rows if r.cot_level == group]
        if not hits:
            continue
        ttlt = [r.ttlt_ms for r in hits if r.ttlt_ms is not None]
        ttfb = [r.ttfb_ms for r in hits if r.ttfb_ms is not None]
        ttfp = [r.ttfp_ms for r in hits if r.ttfp_ms is not None]
        ttthink = [r.ttthink_ms for r in hits if r.ttthink_ms is not None]
        ok = sum(1 for r in hits if r.status == "ok")
        verified_hits = sum(1 for r in hits if r.verified is True)
        verified_false = sum(1 for r in hits if r.verified is False)
        lines.append(
            f"  [{group}] n={len(hits)} ok={ok} "
            f"verified(true/false)={verified_hits}/{verified_false}"
        )
        if ttfb:
            lines.append(f"    ttfb_ms  p50={pct(ttfb,0.5):.0f}  p95={pct(ttfb,0.95):.0f}  max={max(ttfb):.0f}")
        if ttthink:
            lines.append(f"    think_ms p50={pct(ttthink,0.5):.0f}  p95={pct(ttthink,0.95):.0f}  max={max(ttthink):.0f}")
        if ttfp:
            lines.append(f"    tt1p_ms  p50={pct(ttfp,0.5):.0f}  p95={pct(ttfp,0.95):.0f}  max={max(ttfp):.0f}")
        if ttlt:
            lines.append(f"    ttlt_ms  p50={pct(ttlt,0.5):.0f}  p95={pct(ttlt,0.95):.0f}  max={max(ttlt):.0f}")
    # Mismatches between expected and actual level
    mismatches = [r for r in rows if r.cot_level and r.cot_level != r.expected_level]
    if mismatches:
        lines.append(f"  level mismatch: {len(mismatches)} request(s)")
        for r in mismatches[:5]:
            lines.append(f"    want {r.expected_level}, got {r.cot_level}: {r.query!r}")
    errors = [r for r in rows if r.status != "ok"]
    if errors:
        lines.append(f"  errors/timeouts: {len(errors)}")
        for r in errors[:5]:
            lines.append(f"    {r.status}: {r.error} ({r.query!r})")
    return "\n".join(lines)


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="http://127.0.0.1:8010")
    ap.add_argument("--concurrency", type=int, default=10)
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--queries", type=int, default=0,
                    help="Total queries; 0 = run every query in LIGHT+STRONG once (16).")
    args = ap.parse_args()

    queries: list[tuple[str, str]] = []
    for q in LIGHT_QUERIES:
        queries.append((q, "light"))
    for q in STRONG_QUERIES:
        queries.append((q, "strong"))
    if args.queries > 0:
        # Repeat the mix until we reach --queries.
        queries = (queries * ((args.queries // len(queries)) + 1))[: args.queries]

    print(f"[load] {len(queries)} queries @ concurrency={args.concurrency}")
    print(f"[load] host={args.host} timeout={args.timeout}s")

    sem = asyncio.Semaphore(args.concurrency)

    async def _wrap(session: aiohttp.ClientSession, q: str, lvl: str) -> RunResult:
        async with sem:
            return await run_one(session, args.host, q, lvl, args.timeout)

    t_start = time.time()
    async with aiohttp.ClientSession() as session:
        tasks = [asyncio.create_task(_wrap(session, q, lvl)) for q, lvl in queries]
        rows: list[RunResult] = []
        for fut in asyncio.as_completed(tasks):
            r = await fut
            rows.append(r)
            mark = "OK " if r.status == "ok" else r.status.upper()
            cot = r.cot_level or "?"
            ttlt = f"{r.ttlt_ms:.0f}ms" if r.ttlt_ms is not None else "-"
            print(
                f"  {mark}  [{cot:6s}] ttlt={ttlt:>8s}  "
                f"events={r.total_events:3d} partial={r.partial_count:3d} "
                f"v={r.verified}  {r.query[:60]}"
            )
    elapsed = time.time() - t_start

    print(f"\n[load] elapsed {elapsed:.1f}s  total {len(rows)} requests")
    print(summarize(rows))

    RESULTS_DIR.mkdir(exist_ok=True)
    out = RESULTS_DIR / f"stream_load_{int(time.time())}.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(asdict(rows[0]).keys()))
        w.writeheader()
        for r in rows:
            w.writerow(asdict(r))
    print(f"[load] CSV → {out}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
