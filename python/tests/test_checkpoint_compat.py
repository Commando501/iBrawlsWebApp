from __future__ import annotations

from collections import OrderedDict

import gymnasium as gym
import numpy as np
import pytest
import torch
from gymnasium import spaces
from stable_baselines3 import PPO

from ibrawls_rl.checkpoint_compat import migrate_policy_state_for_action_space, warm_start_sb3_model
from ibrawls_rl.policies import sb3_policy_kwargs


class TinyActionEnv(gym.Env):
    metadata = {}

    def __init__(self, nvec: list[int]):
        self.observation_space = spaces.Box(low=-1.0, high=1.0, shape=(5,), dtype=np.float32)
        self.action_space = spaces.MultiDiscrete(nvec)

    def reset(self, *, seed=None, options=None):  # noqa: ANN001
        super().reset(seed=seed)
        return np.zeros(5, dtype=np.float32), {}

    def step(self, action):  # noqa: ANN001
        return np.zeros(5, dtype=np.float32), 0.0, False, False, {}


def _policy_state(rows: int, width: int = 2):
    return OrderedDict({
        "mlp_extractor.policy_net.0.weight": torch.ones((width, width)),
        "action_net.weight": torch.arange(rows * width, dtype=torch.float32).reshape(rows, width),
        "action_net.bias": torch.arange(rows, dtype=torch.float32),
    })


def test_migrates_one_inserted_multidiscrete_action_logit_without_shifting_later_factors():
    old_state = _policy_state(21)
    target_state = _policy_state(22)
    target_state["action_net.weight"].fill_(-7.0)
    target_state["action_net.bias"].fill_(-3.0)

    migrated, info = migrate_policy_state_for_action_space(
        old_state,
        target_state,
        old_nvec=[9, 3, 3, 2, 2, 2],
        new_nvec=[9, 4, 3, 2, 2, 2],
    )

    assert info is not None
    assert info.factor_index == 1
    assert info.insert_index == 12
    assert migrated["action_net.weight"].shape == (22, 2)
    assert migrated["action_net.bias"].shape == (22,)

    torch.testing.assert_close(migrated["action_net.weight"][:12], old_state["action_net.weight"][:12])
    torch.testing.assert_close(migrated["action_net.bias"][:12], old_state["action_net.bias"][:12])
    torch.testing.assert_close(migrated["action_net.weight"][12], target_state["action_net.weight"][12])
    torch.testing.assert_close(migrated["action_net.bias"][12], target_state["action_net.bias"][12])
    torch.testing.assert_close(migrated["action_net.weight"][13:], old_state["action_net.weight"][12:])
    torch.testing.assert_close(migrated["action_net.bias"][13:], old_state["action_net.bias"][12:])


def test_migrates_current_action_head_to_pickup_factor():
    old_state = _policy_state(22)
    target_state = _policy_state(23)
    target_state["action_net.weight"].fill_(-7.0)
    target_state["action_net.bias"].fill_(-3.0)

    migrated, info = migrate_policy_state_for_action_space(
        old_state,
        target_state,
        old_nvec=[9, 4, 3, 2, 2, 2],
        new_nvec=[9, 4, 4, 2, 2, 2],
    )

    assert info is not None
    assert [(ins.factor_index, ins.insert_index) for ins in info.insertions] == [(2, 16)]
    assert migrated["action_net.weight"].shape == (23, 2)
    assert migrated["action_net.bias"].shape == (23,)

    torch.testing.assert_close(migrated["action_net.weight"][:16], old_state["action_net.weight"][:16])
    torch.testing.assert_close(migrated["action_net.bias"][:16], old_state["action_net.bias"][:16])
    torch.testing.assert_close(migrated["action_net.weight"][16], target_state["action_net.weight"][16])
    torch.testing.assert_close(migrated["action_net.bias"][16], target_state["action_net.bias"][16])
    torch.testing.assert_close(migrated["action_net.weight"][17:], old_state["action_net.weight"][16:])
    torch.testing.assert_close(migrated["action_net.bias"][17:], old_state["action_net.bias"][16:])


