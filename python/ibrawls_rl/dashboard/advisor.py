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

from typing import Any

Series = dict[str, list[list[float]]]

_LEVEL_RANK = {"bad": 3, "warn": 2, "info": 1, "good": 0}


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
        try:
            agents = sum(int(x) for x in sizes)
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
        if switch is not None and switch > 0.5:
            add("info", "Movement looks twitchy (human-likeness)",
                f"behavior/move_switch_rate={switch:.2f} — the policy flips direction most "
                "decisions. Humans hold a heading. A higher decision_interval and a lower "
                "late-run entropy_coef both smooth this out.", None)

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
