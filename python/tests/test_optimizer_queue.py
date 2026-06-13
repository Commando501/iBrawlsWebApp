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
