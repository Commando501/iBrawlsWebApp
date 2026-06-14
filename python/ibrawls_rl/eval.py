"""Head-to-head evaluation of a trained policy.

Win/loss/draw is read from the **terminal-tick reward**: a real win/loss carries the ±`win`
reward (≈±1), while a timed-out/stalled match only has the tiny time penalty (≈0). So we
bucket with a decisive threshold — `> +0.5` win, `< -0.5` loss, else **draw** (timeout). This
matters: an undertrained policy that stalls produces draws, not losses.

Works purely through the SB3 VecEnv interface (num_envs / step / reward / done) — no env
internals — so it's robust to the multi-worker layout.
"""
from __future__ import annotations

import numpy as np
from stable_baselines3.common.vec_env import VecFrameStack

from . import baseline
from .envs.grifball_vec_env import GrifballVecEnv

WIN_THRESHOLD = 0.5  # terminal reward magnitude separating a decisive result from a timeout


class BehaviorTracker:
    """Aggregate action statistics that proxy "does it play like a person?".

    Tracked per decision over the graded slots: idle fraction (no movement input),
    move-direction switch rate (twitchiness — humans hold a direction; a jittery policy
    flips every decision), and attack / jump / dash usage rates. These land in eval
    results so human-likeness is measured, not guessed.
    """

    def __init__(self, slots: np.ndarray | None = None):
        self.slots = slots
        self.prev_move: np.ndarray | None = None
        self.prev_action: np.ndarray | None = None
        self.steps = 0
        self.idle = 0
        self.switch = 0
        self.switch_n = 0
        self.repeat = 0
        self.repeat_n = 0
        self.aim_enemy = 0
        self.attack = 0
        self.jump = 0
        self.dash = 0

    def update(self, action: np.ndarray) -> None:
        a = action if self.slots is None else action[self.slots]
        move = a[:, 0]
        self.steps += a.shape[0]
        self.idle += int((move == 0).sum())
        self.aim_enemy += int((a[:, 1] == 3).sum())
        self.attack += int((a[:, 2] != 0).sum())
        self.jump += int((a[:, 3] == 1).sum())
        self.dash += int((a[:, 4] == 1).sum())
        if self.prev_move is not None:
            self.switch += int((move != self.prev_move).sum())
            self.switch_n += a.shape[0]
        if self.prev_action is not None:
            self.repeat += int((a == self.prev_action).all(axis=1).sum())
            self.repeat_n += a.shape[0]
        self.prev_move = move.copy()
        self.prev_action = a.copy()

    def summary(self) -> dict:
        n = max(1, self.steps)
        return {
            "idle_frac": round(self.idle / n, 4),
            "move_switch_rate": round(self.switch / max(1, self.switch_n), 4),
            "action_repeat_rate": round(self.repeat / max(1, self.repeat_n), 4),
            "aim_enemy_rate": round(self.aim_enemy / n, 4),
            "attack_rate": round(self.attack / n, 4),
            "jump_rate": round(self.jump / n, 4),
            "dash_rate": round(self.dash / n, 4),
        }


def _predict(model, env, obs, deterministic: bool) -> np.ndarray:
    if model is None:
        return np.stack([env.action_space.sample() for _ in range(env.num_envs)]).astype(np.int32)
    action, _ = model.predict(obs, deterministic=deterministic)
    return np.asarray(action, dtype=np.int32)


def _maybe_frame_stack(env: GrifballVecEnv, frame_stack: int):  # noqa: ANN001
    stack = max(1, int(frame_stack or 1))
    if stack <= 1:
        return env
    return VecFrameStack(env, n_stack=stack)


def _emit_progress(progress_every: int, completed: int, matches: int, next_mark: int) -> int:
    """Print a parseable `[eval] done/total` line when `completed` crosses a threshold.

    Returns the updated next threshold. No-op when progress_every <= 0 (e.g. the in-training
    eval, which must stay quiet). The control board parses these lines for a live ETA.
    """
    if progress_every and completed >= next_mark:
        print(f"[eval] {min(completed, matches)}/{matches}", flush=True)
        while next_mark <= completed:
            next_mark += progress_every
    return next_mark


