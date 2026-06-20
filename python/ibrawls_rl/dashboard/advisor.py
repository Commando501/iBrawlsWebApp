"""Training advisor: a rule engine that reads a run's metrics + config and says
what's wrong, why, and which knob to turn — with concrete values the UI can apply
in one click.

Pure function over data (series + config values + run state) so it's trivially
testable and works identically for live runs and finished ones. Levels:
``good`` (healthy), ``info`` (opportunity), ``warn`` (needs attention),
``bad`` (actively broken). Each finding may carry ``fixes`` — a {field: value}
dict in TrainConfig field names the dashboard merges into config.toml.
"""
from __future__ import annotations

import json
import os
import re
import zipfile
from typing import Any

from ..config import expand_combat_layout_mix

Series = dict[str, list[list[float]]]

_LEVEL_RANK = {"bad": 3, "warn": 2, "info": 1, "good": 0}

# Live env interface — keep in sync with src/sim/env/action.ts (ACTION_NVEC) and
# src/sim/env/observation.ts (OBS_DIM). The advisor compares saved checkpoints
# against these to catch incompatible warm-starts BEFORE a run dies at startup.
EXPECTED_ACTION_NVEC = (9, 4, 4, 2, 2, 2)
EXPECTED_OBS_DIM_BASE_BY_VERSION = {
    1: 140,
    2: 152,
    3: 172,
}
RECOMMENDED_LONE_WOLF_MIX = ["1v1x16", "1v2x6", "1v3x6", "1v7x2", "ffa4x6", "ffa8x4"]


def _inspect_model_zip(path: str) -> dict | None:
    """Read an SB3 model zip's saved spaces without torch: {nvec, obs_dim} or None."""
    try:
        with zipfile.ZipFile(path) as z:
            data = json.loads(z.read("data"))
        nvec = None
        action = data.get("action_space") or {}
        raw = action.get("nvec")
        if isinstance(raw, str):
            nvec = tuple(int(x) for x in re.findall(r"\d+", raw))
        elif isinstance(raw, list):
            nvec = tuple(int(x) for x in raw)
        obs_dim = None
        shape = (data.get("observation_space") or {}).get("_shape")
        if isinstance(shape, list) and len(shape) == 1:
            obs_dim = int(shape[0])
        return {"nvec": nvec, "obs_dim": obs_dim}
    except Exception:
        return None


def _append_only_action_head_migratable(old: tuple[int, ...], new: tuple[int, ...]) -> bool:
    """True when factors only append at most one choice each (checkpoint_compat handles it)."""
    if len(old) != len(new):
        return False
    diffs = [n - o for o, n in zip(old, new) if o != n]
    return bool(diffs) and all(diff == 1 for diff in diffs)


def _obs_dim_base_for_version(version: int) -> int:
    version = max(1, int(version or 1))
    if version >= 3:
        return EXPECTED_OBS_DIM_BASE_BY_VERSION[3]
    if version >= 2:
        return EXPECTED_OBS_DIM_BASE_BY_VERSION[2]
    return EXPECTED_OBS_DIM_BASE_BY_VERSION[1]


def _last(series: Series, key: str) -> float | None:
    pts = series.get(key)
    return pts[-1][1] if pts else None


def _first(series: Series, key: str) -> float | None:
    pts = series.get(key)
    return pts[0][1] if pts else None


