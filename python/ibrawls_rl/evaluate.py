"""Standalone evaluator: grade a SAVED model over many matches (no training).

    python -m ibrawls_rl.evaluate runs/run1/final_model.zip
    python -m ibrawls_rl.evaluate runs/run1/final_model.zip --opponent heuristic --matches 200

Loads the brain you trained, plays `--matches` games against the chosen opponent, and prints
the win rate and average episodic return. Use this for a rigorous final grade (more matches
than the quick in-training eval) or to compare two checkpoints head-to-head vs the same bot.
"""
from __future__ import annotations

import argparse
import json

from stable_baselines3 import PPO

from .eval import eval_vs, eval_combat_vs_random


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
    ap.add_argument("--json", action="store_true",
                    help="print a single machine-readable JSON line (used by the control board)")
    args = ap.parse_args()

    if not args.json:
        print(f"[eval] loading {args.model} ...")
    model = PPO.load(args.model, device=args.device)

    if args.mode == "combat":
        res = eval_combat_vs_random(
            model, matches=args.matches, num_worlds=args.num_envs, kill_target=args.kill_target,
        )
        if args.json:
            print(json.dumps({"model": args.model, "mode": "combat", "opponent": "random", **res}))
            return
        print(f"\n# {args.model}  combat 1v1 vs random  ({res['episodes']} duels)")
        print(f"  win rate    : {res['win_rate'] * 100:5.1f}%")
        print(f"  loss rate   : {res['loss_rate'] * 100:5.1f}%")
        print(f"  draw rate   : {res['draw_rate'] * 100:5.1f}%")
        return

    res = eval_vs(
        model,
        opponent=args.opponent,
        matches=args.matches,
        num_envs=args.num_envs,
        goal_target=args.goal_target,
        deterministic=True,
    )
    if args.json:
        print(json.dumps({"model": args.model, "mode": "grifball",
                          "opponent": args.opponent, **res}))
        return
    print(f"\n# {args.model}  vs  {args.opponent}  ({res['episodes']} matches)")
    print(f"  win rate    : {res['win_rate'] * 100:5.1f}%")
    print(f"  loss rate   : {res['loss_rate'] * 100:5.1f}%")
    print(f"  draw rate   : {res['draw_rate'] * 100:5.1f}%")
    print(f"  avg return  : {res['ep_return']:+.2f}")


if __name__ == "__main__":
    main()