def eval_vs(
    model,
    opponent: str = "random",
    matches: int = 50,
    num_envs: int = 16,
    goal_target: int = 3,
    deterministic: bool = True,
    progress_every: int = 0,
    decision_interval: int = 1,
    max_minutes: float = 6.0,
    frame_stack: int = 1,
    observation_version: int = 1,
) -> dict:
    """Grade a grifball policy vs a built-in opponent. Each learner sub-env's episode counts."""
    env = GrifballVecEnv(
        num_envs=num_envs,
        opponent=opponent,
        settings={"grifballGoalTarget": goal_target},
        max_ticks=int(60 * 60 * max_minutes),
        decision_interval=decision_interval,
        observation_version=observation_version,
    )
    env = _maybe_frame_stack(env, frame_stack)
    try:
        obs = env.reset()
        ep_return = np.zeros(env.num_envs, dtype=np.float64)
        wins = losses = draws = completed = 0
        next_mark = progress_every
        returns: list[float] = []
        behavior = BehaviorTracker()
        max_iters = matches * 60 * 60 * 8
        it = 0
        while completed < matches and it < max_iters:
            it += 1
            action = _predict(model, env, obs, deterministic)
            behavior.update(action)
            obs, reward, done, _ = env.step(action)
            ep_return += reward
            for i in np.nonzero(done)[0]:
                r = float(reward[i])
                if r > WIN_THRESHOLD:
                    wins += 1
                elif r < -WIN_THRESHOLD:
                    losses += 1
                else:
                    draws += 1
                returns.append(float(ep_return[i]))
                ep_return[i] = 0.0
                completed += 1
            next_mark = _emit_progress(progress_every, completed, matches, next_mark)
        total = max(1, wins + losses + draws)
        return {
            "win_rate": wins / total,
            "loss_rate": losses / total,
            "draw_rate": draws / total,
            "ep_return": float(np.mean(returns)) if returns else 0.0,
            "episodes": completed,
            "behavior": behavior.summary(),
        }
    finally:
        env.close()


def eval_vs_heuristic(model, **kw) -> dict:
    """Back-compat shim: grade against the built-in heuristic."""
    return eval_vs(model, opponent="heuristic", **kw)


def eval_combat_vs_random(
    model,
    matches: int = 100,
    num_worlds: int = 16,
    kill_target: int = 10,
    deterministic: bool = True,
    progress_every: int = 0,
    decision_interval: int = 1,
    max_minutes: float = 6.0,
    world_size: int = 2,
    team_sizes: list[int] | None = None,
    frame_stack: int = 1,
    observation_version: int = 1,
) -> dict:
    """Grade a combat policy in fixed combat worlds with only team 0 controlled by policy.

    `team_sizes=[1, 3]` means one policy-controlled lone-wolf slot against three random
    opponents. `team_sizes=[1]*8` means one policy slot in an 8-player FFA. Win/loss is
    read from the focus slot's terminal reward; timeouts count as draws.
    """
    layout = team_sizes or [1] * int(world_size)
    env = GrifballVecEnv(
        mode="combat",
        combat_world_layouts=[layout] * num_worlds,
        combat_kill_range=(kill_target, kill_target),
        combat_randomize_layout=False,
        max_ticks=int(60 * 60 * max_minutes),
        decision_interval=decision_interval,
        observation_version=observation_version,
    )
    env = _maybe_frame_stack(env, frame_stack)
    try:
        obs = env.reset()
        policy_idx, random_idx = _scenario_indices(layout, num_worlds)
        wins = losses = draws = completed = 0
        next_mark = progress_every
        behavior = BehaviorTracker(slots=policy_idx)
        max_iters = matches * 60 * 60 * 8
        it = 0
        while completed < matches and it < max_iters:
            it += 1
            action = _predict(model, env, obs, deterministic)
            for j in random_idx:
                action[j] = env.action_space.sample()
            behavior.update(action)
            obs, reward, done, _ = env.step(action)
            for w in policy_idx:
                if not done[w]:
                    continue
                r = float(reward[w])
                if r > WIN_THRESHOLD:
                    wins += 1
                elif r < -WIN_THRESHOLD:
                    losses += 1
                else:
                    draws += 1
                completed += 1
            next_mark = _emit_progress(progress_every, completed, matches, next_mark)
        total = max(1, wins + losses + draws)
        return {
            "win_rate": wins / total,
            "loss_rate": losses / total,
            "draw_rate": draws / total,
            "episodes": completed,
            "behavior": behavior.summary(),
            "world_size": sum(layout),
            "team_sizes": layout,
            "kill_target": kill_target,
        }
    finally:
        env.close()


