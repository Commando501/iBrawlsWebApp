"""PPO training entry point (Stable-Baselines3 baseline).

Trains a shared policy for the learner team against the sim's built-in heuristic opponent
— the fast path to the plan's learning-signal check (Verification #7): win-rate / goal-diff
vs heuristic should rise on TensorBoard. Checkpoints + a periodic eval callback included.

    python -m ibrawls_rl.train_ppo --num-envs 32 --steps 2000000

The CleanRL self-play variant (frozen-snapshot league via ``selfplay.py``) is the
customizable path for league logic; this SB3 script is the baseline.
"""
from __future__ import annotations

import argparse
import os

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import CheckpointCallback

from .envs.grifball_vec_env import GrifballVecEnv
from .eval import eval_vs
from .policies import sb3_policy_kwargs

try:
    from stable_baselines3.common.callbacks import BaseCallback

    class EvalCallback(BaseCallback):
        def __init__(self, every: int, episodes: int, opponent: str, verbose: int = 1):
            super().__init__(verbose)
            self.every = every
            self.episodes = episodes
            self.opponent = "heuristic" if opponent == "self" else opponent
            self._last = 0

        def _on_step(self) -> bool:
            if self.num_timesteps - self._last >= self.every:
                self._last = self.num_timesteps
                res = eval_vs(self.model, opponent=self.opponent, matches=self.episodes)
                self.logger.record("eval/win_rate", res["win_rate"])
                self.logger.record("eval/ep_return", res["ep_return"])
                if self.verbose:
                    print(f"[eval vs {self.opponent}] t={self.num_timesteps} "
                          f"winrate={res['win_rate']:.2f} ep_return={res['ep_return']:+.3f}")
            return True
except Exception:  # pragma: no cover
    EvalCallback = None  # type: ignore


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--num-envs", type=int, default=32)
    ap.add_argument("--steps", type=int, default=2_000_000)
    ap.add_argument("--n-steps", type=int, default=256, help="rollout length per sub-env")
    ap.add_argument("--batch-size", type=int, default=8192)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--goal-target", type=int, default=3)
    ap.add_argument("--opponent", type=str, default="heuristic",
                    choices=["heuristic", "random", "self"])
    ap.add_argument("--bootstrap-truncation", action="store_true",
                    help="bootstrap value on maxTicks truncations (default off; "
                         "empirically slower for this win-oriented task)")
    ap.add_argument("--logdir", type=str, default="runs/ppo_grifball")
    ap.add_argument("--save-every", type=int, default=200_000)
    ap.add_argument("--eval-every", type=int, default=100_000)
    ap.add_argument("--eval-episodes", type=int, default=20)
    # GPU / network scale. A small MLP is faster on CPU (SB3's own advice); the GPU only
    # pays off with a larger net + big batches, so scale --policy-width/-depth with --device cuda.
    ap.add_argument("--device", type=str, default="auto", choices=["auto", "cpu", "cuda"])
    ap.add_argument("--policy-width", type=int, default=256)
    ap.add_argument("--policy-depth", type=int, default=2)
    args = ap.parse_args()

    os.makedirs(args.logdir, exist_ok=True)

    import torch
    if args.device == "cuda" and not torch.cuda.is_available():
        raise SystemExit(
            "CUDA requested but torch.cuda.is_available() is False. The venv has a CPU-only "
            "torch build — reinstall a CUDA build (see python/README.md), e.g.:\n"
            "  pip install --force-reinstall torch --index-url https://download.pytorch.org/whl/cu124"
        )
    if args.device in ("auto", "cuda") and torch.cuda.is_available():
        print(f"[train] CUDA device: {torch.cuda.get_device_name(0)}")

    env = GrifballVecEnv(
        num_envs=args.num_envs,
        opponent=args.opponent,
        settings={"grifballGoalTarget": args.goal_target},
        max_ticks=60 * 60 * 6,
        bootstrap_truncation=args.bootstrap_truncation,
    )

    model = PPO(
        "MlpPolicy",
        env,
        n_steps=args.n_steps,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        gamma=0.997,
        gae_lambda=0.95,
        ent_coef=0.01,
        vf_coef=0.5,
        clip_range=0.2,
        policy_kwargs=sb3_policy_kwargs(width=args.policy_width, depth=args.policy_depth),
        tensorboard_log=args.logdir,
        device=args.device,
        verbose=1,
    )

    callbacks = [CheckpointCallback(save_freq=max(1, args.save_every // args.num_envs),
                                    save_path=os.path.join(args.logdir, "checkpoints"),
                                    name_prefix="ppo_grifball")]
    if EvalCallback is not None:
        callbacks.append(EvalCallback(args.eval_every, args.eval_episodes, args.opponent))

    try:
        model.learn(total_timesteps=args.steps, callback=callbacks, progress_bar=True)
        model.save(os.path.join(args.logdir, "final_model"))
    finally:
        env.close()


if __name__ == "__main__":
    main()
