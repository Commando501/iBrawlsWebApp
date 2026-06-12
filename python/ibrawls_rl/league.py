"""Training-side frozen-snapshot league (PFSP self-play).

Pure latest-self-play converges to brittle, exploitable, same-y styles — the policy
only ever fights its current self. The league fixes that: a slice of the training
batch is dedicated 1v1 worlds where the learner fights FROZEN past versions of
itself (plus any seed models), sampled latest-biased with PFSP weighting (prefer
opponents the learner loses to). The learner's rows from those worlds are ordinary
PPO experience; the frozen side is driven here in Python and hidden from SB3.

Pieces:
- :class:`SnapshotPool` — paths -> lazily-loaded PPO models + PFSP win bookkeeping
  (reuses :class:`ibrawls_rl.selfplay.OpponentSampler`).
- :class:`LeagueOpponentVecEnv` — wraps a dedicated 1v1 combat env; exposes the even
  (learner) slots to SB3, drives the odd slots with sampled snapshots, re-samples an
  opponent per world each episode and records decisive results for PFSP.
- :class:`ConcatVecEnv` — splices the main self-play env and the league env into one
  VecEnv batch for SB3.
- :class:`LeagueSnapshotCallback` — auto-freezes the learner into the pool every N
  steps and logs ``league/*`` metrics.
"""
from __future__ import annotations

import os
import sys
from collections import deque
from typing import Any, Sequence

import numpy as np
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.vec_env.base_vec_env import VecEnv, VecEnvStepReturn

from .envs.grifball_vec_env import GrifballVecEnv
from .selfplay import OpponentSampler, PolicySnapshot

WIN_THRESHOLD = 0.5  # same decisive-terminal-reward convention as eval.py

# History depth kept for frozen opponents; supports snapshots trained with up to
# this much frame stacking (each snapshot uses only as many frames as it needs).
MAX_OPPONENT_STACK = 8


def _log(msg: str) -> None:
    print(f"[league] {msg}", file=sys.stderr, flush=True)


class SnapshotPool:
    """Frozen opponents: lazy PPO loading + PFSP sampling + result bookkeeping."""

    def __init__(self, latest_bias: float = 0.7, device: str = "cpu", seed: int = 0):
        self.device = device
        self.sampler = OpponentSampler(
            latest_prob=float(latest_bias),
            rng=np.random.default_rng(seed),
        )
        self._models: dict[str, Any] = {}
        self._bad: set[str] = set()
        self.recent_results: deque[bool] = deque(maxlen=200)  # learner wins, rolling

    def __len__(self) -> int:
        return len(self.sampler.snapshots)

    def add(self, path: str) -> bool:
        """Register a snapshot path (deduped). Loading/validation happens lazily."""
        path = os.path.normpath(path)
        if any(s.path == path for s in self.sampler.snapshots) or path in self._bad:
            return False
        if not os.path.exists(path):
            _log(f"snapshot missing, skipped: {path}")
            self._bad.add(path)
            return False
        self.sampler.add(PolicySnapshot(name=os.path.basename(path), path=path))
        return True

    def _load(self, snap: PolicySnapshot, base_obs_dim: int, action_nvec: Sequence[int]):
        if snap.path in self._models:
            return self._models[snap.path]
        if snap.path in self._bad:
            return None
        try:
            from stable_baselines3 import PPO
            model = PPO.load(snap.path, device=self.device)
            obs_dim = int(np.prod(model.observation_space.shape))
            nvec = getattr(model.action_space, "nvec", None)
            if obs_dim % base_obs_dim != 0:
                raise ValueError(f"obs dim {obs_dim} not a stack of base {base_obs_dim}")
            if nvec is None or len(nvec) != len(action_nvec):
                raise ValueError("action factor count differs from the live env")
            self._models[snap.path] = model
            _log(f"loaded opponent {snap.name} (stack {obs_dim // base_obs_dim})")
            return model
        except Exception as e:
            _log(f"snapshot unusable, dropped: {snap.path} ({e})")
            self._bad.add(snap.path)
            self.sampler.snapshots = [s for s in self.sampler.snapshots if s.path != snap.path]
            return None

    def sample(self, base_obs_dim: int, action_nvec: Sequence[int]):
        """(snapshot, model) or None when the pool is empty/unusable."""
        for _ in range(4):  # a few retries in case a sampled snapshot fails to load
            snap = self.sampler.sample()
            if snap is None:
                return None
            model = self._load(snap, base_obs_dim, action_nvec)
            if model is not None:
                return snap, model
        return None

    def record(self, snap: PolicySnapshot, learner_won: bool) -> None:
        self.sampler.record_result(snap, learner_won)
        self.recent_results.append(learner_won)

    def stats(self) -> dict:
        games = sum(s.games for s in self.sampler.snapshots)
        wins = sum(s.wins for s in self.sampler.snapshots)
        recent = list(self.recent_results)
        return {
            "pool_size": len(self.sampler.snapshots),
            "games": games,
            "win_rate": (wins / games) if games else 0.0,
            "recent_win_rate": (sum(recent) / len(recent)) if recent else 0.0,
        }


