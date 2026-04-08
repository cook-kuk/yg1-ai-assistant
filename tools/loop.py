"""Master auto-agent loop driver.

Each iter:
  1) sample N from weighted pool (hand cases + feedback replays)
  2) augment NL where applicable
  3) run multi-turn against :3000 in parallel
  4) score (deterministic for tier A, regression for tier C)
  5) update weights (failed = +1, passed = -0.1)
  6) append to history
  7) (optional) rebuild after N iters or on demand

Run:  python tools/loop.py [iterN]
"""
import sys, io, json, os, time, random, subprocess, urllib.request, urllib.error
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ENDPOINT = "http://20.119.98.136:3000"
LOOP_DIR = "test-results/loop"
HISTORY = f"{LOOP_DIR}/history.jsonl"
STATE = f"{LOOP_DIR}/state.json"
QUICK_PER_ITER = 12
WORKERS = 4

os.makedirs(LOOP_DIR, exist_ok=True)

def load_state():
    if os.path.exists(STATE):
        with open(STATE, encoding="utf-8") as f: return json.load(f)
    return {"iter": 0, "weights": {}, "started_at": time.time()}

def save_state(s):
    with open(STATE, "w", encoding="utf-8") as f: json.dump(s, f, indent=2, ensure_ascii=False)

def append_history(entry):
    with open(HISTORY, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

def run_quick(label, n=QUICK_PER_ITER, workers=WORKERS):
    """Invoke the JS quick runner."""
    out_file = f"{LOOP_DIR}/{label}.json"
    cmd = ["node", "tools/quick-runner.js", f"--n={n}", f"--workers={workers}", f"--label={label}", f"--out={LOOP_DIR}"]
    print(f"[loop] running {label} ...")
    t0 = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=900, encoding="utf-8", errors="replace")
    dt = time.time() - t0
    print(p.stdout[-2500:] if p.stdout else "")
    if p.returncode != 0:
        print("[loop] STDERR:", (p.stderr or "")[:1500])
    if os.path.exists(out_file):
        with open(out_file, encoding="utf-8") as f: return json.load(f), dt
    return None, dt

def update_weights(state, results):
    w = state.setdefault("weights", {})
    for r in results.get("results", []):
        cid = str(r.get("id"))
        cur = w.get(cid, 1.0)
        verdict = (r.get("verdict") or "").strip()
        if verdict == "✅":
            w[cid] = max(0.5, cur - 0.1)
        elif verdict.startswith("❌"):
            w[cid] = cur + 1.5
        elif verdict.startswith("⚠️") or verdict.startswith("🟡"):
            w[cid] = cur + 0.5

def iter_once(state, label=None):
    state["iter"] += 1
    n = state["iter"]
    label = label or f"iter-{n:03d}"
    res, dt = run_quick(label)
    if not res:
        append_history({"iter": n, "label": label, "error": "no result", "ts": time.time()})
        return
    update_weights(state, res)
    summary = {
        "iter": n, "label": label, "ts": time.time(),
        "passed": res.get("passed"), "failed": res.get("failed"), "warn": res.get("warn"),
        "n": res.get("n"), "dt_s": round(dt, 1),
    }
    append_history(summary)
    save_state(state)
    print(f"[loop] iter {n} done: {summary['passed']}/{summary['n']} ✅  {summary['failed']} ❌  {summary['warn']} ⚠️  ({dt:.0f}s)")
    return summary

if __name__ == "__main__":
    state = load_state()
    n_iters = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    for _ in range(n_iters):
        iter_once(state)
        time.sleep(1)
