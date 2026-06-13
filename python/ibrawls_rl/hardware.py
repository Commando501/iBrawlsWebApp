"""Hardware detection + recommended training settings (stdlib only).

`detect()` reports CPU threads, system RAM, and the NVIDIA GPU (via `nvidia-smi`,
so the dashboard never has to import torch). `recommended_values(hw)` turns that
into a concrete set of TrainConfig field values sized so the CPU-bound sim keeps a
big GPU fed: ~3 worlds per worker, a worker per spare thread, frame-skip 5, and a
rollout buffer that divides cleanly into large minibatches.
"""
from __future__ import annotations

import ctypes
import os
import shutil
import subprocess
from dataclasses import asdict, dataclass


@dataclass
class HardwareInfo:
    cpus: int                 # logical processors (threads)
    ram_gb: float | None      # total system RAM
    gpu_name: str | None      # e.g. "NVIDIA GeForce RTX 4090"
    gpu_vram_gb: float | None


def _detect_ram_gb() -> float | None:
    if os.name == "nt":
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]
        try:
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))  # type: ignore[attr-defined]
            return round(stat.ullTotalPhys / (1024 ** 3), 1)
        except Exception:
            return None
    try:
        pages = os.sysconf("SC_PHYS_PAGES")
        page_size = os.sysconf("SC_PAGE_SIZE")
        return round(pages * page_size / (1024 ** 3), 1)
    except (ValueError, OSError, AttributeError):
        return None


def _detect_gpu() -> tuple[str | None, float | None]:
    if not shutil.which("nvidia-smi"):
        return None, None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        )
        line = (out.stdout or "").strip().splitlines()
        if not line:
            return None, None
        name, _, mem = line[0].partition(",")
        return name.strip() or None, round(float(mem.strip()) / 1024, 1)
    except Exception:
        return None, None


def detect() -> HardwareInfo:
    name, vram = _detect_gpu()
    return HardwareInfo(
        cpus=os.cpu_count() or 4,
        ram_gb=_detect_ram_gb(),
        gpu_name=name,
        gpu_vram_gb=vram,
    )


def _largest_pow2_at_most(n: int) -> int:
    p = 1
    while p * 2 <= n:
        p *= 2
    return p


def recommended_values(hw: HardwareInfo | None = None) -> dict:
    """Recommended TrainConfig field values for this machine (combat focus).

    Sizing logic:
    - The sim is the bottleneck, so workers ≈ CPU threads − 4 (learner + OS keep the rest).
    - ~3 worlds per worker, 1v1-heavy (cleaner early signal) with 4s/8s for generalization.
    - decision_interval 5 → 12 decisions/sec: human reaction cadence AND ~5x throughput.
    - Buffer = rollout_length × total agents; batch = a power of two near buffer/4 so the
      GPU sees a few large minibatches; fewer epochs because the buffer is huge.
    """
    hw = hw or detect()
    has_gpu = bool(hw.gpu_name)
    workers = max(2, min(14, hw.cpus - 4))

    # 1v1-heavy world mix, ~3 worlds per worker.
    twos = workers * 2
    fours = workers
    eights = max(1, workers // 3)
    world_sizes = [2] * twos + [4] * fours + [8] * eights
    agents = 2 * twos + 4 * fours + 8 * eights

    rollout = 256
    buffer = rollout * agents
    batch = _largest_pow2_at_most(max(256, buffer // 4))

    return {
        "mode": "combat",
        "num_workers": workers,
        "combat_world_sizes": world_sizes,
        "combat_layout_mix": ["1v1x16", "1v2x6", "1v3x6", "1v7x2", "ffa4x6", "ffa8x4"],
        "combat_lone_wolf_reward_scale": 1.35,
        "decision_interval": 5,
        "rollout_length": rollout,
        "batch_size": batch,
        "n_epochs": 4,
        "learning_rate": 3e-4,
        "lr_schedule": "linear",
        "target_kl": 0.03,
        "gamma": 0.99,   # per-DECISION discount; at interval 5 this ≈ 0.998 per sim tick
        "device": "cuda" if has_gpu else "cpu",
        "width": 512 if has_gpu else 256,
        "depth": 3 if has_gpu else 2,
        "eval_every": 2_000_000,
        "eval_episodes": 16,
        "save_every": 2_000_000,
    }


def detect_dict() -> dict:
    hw = detect()
    return {**asdict(hw), "recommended": recommended_values(hw)}
