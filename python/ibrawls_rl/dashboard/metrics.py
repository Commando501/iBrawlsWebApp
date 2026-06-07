"""Reading training metrics + run summaries for the dashboard.

Live/finished runs write ``metrics.jsonl`` (one JSON object per logger dump). Older
runs only have TensorBoard event files; we fall back to reading those via the
``tensorboard`` package (already a dependency) so every run on disk is viewable.
"""
from __future__ import annotations

import json
import os
import tomllib
from typing import Any

from .paths import RUNS_DIR


def _read_jsonl_series(path: str) -> dict[str, list[list[float]]]:
    series: dict[str, list[list[float]]] = {}
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            step = rec.get("step")
            if step is None:
                continue
            for k, v in rec.items():
                if k == "step":
                    continue
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    series.setdefault(k, []).append([float(step), float(v)])
    return series


def _read_tb_series(run_dir: str) -> dict[str, list[list[float]]]:
    """Best-effort scalar extraction from TensorBoard event files under run_dir."""
    try:
        from tensorboard.backend.event_processing.event_accumulator import EventAccumulator
    except Exception:
        return {}

    event_dirs: set[str] = set()
    for root, _dirs, files in os.walk(run_dir):
        if any(f.startswith("events.out.tfevents") for f in files):
            event_dirs.add(root)

    merged: dict[str, dict[float, float]] = {}
    for d in sorted(event_dirs):
        try:
            acc = EventAccumulator(d, size_guidance={"scalars": 0})
            acc.Reload()
        except Exception:
            continue
        for tag in acc.Tags().get("scalars", []):
            try:
                events = acc.Scalars(tag)
            except Exception:
                continue
            bucket = merged.setdefault(tag, {})
            for ev in events:
                bucket[float(ev.step)] = float(ev.value)

    return {tag: [[s, v] for s, v in sorted(pts.items())] for tag, pts in merged.items()}


def read_run_metrics(run_dir: str) -> dict[str, Any]:
    """Return {'source', 'series': {key: [[step, value], ...]}} for one run."""
    jsonl = os.path.join(run_dir, "metrics.jsonl")
    if os.path.exists(jsonl) and os.path.getsize(jsonl) > 0:
        series = _read_jsonl_series(jsonl)
        if series:
            return {"source": "jsonl", "series": series}
    return {"source": "tensorboard", "series": _read_tb_series(run_dir)}


def _read_config_used(run_dir: str) -> dict | None:
    path = os.path.join(run_dir, "config_used.toml")
    if not os.path.exists(path):
        return None
    try:
        with open(path, "rb") as f:
            return tomllib.load(f)
    except Exception:
        return None


def _last_step(run_dir: str) -> float | None:
    jsonl = os.path.join(run_dir, "metrics.jsonl")
    if os.path.exists(jsonl) and os.path.getsize(jsonl) > 0:
        last = None
        with open(jsonl, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        last = json.loads(line).get("step", last)
                    except json.JSONDecodeError:
                        pass
        return float(last) if last is not None else None
    return None


def list_runs() -> list[dict]:
    """Summarize every run folder under runs/ for the Runs tab."""
    out: list[dict] = []
    if not os.path.isdir(RUNS_DIR):
        return out
    for name in sorted(os.listdir(RUNS_DIR)):
        run_dir = os.path.join(RUNS_DIR, name)
        if not os.path.isdir(run_dir):
            continue
        cfg = _read_config_used(run_dir)
        total_steps = None
        mode = None
        opponent = None
        if cfg:
            total_steps = cfg.get("run", {}).get("total_steps")
            mode = cfg.get("run", {}).get("mode")
            opponent = cfg.get("run", {}).get("opponent")
        ckpt_dir = os.path.join(run_dir, "checkpoints")
        n_ckpts = 0
        if os.path.isdir(ckpt_dir):
            n_ckpts = sum(1 for f in os.listdir(ckpt_dir) if f.endswith(".zip"))
        has_final = os.path.exists(os.path.join(run_dir, "final_model.zip"))
        out.append({
            "name": name,
            "path": os.path.relpath(run_dir, RUNS_DIR).replace("\\", "/"),
            "rel": ("runs/" + name).replace("\\", "/"),
            "mode": mode,
            "opponent": opponent,
            "total_steps": total_steps,
            "last_step": _last_step(run_dir),
            "checkpoints": n_ckpts,
            "has_final": has_final,
            "has_jsonl": os.path.exists(os.path.join(run_dir, "metrics.jsonl")),
            "mtime": os.path.getmtime(run_dir),
        })
    out.sort(key=lambda r: r["mtime"], reverse=True)
    return out


def list_models() -> list[dict]:
    """Every loadable model .zip across runs (final + checkpoints), newest first."""
    models: list[dict] = []
    if not os.path.isdir(RUNS_DIR):
        return models
    for name in sorted(os.listdir(RUNS_DIR)):
        run_dir = os.path.join(RUNS_DIR, name)
        if not os.path.isdir(run_dir):
            continue
        cfg = _read_config_used(run_dir)
        mode = cfg.get("run", {}).get("mode") if cfg else None
        final = os.path.join(run_dir, "final_model.zip")
        if os.path.exists(final):
            models.append({
                "label": f"{name} / final",
                "path": ("runs/" + name + "/final_model.zip"),
                "mode": mode,
                "mtime": os.path.getmtime(final),
            })
        ckpt_dir = os.path.join(run_dir, "checkpoints")
        if os.path.isdir(ckpt_dir):
            for f in sorted(os.listdir(ckpt_dir)):
                if f.endswith(".zip"):
                    p = os.path.join(ckpt_dir, f)
                    models.append({
                        "label": f"{name} / {f[:-4]}",
                        "path": ("runs/" + name + "/checkpoints/" + f),
                        "mode": mode,
                        "mtime": os.path.getmtime(p),
                    })
    models.sort(key=lambda m: m["mtime"], reverse=True)
    return models
