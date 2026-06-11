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
) -> dict:
    """Grade a grifball policy vs a built-in opponent. Each learner sub-env's episode counts."""
    env = GrifballVecEnv(
        num_envs=num_envs,
        opponent=opponent,
        settings={"grifballGoalTarget": goal_target},
        max_ticks=int(60 * 60 * max_minutes),
        decision_interval=decision_interval,
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
    frame_stack: int = 1,
) -> dict:
    """Grade a combat policy by 1v1 duels vs a random opponent (fixed 1v1 worlds).

    Even agent slots = policy (team t0), odd = random (team t1). Win read from the policy
    slot's terminal reward; timeouts (no decisive reward) count as draws.
    """
    env = GrifballVecEnv(
        mode="combat",
        combat_world_sizes=[world_size] * num_worlds,
        combat_kill_range=(kill_target, kill_target),
        combat_randomize_layout=False,
        max_ticks=int(60 * 60 * max_minutes),
        decision_interval=decision_interval,
    )
    env = _maybe_frame_stack(env, frame_stack)
    try:
        obs = env.reset()
        policy_idx = np.arange(0, env.num_envs, 2)
        random_idx = np.arange(1, env.num_envs, 2)
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
            "world_size": world_size,
            "kill_target": kill_target,
        }
    finally:
        env.close()


def combat_eval_matrix_specs() -> list[dict]:
    """The standard combat grade: duel, small group, and large brawl."""
    return [
        {"name": "duel_k5", "world_size": 2, "kill_target": 5, "max_minutes": 2.0},
        {"name": "skirmish4_k10", "world_size": 4, "kill_target": 10, "max_minutes": 3.0},
        {"name": "brawl8_k15", "world_size": 8, "kill_target": 15, "max_minutes": 4.0},
    ]


def summarize_eval_matrix(results: list[dict]) -> dict:
    """Promotion score: win more, draw less, avoid robotic spam."""
    if not results:
        return {
            "scenarios": 0,
            "mean_win_rate": 0.0,
            "mean_draw_rate": 0.0,
            "human_likeness_penalty": 0.0,
            "promotion_score": 0.0,
        }

    win = float(np.mean([float(r.get("win_rate", 0.0)) for r in results]))
    draw = float(np.mean([float(r.get("draw_rate", 0.0)) for r in results]))
    penalties = []
    for r in results:
        b = r.get("behavior") or {}
        attack_spam = max(0.0, float(b.get("attack_rate", 0.0)) - 0.8)
        dash_spam = max(0.0, float(b.get("dash_rate", 0.0)) - 0.55)
        jump_spam = max(0.0, float(b.get("jump_rate", 0.0)) - 0.45)
        repeat_spam = max(0.0, float(b.get("action_repeat_rate", 0.0)) - 0.65)
        penalties.append(min(1.0, attack_spam + dash_spam + jump_spam + repeat_spam))
    human_penalty = float(np.mean(penalties))
    score = max(0.0, win - draw * 0.35 - human_penalty * 0.4)
    return {
        "scenarios": len(results),
        "mean_win_rate": round(win, 4),
        "mean_draw_rate": round(draw, 4),
        "human_likeness_penalty": round(human_penalty, 4),
        "promotion_score": round(score, 4),
    }


def eval_combat_matrix(
    model,
    matches: int = 100,
    num_worlds: int = 16,
    deterministic: bool = True,
    progress_every: int = 0,
    decision_interval: int = 1,
    frame_stack: int = 1,
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
            world_size=spec["world_size"],
            frame_stack=frame_stack,
        )
        results.append({"name": spec["name"], **res})
    return {"summary": summarize_eval_matrix(results), "scenarios": results}


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
    frame_stack: int = 1,
    device: str = "cpu",
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
            frame_stack=frame_stack,
        )

    from stable_baselines3 import PPO

    opponents = [PPO.load(path, device=device) for path in snapshot_paths]
    env = GrifballVecEnv(
        mode="combat",
        combat_world_sizes=[world_size] * num_worlds,
        combat_kill_range=(kill_target, kill_target),
        combat_randomize_layout=False,
        max_ticks=int(60 * 60 * max_minutes),
        decision_interval=decision_interval,
    )
    env = _maybe_frame_stack(env, frame_stack)
    try:
        obs = env.reset()
        policy_idx = np.arange(0, env.num_envs, 2)
        opponent_idx = np.arange(1, env.num_envs, 2)
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
            "world_size": world_size,
            "kill_target": kill_target,
            "opponent": "league",
            "league_snapshots": snapshot_paths,
        }
    finally:
        env.close()
