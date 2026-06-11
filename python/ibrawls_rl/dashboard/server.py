"""HTTP server for the RL control board (stdlib only).

Serves a single-page app plus a small JSON API: edit/save config, start/stop
training, tail logs, stream metrics for live charts, browse runs, and grade models.
"""
from __future__ import annotations

import json
import os
import re
import threading
import webbrowser
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from ..config import (
    TrainConfig,
    config_schema,
    config_from_values,
    load_config,
    save_config,
)
from .. import baseline as human_baseline
from .. import hardware
from . import advisor
from . import metrics as metricsmod
from . import evalhistory
from .paths import CONFIG_PATH, STATIC_DIR, PROJECT_DIR, safe_run_path
from .procman import ManagedProcess
from .trainqueue import TrainQueue

TRAINER = ManagedProcess("train")
EVALER = ManagedProcess("eval")
WATCHER = ManagedProcess("watch")
QUEUE = TrainQueue(TRAINER)

WATCH_TRAJECTORY = os.path.join(PROJECT_DIR, "runs", "_watch", "latest.json")

# Guards one-time recording of a finished eval into history (keyed by its start time).
_eval_record_lock = threading.Lock()
_recorded_eval_key: float | None = None

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
}


def _current_values() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            return asdict(load_config(CONFIG_PATH))
        except Exception:
            pass
    return asdict(TrainConfig())


_EVAL_PROGRESS = re.compile(r"\[eval\]\s+(\d+)\s*/\s*(\d+)")
_WATCH_PROGRESS = re.compile(r"\[watch\]\s+(\d+)\s*/\s*(\d+)")


def _parse_watch_progress(lines: list[str]) -> tuple[int | None, int | None]:
    for line in reversed(lines):
        m = _WATCH_PROGRESS.search(line)
        if m:
            return int(m.group(1)), int(m.group(2))
    return None, None


def _parse_eval_progress(lines: list[str]) -> tuple[int | None, int | None]:
    """Latest (completed, total) from the evaluator's `[eval] N/M` progress lines."""
    for line in reversed(lines):
        m = _EVAL_PROGRESS.search(line)
        if m:
            return int(m.group(1)), int(m.group(2))
    return None, None


def _record_eval_if_new(st: dict) -> None:
    """Append a finished grade to history exactly once (idempotent across polls)."""
    global _recorded_eval_key
    key = st.get("started_at")
    result = st.get("result")
    if key is None or not result:
        return
    with _eval_record_lock:
        if _recorded_eval_key == key:
            return
        _recorded_eval_key = key
        meta = st.get("meta", {})
        ts = key + (st.get("elapsed") or 0)
        evalhistory.append({
            "ts": ts,
            "model": result.get("model") or meta.get("model"),
            "mode": result.get("mode") or meta.get("mode"),
            "opponent": result.get("opponent") or meta.get("opponent"),
            "matches": meta.get("matches"),
            "num_envs": meta.get("num_envs"),
            "device": meta.get("device"),
            "win_rate": result.get("win_rate"),
            "loss_rate": result.get("loss_rate"),
            "draw_rate": result.get("draw_rate"),
            "episodes": result.get("episodes"),
            "ep_return": result.get("ep_return"),
            "behavior": result.get("behavior"),
            "decision_interval": result.get("decision_interval"),
            "frame_stack": result.get("frame_stack") or meta.get("frame_stack"),
            "summary": result.get("summary"),
            "scenarios": result.get("scenarios"),
            "league_snapshots": result.get("league_snapshots") or meta.get("league_snapshots"),
        })


def _parse_eval_result(proc: ManagedProcess) -> dict | None:
    """Pull the last JSON object the evaluator printed (its --json result line)."""
    tail = proc.log_since(0)["lines"]
    for line in reversed(tail):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    return None


