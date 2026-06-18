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
import threading
from typing import Any, Sequence

import numpy as np
from stable_baselines3.common.vec_env.base_vec_env import VecEnv, VecEnvStepReturn

from .. import protocol as proto
from ..config import expand_combat_layout_mix
from ..spaces import action_space, observation_space

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def _default_cmd() -> list[str]:
    override = os.environ.get("IBRAWLS_SIM_CMD")
    if override:
        return override.split()
    return ["npx", "tsx", "src/sim/server/main.ts"]


class SimWorkerStatusTracker:
    """Small process-local counter for evaluator-visible sim worker lifecycle status."""

    def __init__(self, enabled: bool = False, sink=None) -> None:  # noqa: ANN001
        self.enabled = bool(enabled)
        self._sink = sink or (lambda line: print(line, flush=True))
        self._lock = threading.Lock()
        self._open: set[int] = set()
        self._closing: set[int] = set()
        self._closed: set[int] = set()
        self._started = 0
        self._expected: int | None = None

    def configure(
        self,
        enabled: bool = True,
        sink=None,  # noqa: ANN001
        reset: bool = True,
        expected: int | None = None,
    ) -> dict[str, int]:
        with self._lock:
            self.enabled = bool(enabled)
            if sink is not None:
                self._sink = sink
            if reset:
                self._open.clear()
                self._closing.clear()
                self._closed.clear()
                self._started = 0
                self._expected = None
            if expected is not None:
                self._expected = max(0, int(expected))
            return self._snapshot_locked()

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            return self._snapshot_locked()

    def opened(self, pid: int | None) -> None:
        if pid is None:
            return
        with self._lock:
            pid = int(pid)
            self._open.add(pid)
            self._closing.discard(pid)
            self._closed.discard(pid)
            self._started += 1
            self._emit_locked("open", pid)

    def closing(self, pid: int | None) -> None:
        if pid is None:
            return
        with self._lock:
            pid = int(pid)
            if pid in self._closed:
                return
            self._open.discard(pid)
            self._closing.add(pid)
            self._emit_locked("closing", pid)

    def closed(self, pid: int | None) -> None:
        if pid is None:
            return
        with self._lock:
            pid = int(pid)
            if pid in self._closed:
                return
            self._open.discard(pid)
            self._closing.discard(pid)
            self._closed.add(pid)
            self._emit_locked("closed", pid)

    def _snapshot_locked(self) -> dict[str, int]:
        open_count = len(self._open)
        closing_count = len(self._closing)
        out = {
            "open": open_count,
            "closing": closing_count,
            "closed": len(self._closed),
            "started": self._started,
            "alive": open_count + closing_count,
        }
        if self._expected is not None:
            out["expected"] = self._expected
            out["remaining"] = max(0, self._expected - out["closed"])
        return out

    def _emit_locked(self, event: str, pid: int) -> None:
        if not self.enabled:
            return
        snap = self._snapshot_locked()
        expected = ""
        if "expected" in snap:
            expected = f" expected={snap['expected']} remaining={snap['remaining']}"
        self._sink(
            "[eval-sims] "
            f"open={snap['open']} closing={snap['closing']} "
            f"closed={snap['closed']} started={snap['started']}"
            f"{expected} "
            f"event={event} pid={pid}"
        )


SIM_WORKER_STATUS = SimWorkerStatusTracker()


def configure_sim_worker_status(
    enabled: bool = True,
    sink=None,  # noqa: ANN001
    reset: bool = True,
    expected: int | None = None,
) -> dict[str, int]:
    return SIM_WORKER_STATUS.configure(enabled=enabled, sink=sink, reset=reset, expected=expected)


class SimWorker:
    """One Node sim subprocess: handshake + raw (whole-worker) reset/step over the wire."""

    def __init__(self, cmd: list[str], shell: bool, config: dict) -> None:
        self._closed = False
        self.proc = subprocess.Popen(
            cmd, cwd=REPO_ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=sys.stderr, bufsize=0, shell=shell,
        )
        SIM_WORKER_STATUS.opened(self.proc.pid)
        assert self.proc.stdin and self.proc.stdout
        proto.write_frame(self.proc.stdin, proto.hello_request(config))
        self.header = proto.parse_hello_response(proto.read_frame(self.proc.stdout))
        self.agent_teams: list[str] = self.header["agentTeams"]
        self.n_world_envs: int = int(self.header["numEnvs"])
        self.n_agents: int = int(self.header["numAgents"])
        self.obs_dim: int = int(self.header["obsDim"])
        self.act_dim: int = int(self.header["actionDim"])
        self.reward_component_keys: list[str] = list(self.header.get("rewardComponentKeys") or [])
        self.mechanics_coverage_keys: list[str] = list(self.header.get("mechanicsCoverageKeys") or [])
        self.mechanics_coverage_fields: list[str] = list(
            self.header.get("mechanicsCoverageFields") or ["count", "min", "max", "sum"]
        )
        self.mechanics_base_values: dict[str, float] = {
            str(k): float(v)
            for k, v in (self.header.get("mechanicsBaseValues") or {}).items()
            if isinstance(v, (int, float))
        }
        self.learner_agent_indices: list[int] | None = self.header.get("learnerAgentIndices")
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
            mechanics_coverage_count=len(self.mechanics_coverage_keys) * len(self.mechanics_coverage_fields),
        )

    def get_state(self, world_index: int = 0) -> dict:
        """One world's render-ready snapshot (Watch tab). Call between steps only."""
        proto.write_frame(self.proc.stdin, proto.state_request(world_index))
        return proto.parse_state_response(proto.read_frame(self.proc.stdout))

    def close(self) -> None:
        if self._closed:
            return
        SIM_WORKER_STATUS.closing(self.proc.pid)
        try:
            if self.proc.poll() is None and self.proc.stdin:
                proto.write_frame(self.proc.stdin, proto.close_request())
                self.proc.wait(timeout=2)
        except Exception:
            pass
        finally:
            if self.proc.poll() is None:
                self.proc.kill()
            self._closed = True
            SIM_WORKER_STATUS.closed(self.proc.pid)


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


