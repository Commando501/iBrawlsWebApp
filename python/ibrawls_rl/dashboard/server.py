"""HTTP server for the RL control board (stdlib only).

Serves a single-page app plus a small JSON API: edit/save config, start/stop
training, tail logs, stream metrics for live charts, browse runs, and grade models.
"""
from __future__ import annotations

import json
import os
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
from . import metrics as metricsmod
from .paths import CONFIG_PATH, STATIC_DIR, PROJECT_DIR, safe_run_path
from .procman import ManagedProcess

TRAINER = ManagedProcess("train")
EVALER = ManagedProcess("eval")

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
        if mode == "combat":
            args += ["--kill-target", str(int(body.get("kill_target", 10)))]
        else:
            args += ["--opponent", body.get("opponent", "random"),
                     "--goal-target", str(int(body.get("goal_target", 3)))]
        return EVALER.start(args, meta={"model": model, "mode": mode})

    def _eval_status(self) -> dict:
        st = EVALER.status()
        st["result"] = None if st["state"] in ("running",) else _parse_eval_result(EVALER)
        st["log"] = EVALER.log_since(0)["lines"][-40:]
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