def combat_eval_matrix_specs() -> list[dict]:
    """The standard combat grade: duel, asymmetric lone-wolf, and FFA pressure."""
    return [
        {"name": "duel_1v1", "team_sizes": [1, 1], "kill_target": 5, "max_minutes": 2.0},
        {"name": "lone_1v2", "team_sizes": [1, 2], "kill_target": 8, "max_minutes": 3.0},
        {"name": "lone_1v3", "team_sizes": [1, 3], "kill_target": 10, "max_minutes": 3.0},
        {"name": "lone_1v7", "team_sizes": [1, 7], "kill_target": 15, "max_minutes": 4.0},
        {"name": "ffa4", "team_sizes": [1, 1, 1, 1], "kill_target": 10, "max_minutes": 3.0},
        {"name": "ffa8", "team_sizes": [1, 1, 1, 1, 1, 1, 1, 1], "kill_target": 15, "max_minutes": 4.0},
    ]


def combat_anti_bait_specs() -> list[dict]:
    """Scripted passive-bait scenarios that catch straight-line range-trap failures."""
    return [
        {"name": "bait_duel_1v1", "team_sizes": [1, 1], "kill_target": 5, "max_minutes": 2.0,
         "opponent_profile": "passive_bait"},
        {"name": "bait_jitter_1v1", "team_sizes": [1, 1], "kill_target": 5, "max_minutes": 2.0,
         "opponent_profile": "passive_bait_jitter"},
        {"name": "bait_lone_1v2", "team_sizes": [1, 2], "kill_target": 8, "max_minutes": 3.0,
         "opponent_profile": "passive_bait_jitter"},
        {"name": "bait_lone_1v3", "team_sizes": [1, 3], "kill_target": 10, "max_minutes": 3.0,
         "opponent_profile": "passive_bait_jitter"},
    ]


def _scenario_indices(team_sizes: list[int], num_worlds: int) -> tuple[np.ndarray, np.ndarray]:
    focus: list[int] = []
    opponents: list[int] = []
    width = sum(team_sizes)
    for w in range(num_worlds):
        base = w * width
        for i in range(width):
            (focus if i < team_sizes[0] else opponents).append(base + i)
    return np.asarray(focus, dtype=np.int64), np.asarray(opponents, dtype=np.int64)


def scenario_random_baseline(team_sizes: list[int] | None = None, world_size: int | None = None) -> float:
    """Random chance that the focus team wins a scenario."""
    if team_sizes:
        total = max(1, sum(int(x) for x in team_sizes))
        focus = max(1, int(team_sizes[0]))
        return focus / total
    return 1.0 / max(2, int(world_size or 2))


def scenario_win_score(win_rate: float, team_sizes: list[int] | None = None, world_size: int | None = None) -> float:
    """0 = random baseline, 1 = perfect focus-slot win rate."""
    baseline = scenario_random_baseline(team_sizes, world_size)
    denom = max(1e-9, 1.0 - baseline)
    return max(0.0, min(1.0, (float(win_rate) - baseline) / denom))


def win_lift(win_rate: float, world_size: int) -> float:
    """Legacy win-rate normalization retained for old dashboard/history readers."""
    baseline = 1.0 / max(2, int(world_size or 2))
    return float(win_rate) / baseline


def summarize_anti_bait_results(results: list[dict]) -> dict:
    if not results:
        return {
            "anti_bait_scenarios": 0,
            "mean_anti_bait_win_score": 0.0,
            "trap_death_rate": 0.0,
            "anti_bait_score": 0.0,
        }
    mean_score = float(np.mean([float(r.get("win_score", 0.0)) for r in results]))
    trap_death_rate = float(np.mean([float(r.get("trap_death_rate", 0.0)) for r in results]))
    score = max(0.0, min(1.0, mean_score - trap_death_rate * 0.5))
    return {
        "anti_bait_scenarios": len(results),
        "mean_anti_bait_win_score": round(mean_score, 4),
        "trap_death_rate": round(trap_death_rate, 4),
        "anti_bait_score": round(score, 4),
    }


