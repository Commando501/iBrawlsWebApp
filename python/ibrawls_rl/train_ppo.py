"""PPO training (Stable-Baselines3). Config-driven via :class:`TrainConfig`.

Beginner path: edit ``config.toml`` and run ``python -m ibrawls_rl.train``.
Advanced path: ``python -m ibrawls_rl.train_ppo --opponent random --steps 2000000 ...`` (flags).

Both build a :class:`TrainConfig` and call :func:`run_training`. Every resolved setting is
printed and written to the TensorBoard "TEXT" tab so each run documents itself.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback, CheckpointCallback
from stable_baselines3.common.logger import KVWriter
from stable_baselines3.common.vec_env import VecFrameStack, VecMonitor

from .checkpoint_compat import CheckpointCompatibilityError, warm_start_sb3_model
from .config import TrainConfig, reward_dict, settings_markdown, randomize_spec
from .envs.grifball_vec_env import GrifballVecEnv
from .eval import eval_vs, eval_combat_vs_random
from .league import ConcatVecEnv, LeagueOpponentVecEnv, LeagueSnapshotCallback, SnapshotPool
from .policies import sb3_policy_kwargs
from .training_metadata import build_training_metadata, merge_mechanics_coverage, write_training_metadata

try:
    from stable_baselines3.common.callbacks import BaseCallback

    class EvalCallback(BaseCallback):
        """Periodic in-training grade + behavior (human-likeness) stats.

        Grifball: win rate vs the configured opponent ('self' is graded vs random — an
        interpretable yardstick that rises as skill grows; the heuristic is a near-shutout,
        so it's only the yardstick when you actually train against it).

        Combat: quick 1v1 duels vs random (kill target 5, 2-minute cap so undertrained
        policies don't stall the run) — gives combat a live eval/win_rate line too.
        """

        def __init__(self, cfg: TrainConfig, verbose: int = 1):
            super().__init__(verbose)
            self.cfg = cfg
            self.every = cfg.eval_every
            self.episodes = cfg.eval_episodes
            self.opponent = "random" if cfg.opponent == "self" else cfg.opponent
            self._last = 0

        def _grade(self) -> dict:
            if self.cfg.mode == "combat":
                return eval_combat_vs_random(
                    self.model, matches=self.episodes,
                    num_worlds=min(16, max(4, self.episodes)),
                    kill_target=5, max_minutes=2.0,
                    decision_interval=self.cfg.decision_interval,
                    frame_stack=self.cfg.frame_stack,
                    observation_version=self.cfg.observation_version,
                )
            return eval_vs(
                self.model, opponent=self.opponent, matches=self.episodes,
                decision_interval=self.cfg.decision_interval,
                frame_stack=self.cfg.frame_stack,
                observation_version=self.cfg.observation_version,
            )

        def _on_step(self) -> bool:
            if self.num_timesteps - self._last >= self.every:
                self._last = self.num_timesteps
                res = self._grade()
                self.logger.record("eval/win_rate", res["win_rate"])
                if "ep_return" in res:
                    self.logger.record("eval/ep_return", res["ep_return"])
                for k, v in (res.get("behavior") or {}).items():
                    self.logger.record(f"behavior/{k}", v)
                if self.verbose:
                    opp = "random 1v1" if self.cfg.mode == "combat" else self.opponent
                    print(f"[eval vs {opp}] t={self.num_timesteps} "
                          f"winrate={res['win_rate']:.2f}")
            return True
except Exception:  # pragma: no cover
    EvalCallback = None  # type: ignore


class JSONLMetricsWriter(KVWriter):
    """Append every SB3 logger dump as one JSON line to ``metrics.jsonl``.

    This is what the control board reads for live charts — no TensorBoard parsing
    on the hot path. Each line is a snapshot of all current scalars plus the step.
    """

    def __init__(self, path: str):
        self.path = path
        self.file = open(path, "a", encoding="utf-8")

    def write(self, key_values, key_excluded, step: int = 0) -> None:  # noqa: ANN001
        rec: dict = {"step": int(step)}
        for k, v in key_values.items():
            if isinstance(v, bool):
                rec[k] = v
            elif isinstance(v, (int, float)):
                rec[k] = v
            else:
                try:
                    rec[k] = float(v)
                except (TypeError, ValueError):
                    continue
        self.file.write(json.dumps(rec) + "\n")
        self.file.flush()

    def close(self) -> None:
        try:
            self.file.close()
        except Exception:
            pass


class JSONLLoggerCallback(BaseCallback):
    """Attach the JSONL writer once SB3 has configured the logger (in learn()).

    Attaching right after ``PPO(...)`` doesn't work: ``learn()`` rebuilds
    ``model.logger`` from ``tensorboard_log``, dropping any earlier additions. We
    add the writer in ``_on_training_start`` (after that rebuild) so it captures
    every dump, then close it at the end.
    """

    def __init__(self, logdir: str):
        super().__init__()
        self.logdir = logdir
        self._writer: JSONLMetricsWriter | None = None

    def _on_training_start(self) -> None:
        try:
            self._writer = JSONLMetricsWriter(os.path.join(self.logdir, "metrics.jsonl"))
            self.logger.output_formats.append(self._writer)
        except Exception:
            self._writer = None

    def _on_step(self) -> bool:
        return True

    def _on_training_end(self) -> None:
        if self._writer is not None:
            self._writer.close()


def _unwrap_env_attr(env, attr: str):  # noqa: ANN001
    current = env
    seen = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if hasattr(current, attr):
            return getattr(current, attr)
        current = getattr(current, "venv", None)
    return None


class RewardComponentLoggerCallback(BaseCallback):
    """Record sim-side reward component aggregates into SB3 metrics."""

    def _on_step(self) -> bool:
        components = _unwrap_env_attr(self.training_env, "last_reward_components")
        if isinstance(components, dict):
            for key, value in components.items():
                self.logger.record(f"reward_component/{key}", float(value))
        return True


class MechanicsCoverageLoggerCallback(BaseCallback):
    """Record sampled mechanics ranges and keep training_metadata.json current."""

    def __init__(self, logdir: str, metadata: dict, write_every: int = 10_000):
        super().__init__()
        self.logdir = logdir
        self.metadata = metadata
        self.write_every = max(1, int(write_every))
        self._last_write = 0

    def _record_rows(self, coverage: dict) -> None:
        mechanics = self.metadata.get("mechanics", {}) if isinstance(self.metadata, dict) else {}
        cumulative = mechanics.get("coverage", {}) if isinstance(mechanics, dict) else {}
        base_values = mechanics.get("base_values", {}) if isinstance(mechanics, dict) else {}
        for key, row in coverage.items():
            if not isinstance(row, dict):
                continue
            count = float(row.get("count", 0.0))
            if count <= 0:
                continue
            total = float(row.get("sum", row.get("mean", 0.0) * count))
            mean = total / max(1.0, count)
            self.logger.record(f"mechanics/{key}/count", count)
            self.logger.record(f"mechanics/{key}/min", float(row.get("min", 0.0)))
            self.logger.record(f"mechanics/{key}/mean", mean)
            self.logger.record(f"mechanics/{key}/max", float(row.get("max", 0.0)))
            if isinstance(base_values, dict) and key in base_values:
                self.logger.record(f"mechanics/{key}/base", float(base_values[key]))
            if isinstance(cumulative, dict) and isinstance(cumulative.get(key), dict):
                cov = cumulative[key]
                if "coverage_low" in cov:
                    self.logger.record(f"mechanics/{key}/coverage_low", float(cov["coverage_low"]))
                if "coverage_high" in cov:
                    self.logger.record(f"mechanics/{key}/coverage_high", float(cov["coverage_high"]))

    def _on_training_start(self) -> None:
        write_training_metadata(self.logdir, self.metadata)

    def _on_step(self) -> bool:
        coverage = _unwrap_env_attr(self.training_env, "last_mechanics_coverage")
        if isinstance(coverage, dict) and coverage:
            merge_mechanics_coverage(self.metadata, coverage)
            self._record_rows(coverage)
            if self.num_timesteps - self._last_write >= self.write_every:
                self._last_write = self.num_timesteps
                write_training_metadata(self.logdir, self.metadata)
        return True

    def _on_training_end(self) -> None:
        write_training_metadata(self.logdir, self.metadata)


def _maybe_stack_env(env: GrifballVecEnv, frame_stack: int):  # noqa: ANN001
    stack = max(1, int(frame_stack or 1))
    if stack <= 1:
        return env
    return VecFrameStack(env, n_stack=stack)


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
    metadata_header: dict = {}
    if cfg.mode == "combat":
        env = GrifballVecEnv(
            mode="combat",
            reward=reward_dict(cfg),
            base_seed=cfg.seed,
            max_ticks=int(60 * 60 * cfg.match_minutes),
            bootstrap_truncation=cfg.bootstrap_truncation,
            combat_world_sizes=cfg.combat_world_sizes,
            combat_layout_mix=cfg.combat_layout_mix,
            combat_lone_wolf_reward_scale=cfg.combat_lone_wolf_reward_scale,
            combat_kill_range=(cfg.combat_kill_min, cfg.combat_kill_max),
            combat_randomize_layout=cfg.combat_randomize_layout,
            randomize=dr,
            num_workers=cfg.num_workers,
            decision_interval=cfg.decision_interval,
            observation_version=cfg.observation_version,
        )
        metadata_header = dict(getattr(env, "header", {}) or {})
        if cfg.combat_bait_layout_mix:
            bait_reward = reward_dict(cfg)
            scale = float(cfg.combat_bait_reward_scale)
            for key in ("dangerApproach", "baitDisengage", "trapDeath"):
                bait_reward[key] = float(bait_reward.get(key, 0.0)) * scale
            bait_env = GrifballVecEnv(
                mode="combat",
                reward=bait_reward,
                base_seed=cfg.seed + 555_001,
                max_ticks=int(60 * 60 * cfg.match_minutes),
                bootstrap_truncation=cfg.bootstrap_truncation,
                combat_layout_mix=cfg.combat_bait_layout_mix,
                combat_lone_wolf_reward_scale=cfg.combat_lone_wolf_reward_scale,
                combat_scripted_opponent=cfg.combat_bait_opponent,
                combat_kill_range=(cfg.combat_kill_min, cfg.combat_kill_max),
                combat_randomize_layout=cfg.combat_randomize_layout,
                randomize=dr,
                num_workers=cfg.num_workers,
                decision_interval=cfg.decision_interval,
                observation_version=cfg.observation_version,
            )
            env = ConcatVecEnv([env, bait_env])
            print(f"[train] anti-bait curriculum: {cfg.combat_bait_layout_mix} "
                  f"vs {cfg.combat_bait_opponent} (reward scale {scale:g})")
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
            decision_interval=cfg.decision_interval,
            observation_version=cfg.observation_version,
        )
        metadata_header = dict(getattr(env, "header", {}) or {})

    # League (combat only): dedicate extra 1v1 worlds to fights vs FROZEN snapshots —
    # the PFSP cure for pure-self-play brittleness. The learner's rows from these
    # worlds are ordinary PPO experience; the frozen side runs inside the wrapper.
    league_cb = None
    if cfg.mode == "combat" and cfg.league_worlds > 0:
        pool = SnapshotPool(latest_bias=cfg.league_latest_bias, device="cpu",
                            seed=cfg.seed)
        for p in cfg.league_snapshots:
            pool.add(p)
        league_base = GrifballVecEnv(
            mode="combat",
            reward=reward_dict(cfg),
            base_seed=cfg.seed + 777_001,
            max_ticks=int(60 * 60 * cfg.match_minutes),
            bootstrap_truncation=cfg.bootstrap_truncation,
            combat_world_sizes=[2] * cfg.league_worlds,
            combat_lone_wolf_reward_scale=cfg.combat_lone_wolf_reward_scale,
            combat_kill_range=(cfg.combat_kill_min, cfg.combat_kill_min),
            combat_randomize_layout=False,  # fixed 1v1 so learner/opponent slots are stable
            randomize=dr,
            num_workers=1,
            decision_interval=cfg.decision_interval,
            observation_version=cfg.observation_version,
        )
        env = ConcatVecEnv([env, LeagueOpponentVecEnv(league_base, pool, seed=cfg.seed)])
        league_cb = LeagueSnapshotCallback(
            pool, cfg.league_snapshot_every, os.path.join(cfg.logdir, "league"))
        print(f"[train] league: {cfg.league_worlds} 1v1 worlds vs frozen snapshots "
              f"(pool seeds: {len(pool)}; auto-freeze every {cfg.league_snapshot_every:,})")

    # VecMonitor emits info["episode"] so SB3 logs rollout/ep_rew_mean & ep_len_mean —
    # the primary learning signals (without it those charts never exist).
    training_metadata = build_training_metadata(cfg, metadata_header)
    write_training_metadata(cfg.logdir, training_metadata)

    env = VecMonitor(env)
    env = _maybe_stack_env(env, cfg.frame_stack)

    # Linear schedule: SB3 calls this with progress_remaining going 1 -> 0.
    lr = cfg.learning_rate
    if cfg.lr_schedule == "linear":
        lr0 = cfg.learning_rate
        lr = lambda progress_remaining: lr0 * progress_remaining  # noqa: E731

    # Warn-and-fix instead of crashing: SB3 wants batch_size <= buffer and ideally a divisor.
    buffer = cfg.rollout_length * env.num_envs
    batch_size = min(cfg.batch_size, buffer)
    if batch_size != cfg.batch_size:
        print(f"[train] batch_size {cfg.batch_size} > rollout buffer {buffer}; using {batch_size}")

    model = PPO(
        "MlpPolicy",
        env,
        n_steps=cfg.rollout_length,
        batch_size=batch_size,
        learning_rate=lr,
        gamma=cfg.gamma,
        gae_lambda=cfg.gae_lambda,
        ent_coef=cfg.entropy_coef,
        vf_coef=cfg.value_coef,
        clip_range=cfg.clip_range,
        n_epochs=cfg.n_epochs,
        max_grad_norm=cfg.max_grad_norm,
        target_kl=cfg.target_kl if cfg.target_kl and cfg.target_kl > 0 else None,
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
            warm_start = warm_start_sb3_model(model, cfg.init_model, device=cfg.device)
            if warm_start.migration is not None:
                m = warm_start.migration
                inserted = ", ".join(
                    f"factor {ins.factor_index}, row {ins.insert_index}"
                    for ins in m.insertions
                )
                print(
                    "[train] migrated init_model action head: "
                    f"nvec {list(m.old_nvec)} -> {list(m.new_nvec)}; "
                    f"inserted logits at {inserted}; "
                    "optimizer state reset"
                )
        except CheckpointCompatibilityError as e:
            raise SystemExit(str(e))

    # save_freq is counted in vec-steps, so divide the desired step interval by the ACTUAL
    # number of sub-envs (env.num_envs). Combat's env count comes from combat_world_sizes, not
    # parallel_matches — using parallel_matches here would set a wrong cadence in combat mode.
    callbacks: list = [
        JSONLLoggerCallback(cfg.logdir),
        RewardComponentLoggerCallback(),
        MechanicsCoverageLoggerCallback(cfg.logdir, training_metadata),
        CheckpointCallback(
            save_freq=max(1, cfg.save_every // max(1, env.num_envs)),
            save_path=os.path.join(cfg.logdir, "checkpoints"),
            name_prefix="ppo_grifball",
        ),
    ]
    # Both modes get a periodic in-training grade (combat duels 1v1 vs random) plus live
    # behavior/human-likeness stats. Set eval_every >= ~1M in combat: each grade spawns a
    # short eval sim, so an over-frequent cadence eats throughput.
    if EvalCallback is not None and cfg.eval_every > 0:
        callbacks.append(EvalCallback(cfg))
    if league_cb is not None:
        callbacks.append(league_cb)

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
