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
        "reward_missed_attack_opportunity": 0.25,
    })

    assert cfg.frame_stack == 4
    assert cfg.league_snapshots == ["runs/a/final_model.zip", "runs/b/final_model.zip"]
    assert cfg.league_latest_bias == 0.8
    assert reward_dict(cfg)["invalidAttack"] == 0.4
    assert reward_dict(cfg)["invalidDash"] == 0.3
    assert reward_dict(cfg)["invalidJump"] == 0.2
    assert reward_dict(cfg)["invalidSwap"] == 0.1
    assert reward_dict(cfg)["missedAttackOpportunity"] == 0.25

    toml = dump_toml(cfg)
    assert "[league]" in toml
    assert 'snapshots = ["runs/a/final_model.zip", "runs/b/final_model.zip"]' in toml
    assert "frame_stack = 4" in toml
    assert "invalid_attack = 0.4" in toml
    assert "missed_attack_opportunity = 0.25" in toml


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
    assert by_field["reward_missed_attack_opportunity"]["type"] == "float"
    assert any(section["section"] == "league" for section in sections)


def test_train_config_defaults_keep_existing_behavior_off():
    cfg = TrainConfig()
    assert cfg.frame_stack == 1
    assert cfg.league_snapshots == []
    assert reward_dict(cfg)["invalidAttack"] == 0.0
    assert reward_dict(cfg)["missedAttackOpportunity"] == 0.0


def test_lone_wolf_combat_knobs_roundtrip_through_config_helpers():
    cfg = config_from_values({
        "combat_layout_mix": ["1v1x4", "1v3x2", "ffa8x1"],
        "combat_lone_wolf_reward_scale": 1.35,
        "league_scenario_mix": ["1v2x2"],
        "league_random_opponent_rate": 0.25,
        "observation_version": 1,
    })

    assert cfg.combat_layout_mix == ["1v1x4", "1v3x2", "ffa8x1"]
    assert cfg.combat_lone_wolf_reward_scale == 1.35
    assert cfg.league_scenario_mix == ["1v2x2"]
    assert cfg.league_random_opponent_rate == 0.25
    assert cfg.observation_version == 1

    toml = dump_toml(cfg)
    assert 'layout_mix = ["1v1x4", "1v3x2", "ffa8x1"]' in toml
    assert "lone_wolf_reward_scale = 1.35" in toml
    assert 'scenario_mix = ["1v2x2"]' in toml
    assert "random_opponent_rate = 0.25" in toml
    assert "observation_version = 1" in toml


def test_anti_bait_training_knobs_roundtrip_through_config_helpers():
    cfg = config_from_values({
        "combat_bait_layout_mix": ["1v1x2", "1v3x1"],
        "combat_bait_opponent": "passive_bait",
        "combat_bait_reward_scale": 2.0,
        "observation_version": 3,
        "reward_danger_approach": 0.25,
        "reward_bait_disengage": 0.15,
        "reward_trap_death": 0.8,
    })

    assert cfg.combat_bait_layout_mix == ["1v1x2", "1v3x1"]
    assert cfg.combat_bait_opponent == "passive_bait"
    assert cfg.combat_bait_reward_scale == 2.0
    assert cfg.observation_version == 3
    rewards = reward_dict(cfg)
    assert rewards["dangerApproach"] == 0.25
    assert rewards["baitDisengage"] == 0.15
    assert rewards["trapDeath"] == 0.8

    toml = dump_toml(cfg)
    assert 'bait_layout_mix = ["1v1x2", "1v3x1"]' in toml
    assert 'bait_opponent = "passive_bait"' in toml
    assert "bait_reward_scale = 2.0" in toml
    assert "danger_approach = 0.25" in toml


def test_dashboard_schema_exposes_observation_v3_and_bait_knobs():
    sections = config_schema()
    by_field = {
        knob["field"]: knob
        for section in sections
        for knob in section["knobs"]
    }

    assert by_field["observation_version"]["max"] == 3
    assert by_field["combat_bait_layout_mix"]["type"] == "strlist"
    assert by_field["combat_bait_opponent"]["choices"] == [
        "passive_bait",
        "passive_bait_jitter",
        "passive_bait_duelist",
    ]
    assert by_field["reward_trap_death"]["type"] == "float"