class Handler(BaseHTTPRequestHandler):
    server_version = "iBrawlsRLBoard/1.0"

    # -- helpers ------------------------------------------------------------
    def _send_json(self, obj, code: int = 200) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0) or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _serve_static(self, rel: str) -> None:
        if rel in ("", "/"):
            rel = "index.html"
        rel = rel.lstrip("/")
        if rel.startswith("static/"):      # /static/app.js -> app.js under STATIC_DIR
            rel = rel[len("static/"):]
        path = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not path.startswith(STATIC_DIR) or not os.path.isfile(path):
            self.send_error(404)
            return
        ext = os.path.splitext(path)[1]
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", _CONTENT_TYPES.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        # Local dev tool: never let the browser serve a stale app.js/style.css/index.html.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args) -> None:  # quiet the default request logging
        pass

    # -- routing ------------------------------------------------------------
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        try:
            if path == "/api/schema":
                self._send_json({"sections": config_schema(),
                                 "defaults": asdict(TrainConfig())})
            elif path == "/api/config":
                self._send_json({"values": _current_values(),
                                 "path": os.path.relpath(CONFIG_PATH, PROJECT_DIR)})
            elif path == "/api/train/status":
                self._send_json(self._train_status())
            elif path == "/api/train/log":
                since = int((qs.get("since", ["0"])[0]) or 0)
                self._send_json(TRAINER.log_since(since))
            elif path == "/api/runs":
                self._send_json({"runs": metricsmod.list_runs()})
            elif path == "/api/run/metrics":
                run = safe_run_path(qs.get("dir", [""])[0])
                if not run or not os.path.isdir(run):
                    self._send_json({"error": "run not found"}, 404)
                else:
                    self._send_json(metricsmod.read_run_metrics(run))
            elif path == "/api/models":
                self._send_json({"models": metricsmod.list_models()})
            elif path == "/api/eval/status":
                self._send_json(self._eval_status())
            elif path == "/api/eval/history":
                self._send_json({"history": evalhistory.load()})
            elif path == "/api/hardware":
                self._send_json(hardware.detect_dict())
            elif path == "/api/baseline":
                self._send_json(human_baseline.load_baseline())
            elif path == "/api/advice":
                self._send_json(self._advice(qs.get("dir", [""])[0]))
            elif path == "/api/queue":
                self._send_json(QUEUE.status())
            elif path == "/api/watch/status":
                self._send_json(self._watch_status())
            elif path == "/api/watch/trajectory":
                self._send_trajectory()
            else:
                self._serve_static(path)
        except Exception as e:  # pragma: no cover
            self._send_json({"error": str(e)}, 500)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            body = self._read_body()
            if path == "/api/config":
                cfg = config_from_values(body.get("values", {}))
                save_config(cfg, CONFIG_PATH)
                self._send_json({"ok": True, "values": asdict(cfg)})
            elif path == "/api/train/start":
                self._send_json(self._train_start(body))
            elif path == "/api/train/stop":
                self._send_json(TRAINER.stop())
            elif path == "/api/eval/start":
                self._send_json(self._eval_start(body))
            elif path == "/api/eval/stop":
                self._send_json(EVALER.stop())
            elif path == "/api/eval/history/clear":
                evalhistory.clear()
                self._send_json({"ok": True})
            elif path == "/api/queue/add":
                self._send_json(QUEUE.add(body.get("jobs") or []))
            elif path == "/api/queue/remove":
                self._send_json(QUEUE.remove(int(body.get("id", 0))))
            elif path == "/api/queue/clear_finished":
                self._send_json(QUEUE.clear_finished())
            elif path == "/api/queue/start":
                self._send_json(QUEUE.start())
            elif path == "/api/queue/pause":
                self._send_json(QUEUE.pause())
            elif path == "/api/watch/start":
                self._send_json(self._watch_start(body))
            elif path == "/api/watch/stop":
                self._send_json(WATCHER.stop())
            else:
                self.send_error(404)
        except Exception as e:  # pragma: no cover
            self._send_json({"error": str(e)}, 500)

    # -- train --------------------------------------------------------------
    def _train_start(self, body: dict) -> dict:
        if TRAINER.is_running():
            return {"ok": False, "error": "training already running"}
        cfg = config_from_values(body.get("values", {}))
        save_config(cfg, CONFIG_PATH)
        os.makedirs(safe_run_path(cfg.logdir) or os.path.join(PROJECT_DIR, cfg.logdir),
                    exist_ok=True)
        meta = {"logdir": cfg.logdir, "total_steps": cfg.total_steps, "mode": cfg.mode}
        return TRAINER.start(["ibrawls_rl.train", "config.toml"], meta=meta)

    def _train_status(self) -> dict:
        st = TRAINER.status()
        meta = st.get("meta", {})
        logdir = meta.get("logdir")
        last_step = None
        if logdir:
            run = safe_run_path(logdir)
            if run and os.path.isdir(run):
                last_step = metricsmod._last_step(run)
        total = meta.get("total_steps")
        progress = None
        if last_step is not None and total:
            progress = max(0.0, min(1.0, last_step / float(total)))
        st["last_step"] = last_step
        st["total_steps"] = total
        st["progress"] = progress
        return st

    # -- advisor ------------------------------------------------------------
    def _advice(self, run_rel: str) -> dict:
        """Advisor findings for a run dir (live or finished); config-lint-only when empty."""
        series: dict = {}
        values = _current_values()
        progress = None
        running = False
        if run_rel:
            run = safe_run_path(run_rel)
            if run and os.path.isdir(run):
                series = metricsmod.read_run_metrics(run).get("series", {})
                cfg_used = os.path.join(run, "config_used.toml")
                if os.path.exists(cfg_used):
                    try:
                        values = asdict(load_config(cfg_used))
                    except Exception:
                        pass
                last = metricsmod._last_step(run)
                total = values.get("total_steps")
                if last is not None and total:
                    progress = max(0.0, min(1.0, last / float(total)))
                meta = TRAINER.status().get("meta", {})
                running = TRAINER.is_running() and meta.get("logdir") == run_rel
        # `step` isn't a metric series; drop it if the jsonl reader surfaced it.
        series.pop("step", None)
        return advisor.advise(series, values, running=running, progress=progress,
                              cpus=os.cpu_count() or 8, project_dir=PROJECT_DIR)

    # -- watch (record + replay a match from a saved model) ------------------
    def _watch_start(self, body: dict) -> dict:
        if WATCHER.is_running():
            return {"ok": False, "error": "a watch recording is already running"}
        model = (body.get("model") or "").strip()
        safe = safe_run_path(model)
        if not safe or not os.path.isfile(safe):
            return {"ok": False, "error": f"model not found: {model}"}
        args = ["ibrawls_rl.watch", model,
                "--world-size", str(int(body.get("world_size", 4))),
                "--kill-target", str(int(body.get("kill_target", 10))),
                "--opponent", body.get("opponent", "self"),
                "--max-minutes", str(float(body.get("max_minutes", 3.0)))]
        meta = {"model": model, "world_size": int(body.get("world_size", 4)),
                "kill_target": int(body.get("kill_target", 10)),
                "opponent": body.get("opponent", "self")}
        return WATCHER.start(args, meta=meta)

    def _watch_status(self) -> dict:
        st = WATCHER.status()
        lines = WATCHER.log_since(0)["lines"]
        st["log"] = lines[-15:]
        completed, total = _parse_watch_progress(lines)
        st["progress"] = (completed / total) if (completed is not None and total) else None
        st["has_trajectory"] = os.path.exists(WATCH_TRAJECTORY)
        if st["has_trajectory"]:
            st["trajectory_mtime"] = os.path.getmtime(WATCH_TRAJECTORY)
        return st

    def _send_trajectory(self) -> None:
        if not os.path.exists(WATCH_TRAJECTORY):
            self._send_json({"error": "no trajectory recorded yet"}, 404)
            return
        with open(WATCH_TRAJECTORY, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # -- eval ---------------------------------------------------------------
    def _eval_start(self, body: dict) -> dict:
        if EVALER.is_running():
            return {"ok": False, "error": "evaluation already running"}
        model = (body.get("model") or "").strip()
        safe = safe_run_path(model)
        if not safe or not os.path.isfile(safe):
            return {"ok": False, "error": f"model not found: {model}"}
        mode = body.get("mode", "grifball")
        args = ["ibrawls_rl.evaluate", model, "--json", "--mode", mode,
                "--matches", str(int(body.get("matches", 100))),
                "--num-envs", str(int(body.get("num_envs", 16))),
                "--device", body.get("device", "cpu")]
        if int(body.get("frame_stack", 0) or 0) > 0:
            args += ["--frame-stack", str(int(body.get("frame_stack", 0)))]
        if mode == "combat":
            args += ["--kill-target", str(int(body.get("kill_target", 10)))]
            if body.get("matrix"):
                args += ["--matrix"]
            for path in body.get("league_snapshots") or []:
                args += ["--league-snapshot", str(path)]
        else:
            args += ["--opponent", body.get("opponent", "random"),
                     "--goal-target", str(int(body.get("goal_target", 3)))]
        meta = {
            "model": model, "mode": mode,
            "opponent": body.get("opponent", "random"),
            "matches": int(body.get("matches", 100)),
            "num_envs": int(body.get("num_envs", 16)),
            "device": body.get("device", "cpu"),
            "matrix": bool(body.get("matrix")),
            "frame_stack": int(body.get("frame_stack", 0) or 0),
            "league_snapshots": body.get("league_snapshots") or [],
        }
        return EVALER.start(args, meta=meta)

    def _eval_status(self) -> dict:
        st = EVALER.status()
        st["result"] = None if st["state"] in ("running",) else _parse_eval_result(EVALER)
        lines = EVALER.log_since(0)["lines"]
        st["log"] = lines[-40:]
        completed, total = _parse_eval_progress(lines)
        st["completed"] = completed
        st["total"] = total
        progress = eta = None
        if total and completed is not None:
            progress = max(0.0, min(1.0, completed / float(total)))
            elapsed = st.get("elapsed")
            if elapsed and 0 < completed < total:
                eta = elapsed * (total - completed) / completed
        st["progress"] = progress
        st["eta"] = eta
        _record_eval_if_new(st)
        return st


def serve(host: str = "127.0.0.1", port: int = 8770, open_browser: bool = True) -> None:
    httpd = ThreadingHTTPServer((host, port), Handler)
    url = f"http://{host}:{port}/"
    print("=" * 64)
    print("  iBrawls RL — Control Board")
    print(f"  Open:  {url}")
    print(f"  Project dir: {PROJECT_DIR}")
    print("  Press Ctrl+C to stop the board (training keeps its own process).")
    print("=" * 64)
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[board] shutting down")
    finally:
        httpd.server_close()