def summarize_strict_promotion(summary: dict, frozen_snapshot_score: float | None) -> dict:
    frozen_present = isinstance(frozen_snapshot_score, (int, float))
    frozen_score = round(float(frozen_snapshot_score), 4) if frozen_present else None
    return {
        "frozen_snapshot_score": frozen_score,
        "strict_promotion_requires_frozen": not frozen_present,
        "strict_promotion_ready": bool(
            summary.get("lone_wolf_score", 0.0) >= 0.75 and
            frozen_present and
            float(frozen_snapshot_score) >= 0.55 and
            summary.get("anti_bait_score", 0.0) >= 0.70 and
            summary.get("trap_death_rate", 1.0) <= 0.20
        ),
    }


def summarize_eval_matrix(results: list[dict]) -> dict:
    """Promotion score: beat random in every scenario, draw less, move like a person.

    Wins enter as scenario scores where 0 = random baseline and 1 = perfect. The
    human-likeness penalty measures behavior stats against the human baseline bands
    (replay-derived when python/human_baseline.json exists).
    """
    if not results:
        return {
            "scenarios": 0,
            "mean_win_rate": 0.0,
            "mean_win_lift": 0.0,
            "mean_scenario_win_score": 0.0,
            "mean_draw_rate": 0.0,
            "human_likeness_penalty": 0.0,
            "baseline_source": baseline.load_baseline()["source"],
            "lone_wolf_score": 0.0,
            "promotion_score": 0.0,
        }

    bands = baseline.get_bands()
    win = float(np.mean([float(r.get("win_rate", 0.0)) for r in results]))
    lift = float(np.mean([win_lift(r.get("win_rate", 0.0), r.get("world_size", 2))
                          for r in results]))
    scenario_scores = [
        float(r.get("win_score", scenario_win_score(
            r.get("win_rate", 0.0),
            r.get("team_sizes"),
            r.get("world_size", 2),
        )))
        for r in results
    ]
    lone_wolf_score = float(np.mean(scenario_scores))
    draw = float(np.mean([float(r.get("draw_rate", 0.0)) for r in results]))
    human_penalty = float(np.mean(
        [baseline.band_penalty(r.get("behavior"), bands) for r in results]))
    # Scenario score maps [random..perfect] onto [0..1]; draws and robotic play subtract.
    score = max(0.0, lone_wolf_score - draw * 0.35 - human_penalty * 0.4)
    return {
        "scenarios": len(results),
        "mean_win_rate": round(win, 4),
        "mean_win_lift": round(lift, 4),
        "mean_scenario_win_score": round(lone_wolf_score, 4),
        "mean_draw_rate": round(draw, 4),
        "human_likeness_penalty": round(human_penalty, 4),
        "baseline_source": baseline.load_baseline()["source"],
        "lone_wolf_score": round(score, 4),
        "promotion_score": round(score, 4),
    }


def eval_combat_vs_scripted_bait(
    model,
    matches: int = 100,
    num_worlds: int = 16,
    kill_target: int = 10,
    deterministic: bool = True,
    progress_every: int = 0,
    decision_interval: int = 1,
    max_minutes: float = 6.0,
    team_sizes: list[int] | None = None,
    opponent_profile: str = "passive_bait_jitter",
    frame_stack: int = 1,
    observation_version: int = 1,
) -> dict:
    layout = team_sizes or [1, 1]
    env = GrifballVecEnv(
        mode="combat",
        combat_world_layouts=[layout] * num_worlds,
        combat_kill_range=(kill_target, kill_target),
        combat_randomize_layout=False,
        combat_scripted_opponent=opponent_profile,
        reward={"trapDeath": 1.0},
        max_ticks=int(60 * 60 * max_minutes),
        decision_interval=decision_interval,
        observation_version=observation_version,
    )
    env = _maybe_frame_stack(env, frame_stack)
    try:
        obs = env.reset()
        wins = losses = draws = completed = 0
        next_mark = progress_every
        behavior = BehaviorTracker()
        trap_deaths = 0.0
        max_iters = matches * 60 * 60 * 8
        it = 0
        while completed < matches and it < max_iters:
            it += 1
            action = _predict(model, env, obs, deterministic)
            behavior.update(action)
            obs, reward, done, _ = env.step(action)
            trap_component = getattr(env, "last_reward_components", {}).get("trapDeath", 0.0)
            trap_deaths += max(0.0, -float(trap_component))
            for i in np.nonzero(done)[0]:
                r = float(reward[i])
                if r > WIN_THRESHOLD:
                    wins += 1
                elif r < -WIN_THRESHOLD:
                    losses += 1
                else:
                    draws += 1
                completed += 1
            next_mark = _emit_progress(progress_every, completed, matches, next_mark)
        total = max(1, wins + losses + draws)
        return {
            "win_rate": wins / total,
            "loss_rate": losses / total,
            "draw_rate": draws / total,
            "episodes": completed,
            "behavior": behavior.summary(),
            "world_size": sum(layout),
            "team_sizes": layout,
            "kill_target": kill_target,
            "opponent_profile": opponent_profile,
            "trap_deaths": round(trap_deaths, 4),
            "trap_death_rate": round(trap_deaths / max(1, completed), 4),
        }
    finally:
        env.close()


