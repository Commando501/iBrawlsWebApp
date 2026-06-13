"""Standalone evaluator: grade a SAVED model over many matches (no training).

    python -m ibrawls_rl.evaluate runs/run1/final_model.zip
    python -m ibrawls_rl.evaluate runs/run1/final_model.zip --opponent heuristic --matches 200

Loads the brain you trained, plays `--matches` games against the chosen opponent, and prints
the win rate, average episodic return, and behavior (human-likeness) stats. The decision
interval (frame-skip) is read from the model's own run folder (config_used.toml) so a brain
is always graded at the cadence it was trained at — override with --decision-interval.
"""
from __future__ import annotations

import argparse
import json
import os
import tomllib

from stable_baselines3 import PPO

from . import baseline
from .eval import eval_vs, eval_combat_vs_random, eval_combat_matrix, eval_combat_vs_snapshots


def resolve_decision_interval(model_path: str) -> int:
    """Find config_used.toml in the model's run folder (walking up past checkpoints/)."""
    d = os.path.dirname(os.path.abspath(model_path))
    for _ in range(3):
        cand = os.path.join(d, "config_used.toml")
        if os.path.exists(cand):
            try:
                with open(cand, "rb") as f:
                    data = tomllib.load(f)
                return int(data.get("run", {}).get("decision_interval", 1))
            except Exception:
                return 1
        d = os.path.dirname(d)
    return 1


def resolve_frame_stack(model_path: str) -> int:
    """Find network.frame_stack in config_used.toml beside the model, defaulting to off."""
    d = os.path.dirname(os.path.abspath(model_path))
    for _ in range(3):
        cand = os.path.join(d, "config_used.toml")
        if os.path.exists(cand):
            try:
                with open(cand, "rb") as f:
                    data = tomllib.load(f)
                return int(data.get("network", {}).get("frame_stack", 1))
            except Exception:
                return 1
        d = os.path.dirname(d)
    return 1


def resolve_observation_version(model_path: str) -> int:
    """Find network.observation_version in config_used.toml beside the model."""
    d = os.path.dirname(os.path.abspath(model_path))
    for _ in range(3):
        cand = os.path.join(d, "config_used.toml")
        if os.path.exists(cand):
            try:
                with open(cand, "rb") as f:
                    data = tomllib.load(f)
                return int(data.get("network", {}).get("observation_version", 1))
            except Exception:
                return 1
        d = os.path.dirname(d)
    return 1


_BEHAVIOR_LABELS = {
    "idle_frac": ("idle", "no movement input"),
    "move_switch_rate": ("move switches", "direction change rate; high = jittery, low = committed"),
    "action_repeat_rate": ("button repeats", "same button combo on consecutive decisions"),
    "attack_rate": ("attacking", ""),
    "jump_rate": ("jumping", ""),
    "dash_rate": ("dashing", ""),
}


