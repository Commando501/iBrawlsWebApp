"""League self-play plumbing: frozen opponents hidden from SB3, concat batching.

Spawns real Node sims, so skipped without the npx/tsx toolchain.
"""
from __future__ import annotations

import shutil

import numpy as np
import pytest

needs_node = pytest.mark.skipif(shutil.which("npx") is None,
                                reason="npx/tsx toolchain not available")


def _tiny_ppo(env, tmp_path, name="snap.zip"):
    """A throwaway PPO with the env's spaces (untrained — we only need predict())."""
    from stable_baselines3 import PPO
    model = PPO("MlpPolicy", env, n_steps=8, batch_size=8,
                policy_kwargs={"net_arch": [16]}, device="cpu")
    path = str(tmp_path / name)
    model.save(path)
    return path


@needs_node
def test_league_env_hides_opponents_and_records_results(tmp_path):
    from ibrawls_rl.envs.grifball_vec_env import GrifballVecEnv
    from ibrawls_rl.league import LeagueOpponentVecEnv, SnapshotPool

    base = GrifballVecEnv(
        mode="combat", combat_world_sizes=[2, 2], combat_randomize_layout=False,
        combat_kill_range=(1, 1), num_workers=1, decision_interval=4,
        max_ticks=60 * 30,  # 30 sim-seconds -> guaranteed truncation if no kill
    )
    pool = SnapshotPool(latest_bias=0.7, seed=3)
    env = LeagueOpponentVecEnv(base, pool, seed=3)
    try:
        assert env.num_envs == 2, "two 1v1 worlds -> two learner slots"
        obs = env.reset()
        assert obs.shape == (2, base.obs_dim)

        # Empty pool -> random opponents; stepping still works.
        a = np.stack([env.action_space.sample() for _ in range(env.num_envs)]).astype(np.int32)
        obs, reward, done, infos = env.step(a)
        assert obs.shape == (2, base.obs_dim)
        assert reward.shape == (2,) and done.shape == (2,) and len(infos) == 2

        # Add a real snapshot and run until episodes turn over (kill target 1 +
        # aggressive actions ends quickly; the 30s cap guarantees done either way).
        path = _tiny_ppo(env, tmp_path)
        assert pool.add(path)
        saw_done = False
        for _ in range(800):
            act = np.zeros((env.num_envs, env.act_dim), dtype=np.int32)
            act[:, 0] = 1  # forward
            act[:, 1] = 3  # aim nearest enemy
            act[:, 2] = 1  # attack
            obs, reward, done, infos = env.step(act)
            if done.any():
                saw_done = True
                break
        assert saw_done, "league worlds should finish (kill target 1 or 30s cap)"
        # After an episode the world resampled from the non-empty pool.
        assert any(a is not None for a in env.assignment)
    finally:
        env.close()


@needs_node
def test_concat_env_splices_main_and_league(tmp_path):
    from ibrawls_rl.envs.grifball_vec_env import GrifballVecEnv
    from ibrawls_rl.league import ConcatVecEnv, LeagueOpponentVecEnv, SnapshotPool

    main = GrifballVecEnv(mode="combat", combat_world_sizes=[2, 4], num_workers=1,
                          decision_interval=4)
    league_base = GrifballVecEnv(
        mode="combat", combat_world_sizes=[2, 2], combat_randomize_layout=False,
        combat_kill_range=(2, 2), num_workers=1, decision_interval=4, base_seed=99,
    )
    league = LeagueOpponentVecEnv(league_base, SnapshotPool(seed=1), seed=1)
    env = ConcatVecEnv([main, league])
    try:
        assert env.num_envs == 6 + 2  # main agents + league learner slots
        obs = env.reset()
        assert obs.shape == (8, main.obs_dim)
        a = np.stack([env.action_space.sample() for _ in range(env.num_envs)]).astype(np.int32)
        obs, reward, done, infos = env.step(a)
        assert obs.shape == (8, main.obs_dim) and reward.shape == (8,) and len(infos) == 8
        assert isinstance(env.last_reward_components, dict)
    finally:
        env.close()
