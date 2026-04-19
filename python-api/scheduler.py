"""Data-pipeline scheduler — one daemon thread drives the periodic
background jobs (product-index refresh, session sweep, few-shot backup).

Coexists peacefully with the module-local Timer loops in product_index.py
and session.py: both paths are idempotent and cheap, so running the work
twice is wasteful but never incorrect. The scheduler's main value is the
`/pipeline/status` introspection endpoint — one place to see "when did
each job last run?".
"""
from __future__ import annotations

import threading
import time
from typing import Callable

from config import SCHEDULER_TICK_SEC


class PipelineScheduler:
    def __init__(self) -> None:
        self._running = False
        self._thread: threading.Thread | None = None
        # name → config. `last_run` is the epoch seconds of the last successful
        # run, `last_status` carries a short tag for humans.
        self._tasks: dict[str, dict] = {
            "product_index_refresh": {"interval": 2 * 60 * 60, "last_run": 0.0, "last_status": "pending"},
            "session_cleanup":       {"interval": 5 * 60,        "last_run": 0.0, "last_status": "pending"},
            "few_shot_backup":       {"interval": 60 * 60,       "last_run": 0.0, "last_status": "pending"},
        }

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="pipeline-scheduler")
        self._thread.start()

    def stop(self) -> None:
        """Signal the loop to exit. Daemon thread will die with the process
        anyway; this is mainly for tests."""
        self._running = False

    def _loop(self) -> None:
        while self._running:
            now = time.time()
            for name, task in self._tasks.items():
                if now - task["last_run"] >= task["interval"]:
                    self._run_safe(name, task)
            time.sleep(SCHEDULER_TICK_SEC)

    def _run_safe(self, name: str, task: dict) -> None:
        """Dispatch one job and record status. Never let an exception kill
        the loop — failures just log-and-continue."""
        try:
            self._dispatch(name)
            task["last_status"] = "ok"
        except Exception as e:
            task["last_status"] = f"error: {type(e).__name__}"
        task["last_run"] = time.time()

    def _dispatch(self, name: str) -> None:
        if name == "product_index_refresh":
            from product_index import refresh
            refresh()
        elif name == "session_cleanup":
            from session import cleanup_expired
            cleanup_expired()
        elif name == "few_shot_backup":
            # Stored-on-disk already — we just touch the file to confirm it's
            # readable and surface the error if the volume becomes unhappy.
            from few_shot import load_few_shots
            load_few_shots()
        else:
            raise ValueError(f"unknown task: {name}")

    def status(self) -> dict:
        return {
            name: {
                "interval_sec": task["interval"],
                "last_run_epoch": task["last_run"],
                "last_status": task["last_status"],
            }
            for name, task in self._tasks.items()
        }


# Module-level singleton — main.py imports this directly.
scheduler = PipelineScheduler()
