"""Adaptive few-shot store — records failure-then-corrected pairs and
surfaces the most relevant ones as in-context examples for the SCR prompt.

Two selection modes live here:
  * FIFO (legacy) — pick the MAX_SHOTS most-recently-added pairs.
    Stays available as `render_prompt_suffix` so the SCR prompt keeps
    working when nothing else is passed.
  * Adaptive (this module's headline API) — `select_adaptive_examples`
    embeds the current query (optionally joined with the session's raw
    history signature) and picks top_k by cosine similarity against the
    FIFO-20 pool. Falls back to the FIFO tail on any embedding failure
    so a missing/slow OpenAI key doesn't break SCR.

File-backed (JSON) so the examples survive process restarts. Capped at
MAX_SHOTS to keep the prompt size bounded.
"""
from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Any, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from session import Session

_PATH = Path(__file__).resolve().parent / "data" / "few_shots.json"
MAX_SHOTS = 20      # hard cap on file
PROMPT_SHOTS = 5    # how many to actually surface in the system prompt
_LOCK = threading.Lock()

# Optional logger — `FEW_SHOT_DEBUG=1` env flag prints the chosen exemplars
# and whether the session signature was used so we can verify that single
# vs multi-turn queries really pick different shots.
_logger = logging.getLogger("few_shot")
_DEBUG = os.environ.get("FEW_SHOT_DEBUG", "").strip() in ("1", "true", "True")


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


# ── Adaptive selection ────────────────────────────────────────────────
# Embedding-backed picker. The pool (FIFO-20) stays the same — we just
# reorder it per-query instead of taking the tail. A per-shot embedding
# cache keyed on the message string dodges the repeat embed cost for
# shots that haven't changed between calls. No DB, all in-process.

_EMBED_MODEL = "text-embedding-3-small"
_SHOT_EMBED_CACHE: dict[str, list[float]] = {}


def _cosine(a: list[float], b: list[float]) -> float:
    import math
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


def _embed_one(text: str) -> list[float] | None:
    """Single-string embedding call. Returns None on any failure so the
    caller can fall back to the FIFO-tail selection."""
    if not text:
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        resp = client.embeddings.create(input=[text], model=_EMBED_MODEL)
        return list(resp.data[0].embedding)
    except Exception:
        return None


def _embed_shots(shots: list[dict]) -> list[tuple[dict, list[float]]]:
    """Return [(shot, embedding)] for every shot with cached reuse.
    Shots whose embedding fails are skipped — safer than poisoning the
    ranking with a zero vector."""
    out: list[tuple[dict, list[float]]] = []
    to_embed: list[tuple[int, str]] = []
    for i, s in enumerate(shots):
        msg = (s.get("message") or "").strip()
        if not msg:
            continue
        cached = _SHOT_EMBED_CACHE.get(msg)
        if cached is not None:
            out.append((s, cached))
        else:
            to_embed.append((i, msg))
    if to_embed:
        try:
            from openai import OpenAI
            client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
            resp = client.embeddings.create(
                input=[m for _, m in to_embed], model=_EMBED_MODEL,
            )
            for (idx, msg), emb in zip(to_embed, resp.data):
                vec = list(emb.embedding)
                _SHOT_EMBED_CACHE[msg] = vec
                out.append((shots[idx], vec))
        except Exception:
            pass
    return out


def select_adaptive_examples(
    query: str,
    session: Optional["Session"] = None,
    top_k: int = 3,
) -> list[dict]:
    """Pick up to `top_k` few-shot exemplars ranked by embedding cosine
    similarity against (query + session signature). When a session is
    passed, its raw-history signature is prepended to the query text so
    a multi-turn follow-up ("아까 그거 4날로") ranks against the full
    context, not just the short tail. Falls back to the FIFO tail when
    the pool is empty or embedding is unavailable."""
    shots = load_few_shots()
    if not shots:
        if _DEBUG:
            _logger.info("few_shot: empty pool — no examples")
        return []
    if top_k <= 0:
        return []

    # Build signature — None session degrades to query-only.
    signature = ""
    if session is not None:
        try:
            from session import get_session_signature
            signature = get_session_signature(session) or ""
        except Exception:
            signature = ""
    context_text = f"{signature}\n{query}".strip() if signature else (query or "")

    q_vec = _embed_one(context_text) if context_text else None
    if q_vec is None:
        # FIFO fallback — preserves legacy behavior when embedding fails.
        fallback = shots[-min(top_k, len(shots)):]
        if _DEBUG:
            _logger.info(
                "few_shot: fallback to FIFO tail (session=%s, picked=%d)",
                session is not None, len(fallback),
            )
        return fallback

    scored = _embed_shots(shots)
    if not scored:
        fallback = shots[-min(top_k, len(shots)):]
        if _DEBUG:
            _logger.info("few_shot: shot embed failed — FIFO fallback")
        return fallback

    ranked = sorted(
        scored,
        key=lambda se: _cosine(q_vec, se[1]),
        reverse=True,
    )
    picks = [s for s, _vec in ranked[:top_k]]
    if _DEBUG:
        preview = [p.get("message", "")[:50] for p in picks]
        _logger.info(
            "few_shot: adaptive (session=%s, sig_chars=%d, query=%r) → %s",
            session is not None, len(signature), (query or "")[:50], preview,
        )
    return picks


def render_adaptive_suffix(
    query: str,
    session: Optional["Session"] = None,
    top_k: int = PROMPT_SHOTS,
) -> str:
    """`render_prompt_suffix` counterpart that uses adaptive selection.
    Produces the same `추가 예시:` block shape so SCR can drop it in as
    a direct replacement."""
    picks = select_adaptive_examples(query, session=session, top_k=top_k)
    if not picks:
        return ""
    lines: list[str] = ["", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "추가 예시 (실패 후 정정된 케이스):"]
    for s in picks:
        msg = s.get("message") or ""
        exp = s.get("expected") or {}
        lines.append(f'입력: "{msg}"')
        lines.append(f"출력: {json.dumps(exp, ensure_ascii=False)}")
    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    return "\n".join(lines)
