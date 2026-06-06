"""Build Gymnasium spaces from the sim's handshake header so dims are never hard-coded
on the Python side — the TS ``ENV_SPEC`` is the single source of truth."""
from __future__ import annotations

import numpy as np
from gymnasium import spaces


def observation_space(header: dict) -> spaces.Box:
    """Per-agent observation: a flat, finite Box of width ``obsDim``."""
    obs_dim = int(header["obsDim"])
    return spaces.Box(low=-np.inf, high=np.inf, shape=(obs_dim,), dtype=np.float32)


def action_space(header: dict) -> spaces.MultiDiscrete:
    """Per-agent factorized discrete action (MultiDiscrete over ``actionNvec``)."""
    nvec = np.asarray(header["actionNvec"], dtype=np.int64)
    return spaces.MultiDiscrete(nvec)
