"""Multi-worker vec-env: parallel Node sims concatenated into one batch.

Spawns real Node subprocesses, so skipped if the npx/tsx toolchain or python deps are absent.
"""
from __future__ import annotations

import shutil

import numpy as np
import pytest


@pytest.mark.skipif(shutil.which("npx") is None, reason="npx/tsx toolchain not available")
def test_combat_multiworker_batches_and_steps():
    try:
        from ibrawls_rl.envs.grifball_vec_env import GrifballVecEnv
    except Exception as e:  # pragma: no cover
        pytest.skip(f"python deps unavailable: {e}")

    env = GrifballVecEnv(mode="combat", combat_world_sizes=[2, 2, 4, 4], num_workers=2)
    try:
        assert len(env.views) == 2, "should split worlds across 2 workers"
        assert env.num_envs == 2 + 2 + 4 + 4, "flat batch = sum of all world sizes"
        obs = env.reset()
        assert obs.shape == (env.num_envs, env.obs_dim)
        assert np.isfinite(obs).all()

        a = np.stack([env.action_space.sample() for _ in range(env.num_envs)]).astype(np.int32)
        obs, reward, done, infos = env.step(a)
        assert obs.shape == (env.num_envs, env.obs_dim)
        assert reward.shape == (env.num_envs,)
        assert done.shape == (env.num_envs,)
        assert len(infos) == env.num_envs
    finally:
        env.close()


@pytest.mark.skipif(shutil.which("npx") is None, reason="npx/tsx toolchain not available")
def test_grifball_multiworker_learner_batch():
    try:
        from ibrawls_rl.envs.grifball_vec_env import GrifballVecEnv
    except Exception as e:  # pragma: no cover
        pytest.skip(f"python deps unavailable: {e}")

    # 2 workers x (8//2=4 matches) x 4 blue learners = 32 learner sub-envs.
    env = GrifballVecEnv(mode="grifball", opponent="heuristic", num_envs=8, num_workers=2)
    try:
        assert len(env.views) == 2
        assert env.num_envs == 32
        obs = env.reset()
        assert obs.shape == (32, env.obs_dim)
        a = np.stack([env.action_space.sample() for _ in range(env.num_envs)]).astype(np.int32)
        obs, reward, done, infos = env.step(a)
        assert obs.shape == (32, env.obs_dim) and reward.shape == (32,)
    finally:
        env.close()
