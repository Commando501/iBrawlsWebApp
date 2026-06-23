"""Persistent evaluation history for the dashboard.

Every finished grade is appended as one JSON line to ``eval_history.jsonl`` in the project
dir, so the Evaluate tab can show past results and compare models across dashboard restarts.
Append-only + tolerant parsing keeps it robust to partial writes.
"""
from __future__ import annotations

import json
import os
import hashlib
import time

from .paths import PROJECT_DIR

HISTORY_PATH = os.path.join(PROJECT_DIR, "eval_history.jsonl")

_RESULT_KEYS = {
    "model",
    "mode",
    "opponent",
    "matches",
    "num_envs",
    "device",
    "win_rate",
    "loss_rate",
    "draw_rate",
    "episodes",
    "ep_return",
    "behavior",
    "decision_interval",
    "frame_stack",
    "observation_version",
    "summary",
    "scenarios",
    "mechanics_summary",
    "mechanics_suite",
    "league_snapshots",
}


def _stable_record_id(record: dict) -> str:
    payload = {
        "ts": record.get("ts"),
        "model": record.get("model"),
        "mode": record.get("mode"),
        "opponent": record.get("opponent"),
        "matches": record.get("matches"),
        "episodes": record.get("episodes"),
        "result": record.get("result"),
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return "eval-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def normalize(record: dict) -> dict:
    """Return a history record with id and full result payload filled in."""
    rec = dict(record)
    rec["ts"] = rec.get("ts") or time.time()
    result = rec.get("result")
    if isinstance(result, dict):
        for key in _RESULT_KEYS:
            if rec.get(key) is None and key in result:
                rec[key] = result[key]
    else:
        result = {k: v for k, v in rec.items() if k != "id"}
        rec["result"] = result
    rec["id"] = rec.get("id") or _stable_record_id(rec)
    return rec


def _read_records() -> list[dict]:
    if not os.path.exists(HISTORY_PATH):
        return []
    out: list[dict] = []
    with open(HISTORY_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(normalize(json.loads(line)))
            except json.JSONDecodeError:
                continue
    return out


def append(record: dict) -> dict:
    rec = normalize(record)
    for existing in _read_records():
        if existing.get("id") == rec["id"]:
            return existing
    with open(HISTORY_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec) + "\n")
    return rec


def load() -> list[dict]:
    """All recorded grades, newest first."""
    out = _read_records()
    out.sort(key=lambda r: r.get("ts", 0), reverse=True)
    return out


def delete(record_id: str) -> bool:
    rows = _read_records()
    keep = [row for row in rows if row.get("id") != record_id]
    if len(keep) == len(rows):
        return False
    with open(HISTORY_PATH, "w", encoding="utf-8") as f:
        for row in keep:
            f.write(json.dumps(row) + "\n")
    return True


def clear() -> None:
    try:
        if os.path.exists(HISTORY_PATH):
            os.remove(HISTORY_PATH)
    except OSError:
        pass
