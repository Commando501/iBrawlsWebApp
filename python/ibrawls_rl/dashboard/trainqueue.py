"""Sequential training queue — the optimizer's sweep runner.

Holds an ordered list of jobs (each a full set of config values, usually short
"probe" runs differing in one knob). A background worker writes each job's config
to ``config.toml``, launches the trainer through the shared :class:`ManagedProcess`,
waits for it to finish, records a result summary from the run's metrics, and moves
on. Pausing stops *between* jobs; the in-flight job keeps training (stop it from
the Train tab if needed).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time

from ..config import config_from_values, save_config
from . import metrics as metricsmod
from .paths import CONFIG_PATH, PROJECT_DIR, safe_run_path


def queue_rank_score(summary: dict | None) -> float:
    """Comparable optimizer score; full-matrix lone-wolf grades outrank raw rewards."""
    if not summary:
        return float("-inf")
    anti = summary.get("anti_bait_score")
    if isinstance(anti, (int, float)):
        base = None
        for key in ("lone_wolf_score", "frozen_snapshot_score", "promotion_score"):
            value = summary.get(key)
            if isinstance(value, (int, float)):
                base = float(value) if base is None else min(base, float(value))
        trap = summary.get("trap_death_rate")
        trap_penalty = max(0.0, float(trap) - 0.2) if isinstance(trap, (int, float)) else 0.0
        return min(float(anti), base if base is not None else float(anti)) - trap_penalty
    for key in ("lone_wolf_score", "promotion_score"):
        value = summary.get(key)
        if isinstance(value, (int, float)):
            return float(value)
    win = summary.get("win_rate")
    if isinstance(win, (int, float)):
        return float(win) * 0.25
    reward = summary.get("ep_rew_mean")
    if isinstance(reward, (int, float)):
        return float(reward) / 1000.0
    return float("-inf")


def _summarize_run(logdir: str) -> dict:
    """Final headline numbers for a finished job (best-effort)."""
    run = safe_run_path(logdir)
    if not run or not os.path.isdir(run):
        return {}
    try:
        series = metricsmod.read_run_metrics(run).get("series", {})
    except Exception:
        return {}

    def last(key: str):
        pts = series.get(key)
        return pts[-1][1] if pts else None

    summary = {
        "step": last("step") or metricsmod._last_step(run),
        "ep_rew_mean": last("rollout/ep_rew_mean"),
        "ep_len_mean": last("rollout/ep_len_mean"),
        "win_rate": last("eval/win_rate"),
        "fps": last("time/fps"),
    }
    matrix_path = os.path.join(run, "optimizer_eval_matrix.json")
    if os.path.exists(matrix_path):
        try:
            with open(matrix_path, "r", encoding="utf-8") as f:
                result = json.load(f)
            matrix = result.get("summary") or {}
            summary.update({
                "lone_wolf_score": matrix.get("lone_wolf_score"),
                "promotion_score": matrix.get("promotion_score"),
                "matrix_scenarios": matrix.get("scenarios"),
                "anti_bait_score": matrix.get("anti_bait_score"),
                "trap_death_rate": matrix.get("trap_death_rate"),
                "frozen_snapshot_score": matrix.get("frozen_snapshot_score"),
                "strict_promotion_ready": matrix.get("strict_promotion_ready"),
            })
        except Exception:
            pass
    summary["rank_score"] = queue_rank_score(summary)
    return summary


def _run_optimizer_matrix(model_path: str, cfg) -> dict:
    """Run the full combat matrix after a queue job and persist the JSON result."""
    run = safe_run_path(cfg.logdir)
    if cfg.mode != "combat" or not run or not os.path.exists(model_path):
        return {}
    cmd = [
        sys.executable, "-m", "ibrawls_rl.evaluate", model_path,
        "--json", "--mode", "combat", "--matrix",
        "--matches", str(max(1, int(cfg.eval_episodes))),
        "--num-envs", "16",
        "--device", "cpu",
    ]
    if int(getattr(cfg, "observation_version", 1) or 1) > 1:
        cmd += ["--observation-version", str(int(cfg.observation_version))]
    out = subprocess.run(
        cmd,
        cwd=PROJECT_DIR,
        env={**os.environ, "PYTHONPATH": PROJECT_DIR},
        capture_output=True,
        text=True,
        timeout=60 * 60 * 4,
    )
    if out.returncode != 0:
        return {"optimizer_eval_error": (out.stderr or out.stdout or "").strip()[-500:]}
    payload = None
    for line in reversed((out.stdout or "").splitlines()):
        try:
            payload = json.loads(line)
            break
        except json.JSONDecodeError:
            continue
    if not payload:
        return {"optimizer_eval_error": "matrix evaluator produced no JSON result"}
    matrix_path = os.path.join(run, "optimizer_eval_matrix.json")
    with open(matrix_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1)
    summary = payload.get("summary") or {}
    return {
        "lone_wolf_score": summary.get("lone_wolf_score"),
        "promotion_score": summary.get("promotion_score"),
        "matrix_scenarios": summary.get("scenarios"),
        "anti_bait_score": summary.get("anti_bait_score"),
        "trap_death_rate": summary.get("trap_death_rate"),
        "frozen_snapshot_score": summary.get("frozen_snapshot_score"),
        "strict_promotion_ready": summary.get("strict_promotion_ready"),
    }


class TrainQueue:
    def __init__(self, trainer) -> None:
        self.trainer = trainer  # the shared ManagedProcess("train")
        self._jobs: list[dict] = []
        self._lock = threading.Lock()
        self._running = False
        self._thread: threading.Thread | None = None
        self._next_id = 1

    # -- mutation -------------------------------------------------------------
    def add(self, jobs: list[dict]) -> dict:
        """Each job: {name, values:{field: value}}. logdir comes from values."""
        added = []
        with self._lock:
            for j in jobs:
                values = dict(j.get("values") or {})
                if not values.get("logdir"):
                    return {"ok": False, "error": "every job needs a logdir in its values"}
                job = {
                    "id": self._next_id,
                    "name": str(j.get("name") or values["logdir"]),
                    "values": values,
                    "logdir": values["logdir"],
                    "state": "queued",
                    "started_at": None,
                    "finished_at": None,
                    "summary": None,
                    "error": None,
                }
                self._next_id += 1
                self._jobs.append(job)
                added.append(job["id"])
        return {"ok": True, "added": added}

    def remove(self, job_id: int) -> dict:
        with self._lock:
            for i, j in enumerate(self._jobs):
                if j["id"] == job_id:
                    if j["state"] == "running":
                        return {"ok": False, "error": "job is running — stop training first"}
                    self._jobs.pop(i)
                    return {"ok": True}
        return {"ok": False, "error": "job not found"}

    def clear_finished(self) -> dict:
        with self._lock:
            self._jobs = [j for j in self._jobs if j["state"] in ("queued", "running")]
        return {"ok": True}

    # -- control --------------------------------------------------------------
    def start(self) -> dict:
        with self._lock:
            if self._running:
                return {"ok": True, "note": "already running"}
            if not any(j["state"] == "queued" for j in self._jobs):
                return {"ok": False, "error": "no queued jobs"}
            self._running = True
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._loop, daemon=True)
                self._thread.start()
        return {"ok": True}

    def pause(self) -> dict:
        """Stop advancing after the current job (the in-flight run keeps going)."""
        with self._lock:
            self._running = False
        return {"ok": True}

    def status(self) -> dict:
        with self._lock:
            jobs = [dict(j) for j in self._jobs]
            running = self._running
        # Refresh summaries of finished jobs lazily (cheap: reads jsonl tails).
        for j in jobs:
            if j["state"] in ("done", "error") and not j.get("summary"):
                j["summary"] = _summarize_run(j["logdir"])
        return {"running": running, "jobs": jobs}

    # -- worker ---------------------------------------------------------------
    def _next_queued(self) -> dict | None:
        with self._lock:
            for j in self._jobs:
                if j["state"] == "queued":
                    return j
        return None

    def _loop(self) -> None:
        while True:
            with self._lock:
                if not self._running:
                    return
            if self.trainer.is_running():
                time.sleep(2)
                continue

            job = self._next_queued()
            if job is None:
                with self._lock:
                    self._running = False
                return

            try:
                cfg = config_from_values(job["values"])
                save_config(cfg, CONFIG_PATH)
                run_dir = safe_run_path(cfg.logdir) or os.path.join(PROJECT_DIR, cfg.logdir)
                os.makedirs(run_dir, exist_ok=True)
                res = self.trainer.start(
                    ["ibrawls_rl.train", "config.toml"],
                    meta={"logdir": cfg.logdir, "total_steps": cfg.total_steps,
                          "mode": cfg.mode, "queue_job": job["id"]},
                )
                if not res.get("ok"):
                    raise RuntimeError(res.get("error") or "failed to start trainer")
                job["state"] = "running"
                job["started_at"] = time.time()
            except Exception as e:
                job["state"] = "error"
                job["error"] = str(e)
                job["finished_at"] = time.time()
                continue

            while self.trainer.is_running():
                time.sleep(2)
            st = self.trainer.status()
            ok = st.get("returncode") in (0, None)
            matrix_summary = {}
            job["state"] = "done" if ok else "error"
            if not ok:
                job["error"] = f"trainer exited with code {st.get('returncode')}"
            elif job["state"] == "done":
                model_path = os.path.join(PROJECT_DIR, cfg.logdir, "final_model.zip")
                matrix_summary = _run_optimizer_matrix(model_path, cfg)
                if matrix_summary.get("optimizer_eval_error"):
                    job["error"] = matrix_summary["optimizer_eval_error"]
            job["finished_at"] = time.time()
            job["summary"] = {**_summarize_run(job["logdir"]), **(matrix_summary if ok else {})}
            job["summary"]["rank_score"] = queue_rank_score(job["summary"])
