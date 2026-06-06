"""Single, friendly control surface for training.

Everything you can dial is one field here with a plain-English description. `config.toml`
sets these values; `load_config` reads that file; `settings_markdown` renders the whole set
(value + what it does) into the run's console output and the TensorBoard "TEXT" tab, so every
run is self-documenting.
"""
from __future__ import annotations

import os
import tomllib
from dataclasses import asdict, dataclass, field


@dataclass
class TrainConfig:
    # --- run ---
    mode: str = "grifball"            # "grifball" | "combat" (deathmatch generalist)
    opponent: str = "random"          # grifball only: "random" | "self" | "heuristic"
    total_steps: int = 3_000_000      # how long to train (env steps)
    parallel_matches: int = 32        # grifball: matches at once (combat uses [combat].world_sizes)
    num_workers: int = 1              # parallel Node sim processes (set to ~CPU cores to feed a GPU)
    goal_target: int = 3              # grifball: goals needed to win a match
    match_minutes: float = 6.0        # safety cap on match length (sim-minutes)
    device: str = "auto"              # auto | cpu | cuda
    seed: int = 1                     # base RNG seed (reproducibility)

    # --- combat (deathmatch) generalist; ignored when mode = "grifball" ---
    combat_world_sizes: list[int] = field(default_factory=lambda: [2, 2, 2, 2, 4, 4, 8])
    combat_kill_min: int = 10         # per-episode kill target sampled in [min, max]
    combat_kill_max: int = 25
    combat_randomize_layout: bool = True  # randomize team partition + kill target each episode

    # --- ppo (the learning algorithm) ---
    learning_rate: float = 3e-4       # how big a step the brain takes per update
    rollout_length: int = 128         # steps gathered per env before each update (n_steps)
    batch_size: int = 4096            # samples per gradient minibatch (must divide the buffer)
    gamma: float = 0.997              # far-sightedness (closer to 1 = values distant rewards)
    gae_lambda: float = 0.95          # advantage smoothing (bias/variance tradeoff)
    entropy_coef: float = 0.01        # exploration pressure (higher = stays random longer)
    value_coef: float = 0.5           # weight of the value-prediction loss
    clip_range: float = 0.2           # PPO trust region (how far policy may move per update)

    # --- network (the brain) ---
    width: int = 256                  # neurons per hidden layer (bigger = more capacity, needs GPU)
    depth: int = 2                    # number of hidden layers

    # --- domain randomization (robustness to live balance tweaks) ---
    randomize_enabled: bool = False   # jitter the dynamics settings each episode
    randomize_pct: float = 0.15       # +/- fraction each tunable is jittered by

    # --- reward (what the agent is paid for; see GUIDE.md) ---
    reward_win: float = 1.0           # winning the match (terminal)
    reward_goal_scored: float = 1.0   # each goal your team scores
    reward_goal_conceded: float = 1.0 # each goal the enemy scores (subtracted)
    reward_possession: float = 0.002  # per TICK your team holds the ball (accumulates fast!)
    reward_ball_progress: float = 0.01  # per metre the ball moves toward the enemy goal
    reward_kill: float = 0.1          # each enemy your team kills
    reward_death: float = 0.1         # each of your team's deaths (subtracted)
    reward_time_penalty: float = 0.0005  # tiny per-tick nudge to stop stalling
    bootstrap_truncation: bool = False   # value-bootstrap timeouts (usually leave off)

    # --- logging / output ---
    logdir: str = "runs/run1"         # where TensorBoard logs + checkpoints + model go
    save_every: int = 200_000         # save a checkpoint every N steps
    eval_every: int = 100_000         # grade the policy every N steps
    eval_episodes: int = 24           # matches per grade


# Plain-English descriptions for the self-documenting settings table.
KNOB_DESCRIPTIONS: dict[str, str] = {
    "mode": "'grifball' (carry the ball to score) or 'combat' (deathmatch; trains one generalist over 1v1/FFA/team via [combat]).",
    "combat_world_sizes": "Combat only: fixed sizes of the parallel matches. 2 = a 1v1; 4/8 = FFA or teams. The mix is what makes one model generalize.",
    "combat_kill_min": "Combat only: lower bound of the per-episode kill target.",
    "combat_kill_max": "Combat only: upper bound of the per-episode kill target.",
    "combat_randomize_layout": "Combat only: re-randomize team partition + kill target each episode (keep on for a generalist).",
    "opponent": "Grifball only: 'random' (easy, start here), 'self' (plays copies of itself), 'heuristic' (the strong scripted bot). Combat always self-plays.",
    "total_steps": "Total training experience. ~1-3M to beat random; 10M+ for self-play/heuristic.",
    "parallel_matches": "How many matches run simultaneously. Bigger = smoother learning, more CPU/RAM.",
    "num_workers": "Parallel sim processes across CPU cores. Raise toward your core count to feed a GPU a big batch.",
    "goal_target": "Goals to win a match.",
    "match_minutes": "Hard cap on match length so stalemates end.",
    "device": "Where the brain runs. 'auto' uses the GPU if available; small brains are fine on 'cpu'.",
    "seed": "Random seed; same seed = reproducible run.",
    "learning_rate": "Step size of each brain update. Too high = unstable; too low = slow. Try 1e-4..5e-4.",
    "rollout_length": "Experience gathered per match before each update.",
    "batch_size": "Minibatch size for the update. Must divide parallel_matches x learners x rollout_length.",
    "gamma": "Far-sightedness. High (0.997) because winning is many ticks away.",
    "gae_lambda": "Smoothing of the 'how good was that?' estimate.",
    "entropy_coef": "Exploration. Raise (0.02-0.05) if it gives up exploring too soon; lower if too random late.",
    "value_coef": "How hard it also learns to predict future reward.",
    "clip_range": "Safety limit on how much the policy changes per update.",
    "width": "Neurons per layer. Bigger brain = more skill ceiling, but slower (use the GPU).",
    "depth": "Hidden layers. 2-3 is plenty here.",
    "randomize_enabled": "Jitter game mechanics each episode so the brain stays robust to live balance patches.",
    "randomize_pct": "How far mechanics are jittered (0.15 = +/-15%). Bigger = more robust but harder to learn.",
    "reward_win": "Payout for winning the match.",
    "reward_goal_scored": "Payout per goal scored.",
    "reward_goal_conceded": "Penalty per goal conceded.",
    "reward_possession": "Payout per TICK holding the ball. Accumulates over thousands of ticks - keep small or it dominates winning.",
    "reward_ball_progress": "Payout per metre the ball advances toward the enemy goal.",
    "reward_kill": "Payout per kill.",
    "reward_death": "Penalty per death.",
    "reward_time_penalty": "Small per-tick cost to discourage stalling.",
    "bootstrap_truncation": "Treat timeouts as 'to be continued' (value bootstrap). Usually OFF for this win-focused task.",
    "logdir": "Folder for this run's logs, checkpoints, and final model.",
    "save_every": "Checkpoint frequency (steps).",
    "eval_every": "How often to grade the policy (steps).",
    "eval_episodes": "Matches per grade.",
}


