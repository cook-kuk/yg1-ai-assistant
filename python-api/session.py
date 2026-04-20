"""In-memory multi-turn session store.

Each session holds the dialogue history + the last effective filter set
+ the EDP list from the previous recommendation. Used by /products to:
  - carry missing fields from the prior intent ("switch to 4날" alone
    still benefits from the last turn's material/diameter),
  - narrow a follow-up search to the previously surfaced products
    ("이 중에서 …"),
  - let the chat layer show coherent chips across turns.

Expires after SESSION_TTL seconds of inactivity, swept by a daemon Timer.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Memory design principle:
We keep raw conversation history verbatim, mirroring the Anthropic/OpenAI
messages[] convention. No summarization, no compression, no structured
rewrites. The LLM's native context understanding is the source of truth
for multi-turn coherence. TTL and max_turns windowing handle bounds.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Optional

from config import (
    HISTORY_MAX_TURNS,
    SESSION_CLEANUP_INTERVAL_SEC as _CLEANUP_INTERVAL_SEC_CFG,
    SESSION_TTL_SEC as _SESSION_TTL_SEC_CFG,
)
from canonical_values import INVALID_BRANDS as _INVALID_BRANDS_CFG

# Module-level aliases sourced from config/canonical_values (SSOT). Kept
# here with the same names so the sweeper Timer and carry_forward_intent
# keep reading the same identifiers.
SESSION_TTL_SEC = _SESSION_TTL_SEC_CFG
_CLEANUP_INTERVAL_SEC = _CLEANUP_INTERVAL_SEC_CFG

_SESSIONS: dict[str, "Session"] = {}
_LOCK = threading.Lock()


@dataclass
class Session:
    session_id: str
    created_at: datetime
    last_used_at: datetime
    turns: list[dict] = field(default_factory=list)        # [{role, message, intent, products, at}]
    current_filters: dict = field(default_factory=dict)    # effective SCRIntent-shaped dict
    # Step 2 #5 — scored candidate rows from the last turn, capped at
    # REFINE_RANKED_CAP. Feeds refine_engine.refine_in_memory so drill-down
    # turns can skip SCR + DB + LLM. dict shape matches main.py's ranked[0]
    # (product dict + score dict merged).
    last_ranked: list[dict] = field(default_factory=list)

    # previous_products is a read-only view over last_ranked — keeps the
    # legacy "EDP list" API alive without double state. Callers that used
    # to write `session.previous_products = [...]` must now assign to
    # `session.last_ranked` (list of dicts) or call `update_last_ranked`.
    @property
    def previous_products(self) -> list[str]:
        out: list[str] = []
        for r in self.last_ranked:
            if not isinstance(r, dict):
                continue
            edp = r.get("edp_no")
            if edp:
                out.append(str(edp))
        return out

    def update_last_ranked(
        self,
        ranked: list,
        *,
        cap: Optional[int] = None,
    ) -> None:
        """Persist the turn's ranked candidates. Accepts either the raw
        `list[tuple(dict, score, breakdown)]` shape main.py produces or
        a pre-flattened `list[dict]`. Cap defaults to config.REFINE_RANKED_CAP
        so session memory stays bounded at ~25KB per active session."""
        if cap is None:
            from config import REFINE_RANKED_CAP
            cap = REFINE_RANKED_CAP
        flat: list[dict] = []
        for item in (ranked or []):
            if isinstance(item, tuple) and item and isinstance(item[0], dict):
                merged = dict(item[0])
                # Attach score + breakdown when present so refine can
                # surface rank order + explain "why" later.
                if len(item) >= 2 and isinstance(item[1], (int, float)):
                    merged.setdefault("_score", float(item[1]))
                if len(item) >= 3 and isinstance(item[2], dict):
                    merged.setdefault("_breakdown", dict(item[2]))
                flat.append(merged)
            elif isinstance(item, dict):
                flat.append(dict(item))
        self.last_ranked = flat[:cap]


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
    total_count: int = 0,
    answer_preview: Optional[str] = None,
    top_products: Optional[list[dict]] = None,
) -> None:
    """Append a dialogue turn. `products` stays the EDP list that drives
    follow-up narrowing; `top_products` is an optional list[dict] used only
    by build_conversation_memory to render "이전 턴에 추천했던 3개" previews
    — storing brand/series strings, not the full candidate payload."""
    top_summary = ""
    if top_products:
        parts: list[str] = []
        for p in top_products[:3]:
            if not isinstance(p, dict):
                continue
            brand = (p.get("brand") or "").strip()
            series = (p.get("series") or p.get("series_name") or "").strip()
            if brand or series:
                parts.append(f"{brand} {series}".strip())
        top_summary = " / ".join(parts)

    session.turns.append({
        "role": role,
        "message": message,
        "intent": intent,
        "products": products,
        "total_count": total_count,
        "answer_preview": answer_preview,
        "products_summary": top_summary,
        "at": datetime.now().isoformat(timespec="seconds"),
    })
    session.last_used_at = datetime.now()
    if products:
        # Legacy callers pass an EDP-only list here (no score/breakdown).
        # Wrap into dicts so last_ranked's "list[dict]" invariant holds —
        # refine_engine falls back to unscored behavior when _score is
        # absent. Skipped when top_products already drove a dict-shaped
        # update via update_last_ranked on the call site.
        if not session.last_ranked:
            session.last_ranked = [{"edp_no": str(p)} for p in products if p]
    if intent:
        # Update the effective filter context with fields the new intent set.
        # None values don't overwrite — they'd erase prior decisions.
        for k, v in intent.items():
            if v is not None:
                session.current_filters[k] = v


def build_conversation_memory(session: Optional[Session], max_turns: int = HISTORY_MAX_TURNS) -> str:
    """Render the last `max_turns` dialogue turns as a compact block the CoT
    prompt can reason over. The block shows each turn's role, message,
    extracted filters, total_count, and a trimmed answer preview — plus a
    "대화 흐름 요약" tail that diffs the first-vs-current intent so the model
    can spot *what the user just added or dropped* without re-parsing the
    whole transcript.

    Returns "" when the session is empty; caller should skip rendering."""
    if not session or not session.turns:
        return ""
    recent = session.turns[-max_turns:]
    lines: list[str] = ["[대화 히스토리]"]
    for i, turn in enumerate(recent, 1):
        role = turn.get("role") or "?"
        msg = (turn.get("message") or "").strip()
        intent_dict = turn.get("intent") or {}
        total = turn.get("total_count") or 0
        if role == "user":
            lines.append(f"턴{i} [유저]: {msg}")
            active = {k: v for k, v in intent_dict.items() if v is not None}
            if active:
                lines.append(f"  → 필터: {active}")
        elif role == "assistant":
            preview = turn.get("answer_preview") or msg
            preview = (preview[:150] + "…") if len(preview) > 150 else preview
            lines.append(f"턴{i} [AI]: {preview}")
            if total:
                lines.append(f"  → {total}건 추천")
            products_summary = turn.get("products_summary") or ""
            if products_summary:
                lines.append(f"  → top: {products_summary}")

    # 대화 흐름 요약 — first vs current user turn so the model can see what
    # filter set *changed* between the original ask and the latest follow-up.
    user_turns = [t for t in recent if t.get("role") == "user"]
    if len(user_turns) >= 2:
        first_msg = (user_turns[0].get("message") or "").strip()
        last_msg = (user_turns[-1].get("message") or "").strip()
        lines.append("")
        lines.append("[대화 흐름 요약]")
        lines.append(f"  시작: {first_msg}")
        lines.append(f"  현재: {last_msg}")
        first_intent = user_turns[0].get("intent") or {}
        last_intent = user_turns[-1].get("intent") or {}
        added = {
            k: v for k, v in last_intent.items()
            if v is not None and first_intent.get(k) is None
        }
        removed = {
            k: v for k, v in first_intent.items()
            if v is not None and last_intent.get(k) is None
        }
        if added:
            lines.append(f"  추가된 조건: {added}")
        if removed:
            lines.append(f"  제거된 조건: {removed}")
    return "\n".join(lines)


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


# Category-style "brands" blacklist — single source in canonical_values.
# The carry-forward filter reads this to avoid resurrecting a stale
# "Tooling System" misparse on follow-up turns. Kept as a module name so
# external importers (`from session import INVALID_BRANDS`) still work.
INVALID_BRANDS = _INVALID_BRANDS_CFG


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


# ── Raw history access ────────────────────────────────────────────────
# Per the module-level "Memory design principle" above, downstream callers
# (chat.py, few_shot.py, scr.py) read history through these helpers rather
# than through any summarization layer. The goal is for the LLM to see the
# turns exactly as they happened — same role/content shape it sees elsewhere.


def get_raw_history(
    session: Optional[Session],
    max_turns: int = 10,
    role_filter: Optional[str] = None,
) -> list[dict]:
    """Return the most-recent `max_turns` from the session as raw turn
    dicts (no summarization). `role_filter` optionally restricts to
    "user" or "assistant" turns only."""
    if session is None or not session.turns:
        return []
    turns = session.turns[-max_turns:]
    if role_filter:
        turns = [t for t in turns if t.get("role") == role_filter]
    return turns


def format_history_for_llm(
    session: Optional[Session],
    max_turns: int = HISTORY_MAX_TURNS,
) -> list[dict]:
    """Convert raw turns into the Anthropic/OpenAI messages[] shape —
    a list of {role, content} dicts that callers can prepend to the
    current turn. Skips turns whose message is empty (e.g. a manual-
    filter request with no NL text)."""
    history = get_raw_history(session, max_turns=max_turns)
    out: list[dict] = []
    for t in history:
        role = t.get("role")
        content = t.get("message")
        if role not in ("user", "assistant"):
            continue
        if not content:
            continue
        out.append({"role": role, "content": content})
    return out


def get_session_signature(session: Optional[Session]) -> str:
    """Concatenation of the last 5 user messages, newline-separated. Used
    by few_shot.select_adaptive_examples as the embedding signature so
    multi-turn queries pull different exemplars than single-turn ones.
    Empty string when the session is empty."""
    user_turns = get_raw_history(session, max_turns=5, role_filter="user")
    msgs = [t.get("message") or "" for t in user_turns]
    return "\n".join(m for m in msgs if m)