class LeagueOpponentVecEnv(VecEnv):
    """Expose the even (learner) slots of a 1v1 combat env; drive odd slots with snapshots.

    The base env must be built with ``combat_world_sizes=[2]*L`` and
    ``combat_randomize_layout=False`` so slot ``2w`` is always the learner and slot
    ``2w+1`` its frozen opponent in world ``w``. Opponents act stochastically (more
    varied, more human) on their own frame-stack of the base observations; when the
    pool is empty they fall back to random actions.
    """

    def __init__(self, base: GrifballVecEnv, pool: SnapshotPool, seed: int = 0):
        if base.num_envs % 2 != 0:
            raise ValueError("league base env must be 1v1 worlds (even slot count)")
        self.base = base
        self.pool = pool
        self.n_worlds = base.num_envs // 2
        self.learner_idx = np.arange(0, base.num_envs, 2)
        self.opponent_idx = np.arange(1, base.num_envs, 2)
        self.obs_dim = base.obs_dim
        self.act_dim = base.act_dim
        self.action_nvec = list(base.action_space.nvec)  # type: ignore[attr-defined]
        self.rng = np.random.default_rng(seed)
        # Per-world opponent assignment: (PolicySnapshot, model) or None (random).
        self.assignment: list[tuple[PolicySnapshot, Any] | None] = [None] * self.n_worlds
        # Rolling obs history for opponents, oldest-first (VecFrameStack convention).
        self._history = np.zeros((self.n_worlds, MAX_OPPONENT_STACK * self.obs_dim),
                                 dtype=np.float32)
        self._actions: np.ndarray | None = None
        super().__init__(self.n_worlds, base.observation_space, base.action_space)

    # -- opponent plumbing ---------------------------------------------------
    def _push_history(self, opp_obs: np.ndarray, fresh: np.ndarray | None = None) -> None:
        """Roll the per-world history left one frame; `fresh` worlds restart cleanly."""
        d = self.obs_dim
        self._history[:, :-d] = self._history[:, d:]
        self._history[:, -d:] = opp_obs
        if fresh is not None and fresh.any():
            self._history[fresh, :-d] = 0.0  # new episode: no cross-episode memory

    def _resample(self, world: int) -> None:
        self.assignment[world] = self.pool.sample(self.obs_dim, self.action_nvec)

    def _opponent_actions(self) -> np.ndarray:
        acts = np.zeros((self.n_worlds, self.act_dim), dtype=np.int32)
        # Group worlds by model object so each frozen net predicts one batch.
        groups: dict[int, tuple[Any, list[int]]] = {}
        for w in range(self.n_worlds):
            a = self.assignment[w]
            if a is None:
                self._resample(w)
                a = self.assignment[w]
            if a is None:  # pool (still) empty -> random opponent
                acts[w] = np.array(self.action_space.sample(), dtype=np.int32)
                continue
            _snap, model = a
            groups.setdefault(id(model), (model, []))[1].append(w)
        for model, worlds in groups.values():
            need = int(np.prod(model.observation_space.shape)) // self.obs_dim
            obs = self._history[worlds][:, -need * self.obs_dim:]
            pred, _ = model.predict(obs, deterministic=False)
            acts[worlds] = np.asarray(pred, dtype=np.int32)
        return acts

    # -- VecEnv API ------------------------------------------------------------
    def reset(self) -> np.ndarray:
        obs = self.base.reset()
        self._history[:] = 0.0
        self._history[:, -self.obs_dim:] = obs[self.opponent_idx]
        for w in range(self.n_worlds):
            self._resample(w)
        return obs[self.learner_idx]

    def step_async(self, actions: np.ndarray) -> None:
        self._actions = np.asarray(actions, dtype=np.int32)

    def step_wait(self) -> VecEnvStepReturn:
        assert self._actions is not None
        full = np.zeros((self.base.num_envs, self.act_dim), dtype=np.int32)
        full[self.learner_idx] = self._actions
        full[self.opponent_idx] = self._opponent_actions()

        obs, reward, done, infos = self.base.step(full)

        learner_done = done[self.learner_idx]
        for w in np.nonzero(learner_done)[0]:
            r = float(reward[self.learner_idx[w]])
            a = self.assignment[w]
            if a is not None and abs(r) > WIN_THRESHOLD:  # decisive results only
                self.pool.record(a[0], learner_won=r > WIN_THRESHOLD)
            self._resample(w)
        self._push_history(obs[self.opponent_idx], fresh=learner_done.astype(bool))

        return (
            obs[self.learner_idx],
            reward[self.learner_idx],
            done[self.learner_idx],
            [infos[i] for i in self.learner_idx],
        )

    def close(self) -> None:
        self.base.close()

    # --- Required abstract stubs ---
    def env_is_wrapped(self, wrapper_class, indices=None) -> list[bool]:
        return [False] * self.num_envs

    def get_attr(self, attr_name: str, indices=None) -> list[Any]:
        return [getattr(self, attr_name, None)] * _n_indices(indices, self.num_envs)

    def set_attr(self, attr_name: str, value: Any, indices=None) -> None:
        setattr(self, attr_name, value)

    def env_method(self, method_name: str, *args, indices=None, **kwargs) -> list[Any]:
        return [None] * _n_indices(indices, self.num_envs)

    def get_images(self) -> Sequence[np.ndarray]:
        return []

    @property
    def last_reward_components(self) -> dict[str, float]:
        return getattr(self.base, "last_reward_components", {})


