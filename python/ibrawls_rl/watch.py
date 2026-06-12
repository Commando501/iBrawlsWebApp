"""Record one watchable match: a saved model plays, every decision's world state is
snapshotted, and the trajectory is written as JSON for the dashboard's Watch tab.

    python -m ibrawls_rl.watch runs/combat3_humanlike_v3/final_model.zip
    python -m ibrawls_rl.watch <model> --world-size 4 --kill-target 10 --opponent random

The decision interval and frame stack are read from the model's run folder
(config_used.toml) so the brain plays at the cadence it was trained at. One world
runs; `self` = every slot is the model (FFA), `random` = odd slots act randomly.
Progress lines `[watch] n/N` feed the control board's progress bar.
"""
from __future__ import annotations

import argparse
import json
import os
import time

import numpy as np
from stable_baselines3 import PPO

from .envs.grifball_vec_env import GrifballVecEnv
from .eval import _maybe_frame_stack
from .evaluate import resolve_decision_interval, resolve_frame_stack

WATCH_DIR = os.path.join("runs", "_watch")


def record_match(
    model,
    world_size: int = 4,
    kill_target: int = 10,
    opponent: str = "self",
    decision_interval: int = 5,
    frame_stack: int = 1,
    max_minutes: float = 3.0,
    seed: int | None = None,
    deterministic: bool = False,
    progress_every: int = 0,
) -> dict:
    """Play one match and return {meta, frames: [snapshot, ...], outcome}."""
    base = GrifballVecEnv(
        mode="combat",
        combat_world_sizes=[world_size],
        combat_kill_range=(kill_target, kill_target),
        combat_randomize_layout=False,
        max_ticks=int(60 * 60 * max_minutes),
        decision_interval=decision_interval,
        base_seed=seed if seed is not None else int(time.time()) % 1_000_000,
    )
    env = _maybe_frame_stack(base, frame_stack)
    random_idx = np.arange(1, base.num_envs, 2) if opponent == "random" else np.arange(0)

    max_decisions = int(60 * 60 * max_minutes) // max(1, decision_interval) + 2
    frames: list[dict] = []
    outcome: dict = {"ended": False, "winner": None}
    next_mark = progress_every
    try:
        obs = env.reset()
        frames.append(base.get_state(0))
        for n in range(max_decisions):
            action, _ = model.predict(obs, deterministic=deterministic)
            action = np.asarray(action, dtype=np.int32)
            for j in random_idx:
                action[j] = env.action_space.sample()
            obs, reward, done, _infos = env.step(action)
            if done.any():
                # The env auto-reset; the last recorded frame is the final state we have.
                outcome = {
                    "ended": True,
                    "decisions": n + 1,
                    # Winner from the per-slot terminal rewards (decisive win pays +win).
                    "winner_slot": int(np.argmax(reward)),
                    "truncated": bool(float(np.max(reward)) < 0.5),
                }
                break
            frames.append(base.get_state(0))
            if progress_every and n >= next_mark:
                print(f"[watch] {n}/{max_decisions}", flush=True)
                next_mark += progress_every
    finally:
        env.close()

    return {
        "meta": {
            "world_size": world_size,
            "kill_target": kill_target,
            "opponent": opponent,
            "decision_interval": decision_interval,
            "frame_stack": frame_stack,
            "seconds_per_frame": decision_interval / 60.0,
            "recorded": time.strftime("%Y-%m-%dT%H:%M:%S"),
        },
        "outcome": outcome,
        "frames": frames,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Record a watchable match from a saved model.")
    ap.add_argument("model", help="path to a saved model .zip")
    ap.add_argument("--world-size", type=int, default=4)
    ap.add_argument("--kill-target", type=int, default=10)
    ap.add_argument("--opponent", default="self", choices=["self", "random"])
    ap.add_argument("--max-minutes", type=float, default=3.0)
    ap.add_argument("--decision-interval", type=int, default=0, help="0 = auto from the run")
    ap.add_argument("--frame-stack", type=int, default=0, help="0 = auto from the run")
    ap.add_argument("--seed", type=int, default=-1, help="-1 = random each time")
    ap.add_argument("--deterministic", action="store_true",
                    help="argmax actions (default: sampled — livelier, more human)")
    ap.add_argument("--out", default=os.path.join(WATCH_DIR, "latest.json"))
    args = ap.parse_args()

    interval = args.decision_interval or resolve_decision_interval(args.model)
    frame_stack = args.frame_stack or resolve_frame_stack(args.model)
    print(f"[watch] loading {args.model} (interval {interval}, stack {frame_stack})", flush=True)
    model = PPO.load(args.model, device="cpu")

    max_decisions = int(60 * 60 * args.max_minutes) // max(1, interval)
    traj = record_match(
        model,
        world_size=args.world_size,
        kill_target=args.kill_target,
        opponent=args.opponent,
        decision_interval=interval,
        frame_stack=frame_stack,
        max_minutes=args.max_minutes,
        seed=None if args.seed < 0 else args.seed,
        deterministic=args.deterministic,
        progress_every=max(1, max_decisions // 20),
    )
    traj["meta"]["model"] = args.model

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(traj, f)
    print(f"[watch] wrote {args.out} ({len(traj['frames'])} frames, "
          f"ended={traj['outcome'].get('ended')})", flush=True)


if __name__ == "__main__":
    main()
