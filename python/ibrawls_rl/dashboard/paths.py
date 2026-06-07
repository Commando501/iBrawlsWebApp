"""Shared path resolution for the dashboard.

The dashboard always operates relative to the python project dir (the folder that
holds ``config.toml`` and ``runs/``), regardless of the current working directory,
so launching it from anywhere behaves the same.
"""
from __future__ import annotations

import os

# .../python/ibrawls_rl/dashboard/paths.py -> .../python
PROJECT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RUNS_DIR = os.path.join(PROJECT_DIR, "runs")
CONFIG_PATH = os.path.join(PROJECT_DIR, "config.toml")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


def runs_dir() -> str:
    os.makedirs(RUNS_DIR, exist_ok=True)
    return RUNS_DIR


def safe_run_path(run_dir: str) -> str | None:
    """Resolve a user-supplied run path and confirm it stays under runs/ (or python/)."""
    if not run_dir:
        return None
    cand = run_dir if os.path.isabs(run_dir) else os.path.join(PROJECT_DIR, run_dir)
    cand = os.path.abspath(cand)
    if os.path.commonpath([cand, PROJECT_DIR]) != PROJECT_DIR:
        return None
    return cand