def eval_combat_anti_bait(
    model,
    matches: int = 100,
    num_worlds: int = 16,
    deterministic: bool = True,
    progress_every: int = 0,
    decision_interval: int = 1,
    frame_stack: int = 1,
    observation_version: int = 1,
) -> dict:
    results = []
    for spec in combat_anti_bait_specs():
        res = eval_combat_vs_scripted_bait(
            model,
            matches=matches,
            num_worlds=num_worlds,
            kill_target=spec["kill_target"],
            deterministic=deterministic,
            progress_every=progress_every,
            decision_interval=decision_interval,
            max_minutes=spec["max_minutes"],
            team_sizes=spec["team_sizes"],
            opponent_profile=spec["opponent_profile"],
            frame_stack=frame_stack,
            observation_version=observation_version,
        )
        res["win_lift"] = round(win_lift(res["win_rate"], res["world_size"]), 4)
        res["random_baseline"] = round(scenario_random_baseline(res.get("team_sizes"), res["world_size"]), 4)
        res["win_score"] = round(scenario_win_score(res["win_rate"], res.get("team_sizes"), res["world_size"]), 4)
        res["behavior_bands"] = baseline.annotate(res.get("behavior"))
        results.append({"name": spec["name"], **res})
    return {"summary": summarize_anti_bait_results(results), "scenarios": results}


def eval_combat_matrix(
    model,
    matches: int = 100,
    num_worlds: int = 16,
    deterministic: bool = True,
    progress_every: int = 0,
    decision_interval: int = 1,
    frame_stack: int = 1,
    snapshot_paths: list[str] | None = None,
    device: str = "cpu",
    observation_version: int = 1,
) -> dict:
    results = []
    for spec in combat_eval_matrix_specs():
        res = eval_combat_vs_random(
            model,
            matches=matches,
            num_worlds=num_worlds,
            kill_target=spec["kill_target"],
            deterministic=deterministic,
            progress_every=progress_every,
            decision_interval=decision_interval,
            max_minutes=spec["max_minutes"],
            team_sizes=spec["team_sizes"],
            frame_stack=frame_stack,
            observation_version=observation_version,
        )
        res["win_lift"] = round(win_lift(res["win_rate"], res["world_size"]), 4)
        res["random_baseline"] = round(scenario_random_baseline(res.get("team_sizes"), res["world_size"]), 4)
        res["win_score"] = round(scenario_win_score(res["win_rate"], res.get("team_sizes"), res["world_size"]), 4)
        res["behavior_bands"] = baseline.annotate(res.get("behavior"))
        results.append({"name": spec["name"], **res})
    summary = summarize_eval_matrix(results)
    frozen_snapshot_results = []
    frozen_snapshot_score = None
    if snapshot_paths:
        for spec in combat_eval_matrix_specs():
            res = eval_combat_vs_snapshots(
                model,
                snapshot_paths=snapshot_paths,
                matches=matches,
                num_worlds=num_worlds,
                kill_target=spec["kill_target"],
                deterministic=deterministic,
                progress_every=0,
                decision_interval=decision_interval,
                max_minutes=spec["max_minutes"],
                team_sizes=spec["team_sizes"],
                frame_stack=frame_stack,
                device=device,
                observation_version=observation_version,
            )
            res["win_lift"] = round(win_lift(res["win_rate"], res["world_size"]), 4)
            res["random_baseline"] = round(scenario_random_baseline(res.get("team_sizes"), res["world_size"]), 4)
            res["win_score"] = round(scenario_win_score(res["win_rate"], res.get("team_sizes"), res["world_size"]), 4)
            res["behavior_bands"] = baseline.annotate(res.get("behavior"))
            frozen_snapshot_results.append({"name": spec["name"], **res})
        frozen_snapshot_score = summarize_eval_matrix(frozen_snapshot_results).get("lone_wolf_score")
    anti_bait = eval_combat_anti_bait(
        model,
        matches=matches,
        num_worlds=num_worlds,
        deterministic=deterministic,
        progress_every=0,
        decision_interval=decision_interval,
        frame_stack=frame_stack,
        observation_version=observation_version,
    )
    summary.update(anti_bait["summary"])
    summary.update(summarize_strict_promotion(summary, frozen_snapshot_score))
    return {
        "summary": summary,
        "scenarios": results,
        "frozen_snapshots": frozen_snapshot_results,
        "anti_bait": anti_bait["scenarios"],
    }


