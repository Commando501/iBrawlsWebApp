"""Human behavior baseline: what "moves like a person" means, as numbers.

Bands come from real player replays when available — run
``npx tsx scripts/sim/humanBaseline.ts <replay .json files>`` in the repo root to
produce ``python/human_baseline.json`` — and fall back to hand-tuned defaults
otherwise. The eval matrix scores a policy's behavior stats against these bands,
the dashboard colors the behavior chips with them, and the advisor flags
out-of-band movement, so "human-like" is graded against measured human play, not
guesses.

A band is ``[lo, hi]``: values inside cost nothing; the penalty grows linearly
with the distance outside, scaled so being a whole band-width outside costs 1.0.
"""
from __future__ import annotations

import json
import os
import time
from typing import Any

BASELINE_PATH = os.path.join(os.path.dirname(__file__), "..", "human_baseline.json")

# Hand-tuned fallbacks (used until a replay-derived human_baseline.json exists).
# Sources: the bot acts at the decision cadence; humans hold a heading (~low switch
# rate), idle a little but not much, and don't mash buttons every decision.
DEFAULT_BANDS: dict[str, tuple[float, float]] = {
    "idle_frac": (0.02, 0.45),
    "move_switch_rate": (0.05, 0.35),
    "jump_rate": (0.0, 0.45),
    "dash_rate": (0.0, 0.55),
    "attack_rate": (0.05, 0.80),
    "action_repeat_rate": (0.0, 0.65),
}

_cache: dict[str, Any] | None = None
_cache_mtime: float | None = None


def load_baseline(path: str | None = None) -> dict:
    """{"source": "replays"|"defaults", "bands": {metric: [lo, hi]}, ...meta}."""
    global _cache, _cache_mtime
    p = os.path.abspath(path or BASELINE_PATH)
    try:
        mtime = os.path.getmtime(p)
    except OSError:
        mtime = None

    if mtime is not None and _cache is not None and _cache_mtime == mtime:
        return _cache

    bands = {k: [float(lo), float(hi)] for k, (lo, hi) in DEFAULT_BANDS.items()}
    out: dict[str, Any] = {"source": "defaults", "bands": bands}
    if mtime is not None:
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            file_bands = data.get("bands") or {}
            for key, band in file_bands.items():
                if (isinstance(band, (list, tuple)) and len(band) == 2
                        and all(isinstance(x, (int, float)) for x in band)):
                    bands[key] = [float(band[0]), float(band[1])]
            out = {
                "source": "replays",
                "bands": bands,
                "replays": data.get("replays"),
                "samples": data.get("samples"),
                "generated": data.get("generated"),
                "decision_interval": data.get("decision_interval"),
            }
        except Exception:
            pass  # malformed file -> defaults
    _cache, _cache_mtime = out, mtime
    return out


def get_bands() -> dict[str, list[float]]:
    return load_baseline()["bands"]


def band_penalty(behavior: dict | None, bands: dict[str, list[float]] | None = None) -> float:
    """0 = fully inside the human bands; grows with distance outside (capped at 1).

    Per metric the cost is distance-outside / band-width, so a metric a full
    band-width beyond the human range contributes 1.0 on its own.
    """
    if not behavior:
        return 0.0
    bands = bands or get_bands()
    total = 0.0
    for key, band in bands.items():
        v = behavior.get(key)
        if v is None:
            continue
        lo, hi = float(band[0]), float(band[1])
        width = max(1e-6, hi - lo)
        if v > hi:
            total += (float(v) - hi) / width
        elif v < lo:
            total += (lo - float(v)) / width
    return min(1.0, total)


def annotate(behavior: dict | None) -> dict[str, dict]:
    """Per-metric {value, band, status in/high/low} — for printing and the dashboard."""
    bands = get_bands()
    out: dict[str, dict] = {}
    for key, band in bands.items():
        v = (behavior or {}).get(key)
        if v is None:
            continue
        lo, hi = float(band[0]), float(band[1])
        status = "in" if lo <= v <= hi else ("high" if v > hi else "low")
        out[key] = {"value": float(v), "band": [lo, hi], "status": status}
    return out


def write_baseline(path: str, bands: dict, meta: dict | None = None) -> None:
    """Used by tooling/tests to persist a replay-derived baseline."""
    payload = {"version": 1, "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
               "bands": bands, **(meta or {})}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1)