# Maps TOML [section].key -> dataclass field. Keeps the file readable while the code stays flat.
_TOML_MAP = {
    ("run", "mode"): "mode",
    ("run", "opponent"): "opponent",
    ("run", "total_steps"): "total_steps",
    ("combat", "world_sizes"): "combat_world_sizes",
    ("combat", "kill_min"): "combat_kill_min",
    ("combat", "kill_max"): "combat_kill_max",
    ("combat", "randomize_layout"): "combat_randomize_layout",
    ("run", "parallel_matches"): "parallel_matches",
    ("run", "num_workers"): "num_workers",
    ("run", "goal_target"): "goal_target",
    ("run", "match_minutes"): "match_minutes",
    ("run", "device"): "device",
    ("run", "seed"): "seed",
    ("ppo", "learning_rate"): "learning_rate",
    ("ppo", "rollout_length"): "rollout_length",
    ("ppo", "batch_size"): "batch_size",
    ("ppo", "gamma"): "gamma",
    ("ppo", "gae_lambda"): "gae_lambda",
    ("ppo", "entropy_coef"): "entropy_coef",
    ("ppo", "value_coef"): "value_coef",
    ("ppo", "clip_range"): "clip_range",
    ("network", "width"): "width",
    ("network", "depth"): "depth",
    ("randomize", "enabled"): "randomize_enabled",
    ("randomize", "pct"): "randomize_pct",
    ("reward", "win"): "reward_win",
    ("reward", "goal_scored"): "reward_goal_scored",
    ("reward", "goal_conceded"): "reward_goal_conceded",
    ("reward", "possession"): "reward_possession",
    ("reward", "ball_progress"): "reward_ball_progress",
    ("reward", "kill"): "reward_kill",
    ("reward", "death"): "reward_death",
    ("reward", "time_penalty"): "reward_time_penalty",
    ("reward", "bootstrap_truncation"): "bootstrap_truncation",
    ("logging", "dir"): "logdir",
    ("logging", "save_every"): "save_every",
    ("logging", "eval_every"): "eval_every",
    ("logging", "eval_episodes"): "eval_episodes",
}


def load_config(path: str) -> TrainConfig:
    """Read a config.toml into a TrainConfig (unset fields keep their defaults)."""
    if not os.path.exists(path):
        raise SystemExit(f"config file not found: {path}\nCopy python/config.toml and edit it.")
    with open(path, "rb") as f:
        data = tomllib.load(f)
    cfg = TrainConfig()
    for (section, key), field in _TOML_MAP.items():
        if section in data and key in data[section]:
            setattr(cfg, field, data[section][key])
    return cfg


def reward_dict(cfg: TrainConfig) -> dict:
    """The reward weights in the names the TS engine expects."""
    return {
        "win": cfg.reward_win,
        "goalScored": cfg.reward_goal_scored,
        "goalConceded": cfg.reward_goal_conceded,
        "possession": cfg.reward_possession,
        "ballProgress": cfg.reward_ball_progress,
        "kill": cfg.reward_kill,
        "death": cfg.reward_death,
        "timePenalty": cfg.reward_time_penalty,
    }


def randomize_spec(cfg: TrainConfig) -> dict:
    """The domain-randomization spec in the shape the TS vec-env expects."""
    return {"enabled": bool(cfg.randomize_enabled), "pct": float(cfg.randomize_pct)}


def settings_markdown(cfg: TrainConfig) -> str:
    """A labeled table of every setting + what it does (for console + TensorBoard TEXT tab)."""
    rows = ["| setting | value | what it does |", "|---|---|---|"]
    for field, value in asdict(cfg).items():
        desc = KNOB_DESCRIPTIONS.get(field, "")
        rows.append(f"| {field} | {value} | {desc} |")
    return "\n".join(rows)
