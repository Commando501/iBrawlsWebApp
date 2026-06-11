"""Gymnasium/SB3-compatible vectorized client for the Node Grifball/Combat sim.

Spawns **one or more** Node sim subprocesses (one per CPU core via ``num_workers``), each
hosting a slice of the matches, and concatenates their agents into one flat batch of
learner-controlled sub-envs. Multiple workers let the CPU-bound sim run in parallel across
cores and feed the policy a large batch — which is what makes a GPU worth using.

Per step we send the action frame to *all* workers first, then read every response, so the
worker processes step concurrently instead of serially.

Modes:
- grifball: learner team = blue; opponent team driven by the built-in heuristic/random, or
  shared-policy self-play (``opponent='self'``).
- combat: pure self-play generalist (every agent is the learner).
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


class SimWorker:
    """One Node sim subprocess: handshake + raw (whole-worker) reset/step over the wire."""

    def __init__(self, cmd: list[str], shell: bool, config: dict) -> None:
        self.proc = subprocess.Popen(
            cmd, cwd=REPO_ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=sys.stderr, bufsize=0, shell=shell,
        )
        assert self.proc.stdin and self.proc.stdout
        proto.write_frame(self.proc.stdin, proto.hello_request(config))
        self.header = proto.parse_hello_response(proto.read_frame(self.proc.stdout))
        self.agent_teams: list[str] = self.header["agentTeams"]
        self.n_world_envs: int = int(self.header["numEnvs"])
        self.n_agents: int = int(self.header["numAgents"])
        self.obs_dim: int = int(self.header["obsDim"])
        self.act_dim: int = int(self.header["actionDim"])
        self.reward_component_keys: list[str] = list(self.header.get("rewardComponentKeys") or [])
        self.slots: int = self.n_world_envs * self.n_agents  # total agent rows this worker owns

    def reset(self) -> np.ndarray:
        proto.write_frame(self.proc.stdin, proto.reset_request())
        return proto.parse_obs_only(proto.read_frame(self.proc.stdout), self.slots, self.obs_dim)

    def send_step(self, full_actions: np.ndarray) -> None:
        """Async: write the STEP frame (full (slots, act_dim) action block) and flush."""
        proto.write_frame(self.proc.stdin, proto.step_request(full_actions))

    def recv_step(self) -> proto.StepResponse:
        return proto.parse_step_response(
            proto.read_frame(self.proc.stdout),
            self.slots,
            self.obs_dim,
            reward_component_count=len(self.reward_component_keys),
        )

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


class _WorkerView:
    """Per-worker aggregation metadata: how its learner agents map into the flat batch."""
    def __init__(self, worker: SimWorker, learner_idx: list[int], slot_off: int) -> None:
        self.worker = worker
        self.learner_idx = learner_idx
        self.learners_per_env = len(learner_idx)
        self.slot_off = slot_off                                   # start row in the flat batch
        self.count = worker.n_world_envs * self.learners_per_env   # learner rows from this worker

    def select(self, arr: np.ndarray) -> np.ndarray:
        """Pick learner rows from a whole-worker (slots, ...) array -> (count, ...)."""
        w = arr.reshape(self.worker.n_world_envs, self.worker.n_agents, *arr.shape[1:])
        sel = w[:, self.learner_idx, ...]
        return sel.reshape(self.count, *arr.shape[1:])


class GrifballVecEnv(VecEnv):
    """Fans matches across `num_workers` Node processes; exposes learner agents as sub-envs."""

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
        randomize: dict | None = None,
        num_workers: int = 1,
        decision_interval: int = 1,
        node_cmd: Sequence[str] | None = None,
    ) -> None:
        self.mode = mode
        if mode == "combat":
            opponent = "self"  # combat is pure self-play
        self.opponent = opponent
        self.bootstrap_truncation = bootstrap_truncation

        cmd = list(node_cmd) if node_cmd else _default_cmd()
        shell = os.name == "nt" and node_cmd is None
        W = max(1, int(num_workers))

        def base_cfg(seed: int) -> dict:
            cfg: dict = {"baseSeed": seed, "mode": mode}
            if settings:
                cfg["settings"] = settings
            if reward:
                cfg["reward"] = reward
            if max_ticks is not None:
                cfg["maxTicks"] = max_ticks
            if randomize and randomize.get("enabled"):
                cfg["randomize"] = randomize
            if decision_interval and int(decision_interval) > 1:
                cfg["decisionInterval"] = int(decision_interval)
            return cfg

        self.views: list[_WorkerView] = []
        slot_off = 0

        if mode == "combat":
            sizes = combat_world_sizes or [2, 2, 2, 2, 4, 4, 8]
            chunks = [sizes[w::W] for w in range(W)]
            chunks = [c for c in chunks if c]  # drop empties if W > #worlds
            for w, chunk in enumerate(chunks):
                cfg = base_cfg(base_seed + w * 1_000_003)
                cfg["worldSizes"] = chunk
                if combat_kill_range:
                    cfg["killTargetRange"] = list(combat_kill_range)
                cfg["randomizeLayout"] = combat_randomize_layout
                worker = SimWorker(cmd, shell, cfg)
                learner_idx = list(range(worker.n_agents))  # self-play: all are learners
                view = _WorkerView(worker, learner_idx, slot_off)
                self.views.append(view)
                slot_off += view.count
        else:
            per_worker_envs = max(1, num_envs // W)
            # Probe once to learn team layout -> learner / built-in opponent slots.
            probe = SimWorker(cmd, shell, {**base_cfg(base_seed), "numEnvs": per_worker_envs})
            teams = probe.agent_teams
            if opponent == "self":
                learner_idx = list(range(probe.n_agents))
                builtin_idx: list[int] = []
            else:
                learner_idx = [i for i, t in enumerate(teams) if t == learner_team]
                builtin_idx = [i for i, t in enumerate(teams) if t != learner_team]
            probe.close()
            for w in range(W):
                cfg = {**base_cfg(base_seed + w * 1_000_003), "numEnvs": per_worker_envs}
                if builtin_idx:
                    cfg["builtinAgents"] = builtin_idx
                    cfg["builtinPolicy"] = "random" if opponent == "random" else "heuristic"
                worker = SimWorker(cmd, shell, cfg)
                view = _WorkerView(worker, learner_idx, slot_off)
                self.views.append(view)
                slot_off += view.count

        first = self.views[0].worker
        self.obs_dim = first.obs_dim
        self.act_dim = first.act_dim
        self.header = first.header
        self.reward_component_keys = list(first.reward_component_keys)
        self.last_reward_components: dict[str, float] = {
            key: 0.0 for key in self.reward_component_keys
        }
        n_sub = slot_off  # total learner rows across all workers

        super().__init__(n_sub, observation_space(first.header), action_space(first.header))
        self._actions: np.ndarray | None = None
        self._last_obs = np.zeros((n_sub, self.obs_dim), dtype=np.float32)

    # ------------------------------------------------------------------ VecEnv API
    def reset(self) -> np.ndarray:
        for v in self.views:
            self._last_obs[v.slot_off:v.slot_off + v.count] = v.select(v.worker.reset())
        return self._last_obs

    def step_async(self, actions: np.ndarray) -> None:
        self._actions = np.asarray(actions, dtype=np.int32)

    def step_wait(self) -> VecEnvStepReturn:
        # 1) Send STEP to every worker first so they compute in parallel.
        for v in self.views:
            chunk = self._actions[v.slot_off:v.slot_off + v.count]  # (count, act_dim)
            full = np.zeros((v.worker.n_world_envs, v.worker.n_agents, self.act_dim), dtype=np.int32)
            acts = chunk.reshape(v.worker.n_world_envs, v.learners_per_env, self.act_dim)
            for j, idx in enumerate(v.learner_idx):
                full[:, idx, :] = acts[:, j, :]
            v.worker.send_step(full.reshape(-1, self.act_dim))

        # 2) Collect responses.
        reward = np.zeros(self.num_envs, dtype=np.float32)
        done = np.zeros(self.num_envs, dtype=bool)
        infos: list[dict[str, Any]] = [{} for _ in range(self.num_envs)]
        component_totals = np.zeros((len(self.reward_component_keys),), dtype=np.float64)
        for v in self.views:
            resp = v.worker.recv_step()
            if resp.reward_components.size:
                component_totals[:resp.reward_components.size] += resp.reward_components
            o = v.slot_off
            self._last_obs[o:o + v.count] = v.select(resp.obs)
            reward[o:o + v.count] = v.select(resp.reward.reshape(-1, 1)).reshape(-1)
            d = v.select(resp.done.reshape(-1, 1)).reshape(-1).astype(bool)
            tr = v.select(resp.truncated.reshape(-1, 1)).reshape(-1).astype(bool)
            done[o:o + v.count] = d
            for k in range(v.count):
                if not d[k]:
                    continue
                info = infos[o + k]
                info["truncated"] = bool(tr[k])
                we = k // v.learners_per_env
                j = k % v.learners_per_env
                world_idx = we * v.worker.n_agents + v.learner_idx[j]
                term = resp.terminal_obs.get(world_idx)
                if term is not None:
                    info["terminal_observation"] = term
                if tr[k] and self.bootstrap_truncation:
                    info["TimeLimit.truncated"] = True
        self.last_reward_components = {
            key: float(component_totals[i])
            for i, key in enumerate(self.reward_component_keys)
        }
        return self._last_obs, reward, done, infos

    def close(self) -> None:
        for v in self.views:
            v.worker.close()

    # --- Required abstract stubs ---
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

    def get_images(self) -> Sequence[np.ndarray]:
        return []
