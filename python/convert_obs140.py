"""One-off: adapt a 138-obs checkpoint to the current 140-obs observation space.

The observation grew by 2 dims (DOMAIN_RANDOMIZABLE_KEYS 28 -> 30), appended at the
*tail* (the `mechanics` block is the last field in src/sim/env/observation.ts). So the
shared 138 features keep their indices and we only need to widen the first layer of the
shared MLP from in=138 to in=140, zero-filling the 2 new input columns. Those features
encode deviation-from-nominal (0 at nominal), so zero weights => identical behavior to the
old brain at startup; PPO learns the new columns from there.

Optimizer momentum is dropped (a fresh PPO's empty Adam state is re-warmed in a few
hundred steps) — that's why we rebuild a model rather than patching the zip in place.

Usage:
    python convert_obs140.py runs/combat2_v3/final_model.zip runs/combat2_v3/final_model_140obs.zip
"""
from __future__ import annotations

import sys

import gymnasium as gym
import numpy as np
import torch
from gymnasium import spaces
from stable_baselines3 import PPO

from ibrawls_rl.policies import sb3_policy_kwargs

NEW_OBS_DIM = 140
WIDTH = 512
DEPTH = 3
# Shared-MLP first-layer weights that take the raw observation as input.
FIRST_LAYER_KEYS = ("mlp_extractor.policy_net.0.weight", "mlp_extractor.value_net.0.weight")


class _DummyEnv(gym.Env):
    """Minimal env so PPO can build a policy at the new obs width; never stepped for real."""

    def __init__(self, obs_dim: int, action_space: spaces.Space):
        self.observation_space = spaces.Box(-np.inf, np.inf, (obs_dim,), np.float32)
        self.action_space = action_space

    def reset(self, *, seed=None, options=None):
        return np.zeros(self.observation_space.shape, np.float32), {}

    def step(self, action):
        return np.zeros(self.observation_space.shape, np.float32), 0.0, True, False, {}


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: python convert_obs140.py <old_model.zip> <new_model.zip>")
    src, dst = sys.argv[1], sys.argv[2]

    old = PPO.load(src, device="cpu")
    old_obs = int(np.prod(old.observation_space.shape))
    print(f"[convert] loaded {src}: obs_dim={old_obs}, action_space={old.action_space}")
    if old_obs == NEW_OBS_DIM:
        raise SystemExit(f"already {NEW_OBS_DIM}-dim — nothing to do")

    new = PPO(
        "MlpPolicy",
        _DummyEnv(NEW_OBS_DIM, old.action_space),
        policy_kwargs=sb3_policy_kwargs(width=WIDTH, depth=DEPTH),
        device="cpu",
    )

    old_sd = old.policy.state_dict()
    new_sd = new.policy.state_dict()
    out_sd = {}
    for k, new_param in new_sd.items():
        old_param = old_sd[k]
        if k in FIRST_LAYER_KEYS:
            if old_param.shape[1] + (NEW_OBS_DIM - old_obs) != new_param.shape[1]:
                raise SystemExit(f"unexpected first-layer shape for {k}: {tuple(old_param.shape)}")
            padded = torch.zeros_like(new_param)
            padded[:, :old_param.shape[1]] = old_param  # new tail columns stay zero
            out_sd[k] = padded
            print(f"[convert] padded {k}: {tuple(old_param.shape)} -> {tuple(padded.shape)}")
        else:
            if old_param.shape != new_param.shape:
                raise SystemExit(f"shape mismatch on {k}: {tuple(old_param.shape)} vs {tuple(new_param.shape)}")
            out_sd[k] = old_param

    new.policy.load_state_dict(out_sd, strict=True)
    new.save(dst)
    print(f"[convert] wrote {dst} (obs_dim={NEW_OBS_DIM}, depth={DEPTH}, optimizer reset)")


if __name__ == "__main__":
    main()
