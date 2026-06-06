"""Beginner entry point: edit config.toml, then run

    python -m ibrawls_rl.train                 # uses ./config.toml
    python -m ibrawls_rl.train my_config.toml  # or a specific file

Everything is controlled by the config file — no flags to remember. Watch progress with
    tensorboard --logdir runs
"""
from __future__ import annotations

import sys

from .config import load_config
from .train_ppo import run_training


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else "config.toml"
    cfg = load_config(path)
    print(f"[train] loaded {path} -> opponent={cfg.opponent}, steps={cfg.total_steps}, "
          f"logdir={cfg.logdir}")
    saved = run_training(cfg)
    print(f"[train] done. model saved to {saved}")


if __name__ == "__main__":
    main()
