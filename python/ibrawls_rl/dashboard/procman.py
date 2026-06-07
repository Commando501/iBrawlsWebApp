"""Manage long-running child processes (training, evaluation) for the dashboard.

A :class:`ManagedProcess` spawns a Python module, streams its combined stdout/stderr
into a ring buffer the UI can tail, and can be stopped cleanly — including the Node
sim children the trainer spawns (killed via the process tree on Windows).
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from collections import deque

from .paths import PROJECT_DIR

_IS_WIN = os.name == "nt"


class ManagedProcess:
    def __init__(self, name: str, max_lines: int = 4000):
        self.name = name
        self._proc: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._lines: deque[str] = deque(maxlen=max_lines)
        self._emitted = 0          # absolute count of lines ever produced
        self._started_at: float | None = None
        self._finished_at: float | None = None
        self._returncode: int | None = None
        self._cmd: list[str] = []
        self._meta: dict = {}

    # -- lifecycle ----------------------------------------------------------
    def is_running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def start(self, args: list[str], meta: dict | None = None) -> dict:
        if self.is_running():
            return {"ok": False, "error": f"{self.name} already running"}
        cmd = [sys.executable, "-u", "-m", *args]
        creationflags = 0
        if _IS_WIN:
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
        with self._lock:
            self._lines.clear()
            self._emitted = 0
        self._cmd = cmd
        self._meta = meta or {}
        self._started_at = time.time()
        self._finished_at = None
        self._returncode = None
        self._proc = subprocess.Popen(
            cmd,
            cwd=PROJECT_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=creationflags,
        )
        threading.Thread(target=self._pump, daemon=True).start()
        return {"ok": True}

    def _pump(self) -> None:
        proc = self._proc
        assert proc is not None and proc.stdout is not None
        for line in proc.stdout:
            with self._lock:
                self._lines.append(line.rstrip("\n"))
                self._emitted += 1
        proc.wait()
        self._returncode = proc.returncode
        self._finished_at = time.time()

    def stop(self) -> dict:
        if not self.is_running():
            return {"ok": False, "error": "not running"}
        proc = self._proc
        assert proc is not None
        try:
            if _IS_WIN:
                # Kill the whole tree so the Node sim children die too.
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                    capture_output=True,
                )
            else:
                proc.terminate()
        except Exception as e:  # pragma: no cover
            return {"ok": False, "error": str(e)}
        return {"ok": True}

    # -- introspection ------------------------------------------------------
    def status(self) -> dict:
        running = self.is_running()
        state = "idle"
        if running:
            state = "running"
        elif self._started_at is not None:
            state = "finished" if (self._returncode in (0, None)) else "error"
        elapsed = None
        if self._started_at is not None:
            end = self._finished_at or time.time()
            elapsed = end - self._started_at
        return {
            "name": self.name,
            "state": state,
            "running": running,
            "pid": self._proc.pid if self._proc else None,
            "returncode": self._returncode,
            "started_at": self._started_at,
            "elapsed": elapsed,
            "cmd": " ".join(self._cmd),
            "meta": self._meta,
        }

    def log_since(self, since: int) -> dict:
        with self._lock:
            total = self._emitted
            have = len(self._lines)
            first_idx = total - have
            start = max(since, first_idx)
            offset = start - first_idx
            lines = list(self._lines)[offset:] if offset < have else []
        return {"lines": lines, "next": total, "first": first_idx}