def _print_behavior(res: dict) -> None:
    b = res.get("behavior") or {}
    if not b:
        return
    info = baseline.load_baseline()
    notes = baseline.annotate(b)
    print(f"  behavior (per decision; human bands from {info['source']}):")
    for key, (label, hint) in _BEHAVIOR_LABELS.items():
        if key not in b:
            continue
        note = notes.get(key)
        if note:
            lo, hi = note["band"]
            mark = {"in": "OK", "high": "HIGH", "low": "LOW"}[note["status"]]
            band_txt = f"[human {lo * 100:.0f}-{hi * 100:.0f}%  {mark}]"
        else:
            band_txt = ""
        hint_txt = f"  ({hint})" if hint else ""
        print(f"    {label:<13}: {b[key] * 100:5.1f}%  {band_txt}{hint_txt}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Evaluate a saved PPO model.")
    ap.add_argument("model", help="path to a saved model .zip (e.g. runs/run1/final_model.zip)")
    ap.add_argument("--mode", default="grifball", choices=["grifball", "combat"])
    ap.add_argument("--opponent", default="random", choices=["random", "self", "heuristic"],
                    help="grifball only: who to grade against (the heuristic is a near-shutout)")
    ap.add_argument("--matches", type=int, default=100)
    ap.add_argument("--goal-target", type=int, default=3, help="grifball only")
    ap.add_argument("--kill-target", type=int, default=10, help="combat only")
    ap.add_argument("--num-envs", type=int, default=16)
    ap.add_argument("--device", default="cpu", choices=["auto", "cpu", "cuda"])
    ap.add_argument("--decision-interval", type=int, default=0,
                    help="sim ticks per decision; 0 = auto from the model's config_used.toml")
    ap.add_argument("--frame-stack", type=int, default=0,
                    help="observation frames stacked during training; 0 = auto from config_used.toml")
    ap.add_argument("--observation-version", type=int, default=0,
                    help="observation contract used during training; 0 = auto from config_used.toml")
    ap.add_argument("--matrix", action="store_true",
                    help="combat only: run the standard 1v1/4-player/8-player evaluation matrix")
    ap.add_argument("--league-snapshot", action="append", default=[],
                    help="combat only: frozen opponent model path; may be repeated")
    ap.add_argument("--json", action="store_true",
                    help="print a single machine-readable JSON line (used by the control board)")
    args = ap.parse_args()

    interval = args.decision_interval or resolve_decision_interval(args.model)
    frame_stack = args.frame_stack or resolve_frame_stack(args.model)
    observation_version = args.observation_version or resolve_observation_version(args.model)
    if not args.json:
        print(f"[eval] loading {args.model} ... (decision interval {interval}, frame stack {frame_stack}, obs v{observation_version})")
    model = PPO.load(args.model, device=args.device)

    progress_every = max(1, args.matches // 20)  # ~20 progress lines for the control board's ETA
    if args.mode == "combat":
        if args.matrix:
            res = eval_combat_matrix(
                model, matches=args.matches, num_worlds=args.num_envs,
                progress_every=progress_every, decision_interval=interval,
                frame_stack=frame_stack, snapshot_paths=args.league_snapshot,
                device=args.device, observation_version=observation_version,
            )
            payload = {"model": args.model, "mode": "combat", "opponent": "matrix",
                       "decision_interval": interval, "frame_stack": frame_stack,
                       "observation_version": observation_version, **res}
            if args.json:
                print(json.dumps(payload))
                return
            print(f"\n# {args.model}  combat evaluation matrix")
            for row in res["scenarios"]:
                print(f"  {row['name']:<15} win={row['win_rate'] * 100:5.1f}% "
                      f"(score {row.get('win_score', 0):.2f}; random {row.get('random_baseline', 0) * 100:.1f}%) "
                      f"draw={row['draw_rate'] * 100:5.1f}%")
            s = res["summary"]
            print(f"  mean scenario score  : {s['mean_scenario_win_score']:.3f}")
            print(f"  human-likeness penalty: {s['human_likeness_penalty']:.3f} "
                  f"(bands from {s.get('baseline_source', 'defaults')})")
            print(f"  lone-wolf score      : {s['lone_wolf_score']:.3f}")
            return

        if args.league_snapshot:
            res = eval_combat_vs_snapshots(
                model, snapshot_paths=args.league_snapshot, matches=args.matches,
                num_worlds=args.num_envs, kill_target=args.kill_target,
                progress_every=progress_every, decision_interval=interval,
                frame_stack=frame_stack, device=args.device,
                observation_version=observation_version,
            )
        else:
            res = eval_combat_vs_random(
                model, matches=args.matches, num_worlds=args.num_envs, kill_target=args.kill_target,
                progress_every=progress_every, decision_interval=interval,
                frame_stack=frame_stack,
                observation_version=observation_version,
            )
        if args.json:
            print(json.dumps({"model": args.model, "mode": "combat", "opponent": "random",
                              "decision_interval": interval, "frame_stack": frame_stack,
                              "observation_version": observation_version, **res}))
            return
        print(f"\n# {args.model}  combat 1v1 vs random  ({res['episodes']} duels)")
        print(f"  win rate    : {res['win_rate'] * 100:5.1f}%")
        print(f"  loss rate   : {res['loss_rate'] * 100:5.1f}%")
        print(f"  draw rate   : {res['draw_rate'] * 100:5.1f}%")
        _print_behavior(res)
        return

    res = eval_vs(
        model,
        opponent=args.opponent,
        matches=args.matches,
        num_envs=args.num_envs,
        goal_target=args.goal_target,
        deterministic=True,
        progress_every=progress_every,
        decision_interval=interval,
        frame_stack=frame_stack,
        observation_version=observation_version,
    )
    if args.json:
        print(json.dumps({"model": args.model, "mode": "grifball",
                          "opponent": args.opponent, "decision_interval": interval,
                          "frame_stack": frame_stack,
                          "observation_version": observation_version, **res}))
        return
    print(f"\n# {args.model}  vs  {args.opponent}  ({res['episodes']} matches)")
    print(f"  win rate    : {res['win_rate'] * 100:5.1f}%")
    print(f"  loss rate   : {res['loss_rate'] * 100:5.1f}%")
    print(f"  draw rate   : {res['draw_rate'] * 100:5.1f}%")
    print(f"  avg return  : {res['ep_return']:+.2f}")
    _print_behavior(res)


if __name__ == "__main__":
    main()
