"""Tunable magic numbers + environment-backed settings — single source
of truth.

Mirrors the TypeScript side's `lib/config.ts` convention (env override
with a typed default via `envNum`). Any file in python-api that hard-
coded a threshold / TTL / model id / retry count should import from here
instead so ops can retune without reading the full codebase.

Everything is read at import time; call `reload_env()` in tests only.
"""
from __future__ import annotations

import os

# ── env helpers ──────────────────────────────────────────────────────


def envNum(name: str, default: int | float) -> float:
    """Parse an env var as number with fallback. Float return so the
    caller can narrow to int where appropriate."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


def envInt(name: str, default: int) -> int:
    return int(envNum(name, default))


def envStr(name: str, default: str) -> str:
    v = os.environ.get(name)
    return v if v is not None and v.strip() != "" else default


# ── OpenAI model IDs ─────────────────────────────────────────────────
# CLAUDE.md: provider.ts 의 tier naming (haiku/sonnet/opus) 은 건드리지
# 말 것. env var 이름도 그 관례를 따른다.
OPENAI_LIGHT_MODEL = envStr("OPENAI_HAIKU_MODEL", "gpt-5.4-mini")
OPENAI_STRONG_MODEL = envStr("OPENAI_SONNET_MODEL", "gpt-5.4")
OPENAI_EMBED_MODEL = envStr("OPENAI_EMBED_MODEL", "text-embedding-3-small")

# ── Session store ────────────────────────────────────────────────────
SESSION_TTL_SEC = int(envNum("SESSION_TTL_SEC", 60 * 60))          # 1 hour idle
SESSION_CLEANUP_INTERVAL_SEC = int(envNum("SESSION_CLEANUP_INTERVAL_SEC", 5 * 60))

# ── Few-shot pool ────────────────────────────────────────────────────
FEW_SHOT_MAX_SHOTS = envInt("FEW_SHOT_MAX_SHOTS", 20)       # file cap
FEW_SHOT_PROMPT_SHOTS = envInt("FEW_SHOT_PROMPT_SHOTS", 5)  # surfaced in prompt

# ── Dual CoT (chat.py) ───────────────────────────────────────────────
DUAL_COT_STRONG_THRESHOLD = envInt("DUAL_COT_STRONG_THRESHOLD", 3)
DUAL_COT_PARTIAL_CHARS = envInt("DUAL_COT_PARTIAL_CHARS", 50)

# ── Conversation memory window ───────────────────────────────────────
MEMORY_MAX_TURNS = envInt("MEMORY_MAX_TURNS", 6)

# ── Golden test harness retry ────────────────────────────────────────
GOLDEN_RETRY_STATUS: set[int] = {429, 500, 502, 503, 504}
GOLDEN_MAX_RETRIES = envInt("GOLDEN_MAX_RETRIES", 3)
GOLDEN_BASE_BACKOFF_SEC = envNum("GOLDEN_BASE_BACKOFF_SEC", 1.0)
GOLDEN_INTER_CASE_SLEEP_SEC = envNum("GOLDEN_INTER_CASE_SLEEP_SEC", 0.3)

# ── Negation proximity window (scr.py) ───────────────────────────────
# Chars of context around a brand mention that still count as the same
# negation clause. 15 gives us typical trailing "말고 …" while staying
# short enough to dodge unrelated negations elsewhere in the sentence.
NEGATION_PROXIMITY_CHARS = envInt("NEGATION_PROXIMITY_CHARS", 15)


def reload_env() -> None:
    """Re-read env. Intended for tests that monkeypatch envs mid-process."""
    globals().update(
        OPENAI_LIGHT_MODEL=envStr("OPENAI_HAIKU_MODEL", "gpt-5.4-mini"),
        OPENAI_STRONG_MODEL=envStr("OPENAI_SONNET_MODEL", "gpt-5.4"),
        OPENAI_EMBED_MODEL=envStr("OPENAI_EMBED_MODEL", "text-embedding-3-small"),
        SESSION_TTL_SEC=int(envNum("SESSION_TTL_SEC", 60 * 60)),
        SESSION_CLEANUP_INTERVAL_SEC=int(envNum("SESSION_CLEANUP_INTERVAL_SEC", 5 * 60)),
        FEW_SHOT_MAX_SHOTS=envInt("FEW_SHOT_MAX_SHOTS", 20),
        FEW_SHOT_PROMPT_SHOTS=envInt("FEW_SHOT_PROMPT_SHOTS", 5),
        DUAL_COT_STRONG_THRESHOLD=envInt("DUAL_COT_STRONG_THRESHOLD", 3),
        DUAL_COT_PARTIAL_CHARS=envInt("DUAL_COT_PARTIAL_CHARS", 50),
        MEMORY_MAX_TURNS=envInt("MEMORY_MAX_TURNS", 6),
        GOLDEN_MAX_RETRIES=envInt("GOLDEN_MAX_RETRIES", 3),
        GOLDEN_BASE_BACKOFF_SEC=envNum("GOLDEN_BASE_BACKOFF_SEC", 1.0),
        GOLDEN_INTER_CASE_SLEEP_SEC=envNum("GOLDEN_INTER_CASE_SLEEP_SEC", 0.3),
        NEGATION_PROXIMITY_CHARS=envInt("NEGATION_PROXIMITY_CHARS", 15),
    )