class ConcatVecEnv(VecEnv):
    """Splice several VecEnvs (same obs/action spaces) into one flat batch."""

    def __init__(self, envs: Sequence[VecEnv]):
        if not envs:
            raise ValueError("need at least one env")
        self.envs = list(envs)
        first = self.envs[0]
        for e in self.envs[1:]:
            if (e.observation_space.shape != first.observation_space.shape):
                raise ValueError("observation spaces differ between concatenated envs")
        self._offsets: list[int] = []
        total = 0
        for e in self.envs:
            self._offsets.append(total)
            total += e.num_envs
        super().__init__(total, first.observation_space, first.action_space)

    def reset(self) -> np.ndarray:
        return np.concatenate([e.reset() for e in self.envs], axis=0)

    def step_async(self, actions: np.ndarray) -> None:
        for e, off in zip(self.envs, self._offsets):
            e.step_async(actions[off:off + e.num_envs])

    def step_wait(self) -> VecEnvStepReturn:
        obs_l, rew_l, done_l, infos = [], [], [], []
        for e in self.envs:
            o, r, d, i = e.step_wait()
            obs_l.append(o)
            rew_l.append(r)
            done_l.append(d)
            infos.extend(i)
        return (np.concatenate(obs_l, axis=0), np.concatenate(rew_l, axis=0),
                np.concatenate(done_l, axis=0), infos)

    def close(self) -> None:
        for e in self.envs:
            e.close()

    @property
    def last_reward_components(self) -> dict[str, float]:
        merged: dict[str, float] = {}
        for e in self.envs:
            comp = getattr(e, "last_reward_components", None)
            if isinstance(comp, dict):
                for k, v in comp.items():
                    merged[k] = merged.get(k, 0.0) + float(v)
        return merged

    # --- Required abstract stubs ---
    def env_is_wrapped(self, wrapper_class, indices=None) -> list[bool]:
        return [False] * self.num_envs

    def get_attr(self, attr_name: str, indices=None) -> list[Any]:
        return [getattr(self, attr_name, None)] * _n_indices(indices, self.num_envs)

    def set_attr(self, attr_name: str, value: Any, indices=None) -> None:
        setattr(self, attr_name, value)

    def env_method(self, method_name: str, *args, indices=None, **kwargs) -> list[Any]:
        return [None] * _n_indices(indices, self.num_envs)

    def get_images(self) -> Sequence[np.ndarray]:
        return []


def _n_indices(indices, num_envs: int) -> int:
    if indices is None:
        return num_envs
    if isinstance(indices, int):
        return 1
    return len(list(indices))


class LeagueSnapshotCallback(BaseCallback):
    """Freeze the learner into the league pool every N steps; log league metrics."""

    def __init__(self, pool: SnapshotPool, every: int, directory: str, verbose: int = 0):
        super().__init__(verbose)
        self.pool = pool
        self.every = max(1, int(every))
        self.directory = directory
        self._last = 0

    def _snapshot(self) -> None:
        os.makedirs(self.directory, exist_ok=True)
        path = os.path.join(self.directory, f"snapshot_{self.num_timesteps:09d}.zip")
        self.model.save(path)
        self.pool.add(path)
        _log(f"froze learner -> {os.path.basename(path)} (pool {len(self.pool)})")

    def _on_training_start(self) -> None:
        # Always seed the pool with the starting brain so league worlds have a
        # same-architecture opponent from step 0 (even on a fresh run).
        self._snapshot()

    def _on_step(self) -> bool:
        if self.num_timesteps - self._last >= self.every:
            self._last = self.num_timesteps
            self._snapshot()
        st = self.pool.stats()
        self.logger.record("league/pool_size", st["pool_size"])
        self.logger.record("league/learner_win_rate", st["recent_win_rate"])
        return True
