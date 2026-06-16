"""Model contract reader for the RL control board."""
from __future__ import annotations

import os
import tomllib

from ..training_metadata import find_training_metadata, read_training_metadata
from .paths import PROJECT_DIR


def _walk_up_file(start: str, filename: str, depth: int = 4) -> str | None:
    d = os.path.abspath(start)
    if os.path.isfile(d):
        d = os.path.dirname(d)
    for _ in range(depth):
        path = os.path.join(d, filename)
        if os.path.exists(path):
            return path
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return None


def _rel(path: str, project_dir: str) -> str:
    try:
        return os.path.relpath(path, project_dir).replace("\\", "/")
    except ValueError:
        return path.replace("\\", "/")


def _load_toml(path: str) -> dict:
    try:
        with open(path, "rb") as f:
            return tomllib.load(f)
    except (OSError, tomllib.TOMLDecodeError):
        return {}


def _fallback_from_config(model_path: str, project_dir: str) -> dict:
    cfg_path = _walk_up_file(model_path, "config_used.toml")
    cfg = _load_toml(cfg_path) if cfg_path else {}
    run = cfg.get("run", {}) if isinstance(cfg.get("run"), dict) else {}
    network = cfg.get("network", {}) if isinstance(cfg.get("network"), dict) else {}
    randomize = cfg.get("randomize", {}) if isinstance(cfg.get("randomize"), dict) else {}
    mode = str(run.get("mode") or "unknown")
    return {
        "source": "config_used" if cfg else "missing",
        "partial": True,
        "model": _rel(os.path.abspath(model_path), project_dir),
        "mode": mode,
        "model_contract": {
            "mode": mode,
            "observation_version": int(network.get("observation_version", 1) or 1),
            "frame_stack": int(network.get("frame_stack", 1) or 1),
            "decision_interval": int(run.get("decision_interval", 1) or 1),
            "width": int(network.get("width", 0) or 0),
            "depth": int(network.get("depth", 0) or 0),
        },
        "mechanics": {
            "randomize": {
                "enabled": bool(randomize.get("enabled", False)),
                "pct": float(randomize.get("pct", 0.0) or 0.0),
            },
            "keys": [],
            "base_values": {},
            "coverage": {},
        },
        "warnings": [
            "training_metadata.json missing; mechanics coverage and exact sim contract are unavailable."
        ],
        "metadata_path": None,
        "config_path": _rel(cfg_path, project_dir) if cfg_path else None,
    }


def build_model_contract(model_path: str, project_dir: str = PROJECT_DIR) -> dict:
    """Return the best-known contract for a saved model."""
    model_abs = os.path.abspath(model_path)
    metadata = read_training_metadata(model_abs)
    metadata_path = find_training_metadata(model_abs)
    if isinstance(metadata, dict):
        contract = metadata.get("model_contract", {}) if isinstance(metadata.get("model_contract"), dict) else {}
        mode = str(contract.get("mode") or metadata.get("run", {}).get("mode") or "unknown")
        return {
            "source": "training_metadata",
            "partial": False,
            "model": _rel(model_abs, project_dir),
            "mode": mode,
            "run": metadata.get("run", {}),
            "model_contract": contract,
            "combat": metadata.get("combat", {}),
            "mechanics": metadata.get("mechanics", {}),
            "warnings": [],
            "metadata_path": _rel(metadata_path, project_dir) if metadata_path else None,
            "config_path": _rel(_walk_up_file(model_abs, "config_used.toml"), project_dir)
            if _walk_up_file(model_abs, "config_used.toml") else None,
        }
    return _fallback_from_config(model_abs, project_dir)
