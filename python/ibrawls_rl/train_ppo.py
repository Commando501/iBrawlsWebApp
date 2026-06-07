"""PPO training (Stable-Baselines3). Config-driven via :class:`TrainConfig`.

Beginner path: edit ``config.toml`` and run ``python -m ibrawls_rl.train``.
Advanced path: ``python -m ibrawls_rl.train_ppo --opponent random --steps 2000000 ...`` (flags).

Both build a :class:`TrainConfig` and call :func:`run_training`. Every resolved setting is
printed and written to the TensorBoard "TEXT" tab so each run documents itself.
"""
from __future__ import annotations

import argparse
import os
import shutil

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import CheckpointCallback

from .config import TrainConfig, reward_dict, settings_markdown, randomize_spec
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
            # Grade self-play vs random (an interpretable yardstick that rises as skill grows);
            # the heuristic is a near-shutout, so it's only used as the yardstick when you're
            # actually training against it.
            self.opponent = "random" if opponent == "self" else opponent
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


def _log_settings(cfg: TrainConfig) -> None:
    """Print the labeled settings table and write it to the TB TEXT tab + a file."""
    table = settings_markdown(cfg)
    print("\n===== run settings =====")
    print(table)
    print("========================\n")
    try:
        from torch.utils.tensorboard import SummaryWriter
        w = SummaryWriter(log_dir=cfg.logdir)
        w.add_text("settings", table.replace("\n", "  \n"))  # markdown linebreaks
        w.close()
    except Exception:
        pass
    with open(os.path.join(cfg.logdir, "settings.md"), "w", encoding="utf-8") as f:
        f.write(table + "\n")


def run_training(cfg: TrainConfig) -> str:
    """Run one training job from a fully-resolved config. Returns the saved model path."""
    os.makedirs(cfg.logdir, exist_ok=True)

    import torch
    if cfg.device == "cuda" and not torch.cuda.is_available():
        raise SystemExit(
            "device='cuda' but torch.cuda.is_available() is False. The venv has a CPU-only "
            "torch build — install a CUDA build (see python/README.md):\n"
            "  pip install --force-reinstall torch --index-url https://download.pytorch.org/whl/cu124"
        )
    if cfg.device in ("auto", "cuda") and torch.cuda.is_available():
        print(f"[train] CUDA device: {torch.cuda.get_device_name(0)}")

    _log_settings(cfg)
    # Keep a copy of the exact config that produced this run, if it exists.
    if os.path.exists("config.toml"):
        try:
            shutil.copy("config.toml", os.path.join(cfg.logdir, "config_used.toml"))
        except Exception:
            pass

    dr = randomize_spec(cfg)
    if cfg.mode == "combat":
        env = GrifballVecEnv(
            mode="combat",
            reward=reward_dict(cfg),
            base_seed=cfg.seed,
            max_ticks=int(60 * 60 * cfg.match_minutes),
            bootstrap_truncation=cfg.bootstrap_truncation,
            combat_world_sizes=cfg.combat_world_sizes,
            combat_kill_range=(cfg.combat_kill_min, cfg.combat_kill_max),
            combat_randomize_layout=cfg.combat_randomize_layout,
            randomize=dr,
            num_workers=cfg.num_workers,
        )
    else:
        env = GrifballVecEnv(
            num_envs=cfg.parallel_matches,
            opponent=cfg.opponent,
            settings={"grifballGoalTarget": cfg.goal_target},
            reward=reward_dict(cfg),
            base_seed=cfg.seed,
            max_ticks=int(60 * 60 * cfg.match_minutes),
            bootstrap_truncation=cfg.bootstrap_truncation,
            randomize=dr,
            num_workers=cfg.num_workers,
        )

    model = PPO(
        "MlpPolicy",
        env,
        n_steps=cfg.rollout_length,
        batch_size=cfg.batch_size,
        learning_rate=cfg.learning_rate,
        gamma=cfg.gamma,
        gae_lambda=cfg.gae_lambda,
        ent_coef=cfg.entropy_coef,
        vf_coef=cfg.value_coef,
        clip_range=cfg.clip_range,
        seed=cfg.seed,
        policy_kwargs=sb3_policy_kwargs(width=cfg.width, depth=cfg.depth),
        tensorboard_log=cfg.logdir,
        device=cfg.device,
        verbose=1,
    )

    # Warm-start: load a previous stage's weights into this (same-architecture) model so the
    # curriculum actually transfers skill instead of starting each stage from scratch.
    if cfg.init_model:
        if not os.path.exists(cfg.init_model):
            raise SystemExit(f"init_model not found: {cfg.init_model}")
        print(f"[train] warm-starting from {cfg.init_model}")
        try:
            model.set_parameters(cfg.init_model, device=cfg.device)
        except Exception as e:  # usually an architecture mismatch
            raise SystemExit(
                f"failed to load init_model ({e}). The width/depth must match the saved model."
            )

    callbacks = [CheckpointCallback(
        save_freq=max(1, cfg.save_every // cfg.parallel_matches),
        save_path=os.path.join(cfg.logdir, "checkpoints"),
        name_prefix="ppo_grifball",
    )]
    # Grifball gets a win-rate-vs-opponent eval. Combat is self-play (no fixed opponent to
    # grade against mid-run); use `evaluate.py --mode combat` for an on-demand vs-random grade.
    if EvalCallback is not None and cfg.mode != "combat":
        callbacks.append(EvalCallback(cfg.eval_every, cfg.eval_episodes, cfg.opponent))

    saved = os.path.join(cfg.logdir, "final_model")
    try:
        model.learn(total_timesteps=cfg.total_steps, callback=callbacks, progress_bar=True)
        model.save(saved)
    finally:
        env.close()
    return saved + ".zip"


def main() -> None:
    """Advanced flag-based entry point (config.toml is the friendly path)."""
    d = TrainConfig()
    ap = argparse.ArgumentParser(description="PPO trainer (flags override TrainConfig defaults).")
    ap.add_argument("--opponent", default=d.opponent, choices=["random", "self", "heuristic"])
    ap.add_argument("--steps", type=int, default=d.total_steps, dest="total_steps")
    ap.add_argument("--num-envs", type=int, default=d.parallel_matches, dest="parallel_matches")
    ap.add_argument("--goal-target", type=int, default=d.goal_target)
    ap.add_argument("--n-steps", type=int, default=d.rollout_length, dest="rollout_length")
    ap.add_argument("--batch-size", type=int, default=d.batch_size)
    ap.add_argument("--lr", type=float, default=d.learning_rate, dest="learning_rate")
    ap.add_argument("--device", default=d.device, choices=["auto", "cpu", "cuda"])
    ap.add_argument("--policy-width", type=int, default=d.width, dest="width")
    ap.add_argument("--policy-depth", type=int, default=d.depth, dest="depth")
    ap.add_argument("--bootstrap-truncation", action="store_true", default=d.bootstrap_truncation)
    ap.add_argument("--logdir", default=d.logdir)
    ap.add_argument("--eval-every", type=int, default=d.eval_every)
    ap.add_argument("--eval-episodes", type=int, default=d.eval_episodes)
    args = ap.parse_args()

    cfg = TrainConfig(**{**d.__dict__, **vars(args)})
    run_training(cfg)


if __name__ == "__main__":
    main()