def _median_tail(series: Series, key: str, n: int = 10) -> float | None:
    pts = series.get(key)
    if not pts:
        return None
    vals = sorted(v for _s, v in pts[-n:])
    return vals[len(vals) // 2]


def _trend(series: Series, key: str, frac: float = 0.33) -> float | None:
    """Relative change over the last `frac` of the series (+0.10 = up 10%)."""
    pts = series.get(key)
    if not pts or len(pts) < 6:
        return None
    tail = pts[int(len(pts) * (1 - frac)):]
    if len(tail) < 2:
        return None
    first, last = tail[0][1], tail[-1][1]
    return (last - first) / (abs(first) + 1e-9)


def _num(values: dict, field: str, default: float) -> float:
    try:
        v = float(values.get(field, default))
        return v if v == v else default  # NaN guard
    except (TypeError, ValueError):
        return default


def _pow2_at_most(n: int) -> int:
    p = 1
    while p * 2 <= n:
        p *= 2
    return p


def _round(v: float, d: int = 4) -> float:
    return round(v, d)


def advise(
    series: Series,
    values: dict[str, Any],
    *,
    running: bool = False,
    progress: float | None = None,
    cpus: int = 8,
    project_dir: str | None = None,
) -> dict:
    """Produce {verdict: {level, text}, findings: [{level, title, detail, fixes}]}."""
    f: list[dict] = []

    def add(level: str, title: str, detail: str, fixes: dict | None = None) -> None:
        f.append({"level": level, "title": title, "detail": detail, "fixes": fixes or {}})

    mode = str(values.get("mode", "combat"))
    interval = int(_num(values, "decision_interval", 1))
    workers = int(_num(values, "num_workers", 1))
    rollout = int(_num(values, "rollout_length", 128))
    batch = int(_num(values, "batch_size", 4096))
    total_steps = int(_num(values, "total_steps", 3_000_000))
    prog = progress if progress is not None else 0.0

    # ---------- setup lint (config-only; valid before any metrics exist) ----------
    if interval <= 1:
        add("warn", "Deciding at 60Hz (super-human, slow)",
            "decision_interval=1 makes the policy act every sim tick — super-human twitch AND "
            "~5x slower training. 5 (= 12 decisions/sec) is a human reaction cadence and a "
            "direct throughput multiplier.",
            {"decision_interval": 5})

    if workers < max(2, cpus - 5):
        add("info", "CPU cores sitting idle",
            f"num_workers={workers} but this machine has {cpus} threads. The sim is the "
            f"bottleneck — raise workers to ~{cpus - 4} (leave a few threads for the learner "
            "and OS) and widen [combat] world_sizes so each worker has ~3 worlds.",
            {"num_workers": max(2, cpus - 4)})

    if mode == "combat":
        sizes = values.get("combat_world_sizes") or []
        layout_mix = values.get("combat_layout_mix") or []
        if not layout_mix:
            add("info", "No explicit lone-wolf scenario mix",
                "combat_world_sizes can expose 1v1/FFA/team layouts, but it does not guarantee "
                "the direct 1-vs-many reps needed for lone-wolf skill. Add fixed asymmetric "
                "layouts and keep FFA pressure in the same run.",
                {
                    "combat_layout_mix": RECOMMENDED_LONE_WOLF_MIX,
                    "combat_lone_wolf_reward_scale": 1.35,
                })
        try:
            agents = (
                sum(sum(layout) for layout in expand_combat_layout_mix(layout_mix))
                if layout_mix else sum(int(x) for x in sizes)
            )
        except (TypeError, ValueError):
            agents = 0
        if agents:
            buffer = rollout * agents
            if batch > buffer:
                add("bad", "batch_size larger than the rollout buffer",
                    f"buffer = rollout_length × agents = {rollout} × {agents} = {buffer}, but "
                    f"batch_size = {batch}. SB3 will clamp/fail. Use a power of two near "
                    "buffer/4.",
                    {"batch_size": _pow2_at_most(max(256, buffer // 4))})
            elif buffer % batch != 0:
                add("info", "Rollout buffer not a multiple of batch_size",
                    f"buffer {buffer} % batch {batch} ≠ 0 — the last minibatch each epoch is "
                    "ragged. Harmless, but a clean divisor wastes nothing.",
                    {"batch_size": _pow2_at_most(max(256, buffer // 4))})
            if int(_num(values, "n_epochs", 10)) >= 8 and buffer >= 16384:
                add("info", "Many epochs over a huge buffer",
                    "With a big rollout buffer, 10 optimization passes per update over-fit each "
                    "batch and slow the loop. 3–4 epochs is the large-scale PPO sweet spot.",
                    {"n_epochs": 4})
        ee = int(_num(values, "eval_every", 100_000))
        if 0 < ee < 500_000:
            add("warn", "In-training eval too frequent",
                f"eval_every={ee:,} — each combat grade spins up a separate eval sim, and at "
                "high throughput that fires every few seconds of wall time. 2,000,000 keeps the "
                "signal without eating the run.",
                {"eval_every": 2_000_000})

        bait_mix = values.get("combat_bait_layout_mix") or []
        if bait_mix:
            approach = _num(values, "reward_approach", 0.03)
            danger = _num(values, "reward_danger_approach", 0.0)
            bait_scale = _num(values, "combat_bait_reward_scale", 1.0)
            if danger * max(1.0, bait_scale) <= approach:
                add("warn", "Weak anti-bait reward balance",
                    "The learner can still be paid more for closing on a passive ready target "
                    "than it is punished for entering the trap. Harden bait worlds so passive "
                    "spacing is a losing line instead of a profitable approach shortcut.",
                    {
                        "reward_danger_approach": 1.0,
                        "reward_bait_disengage": 0.35,
                        "reward_trap_death": 1.2,
                        "combat_bait_reward_scale": 3.0,
                    })

    if interval >= 4 and _num(values, "gamma", 0.997) >= 0.995:
        add("info", "Discount tuned for 60Hz decisions",
            "gamma is per DECISION, and with frame-skip each decision covers "
            f"{interval} ticks. gamma=0.99 at interval {interval} ≈ the old 0.997-per-tick "
            "horizon; keeping 0.997+ stretches credit over an unnecessarily long horizon and "
            "slows value learning.",
            {"gamma": 0.99})

    if str(values.get("lr_schedule", "constant")) == "constant" and total_steps >= 10_000_000:
        add("info", "Constant learning rate on a long run",
            "Long runs end cleaner with a linear LR decay — big steps early, fine-tuning late. "
            "Set lr_schedule=linear.",
            {"lr_schedule": "linear"})

    if bool(values.get("randomize_enabled")) and not str(values.get("init_model") or "").strip():
        add("info", "Domain randomization from scratch",
            "DR makes the task harder; a fresh brain learns the core skill faster at fixed "
            "mechanics. Usual flow: train clean first, then a warm-started hardening run with "
            "randomize on.", None)

    # ---------- reward sanity: the time penalty must never dominate ----------
    if mode == "combat":
        tp = _num(values, "reward_time_penalty", 0.0005)
        ticks = 3600.0 * max(0.1, _num(values, "match_minutes", 1.5))
        decisive = (_num(values, "reward_win", 1.0)
                    + _num(values, "reward_kill", 0.1) * _num(values, "combat_kill_min", 10))
        total_tp = tp * ticks
        if decisive > 0 and total_tp > decisive:
            suggested = round(max(0.0005, decisive * 0.25 / ticks), 5)
            add("bad" if total_tp > 3 * decisive else "warn",
                "Time penalty dominates the reward",
                f"time_penalty accumulates per TICK: {tp} × {ticks:,.0f} ticks ≈ "
                f"{total_tp:,.0f} per full round, vs only ~{decisive:,.0f} from winning + "
                "hitting the kill target. The return becomes 'end the round at ANY cost' — "
                "including feeding the enemy kills — and the value head can't predict "
                "length-dominated returns (explained_variance sinks).",
                {"reward_time_penalty": suggested})

    # ---------- init_model compatibility (catches dead-on-arrival warm starts) ----------
    init_model = str(values.get("init_model") or "").strip()
    observation_version = max(1, int(_num(values, "observation_version", 1)))
    expected_obs_base = _obs_dim_base_for_version(observation_version)
    if init_model and project_dir:
        path = init_model if os.path.isabs(init_model) else os.path.join(project_dir, init_model)
        if not os.path.exists(path):
            add("bad", "init_model file not found",
                f"{init_model} doesn't exist — the run will exit at startup. Clear it or fix "
                "the path.", {"init_model": ""})
        else:
            info = _inspect_model_zip(path)
            frame_stack = max(1, int(_num(values, "frame_stack", 1)))
            if info and info.get("nvec"):
                nvec = tuple(info["nvec"])
                if nvec != EXPECTED_ACTION_NVEC:
                    if _append_only_action_head_migratable(nvec, EXPECTED_ACTION_NVEC):
                        add("info", "init_model uses the older action space (auto-migrates)",
                            f"Saved action space {list(nvec)} vs live "
                            f"{list(EXPECTED_ACTION_NVEC)} — the trainer inserts the new logits "
                            "and resets the optimizer. Expect a brief performance dip while "
                            "the new choices are learned.", None)
                    else:
                        add("bad", "init_model action space is incompatible",
                            f"Saved action space {list(nvec)} can't be migrated to the live "
                            f"{list(EXPECTED_ACTION_NVEC)} — the run will exit at startup. "
                            "Train fresh.", {"init_model": ""})
            if info and info.get("obs_dim"):
                model_obs = int(info["obs_dim"])
                if model_obs % expected_obs_base == 0:
                    model_stack = model_obs // expected_obs_base
                    if model_stack != frame_stack:
                        add("bad", "frame_stack doesn't match init_model",
                            f"The saved model expects {model_obs}-dim observations "
                            f"(observation_version {observation_version}, frame_stack "
                            f"{model_stack}) but the config says frame_stack={frame_stack} — "
                            "the first layer won't load. Match the model's stack, or clear "
                            "init_model to change the stack.",
                            {"frame_stack": model_stack})
                else:
                    matching = [
                        f"obs v{version}/stack {model_obs // base}"
                        for version, base in EXPECTED_OBS_DIM_BASE_BY_VERSION.items()
                        if model_obs % base == 0
                    ]
                    prior = f" It looks like {', '.join(matching)}." if matching else ""
                    add("bad", "init_model observation layout is incompatible",
                        f"Saved obs dim {model_obs} isn't a stack of observation_version="
                        f"{observation_version}'s live base {expected_obs_base}.{prior} "
                        "Use a checkpoint from the same observation version and frame stack, "
                        "or clear init_model to train a fresh checkpoint family.",
                        {"init_model": ""})

    # ---------- league (the self-play brittleness cure) ----------
    if mode == "combat":
        snaps = [str(p) for p in (values.get("league_snapshots") or [])]
        if project_dir:
            missing = [p for p in snaps
                       if not os.path.exists(p if os.path.isabs(p)
                                             else os.path.join(project_dir, p))]
            if missing:
                add("warn", "League snapshot path(s) missing",
                    "These league_snapshots don't exist and will be skipped: "
                    + ", ".join(missing), None)
        if int(_num(values, "league_worlds", 0)) <= 0:
            add("info", "Pure self-play (no league worlds)",
                "The policy only ever fights its current self — that converges to brittle, "
                "exploitable styles. Dedicating a few 1v1 worlds to FROZEN past snapshots "
                "(PFSP) produces the robust, varied play that reads as human.",
                {"league_worlds": 6})

    if (mode == "combat" and not init_model
            and int(_num(values, "frame_stack", 1)) <= 1):
        add("info", "No short-term memory (frame_stack=1)",
            "A fresh run is the cheapest moment to turn on frame stacking: 4 recent "
            "observations give the MLP temporal context (dodging, tracking, momentum "
            "reads) that pure-reactive policies lack.", {"frame_stack": 4})

    # ---------- metric rules (only when the run has produced data) ----------
    have_metrics = bool(series)
    if have_metrics:
        ev = _last(series, "train/explained_variance")
        if ev is not None:
            if ev < 0:
                add("bad", "Value predictor failing (explained_variance < 0)",
                    f"explained_variance={ev:.2f}. The critic can't predict outcomes, so "
                    "advantages are noise. Lower the learning rate.",
                    {"learning_rate": _round(_num(values, "learning_rate", 3e-4) * 0.5, 6)})
            elif ev > 0.6:
                add("good", "Value head healthy",
                    f"explained_variance={ev:.2f} — the critic predicts outcomes well.", None)

        kl = _median_tail(series, "train/approx_kl")
        if kl is not None:
            if kl > 0.04:
                fixes = {"learning_rate": _round(_num(values, "learning_rate", 3e-4) * 0.5, 6)}
                if _num(values, "target_kl", 0.0) <= 0:
                    fixes["target_kl"] = 0.03
                add("bad", "Updates too large (KL high)",
                    f"median approx_kl≈{kl:.3f} (healthy: 0.005–0.03). The policy is lurching; "
                    "lower the LR and add a target_kl safety rail.", fixes)
            elif kl < 0.002 and prog < 0.8 and not running:
                add("info", "Updates very small (KL low)",
                    f"median approx_kl≈{kl:.4f} — learning could afford a higher learning rate.",
                    {"learning_rate": _round(_num(values, "learning_rate", 3e-4) * 1.5, 6)})

        ent0, ent = _first(series, "train/entropy_loss"), _last(series, "train/entropy_loss")
        if ent0 is not None and ent is not None and ent0 < -0.5:
            if prog > 0.3 and ent <= 0.92 * ent0:  # both negative: ent still ~at the start
                fixes = {}
                if mode == "combat":
                    fixes["reward_approach"] = _round(_num(values, "reward_approach", 0.03) * 1.5, 3)
                add("warn", "Policy not committing (entropy pinned at max)",
                    f"entropy_loss is still ≈{ent:.2f} (started {ent0:.2f}) — the policy is "
                    "near-random. Strengthen the approach foothold, shorten rounds, or give it "
                    "more steps.", fixes)
            elif ent >= -0.5 and prog < 0.5:
                add("warn", "Exploration collapsed early",
                    f"entropy_loss≈{ent:.2f} before half the run — it stopped exploring too "
                    "soon and will plateau. Raise the entropy bonus.",
                    {"entropy_coef": _round(max(0.02, _num(values, "entropy_coef", 0.01) * 2), 4)})

        rew_t = _trend(series, "rollout/ep_rew_mean")
        if rew_t is not None:
            if rew_t > 0.05:
                add("good", "Reward still climbing",
                    "rollout/ep_rew_mean is rising — it hasn't converged; more steps will keep "
                    "paying off.", None)
            elif rew_t < -0.08:
                add("warn", "Reward regressing",
                    "rollout/ep_rew_mean fell over the last third — usually instability. Lower "
                    "the learning rate (and check approx_kl).",
                    {"learning_rate": _round(_num(values, "learning_rate", 3e-4) * 0.5, 6)})
            elif prog > 0.6:
                add("info", "Reward plateaued",
                    "rollout/ep_rew_mean is flat — likely converged at this difficulty. Next "
                    "moves: grade it (Evaluate tab), then a warm-started hardening run with "
                    "domain randomization, or raise entropy_coef to re-explore.", None)

        len_t = _trend(series, "rollout/ep_len_mean")
        if len_t is not None and len_t > 0.1:
            fixes = {}
            if mode == "combat":
                fixes = {"reward_kill": _round(_num(values, "reward_kill", 0.1) * 1.5, 3)}
            add("warn", "Rounds getting longer (passive play)",
                "rollout/ep_len_mean is rising — matches drag instead of resolving. Pay kills "
                "more / shorten the round caps so decisive play wins.", fixes)

        fps = _last(series, "time/fps")
        if fps is not None and fps < 1500 and interval > 1 and workers >= max(2, cpus - 5):
            add("info", "Throughput low despite a tuned setup",
                f"time/fps≈{fps:.0f}. If the GPU sits idle, add worlds per worker (widen "
                "[combat] world_sizes); if CPU is pegged, this is the sim's ceiling.", None)

        wr = _last(series, "eval/win_rate")
        if wr is not None:
            if wr >= 0.85:
                add("good", "Dominating the in-training grade",
                    f"eval/win_rate={wr:.2f}. Time to validate properly on the Evaluate tab "
                    "(more matches, higher kill target) and consider the hardening phase.", None)
            elif prog > 0.5 and wr < 0.3:
                add("warn", "Win rate still low past mid-run",
                    f"eval/win_rate={wr:.2f}. Re-check the reward balance: kills must clearly "
                    "out-pay approach, and rounds must be short enough to resolve.", None)

        switch = _last(series, "behavior/move_switch_rate")
        if switch is not None:
            try:
                from ..baseline import get_bands, load_baseline
                hi = float(get_bands().get("move_switch_rate", [0.0, 0.5])[1])
                src = load_baseline()["source"]
            except Exception:
                hi, src = 0.5, "defaults"
            if switch > hi:
                add("info", "Movement looks twitchy (human-likeness)",
                    f"behavior/move_switch_rate={switch:.2f} vs the human band's upper edge "
                    f"{hi:.2f} (bands from {src}) — the policy flips direction more than "
                    "people do. A higher decision_interval and a lower late-run entropy_coef "
                    "both smooth this out.", None)

    # ---------- verdict ----------
    worst = max((x["level"] for x in f), key=lambda lv: _LEVEL_RANK[lv], default="good")
    n_bad = sum(1 for x in f if x["level"] == "bad")
    n_warn = sum(1 for x in f if x["level"] == "warn")
    if not have_metrics:
        text = "No metrics yet — setup checks only." if f else "Setup looks clean. Start training."
    elif n_bad:
        text = f"{n_bad} problem(s) actively hurting training — fix these first."
    elif n_warn:
        text = (f"{n_warn} thing(s) deserve attention." if running
                else f"{n_warn} thing(s) to address before the next run.")
    else:
        text = "Run looks healthy — let it cook." if running else "Run looks healthy."
    return {"verdict": {"level": worst if f else "good", "text": text}, "findings": f}
