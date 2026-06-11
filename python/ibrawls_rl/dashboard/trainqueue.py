"""Sequential training queue — the optimizer's sweep runner.

Holds an ordered list of jobs (each a full set of config values, usually short
"probe" runs differing in one knob). A background worker writes each job's config
to ``config.toml``, launches the trainer through the shared :class:`ManagedProcess`,
waits for it to finish, records a result summary from the run's metrics, and moves
on. Pausing stops *between* jobs; the in-flight job keeps training (stop it from
the Train tab if needed).
"""
from __future__ import annotations

import os
import threading
import time

from ..config import config_from_values, save_config
from . import metrics as metricsmod
from .paths import CONFIG_PATH, PROJECT_DIR, safe_run_path


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

    return {
        "step": last("step") or metricsmod._last_step(run),
        "ep_rew_mean": last("rollout/ep_rew_mean"),
        "ep_len_mean": last("rollout/ep_len_mean"),
        "win_rate": last("eval/win_rate"),
        "fps": last("time/fps"),
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
            job["state"] = "done" if ok else "error"
            if not ok:
                job["error"] = f"trainer exited with code {st.get('returncode')}"
            job["finished_at"] = time.time()
            job["summary"] = _summarize_run(job["logdir"])
