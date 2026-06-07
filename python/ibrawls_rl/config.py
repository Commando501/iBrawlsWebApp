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
    # Warm-start: continue from a previous stage's model (the curriculum's weight transfer).
    # Must use the SAME width/depth. Empty = train from scratch.
    init_model: str = ""              # e.g. "runs/s1_random/final_model.zip"

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
    reward_approach: float = 0.03     # per metre closing on the objective (ball / nearest enemy)
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
    "init_model": "Warm-start from a saved model (curriculum transfer). Same width/depth required. Empty = from scratch.",
    "randomize_enabled": "Jitter game mechanics each episode so the brain stays robust to live balance patches.",
    "randomize_pct": "How far mechanics are jittered (0.15 = +/-15%). Bigger = more robust but harder to learn.",
    "reward_win": "Payout for winning the match.",
    "reward_goal_scored": "Payout per goal scored.",
    "reward_goal_conceded": "Penalty per goal conceded.",
    "reward_possession": "Payout per TICK holding the ball. Accumulates over thousands of ticks - keep small or it dominates winning.",
    "reward_ball_progress": "Payout per metre the ball advances toward the enemy goal.",
    "reward_kill": "Payout per kill.",
    "reward_death": "Penalty per death.",
    "reward_approach": "Payout per metre closing on the objective (free ball / nearest enemy). The exploration foothold that gets a fresh brain moving toward the action.",
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
    ("network", "init_model"): "init_model",
    ("randomize", "enabled"): "randomize_enabled",
    ("randomize", "pct"): "randomize_pct",
    ("reward", "win"): "reward_win",
    ("reward", "goal_scored"): "reward_goal_scored",
    ("reward", "goal_conceded"): "reward_goal_conceded",
    ("reward", "possession"): "reward_possession",
    ("reward", "ball_progress"): "reward_ball_progress",
    ("reward", "kill"): "reward_kill",
    ("reward", "death"): "reward_death",
    ("reward", "approach"): "reward_approach",
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
        "approach": cfg.reward_approach,
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


# ----------------------------------------------------------------------------
# UI schema + TOML writer — single source of truth shared by the dashboard and
# the CLI. The dashboard renders a form from `config_schema()`; saving a config
# round-trips through `dump_toml()` so a file edited in the browser is identical
# to one a human could have written by hand.
# ----------------------------------------------------------------------------

# Order + friendly titles for the grouped form. Mirrors the TOML sections.
SECTION_ORDER = ["run", "combat", "ppo", "network", "randomize", "reward", "logging"]
SECTION_TITLES = {
    "run": "Run",
    "combat": "Combat (deathmatch generalist)",
    "ppo": "Learning algorithm (PPO)",
    "network": "Network (the brain)",
    "randomize": "Domain randomization",
    "reward": "Rewards (what the agent is paid for)",
    "logging": "Logging & output",
}

# Fields that are a pick-one choice rather than a free value.
_FIELD_CHOICES: dict[str, list[str]] = {
    "mode": ["grifball", "combat"],
    "opponent": ["random", "self", "heuristic"],
    "device": ["auto", "cpu", "cuda"],
}

# Optional (min, max, step) hints for number inputs — purely to make the form
# nicer; values are never clamped to these.
_FIELD_RANGES: dict[str, tuple[float, float, float]] = {
    "learning_rate": (1e-5, 1e-2, 1e-5),
    "entropy_coef": (0.0, 0.1, 0.005),
    "gamma": (0.9, 0.9999, 0.001),
    "gae_lambda": (0.8, 1.0, 0.01),
    "clip_range": (0.05, 0.5, 0.05),
    "value_coef": (0.1, 1.0, 0.05),
    "randomize_pct": (0.0, 0.5, 0.05),
}


def _infer_type(field: str, value) -> str:
    if field in _FIELD_CHOICES:
        return "choice"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, list):
        return "intlist"
    return "str"


