from __future__ import annotations

import json

from ibrawls_rl.dashboard.model_contract import build_model_contract


def test_model_contract_prefers_training_metadata(tmp_path):
    run = tmp_path / "runs" / "combat_contract"
    run.mkdir(parents=True)
    model = run / "final_model.zip"
    model.write_bytes(b"zip")
    (run / "training_metadata.json").write_text(json.dumps({
        "schema_version": 1,
        "run": {"mode": "combat", "decision_interval": 5},
        "model_contract": {
            "mode": "combat",
            "observation_version": 3,
            "frame_stack": 4,
            "obs_dim": 260,
            "action_dim": 6,
        },
        "mechanics": {
            "randomize": {"enabled": True, "pct": 0.15},
            "keys": ["attackRange"],
            "base_values": {"attackRange": 2.8},
            "coverage": {"attackRange": {"count": 12, "min": 2.38, "mean": 2.82, "max": 3.22}},
        },
    }), encoding="utf-8")

    contract = build_model_contract(str(model), project_dir=str(tmp_path))

    assert contract["source"] == "training_metadata"
    assert contract["partial"] is False
    assert contract["mode"] == "combat"
    assert contract["model_contract"]["observation_version"] == 3
    assert contract["mechanics"]["coverage"]["attackRange"]["count"] == 12


def test_model_contract_falls_back_to_config_used(tmp_path):
    run = tmp_path / "runs" / "legacy"
    run.mkdir(parents=True)
    model = run / "final_model.zip"
    model.write_bytes(b"zip")
    (run / "config_used.toml").write_text(
        """
[run]
mode = "combat"
decision_interval = 5

[network]
frame_stack = 4
observation_version = 3

[randomize]
enabled = true
pct = 0.15
""".strip(),
        encoding="utf-8",
    )

    contract = build_model_contract(str(model), project_dir=str(tmp_path))

    assert contract["source"] == "config_used"
    assert contract["partial"] is True
    assert contract["mode"] == "combat"
    assert contract["model_contract"]["frame_stack"] == 4
    assert contract["mechanics"]["randomize"] == {"enabled": True, "pct": 0.15}
    assert contract["warnings"]
