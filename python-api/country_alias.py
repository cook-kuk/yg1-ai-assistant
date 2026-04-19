"""Country alias normalization — Korean / English / case variants → DB canonical.

The MV's `country_codes` array is heterogeneous: KOREA / AMERICA / America /
EUROPE / Europe / ASIA / Asia all appear. The original `country_codes @> ARRAY[%s]`
filter required an exact-string match, so a user query "한국에서 재고 있는"
or "미국 재고" silently returned nothing.

This module exposes one helper: `expand_country(raw)` → list of canonical
strings to OR against `country_codes`. Returns the original value as a
single-element list when nothing matches, so unknown inputs degrade
gracefully without crashing the search.
"""
from __future__ import annotations


# Canonical → all DB literal forms (case variants live in MV across regions).
_CANONICAL_VARIANTS: dict[str, list[str]] = {
    "KOREA":   ["KOREA"],
    "AMERICA": ["AMERICA", "America"],
    "EUROPE":  ["EUROPE", "Europe"],
    "ASIA":    ["ASIA", "Asia"],
}


# Alias → canonical. Lower-cased + whitespace-stripped key.
# Korean: 한국/미국/유럽/아시아 + 일본/중국/대만 (mapped to ASIA, since the
# MV doesn't break those out — every Asia EDP carries 'ASIA').
_COUNTRY_ALIASES: dict[str, str] = {
    # Korea
    "korea": "KOREA",
    "kor": "KOREA",
    "kr": "KOREA",
    "한국": "KOREA",
    "국내": "KOREA",
    # America (Americas, broadly)
    "america": "AMERICA",
    "us": "AMERICA",
    "usa": "AMERICA",
    "미국": "AMERICA",
    "북미": "AMERICA",
    "미주": "AMERICA",
    # Europe
    "europe": "EUROPE",
    "eu": "EUROPE",
    "유럽": "EUROPE",
    "구주": "EUROPE",
    # Asia (broader Asia bucket — Japan/China/Taiwan/Vietnam roll up here
    # since the MV doesn't keep finer-grained codes)
    "asia": "ASIA",
    "아시아": "ASIA",
    "일본": "ASIA",
    "japan": "ASIA",
    "jp": "ASIA",
    "중국": "ASIA",
    "china": "ASIA",
    "cn": "ASIA",
    "대만": "ASIA",
    "taiwan": "ASIA",
    "베트남": "ASIA",
    "vietnam": "ASIA",
}


def canonicalize_country(raw: str | None) -> str | None:
    """Map any user-supplied country phrasing to one of the four canonical
    DB region codes (KOREA / AMERICA / EUROPE / ASIA). Returns None on
    unknown input so callers can decide whether to skip the filter."""
    if not raw:
        return None
    key = str(raw).strip().lower()
    if not key:
        return None
    # Direct alias hit.
    if key in _COUNTRY_ALIASES:
        return _COUNTRY_ALIASES[key]
    # Already canonical (any case)?
    upper = str(raw).strip().upper()
    if upper in _CANONICAL_VARIANTS:
        return upper
    # Substring fallback — "한국에서", "미주 재고" still resolve.
    for alias, canonical in _COUNTRY_ALIASES.items():
        if alias in key:
            return canonical
    return None


def expand_country(raw: str | None) -> list[str]:
    """Return the list of DB literal strings to OR against country_codes.
    Empty list when input is unresolvable (caller should drop the filter
    entirely). Always at least one entry when a canonical was found —
    KOREA never had case variants in the MV, the others have two forms."""
    canonical = canonicalize_country(raw)
    if not canonical:
        return []
    return list(_CANONICAL_VARIANTS.get(canonical, [canonical]))