def _section_for(field: str) -> str:
    for (section, _key), f in _TOML_MAP.items():
        if f == field:
            return section
    return "run"


def _toml_key_for(field: str) -> str:
    for (_section, key), f in _TOML_MAP.items():
        if f == field:
            return key
    return field


def config_schema() -> list[dict]:
    """Structured description of every knob, grouped by section, for the UI form.

    Returns a list of {section, title, knobs:[{field, key, label, type, default,
    description, choices?, min?, max?, step?}]} in display order.
    """
    defaults = asdict(TrainConfig())
    # field -> (toml key) grouped by section, preserving _TOML_MAP order.
    by_section: dict[str, list[tuple[str, str]]] = {}
    for (section, key), field in _TOML_MAP.items():
        by_section.setdefault(section, []).append((key, field))

    out: list[dict] = []
    for section in SECTION_ORDER:
        knobs = []
        for key, field in by_section.get(section, []):
            value = defaults[field]
            ktype = _infer_type(field, value)
            knob = {
                "field": field,
                "key": key,
                "label": key.replace("_", " "),
                "type": ktype,
                "default": value,
                "description": KNOB_DESCRIPTIONS.get(field, ""),
            }
            if ktype == "choice":
                knob["choices"] = _FIELD_CHOICES[field]
            if field in _FIELD_RANGES:
                lo, hi, step = _FIELD_RANGES[field]
                knob.update(min=lo, max=hi, step=step)
            knobs.append(knob)
        if knobs:
            out.append({"section": section, "title": SECTION_TITLES.get(section, section), "knobs": knobs})
    return out


def coerce_value(field: str, raw):
    """Coerce a value coming from JSON/the form into the dataclass field's type."""
    default = getattr(TrainConfig(), field)
    if isinstance(default, bool):
        if isinstance(raw, str):
            return raw.strip().lower() in ("1", "true", "yes", "on")
        return bool(raw)
    if isinstance(default, int):
        return int(float(raw))
    if isinstance(default, float):
        return float(raw)
    if isinstance(default, list):
        if isinstance(raw, str):
            return [int(float(x)) for x in raw.replace(",", " ").split() if x.strip()]
        return [int(float(x)) for x in raw]
    return str(raw)


def config_from_values(values: dict) -> TrainConfig:
    """Build a TrainConfig from a {field: value} dict (unknown fields ignored)."""
    cfg = TrainConfig()
    valid = set(asdict(cfg).keys())
    for field, raw in values.items():
        if field in valid:
            setattr(cfg, field, coerce_value(field, raw))
    return cfg


def _toml_val(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, str):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
    if isinstance(v, list):
        return "[" + ", ".join(str(int(x)) for x in v) + "]"
    if isinstance(v, float):
        return repr(v)
    return str(v)


def dump_toml(cfg: TrainConfig) -> str:
    """Serialize a TrainConfig back to grouped TOML (what config.toml looks like)."""
    by_section: dict[str, list[tuple[str, str]]] = {}
    for (section, key), field in _TOML_MAP.items():
        by_section.setdefault(section, []).append((key, field))

    lines = [
        "# ============================================================================",
        "#  iBrawls RL config. Written by the control board (python -m ibrawls_rl.dashboard).",
        "#  Safe to hand-edit; every field's meaning is shown in the dashboard form.",
        "# ============================================================================",
        "",
    ]
    for section in SECTION_ORDER:
        rows = by_section.get(section)
        if not rows:
            continue
        lines.append(f"[{section}]")
        for key, field in rows:
            lines.append(f"{key} = {_toml_val(getattr(cfg, field))}")
        lines.append("")
    return "\n".join(lines)


def save_config(cfg: TrainConfig, path: str) -> None:
    """Write a TrainConfig to a TOML file."""
    with open(path, "w", encoding="utf-8") as f:
        f.write(dump_toml(cfg))
