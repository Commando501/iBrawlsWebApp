from __future__ import annotations

from ibrawls_rl.config import TrainConfig, config_from_values, config_schema, dump_toml, reward_dict


def test_human_likeness_training_knobs_roundtrip_through_config_helpers():
    cfg = config_from_values({
        "frame_stack": 4,
        "league_snapshots": ["runs/a/final_model.zip", "runs/b/final_model.zip"],
        "league_latest_bias": 0.8,
        "reward_invalid_attack": 0.4,
        "reward_invalid_dash": 0.3,
        "reward_invalid_jump": 0.2,
        "reward_invalid_swap": 0.1,
    })

    assert cfg.frame_stack == 4
    assert cfg.league_snapshots == ["runs/a/final_model.zip", "runs/b/final_model.zip"]
    assert cfg.league_latest_bias == 0.8
    assert reward_dict(cfg)["invalidAttack"] == 0.4
    assert reward_dict(cfg)["invalidDash"] == 0.3
    assert reward_dict(cfg)["invalidJump"] == 0.2
    assert reward_dict(cfg)["invalidSwap"] == 0.1

    toml = dump_toml(cfg)
    assert "[league]" in toml
    assert 'snapshots = ["runs/a/final_model.zip", "runs/b/final_model.zip"]' in toml
    assert "frame_stack = 4" in toml
    assert "invalid_attack = 0.4" in toml


def test_dashboard_schema_exposes_frame_stack_and_snapshot_league():
    sections = config_schema()
    by_field = {
        knob["field"]: knob
        for section in sections
        for knob in section["knobs"]
    }

    assert by_field["frame_stack"]["type"] == "int"
    assert by_field["league_snapshots"]["type"] == "strlist"
    assert by_field["reward_invalid_attack"]["type"] == "float"
    assert any(section["section"] == "league" for section in sections)


def test_train_config_defaults_keep_existing_behavior_off():
    cfg = TrainConfig()
    assert cfg.frame_stack == 1
    assert cfg.league_snapshots == []
    assert reward_dict(cfg)["invalidAttack"] == 0.0
