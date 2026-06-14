from __future__ import annotations

import numpy as np

from ibrawls_rl.eval import (
    BehaviorTracker,
    combat_anti_bait_specs,
    combat_eval_matrix_specs,
    scenario_random_baseline,
    scenario_win_score,
    summarize_anti_bait_results,
    summarize_eval_matrix,
    summarize_strict_promotion,
)


def test_behavior_tracker_reports_repetition_and_enemy_aim_usage():
    tracker = BehaviorTracker()
    action = np.array([
        [1, 3, 1, 0, 1, 0],
        [1, 3, 1, 0, 1, 0],
    ], dtype=np.int32)

    tracker.update(action)
    tracker.update(action)

    summary = tracker.summary()
    assert summary["aim_enemy_rate"] == 1.0
    assert summary["attack_rate"] == 1.0
    assert summary["dash_rate"] == 1.0
    assert summary["action_repeat_rate"] == 1.0


def test_combat_eval_matrix_specs_cover_duels_small_groups_and_large_groups():
    specs = combat_eval_matrix_specs()
    assert [s["name"] for s in specs] == ["duel_1v1", "lone_1v2", "lone_1v3", "lone_1v7", "ffa4", "ffa8"]
    assert [s["team_sizes"] for s in specs] == [[1, 1], [1, 2], [1, 3], [1, 7], [1, 1, 1, 1], [1] * 8]
    assert [s["kill_target"] for s in specs] == [5, 8, 10, 15, 10, 15]


def test_combat_anti_bait_specs_cover_static_and_jitter_baiters():
    specs = combat_anti_bait_specs()
    assert [s["name"] for s in specs] == [
        "bait_duel_1v1",
        "bait_jitter_1v1",
        "bait_lone_1v2",
        "bait_lone_1v3",
    ]
    assert specs[0]["opponent_profile"] == "passive_bait"
    assert specs[1]["opponent_profile"] == "passive_bait_jitter"
    assert [s["team_sizes"] for s in specs] == [[1, 1], [1, 1], [1, 2], [1, 3]]


def test_lone_wolf_scenario_score_uses_random_baseline():
    assert scenario_random_baseline([1, 1]) == 0.5
    assert scenario_random_baseline([1, 7]) == 0.125
    assert scenario_win_score(0.5, [1, 1]) == 0.0
    assert scenario_win_score(1.0, [1, 7]) == 1.0
    assert round(scenario_win_score(0.5625, [1, 7]), 4) == 0.5


def test_summarize_eval_matrix_penalizes_draws_and_spammy_behavior():
    out = summarize_eval_matrix([
        {
            "name": "duel_k5",
            "win_rate": 0.8,
            "draw_rate": 0.1,
            "behavior": {"attack_rate": 0.7, "dash_rate": 0.2, "jump_rate": 0.1, "action_repeat_rate": 0.2},
        },
        {
            "name": "skirmish4_k10",
            "win_rate": 0.5,
            "draw_rate": 0.4,
            "behavior": {"attack_rate": 1.0, "dash_rate": 1.0, "jump_rate": 0.8, "action_repeat_rate": 0.9},
        },
    ])

    assert out["scenarios"] == 2
    assert out["mean_win_rate"] == 0.65
    assert out["mean_draw_rate"] == 0.25
    assert out["human_likeness_penalty"] > 0.3
    assert out["lone_wolf_score"] < out["mean_win_rate"]


def test_summarize_anti_bait_results_penalizes_trap_deaths():
    summary = summarize_anti_bait_results([
        {"win_score": 0.9, "trap_death_rate": 0.1},
        {"win_score": 0.7, "trap_death_rate": 0.3},
    ])

    assert summary["anti_bait_scenarios"] == 2
    assert summary["mean_anti_bait_win_score"] == 0.8
    assert summary["trap_death_rate"] == 0.2
    assert summary["anti_bait_score"] == 0.7


def test_strict_promotion_requires_matrix_snapshot_and_anti_bait_gates():
    ready = summarize_strict_promotion({
        "lone_wolf_score": 0.82,
        "anti_bait_score": 0.74,
        "trap_death_rate": 0.18,
    }, 0.56)
    assert ready["strict_promotion_ready"] is True
    assert ready["strict_promotion_requires_frozen"] is False
    assert ready["frozen_snapshot_score"] == 0.56

    no_snapshot = summarize_strict_promotion({
        "lone_wolf_score": 0.95,
        "anti_bait_score": 0.95,
        "trap_death_rate": 0.0,
    }, None)
    assert no_snapshot["strict_promotion_ready"] is False
    assert no_snapshot["strict_promotion_requires_frozen"] is True

    trap_fail = summarize_strict_promotion({
        "lone_wolf_score": 0.95,
        "anti_bait_score": 0.95,
        "trap_death_rate": 0.21,
    }, 0.9)
    assert trap_fail["strict_promotion_ready"] is False