def learner_indices_from_header(worker: SimWorker) -> list[int]:
    indices = getattr(worker, "learner_agent_indices", None)
    if indices:
        return [int(i) for i in indices]
    return list(range(worker.n_agents))


def _coverage_to_rows(keys: list[str], fields: list[str], values: np.ndarray) -> dict[str, dict[str, float]]:
    width = len(fields)
    if width <= 0 or not keys or values.size <= 0:
        return {}
    index = {name: i for i, name in enumerate(fields)}
    out: dict[str, dict[str, float]] = {}
    for i, key in enumerate(keys):
        start = i * width
        if start + width > values.size:
            break
        row = values[start:start + width]
        count = float(row[index.get("count", 0)])
        if count <= 0:
            continue
        total = float(row[index.get("sum", width - 1)])
        out[key] = {
            "count": count,
            "min": float(row[index.get("min", 1)]),
            "max": float(row[index.get("max", 2)]),
            "sum": total,
            "mean": total / count if count else 0.0,
        }
    return out


def _merge_coverage_rows(target: dict[str, dict[str, float]], rows: dict[str, dict[str, float]]) -> None:
    for key, row in rows.items():
        count = float(row.get("count", 0.0))
        if count <= 0:
            continue
        current = target.get(key)
        if not current or float(current.get("count", 0.0)) <= 0:
            target[key] = dict(row)
        else:
            current["count"] = float(current.get("count", 0.0)) + count
            current["min"] = min(float(current.get("min", row["min"])), float(row["min"]))
            current["max"] = max(float(current.get("max", row["max"])), float(row["max"]))
            current["sum"] = float(current.get("sum", 0.0)) + float(row.get("sum", 0.0))
            current["mean"] = current["sum"] / max(1.0, current["count"])


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
        combat_layout_mix: list[str] | None = None,
        combat_world_layouts: list[list[int]] | None = None,
        combat_lone_wolf_reward_scale: float = 1.0,
        combat_scripted_opponent: str = "",
        combat_kill_range: tuple[int, int] | None = None,
        combat_randomize_layout: bool = True,
        randomize: dict | None = None,
        num_workers: int = 1,
        decision_interval: int = 1,
        observation_version: int = 1,
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
            if mode == "combat" and int(observation_version or 1) > 1:
                cfg["observationVersion"] = int(observation_version)
            if mode == "combat" and combat_scripted_opponent:
                cfg["scriptedOpponentProfile"] = str(combat_scripted_opponent)
            return cfg

        self.views: list[_WorkerView] = []
        slot_off = 0

        if mode == "combat":
            layouts = combat_world_layouts or expand_combat_layout_mix(combat_layout_mix or [])
            if layouts:
                chunks = [layouts[w::W] for w in range(W)]
            else:
                sizes = combat_world_sizes or [2, 2, 2, 2, 4, 4, 8]
                chunks = [sizes[w::W] for w in range(W)]
            chunks = [c for c in chunks if c]  # drop empties if W > #worlds
            for w, chunk in enumerate(chunks):
                cfg = base_cfg(base_seed + w * 1_000_003)
                if layouts:
                    cfg["worldLayouts"] = chunk
                    cfg["loneWolfRewardScale"] = float(combat_lone_wolf_reward_scale)
                else:
                    cfg["worldSizes"] = chunk
                if combat_kill_range:
                    cfg["killTargetRange"] = list(combat_kill_range)
                cfg["randomizeLayout"] = combat_randomize_layout
                worker = SimWorker(cmd, shell, cfg)
                learner_idx = learner_indices_from_header(worker)
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
        self.mechanics_coverage_keys = list(first.mechanics_coverage_keys)
        self.mechanics_coverage_fields = list(first.mechanics_coverage_fields)
        self.mechanics_base_values = dict(first.mechanics_base_values)
        self.last_reward_components: dict[str, float] = {
            key: 0.0 for key in self.reward_component_keys
        }
        self.last_mechanics_coverage: dict[str, dict[str, float]] = {}
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
        coverage_totals: dict[str, dict[str, float]] = {}
        for v in self.views:
            resp = v.worker.recv_step()
            if resp.reward_components.size:
                component_totals[:resp.reward_components.size] += resp.reward_components
            if resp.mechanics_coverage.size:
                _merge_coverage_rows(
                    coverage_totals,
                    _coverage_to_rows(
                        v.worker.mechanics_coverage_keys,
                        v.worker.mechanics_coverage_fields,
                        resp.mechanics_coverage,
                    ),
                )
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
        self.last_mechanics_coverage = coverage_totals
        return self._last_obs, reward, done, infos

    def get_state(self, world_index: int = 0) -> dict:
        """Snapshot of one world on the FIRST worker (single-worker watch/debug envs)."""
        return self.views[0].worker.get_state(world_index)

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
