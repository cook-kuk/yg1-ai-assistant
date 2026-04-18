"""In-memory multi-turn session store.

Each session holds the dialogue history + the last effective filter set
+ the EDP list from the previous recommendation. Used by /products to:
  - carry missing fields from the prior intent ("switch to 4날" alone
    still benefits from the last turn's material/diameter),
  - narrow a follow-up search to the previously surfaced products
    ("이 중에서 …"),
  - let the chat layer show coherent chips across turns.

Expires after SESSION_TTL seconds of inactivity, swept by a daemon Timer.
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Optional

SESSION_TTL_SEC = 60 * 60  # 1 hour idle
_CLEANUP_INTERVAL_SEC = 5 * 60  # sweep every 5 min

_SESSIONS: dict[str, "Session"] = {}
_LOCK = threading.Lock()


@dataclass
class Session:
    session_id: str
    created_at: datetime
    last_used_at: datetime
    turns: list[dict] = field(default_factory=list)        # [{role, message, intent, products, at}]
    current_filters: dict = field(default_factory=dict)    # effective SCRIntent-shaped dict
    previous_products: list[str] = field(default_factory=list)  # EDP numbers from last reply


def get_or_create(session_id: Optional[str]) -> Session:
    """Return an existing session or mint a fresh one. Touching the session
    bumps `last_used_at` so the sweeper doesn't evict active dialogues."""
    now = datetime.now()
    with _LOCK:
        if session_id and session_id in _SESSIONS:
            s = _SESSIONS[session_id]
            s.last_used_at = now
            return s
        sid = session_id or str(uuid.uuid4())
        s = Session(sid, now, now)
        _SESSIONS[sid] = s
        return s


def add_turn(
    session: Session,
    role: str,
    message: str,
    intent: Optional[dict] = None,
    products: Optional[list[str]] = None,
) -> None:
    """Append a dialogue turn. If `products` is non-empty it becomes the new
    `previous_products` reference for the next follow-up narrow."""
    session.turns.append({
        "role": role,
        "message": message,
        "intent": intent,
        "products": products,
        "at": datetime.now().isoformat(timespec="seconds"),
    })
    session.last_used_at = datetime.now()
    if products:
        # Keep only EDP identifiers — scoping follow-ups doesn't need the
        # full candidate payload.
        session.previous_products = list(products)
    if intent:
        # Update the effective filter context with fields the new intent set.
        # None values don't overwrite — they'd erase prior decisions.
        for k, v in intent.items():
            if v is not None:
                session.current_filters[k] = v


def cleanup_expired() -> int:
    """Evict sessions untouched for > SESSION_TTL_SEC. Returns evict count."""
    cutoff = datetime.now() - timedelta(seconds=SESSION_TTL_SEC)
    with _LOCK:
        expired = [k for k, v in _SESSIONS.items() if v.last_used_at < cutoff]
        for k in expired:
            del _SESSIONS[k]
    return len(expired)


def _sweep() -> None:
    cleanup_expired()
    _schedule_sweep()


def _schedule_sweep() -> None:
    t = threading.Timer(_CLEANUP_INTERVAL_SEC, _sweep)
    t.daemon = True
    t.start()


# Kick off the sweeper on import. If the process is a worker + master, the
# daemon thread dies with the worker, which is fine — sessions are
# per-process anyway (the store is module-level, not Redis-backed).
_schedule_sweep()


def session_count() -> int:
    return len(_SESSIONS)


# Category-style "brands" the LLM sometimes hallucinates from generic nouns
# like "tool" or "insert" in the user's message. Blocking them from carry-
# forward means a stale "Tooling System" on turn 1 can't poison turn 2's
# search after the prompt fix makes the LLM stop emitting them.
INVALID_BRANDS: set[str] = {
    "Tooling System",
    "Milling Insert",
    "ADKT Cutter",
    "MORSE TAPER SHANK DRILLS",
    "Morse Taper Shank Drills",
    "Turning",
}


def carry_forward_intent(session: Session, intent: Any) -> Any:
    """Fill None fields on `intent` from `session.current_filters`. Mutates
    `intent` in place and returns it for chaining.
    Only applied for the first N turns so stale state doesn't compound —
    callers decide whether to invoke this each turn or just on follow-ups."""
    if intent is None or not session.current_filters:
        return intent
    for field_name in intent.__class__.model_fields:
        if getattr(intent, field_name, None) is None:
            carried = session.current_filters.get(field_name)
            if carried is not None:
                # Don't resurrect category-style brand misparses that an
                # earlier turn's LLM emitted before the prompt fix landed.
                if field_name == "brand" and str(carried) in INVALID_BRANDS:
                    continue
                setattr(intent, field_name, carried)
    return intent
