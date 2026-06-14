from __future__ import annotations

from ibrawls_rl.dashboard.trainqueue import queue_rank_score


def test_optimizer_queue_ranks_full_matrix_score_before_training_reward():
    scored = {
        "lone_wolf_score": 0.82,
        "promotion_score": 0.82,
        "ep_rew_mean": 2.5,
    }
    reward_only = {
        "ep_rew_mean": 99.0,
    }

    assert queue_rank_score(scored) == 0.82
    assert queue_rank_score(scored) > queue_rank_score(reward_only)


def test_optimizer_queue_uses_strict_anti_bait_fields_when_present():
    broad_but_exploitable = {
        "lone_wolf_score": 0.9,
        "promotion_score": 0.9,
        "anti_bait_score": 0.55,
        "trap_death_rate": 0.1,
    }
    lower_matrix_but_safer = {
        "lone_wolf_score": 0.82,
        "promotion_score": 0.82,
        "anti_bait_score": 0.78,
        "trap_death_rate": 0.05,
    }

    assert queue_rank_score(broad_but_exploitable) == 0.55
    assert queue_rank_score(lower_matrix_but_safer) > queue_rank_score(broad_but_exploitable)


def test_optimizer_queue_penalizes_weak_frozen_snapshot_score_when_present():
    broad_and_safe_but_snapshot_weak = {
        "lone_wolf_score": 0.9,
        "frozen_snapshot_score": 0.45,
        "anti_bait_score": 0.8,
        "trap_death_rate": 0.05,
    }
    promotion_ready_candidate = {
        "lone_wolf_score": 0.82,
        "frozen_snapshot_score": 0.62,
        "anti_bait_score": 0.74,
        "trap_death_rate": 0.1,
    }

    assert queue_rank_score(broad_and_safe_but_snapshot_weak) == 0.45
    assert queue_rank_score(promotion_ready_candidate) > queue_rank_score(broad_and_safe_but_snapshot_weak)
