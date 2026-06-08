"""Persistent evaluation history for the dashboard.

Every finished grade is appended as one JSON line to ``eval_history.jsonl`` in the project
dir, so the Evaluate tab can show past results and compare models across dashboard restarts.
Append-only + tolerant parsing keeps it robust to partial writes.
"""
from __future__ import annotations

import json
import os
import time

from .paths import PROJECT_DIR

HISTORY_PATH = os.path.join(PROJECT_DIR, "eval_history.jsonl")


def append(record: dict) -> None:
    rec = {"ts": record.get("ts") or time.time(), **record}
    with open(HISTORY_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")


def load() -> list[dict]:
    """All recorded grades, newest first."""
    if not os.path.exists(HISTORY_PATH):
        return []
    out: list[dict] = []
    with open(HISTORY_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    out.sort(key=lambda r: r.get("ts", 0), reverse=True)
    return out


def clear() -> None:
    try:
        if os.path.exists(HISTORY_PATH):
            os.remove(HISTORY_PATH)
    except OSError:
        pass
