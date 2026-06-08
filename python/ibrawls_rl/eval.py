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

from .envs.grifball_vec_env import GrifballVecEnv

WIN_THRESHOLD = 0.5  # terminal reward magnitude separating a decisive result from a timeout


def _predict(model, env, obs, deterministic: bool) -> np.ndarray:
    if model is None:
        return np.stack([env.action_space.sample() for _ in range(env.num_envs)]).astype(np.int32)
    action, _ = model.predict(obs, deterministic=deterministic)
    return np.asarray(action, dtype=np.int32)


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
) -> dict:
    """Grade a grifball policy vs a built-in opponent. Each learner sub-env's episode counts."""
    env = GrifballVecEnv(
        num_envs=num_envs,
        opponent=opponent,
        settings={"grifballGoalTarget": goal_target},
        max_ticks=60 * 60 * 6,
    )
    try:
        obs = env.reset()
        ep_return = np.zeros(env.num_envs, dtype=np.float64)
        wins = losses = draws = completed = 0
        next_mark = progress_every
        returns: list[float] = []
        max_iters = matches * 60 * 60 * 8
        it = 0
        while completed < matches and it < max_iters:
            it += 1
            obs, reward, done, _ = env.step(_predict(model, env, obs, deterministic))
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
) -> dict:
    """Grade a combat policy by 1v1 duels vs a random opponent (fixed 1v1 worlds).

    Even agent slots = policy (team t0), odd = random (team t1). Win read from the policy
    slot's terminal reward; timeouts (no decisive reward) count as draws.
    """
    env = GrifballVecEnv(
        mode="combat",
        combat_world_sizes=[2] * num_worlds,
        combat_kill_range=(kill_target, kill_target),
        combat_randomize_layout=False,
        max_ticks=60 * 60 * 6,
    )
    try:
        obs = env.reset()
        policy_idx = np.arange(0, env.num_envs, 2)
        random_idx = np.arange(1, env.num_envs, 2)
        wins = losses = draws = completed = 0
        next_mark = progress_every
        max_iters = matches * 60 * 60 * 8
        it = 0
        while completed < matches and it < max_iters:
            it += 1
            action = _predict(model, env, obs, deterministic)
            for j in random_idx:
                action[j] = env.action_space.sample()
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
        }
    finally:
        env.close()
