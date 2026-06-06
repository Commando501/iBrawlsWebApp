"""Head-to-head evaluation of a trained policy vs the built-in heuristic.

Win/loss is read from the terminal-tick reward sign (the ±``win`` reward dominates a single
tick), aggregated per world-env episode. Reports win-rate and mean episodic return — the
learning signal for Verification #7. (Exact goal-diff / K-D / length over many matches is
also available on the TS side via ``npm run sim:eval``.)
"""
from __future__ import annotations

import numpy as np

from .envs.grifball_vec_env import GrifballVecEnv


def eval_vs(
    model,
    opponent: str = "heuristic",
    matches: int = 50,
    num_envs: int = 16,
    goal_target: int = 3,
    deterministic: bool = True,
) -> dict:
    env = GrifballVecEnv(
        num_envs=num_envs,
        opponent=opponent,
        settings={"grifballGoalTarget": goal_target},
        max_ticks=60 * 60 * 6,
    )
    try:
        obs = env.reset()
        lpe = env.learners_per_env
        world_envs = env.n_world_envs
        ep_return = np.zeros(env.num_envs, dtype=np.float64)

        wins = 0
        losses = 0
        draws = 0
        returns: list[float] = []
        completed = 0

        max_iters = matches * 60 * 60 * 8  # generous safety bound
        it = 0
        while completed < matches and it < max_iters:
            it += 1
            if model is None:
                action = np.stack(
                    [env.action_space.sample() for _ in range(env.num_envs)]
                ).astype(np.int32)
            else:
                action, _ = model.predict(obs, deterministic=deterministic)
            obs, reward, done, _ = env.step(action)
            ep_return += reward

            if done.any():
                # Sub-envs of a world-env finish together; collapse per world-env.
                for w in range(world_envs):
                    sl = slice(w * lpe, (w + 1) * lpe)
                    if done[sl].any():
                        team_reward = float(reward[sl].mean())
                        returns.append(float(ep_return[sl].mean()))
                        ep_return[sl] = 0.0
                        if team_reward > 1e-6:
                            wins += 1
                        elif team_reward < -1e-6:
                            losses += 1
                        else:
                            draws += 1
                        completed += 1

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
    """Back-compat shim: eval against the built-in heuristic."""
    return eval_vs(model, opponent="heuristic", **kw)
