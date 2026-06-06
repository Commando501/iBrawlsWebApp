"""Gymnasium/SB3-compatible vectorized client for the Node Grifball sim.

Spawns the TS vec-env server (``src/sim/server/main.ts``) as a subprocess, performs the
binary HELLO handshake, and exposes the **learner-controlled** agents as a flat batch of
``numEnvs × learnerAgentsPerEnv`` sub-envs (shared-policy self-play / vs-heuristic).

Opponent-team agents are driven inside the Node server by the built-in heuristic (when
``opponent='heuristic'``); Python sends zero actions for those slots and ignores their
obs/reward. With ``opponent='self'`` the shared policy controls every agent.
"""
from __future__ import annotations

import os
import subprocess
import sys
from typing import Any, Sequence

import numpy as np
from stable_baselines3.common.vec_env.base_vec_env import VecEnv, VecEnvStepReturn

from .. import protocol as proto
from ..spaces import action_space, observation_space

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def _default_cmd() -> list[str]:
    override = os.environ.get("IBRAWLS_SIM_CMD")
    if override:
        return override.split()
    return ["npx", "tsx", "src/sim/server/main.ts"]


class GrifballVecEnv(VecEnv):
    """One subprocess hosting ``numEnvs`` matches; exposes the learner agents as sub-envs."""

    def __init__(
        self,
        num_envs: int = 32,
        opponent: str = "heuristic",   # 'heuristic' | 'random' | 'self'
        learner_team: str = "blue",
        settings: dict | None = None,
        reward: dict | None = None,
        base_seed: int = 1,
        max_ticks: int | None = None,
        bootstrap_truncation: bool = False,
        mode: str = "grifball",        # 'grifball' | 'combat'
        combat_world_sizes: list[int] | None = None,
        combat_kill_range: tuple[int, int] | None = None,
        combat_randomize_layout: bool = True,
        randomize: dict | None = None,  # domain-randomization spec {enabled, pct}
        node_cmd: Sequence[str] | None = None,
    ) -> None:
        self.mode = mode
        # Combat is pure self-play (one shared policy plays every role in every world).
        if mode == "combat":
            opponent = "self"
        self.opponent = opponent
        self.learner_team = learner_team
        # Whether a maxTicks truncation bootstraps its value (SB3 TimeLimit.truncated).
        # Default OFF: for this win-oriented goal task, bootstrapping truncations rewards
        # "stall to timeout" and empirically learns slower; treating the cut-off as a
        # (failed) terminal pressures the policy to actually score. The signal is still
        # exposed in info["truncated"] either way.
        self.bootstrap_truncation = bootstrap_truncation

        cmd = list(node_cmd) if node_cmd else _default_cmd()
        self.proc = subprocess.Popen(
            cmd,
            cwd=REPO_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=sys.stderr,
            bufsize=0,
            shell=(os.name == "nt" and node_cmd is None),
        )
        assert self.proc.stdin and self.proc.stdout

        # Resolve which agent slots the opponent controls server-side.
        # We must know agentTeams to pick them, but that's in the handshake — so do a
        # two-pass handshake: send a probe config, read header, then we already know teams.
        probe_cfg: dict = {"numEnvs": num_envs, "baseSeed": base_seed, "mode": mode}
        if settings:
            probe_cfg["settings"] = settings
        if reward:
            probe_cfg["reward"] = reward
        if max_ticks is not None:
            probe_cfg["maxTicks"] = max_ticks
        if randomize and randomize.get("enabled"):
            probe_cfg["randomize"] = randomize
        if mode == "combat":
            if combat_world_sizes:
                probe_cfg["worldSizes"] = combat_world_sizes
            if combat_kill_range:
                probe_cfg["killTargetRange"] = list(combat_kill_range)
            probe_cfg["randomizeLayout"] = combat_randomize_layout
        # First handshake to learn agentTeams (no builtin yet).
        header = self._handshake(probe_cfg)
        self.agent_ids: list[str] = header["agentIds"]
        self.agent_teams: list[str] = header["agentTeams"]
        self.n_agents: int = int(header["numAgents"])
        self.n_world_envs: int = int(header["numEnvs"])
        self.obs_dim: int = int(header["obsDim"])
        self.act_dim: int = int(header["actionDim"])
        self.header = header

        # Learner / opponent agent indices within one env's roster.
        if opponent == "self":
            self.learner_idx = list(range(self.n_agents))
            self.builtin_idx: list[int] = []
        else:
            self.learner_idx = [i for i, t in enumerate(self.agent_teams) if t == learner_team]
            self.builtin_idx = [i for i, t in enumerate(self.agent_teams) if t != learner_team]

        # If we need a built-in opponent, re-handshake with builtinAgents set so the
        # server overrides those slots with the heuristic. (Restart the process cleanly.)
        if self.builtin_idx:
            self.close()
            self.proc = subprocess.Popen(
                cmd, cwd=REPO_ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=sys.stderr, bufsize=0, shell=(os.name == "nt" and node_cmd is None),
            )
            cfg = dict(probe_cfg)
            cfg["builtinAgents"] = self.builtin_idx
            cfg["builtinPolicy"] = "random" if opponent == "random" else "heuristic"
            header = self._handshake(cfg)

        self.learners_per_env = len(self.learner_idx)
        n_sub = self.n_world_envs * self.learners_per_env

        super().__init__(n_sub, observation_space(header), action_space(header))

        self._actions: np.ndarray | None = None
        self._last_obs = np.zeros((n_sub, self.obs_dim), dtype=np.float32)

    # ------------------------------------------------------------------ handshake / io
    def _handshake(self, config: dict) -> dict:
        proto.write_frame(self.proc.stdin, proto.hello_request(config))
        return proto.parse_hello_response(proto.read_frame(self.proc.stdout))

    def _world_to_learner(self, world: np.ndarray) -> np.ndarray:
        """Select learner rows from a (numWorldEnvs*numAgents, ...) array -> (n_sub, ...)."""
        world = world.reshape(self.n_world_envs, self.n_agents, *world.shape[1:])
        sel = world[:, self.learner_idx, ...]
        return sel.reshape(self.n_world_envs * self.learners_per_env, *world.shape[2:])

    # ------------------------------------------------------------------ VecEnv API
    def reset(self) -> np.ndarray:
        proto.write_frame(self.proc.stdin, proto.reset_request())
        payload = proto.read_frame(self.proc.stdout)
        obs = proto.parse_obs_only(payload, self.n_world_envs * self.n_agents, self.obs_dim)
        self._last_obs = self._world_to_learner(obs)
        return self._last_obs

    def step_async(self, actions: np.ndarray) -> None:
        self._actions = np.asarray(actions, dtype=np.int32)

    def step_wait(self) -> VecEnvStepReturn:
        # Scatter learner actions into a full (numWorldEnvs*numAgents, actDim) block.
        full = np.zeros((self.n_world_envs, self.n_agents, self.act_dim), dtype=np.int32)
        acts = self._actions.reshape(self.n_world_envs, self.learners_per_env, self.act_dim)
        for j, idx in enumerate(self.learner_idx):
            full[:, idx, :] = acts[:, j, :]

        proto.write_frame(self.proc.stdin, proto.step_request(full.reshape(-1, self.act_dim)))
        payload = proto.read_frame(self.proc.stdout)
        resp = proto.parse_step_response(payload, self.n_world_envs * self.n_agents, self.obs_dim)

        obs = self._world_to_learner(resp.obs)
        reward = self._world_to_learner(resp.reward.reshape(-1, 1)).reshape(-1).astype(np.float32)
        done = self._world_to_learner(resp.done.reshape(-1, 1)).reshape(-1).astype(bool)
        trunc = self._world_to_learner(resp.truncated.reshape(-1, 1)).reshape(-1).astype(bool)
        self._last_obs = obs

        # SB3 bootstraps a done iff info has terminal_observation AND TimeLimit.truncated.
        # Real match ends are true terminals (no bootstrap); maxTicks cut-offs are
        # truncations (bootstrap). Map each learner sub-env back to its world agent slot.
        infos: list[dict[str, Any]] = [{} for _ in range(self.num_envs)]
        for sub in range(self.num_envs):
            if not done[sub]:
                continue
            infos[sub]["truncated"] = bool(trunc[sub])  # always exposed (diagnostics)
            w = sub // self.learners_per_env
            j = sub % self.learners_per_env
            world_idx = w * self.n_agents + self.learner_idx[j]
            term = resp.terminal_obs.get(world_idx)
            if term is not None:
                infos[sub]["terminal_observation"] = term
            # Only flag TimeLimit.truncated (-> SB3 value bootstrap) when explicitly enabled.
            if trunc[sub] and self.bootstrap_truncation:
                infos[sub]["TimeLimit.truncated"] = True
        return obs, reward, done, infos

    def close(self) -> None:
        try:
            if self.proc.poll() is None and self.proc.stdin:
                proto.write_frame(self.proc.stdin, proto.close_request())
                self.proc.wait(timeout=2)
        except Exception:
            pass
        finally:
            if self.proc.poll() is None:
                self.proc.kill()

    # --- Required abstract stubs (no per-sub-env Python objects to introspect) ---
    def env_is_wrapped(self, wrapper_class, indices=None) -> list[bool]:
        return [False] * self.num_envs

    def get_attr(self, attr_name: str, indices=None) -> list[Any]:
        return [getattr(self, attr_name, None)] * self._n(indices)

    def set_attr(self, attr_name: str, value: Any, indices=None) -> None:
        setattr(self, attr_name, value)

    def env_method(self, method_name: str, *args, indices=None, **kwargs) -> list[Any]:
        return [None] * self._n(indices)

    def _n(self, indices) -> int:
        if indices is None:
            return self.num_envs
        if isinstance(indices, int):
            return 1
        return len(list(indices))

    def get_images(self) -> Sequence[np.ndarray]:  # headless
        return []
