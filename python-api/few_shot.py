"""Adaptive few-shot store — records failure-then-corrected pairs and
surfaces the most recent ones as in-context examples for the SCR prompt.

File-backed (JSON) so the examples survive process restarts. Capped at
MAX_SHOTS to keep the prompt size bounded.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

_PATH = Path(__file__).resolve().parent / "data" / "few_shots.json"
MAX_SHOTS = 20      # hard cap on file
PROMPT_SHOTS = 5    # how many to actually surface in the system prompt
_LOCK = threading.Lock()


def _read() -> list[dict]:
    try:
        with _PATH.open(encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return [d for d in data if isinstance(d, dict)]
    except FileNotFoundError:
        return []
    except json.JSONDecodeError:
        return []
    return []


def _write(shots: list[dict]) -> None:
    _PATH.parent.mkdir(parents=True, exist_ok=True)
    with _PATH.open("w", encoding="utf-8") as f:
        json.dump(shots, f, ensure_ascii=False, indent=2)


def load_few_shots() -> list[dict]:
    """Return all persisted shots (may exceed PROMPT_SHOTS)."""
    with _LOCK:
        return _read()


def add_few_shot(message: str, expected: dict[str, Any]) -> None:
    """Append a (message, expected) pair and trim to MAX_SHOTS, FIFO.
    Duplicate messages replace the older entry so the list tracks the
    latest correction for each prompt."""
    if not message or not isinstance(expected, dict):
        return
    with _LOCK:
        shots = _read()
        shots = [s for s in shots if s.get("message") != message]
        shots.append({"message": message, "expected": expected})
        if len(shots) > MAX_SHOTS:
            shots = shots[-MAX_SHOTS:]
        _write(shots)


def render_prompt_suffix() -> str:
    """Build the `추가 예시:` block to append to the SCR system prompt.
    Empty string when there are no shots — caller just concatenates."""
    shots = load_few_shots()
    if not shots:
        return ""
    recent = shots[-PROMPT_SHOTS:]
    lines: list[str] = ["", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "추가 예시 (실패 후 정정된 케이스):"]
    for s in recent:
        msg = s.get("message") or ""
        exp = s.get("expected") or {}
        lines.append(f'입력: "{msg}"')
        lines.append(f"출력: {json.dumps(exp, ensure_ascii=False)}")
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    return "\n".join(lines)


def clear() -> None:
    """Remove the few-shot file — used by tests / ops maintenance."""
    with _LOCK:
        if _PATH.exists():
            _PATH.unlink()
