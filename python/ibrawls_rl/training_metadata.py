"""Training-run metadata for brain compatibility and mechanics coverage."""
from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from .config import TrainConfig

DEFAULT_METADATA_FILE = "training_metadata.json"


def _finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _rounded(value: Any, digits: int = 4) -> float:
    number = _finite_float(value)
    return round(number if number is not None else 0.0, digits)


def _base_values(header: dict, keys: list[str]) -> dict[str, float]:
    raw = header.get("mechanicsBaseValues") or {}
    out: dict[str, float] = {}
    if isinstance(raw, dict):
        for key in keys:
            value = _finite_float(raw.get(key))
            if value is not None:
                out[key] = value
    return out


def build_training_metadata(cfg: TrainConfig, env_header: dict) -> dict:
    """Build the persisted run contract from the resolved config and sim handshake."""
    keys = [str(k) for k in (env_header.get("mechanicsCoverageKeys") or [])]
    fields = [str(k) for k in (env_header.get("mechanicsCoverageFields") or [])]
    mode = str(env_header.get("mode") or cfg.mode)
    cfg_values = asdict(cfg)
    metadata = {
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "run": {
            "mode": mode,
            "logdir": cfg.logdir,
            "seed": int(cfg.seed),
            "total_steps": int(cfg.total_steps),
            "decision_interval": int(cfg.decision_interval),
        },
        "model_contract": {
            "mode": mode,
            "observation_version": int(env_header.get("observationVersion") or cfg.observation_version),
            "frame_stack": int(cfg.frame_stack),
            "obs_dim": int(env_header.get("obsDim") or 0),
            "action_dim": int(env_header.get("actionDim") or 0),
            "width": int(cfg.width),
            "depth": int(cfg.depth),
            "decision_interval": int(cfg.decision_interval),
        },
        "combat": {
            "world_sizes": list(cfg.combat_world_sizes),
            "layout_mix": list(cfg.combat_layout_mix),
            "bait_layout_mix": list(cfg.combat_bait_layout_mix),
            "kill_range": [int(cfg.combat_kill_min), int(cfg.combat_kill_max)],
            "randomize_layout": bool(cfg.combat_randomize_layout),
            "lone_wolf_reward_scale": float(cfg.combat_lone_wolf_reward_scale),
        },
        "mechanics": {
            "randomize": {
                "enabled": bool(cfg.randomize_enabled),
                "pct": float(cfg.randomize_pct),
            },
            "keys": keys,
            "fields": fields,
            "base_values": _base_values(env_header, keys),
            "coverage": {},
        },
        "config": cfg_values,
    }
    return metadata


def merge_mechanics_coverage(metadata: dict, coverage: dict[str, dict[str, Any]]) -> dict:
    """Merge one step's sampled mechanics coverage into the cumulative metadata."""
    mechanics = metadata.setdefault("mechanics", {})
    cumulative = mechanics.setdefault("coverage", {})
    base_values = mechanics.get("base_values") if isinstance(mechanics.get("base_values"), dict) else {}
    randomize = mechanics.get("randomize") if isinstance(mechanics.get("randomize"), dict) else {}
    pct = _finite_float(randomize.get("pct") if randomize else 0.0) or 0.0
    for key, row in (coverage or {}).items():
        if not isinstance(row, dict):
            continue
        count = _finite_float(row.get("count")) or 0.0
        if count <= 0:
            continue
        total = _finite_float(row.get("sum"))
        if total is None:
            mean = _finite_float(row.get("mean")) or 0.0
            total = mean * count
        low = _finite_float(row.get("min"))
        high = _finite_float(row.get("max"))
        if low is None or high is None:
            continue
        current = cumulative.get(key)
        if not isinstance(current, dict) or float(current.get("count", 0.0)) <= 0:
            merged = {"count": int(count), "min": low, "max": high, "sum": total}
        else:
            prev_count = _finite_float(current.get("count")) or 0.0
            prev_sum = _finite_float(current.get("sum")) or (
                (_finite_float(current.get("mean")) or 0.0) * prev_count
            )
            merged = {
                "count": int(prev_count + count),
                "min": min(_finite_float(current.get("min")) or low, low),
                "max": max(_finite_float(current.get("max")) or high, high),
                "sum": prev_sum + total,
            }
        merged["mean"] = merged["sum"] / max(1, merged["count"])
        base = _finite_float(base_values.get(key) if isinstance(base_values, dict) else None)
        if base is not None:
            merged["base"] = base
            merged["coverage_low"] = base * (1.0 - pct)
            merged["coverage_high"] = base * (1.0 + pct)
        cumulative[key] = {
            name: (int(value) if name == "count" else _rounded(value))
            for name, value in merged.items()
        }
    return metadata


def write_training_metadata(run_dir: str, metadata: dict) -> str:
    """Persist metadata to ``training_metadata.json`` inside a run directory."""
    os.makedirs(run_dir, exist_ok=True)
    path = os.path.join(run_dir, DEFAULT_METADATA_FILE)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2, sort_keys=True)
        f.write("\n")
    return path


def find_training_metadata(model_or_run_path: str) -> str | None:
    """Find metadata beside a model, walking up through checkpoints/ when needed."""
    d = os.path.abspath(model_or_run_path)
    if os.path.isfile(d):
        d = os.path.dirname(d)
    for _ in range(4):
        path = os.path.join(d, DEFAULT_METADATA_FILE)
        if os.path.exists(path):
            return path
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return None


def read_training_metadata(model_or_run_path: str) -> dict | None:
    path = find_training_metadata(model_or_run_path)
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None