def eval_combat_vs_snapshots(
    model,
    snapshot_paths: list[str],
    matches: int = 100,
    num_worlds: int = 16,
    kill_target: int = 10,
    deterministic: bool = True,
    progress_every: int = 0,
    decision_interval: int = 1,
    max_minutes: float = 6.0,
    world_size: int = 2,
    team_sizes: list[int] | None = None,
    frame_stack: int = 1,
    device: str = "cpu",
    observation_version: int = 1,
) -> dict:
    """Grade even policy slots against odd slots driven by frozen PPO snapshots."""
    if not snapshot_paths:
        return eval_combat_vs_random(
            model,
            matches=matches,
            num_worlds=num_worlds,
            kill_target=kill_target,
            deterministic=deterministic,
            progress_every=progress_every,
            decision_interval=decision_interval,
            max_minutes=max_minutes,
            world_size=world_size,
            team_sizes=team_sizes,
            frame_stack=frame_stack,
            observation_version=observation_version,
        )

    from stable_baselines3 import PPO

    opponents = [PPO.load(path, device=device) for path in snapshot_paths]
    layout = team_sizes or [1] * int(world_size)
    env = GrifballVecEnv(
        mode="combat",
        combat_world_layouts=[layout] * num_worlds,
        combat_kill_range=(kill_target, kill_target),
        combat_randomize_layout=False,
        max_ticks=int(60 * 60 * max_minutes),
        decision_interval=decision_interval,
        observation_version=observation_version,
    )
    env = _maybe_frame_stack(env, frame_stack)
    try:
        obs = env.reset()
        policy_idx, opponent_idx = _scenario_indices(layout, num_worlds)
        wins = losses = draws = completed = 0
        next_mark = progress_every
        behavior = BehaviorTracker(slots=policy_idx)
        max_iters = matches * 60 * 60 * 8
        it = 0
        while completed < matches and it < max_iters:
            it += 1
            action = _predict(model, env, obs, deterministic)
            for n, opp in enumerate(opponents):
                opp_action = _predict(opp, env, obs, deterministic)
                slots = opponent_idx[n::len(opponents)]
                action[slots] = opp_action[slots]
            behavior.update(action)
            obs, reward, done, _ = env.step(action)
            for w in policy_idx:
                if not done[w]:
                    continue
                r = float(reward[w])
                if r > WIN_THRESHOLD:
                    wins += 1
                elif r < -WIN_THRESHOLD:
                    losses += 1
                else:
                    draws += 1
                completed += 1
            next_mark = _emit_progress(progress_every, completed, matches, next_mark)
        total = max(1, wins + losses + draws)
        return {
            "win_rate": wins / total,
            "loss_rate": losses / total,
            "draw_rate": draws / total,
            "episodes": completed,
            "behavior": behavior.summary(),
            "world_size": sum(layout),
            "team_sizes": layout,
            "kill_target": kill_target,
            "opponent": "league",
            "league_snapshots": snapshot_paths,
        }
    finally:
        env.close()