def test_migrates_older_action_head_with_aim_and_pickup_insertions():
    old_state = _policy_state(21)
    target_state = _policy_state(23)
    target_state["action_net.weight"].fill_(-7.0)
    target_state["action_net.bias"].fill_(-3.0)

    migrated, info = migrate_policy_state_for_action_space(
        old_state,
        target_state,
        old_nvec=[9, 3, 3, 2, 2, 2],
        new_nvec=[9, 4, 4, 2, 2, 2],
    )

    assert info is not None
    assert [(ins.factor_index, ins.insert_index) for ins in info.insertions] == [(1, 12), (2, 16)]
    assert migrated["action_net.weight"].shape == (23, 2)
    assert migrated["action_net.bias"].shape == (23,)

    torch.testing.assert_close(migrated["action_net.weight"][:12], old_state["action_net.weight"][:12])
    torch.testing.assert_close(migrated["action_net.bias"][:12], old_state["action_net.bias"][:12])
    torch.testing.assert_close(migrated["action_net.weight"][12], target_state["action_net.weight"][12])
    torch.testing.assert_close(migrated["action_net.bias"][12], target_state["action_net.bias"][12])
    torch.testing.assert_close(migrated["action_net.weight"][13:16], old_state["action_net.weight"][12:15])
    torch.testing.assert_close(migrated["action_net.bias"][13:16], old_state["action_net.bias"][12:15])
    torch.testing.assert_close(migrated["action_net.weight"][16], target_state["action_net.weight"][16])
    torch.testing.assert_close(migrated["action_net.bias"][16], target_state["action_net.bias"][16])
    torch.testing.assert_close(migrated["action_net.weight"][17:], old_state["action_net.weight"][15:])
    torch.testing.assert_close(migrated["action_net.bias"][17:], old_state["action_net.bias"][15:])


def test_leaves_matching_action_heads_unchanged():
    old_state = _policy_state(23)
    target_state = _policy_state(23)

    migrated, info = migrate_policy_state_for_action_space(
        old_state,
        target_state,
        old_nvec=[9, 4, 4, 2, 2, 2],
        new_nvec=[9, 4, 4, 2, 2, 2],
    )

    assert info is None
    torch.testing.assert_close(migrated["action_net.weight"], old_state["action_net.weight"])
    torch.testing.assert_close(migrated["action_net.bias"], old_state["action_net.bias"])


def test_rejects_unsupported_action_space_changes():
    old_state = _policy_state(21)
    target_state = _policy_state(24)

    with pytest.raises(ValueError, match="unsupported action-factor expansion"):
        migrate_policy_state_for_action_space(
            old_state,
            target_state,
            old_nvec=[9, 3, 3, 2, 2, 2],
            new_nvec=[9, 5, 4, 2, 2, 2],
        )


def test_warm_start_sb3_model_migrates_saved_ppo_action_head(tmp_path):
    kwargs = dict(
        n_steps=2,
        batch_size=2,
        n_epochs=1,
        policy_kwargs=sb3_policy_kwargs(width=8, depth=1),
        device="cpu",
        verbose=0,
    )
    old_model = PPO("MlpPolicy", TinyActionEnv([9, 3, 3, 2, 2, 2]), **kwargs)
    old_path = tmp_path / "old_policy"
    old_model.save(old_path)

    new_model = PPO("MlpPolicy", TinyActionEnv([9, 4, 4, 2, 2, 2]), **kwargs)
    result = warm_start_sb3_model(new_model, str(old_path), device="cpu")

    assert result.migration is not None
    assert result.migration.insert_index == 12
    assert [(ins.factor_index, ins.insert_index) for ins in result.migration.insertions] == [(1, 12), (2, 16)]
    action, _ = new_model.predict(np.zeros(5, dtype=np.float32), deterministic=True)
    assert action.shape == (6,)
