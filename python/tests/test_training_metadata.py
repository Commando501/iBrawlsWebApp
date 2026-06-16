from __future__ import annotations

import json

from ibrawls_rl.config import TrainConfig
from ibrawls_rl.training_metadata import (
    build_training_metadata,
    merge_mechanics_coverage,
    write_training_metadata,
)


def test_build_training_metadata_records_brain_contract_and_mechanics():
    cfg = TrainConfig(
        mode="combat",
        logdir="runs/combat_contract",
        decision_interval=5,
        frame_stack=4,
        observation_version=3,
        randomize_enabled=True,
        randomize_pct=0.15,
    )
    header = {
        "mode": "combat",
        "obsDim": 260,
        "actionDim": 6,
        "numAgents": 8,
        "mechanicsCoverageKeys": ["attackRange", "dashDistance"],
        "mechanicsCoverageFields": ["count", "min", "max", "sum"],
        "mechanicsBaseValues": {"attackRange": 2.8, "dashDistance": 5.0},
    }

    meta = build_training_metadata(cfg, header)

    assert meta["schema_version"] == 1
    assert meta["run"]["mode"] == "combat"
    assert meta["model_contract"]["observation_version"] == 3
    assert meta["model_contract"]["frame_stack"] == 4
    assert meta["model_contract"]["obs_dim"] == 260
    assert meta["mechanics"]["randomize"]["enabled"] is True
    assert meta["mechanics"]["randomize"]["pct"] == 0.15
    assert meta["mechanics"]["keys"] == ["attackRange", "dashDistance"]
    assert meta["mechanics"]["base_values"]["attackRange"] == 2.8


def test_merge_mechanics_coverage_keeps_min_mean_max_band():
    meta = {
        "mechanics": {
            "randomize": {"enabled": True, "pct": 0.1},
            "base_values": {"attackRange": 3.0},
            "coverage": {},
        }
    }

    merge_mechanics_coverage(meta, {"attackRange": {"count": 4, "min": 2.7, "max": 3.3, "sum": 12.0}})
    merge_mechanics_coverage(meta, {"attackRange": {"count": 2, "min": 2.9, "max": 3.5, "sum": 6.4}})

    cov = meta["mechanics"]["coverage"]["attackRange"]
    assert cov["count"] == 6
    assert cov["min"] == 2.7
    assert cov["max"] == 3.5
    assert cov["mean"] == 3.0667
    assert cov["coverage_low"] == 2.7
    assert cov["coverage_high"] == 3.3


def test_write_training_metadata_persists_json(tmp_path):
    meta = {"schema_version": 1, "run": {"mode": "combat"}}

    path = write_training_metadata(str(tmp_path), meta)

    assert path == str(tmp_path / "training_metadata.json")
    assert json.loads((tmp_path / "training_metadata.json").read_text(encoding="utf-8")) == meta
