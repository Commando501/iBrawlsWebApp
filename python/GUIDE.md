# Beginner's guide to training the iBrawls bot

A plain-English manual for running and tuning. You don't need RL background.

## 1. The mental model (30 seconds)

- The **agent** is the bot's brain (a neural network, the "policy").
- Each tick it sees an **observation** (where it/ball/teammates/enemies are) and picks an
  **action** (move / aim / attack / …).
- It gets **reward** for good things (scoring, winning) and penalties for bad ones.
- A match from start to win/timeout is an **episode**.
- Training = play millions of ticks, nudging the brain so future reward goes up. That's it.

You don't program tactics. You set the **reward** (what's "good") and the **opponent**, and
the bot discovers tactics by trial and error.

## 2. The whole workflow

1. **Edit `config.toml`** — your control panel. Every setting has a comment.
2. **Train:** `python -m ibrawls_rl.train`
3. **Watch:** `tensorboard --logdir runs` → open http://localhost:6006
4. **Grade a finished brain:** `python -m ibrawls_rl.evaluate runs/run1/final_model.zip`

That's the loop. The bot improves; you read the graphs; you adjust `config.toml`; repeat.

## 3. Reading TensorBoard (what "good" looks like)

Open it, look at these (ignore the rest at first):

| Graph | Plain meaning | You want |
|---|---|---|
| **eval/win_rate** | % of test matches won | going **up** |
| **rollout/ep_rew_mean** | average reward per match | going **up** |
| **rollout/ep_len_mean** | average match length (ticks) | going **down** = decisive wins |
| **train/explained_variance** | can the bot predict how a match will go? | rising toward **1.0** |
| **train/entropy_loss** | how random the bot still is (starts ≈ −6.5) | drifting **toward 0**, slowly |
| **train/approx_kl** | how much the brain changed per update | small, ~**0.005–0.03** |

The **TEXT tab** shows the exact settings that produced the run (with descriptions), so you
can always see what a graph was trained with. Each run is a separate colored line — keep each
run in its own `logging.dir` (e.g. `runs/run1`, `runs/run2`) to compare them side by side.

## 4. Diagnosing + which knob to turn

| Symptom | Likely cause | Fix in config.toml |
|---|---|---|
| win_rate flat near 0 | opponent too hard to start | `opponent = "random"` first |
| nothing moves at all | learning too slow / stuck | raise `learning_rate` (e.g. 0.0005) |
| graphs spiky, win_rate jumps around wildly | steps too big / unstable | lower `learning_rate` (0.0001) |
| reward rises but win_rate flat | bot is **gaming the shaping** (e.g. hoarding the ball, never scoring) | lower `possession` / `ball_progress`, or raise `win` / `goal_scored` |
| gets decent then stops improving early | stopped exploring too soon | raise `entropy_coef` (0.02–0.05) |
| `explained_variance` negative | value predictor failing | lower `learning_rate` |

## 5. The reward, explained (the most important tuning idea)

The bot does **exactly what pays best** — so the reward *is* the strategy. The trap:

> **Dense rewards add up over thousands of ticks.** `possession = 0.002` per tick, held for
> 1800 ticks, pays **3.6** — more than scoring a goal (`1.0`) or winning (`1.0`).

So if dense terms (`possession`, `ball_progress`) are too big, the bot learns to *hold the
ball forever* instead of scoring. The cure: keep dense rewards small relative to
`goal_scored` / `win`, or start with them larger (to learn the basics fast) and **shrink them
in later runs** so the bot optimizes the real objective.

Sparse rewards (`win`, `goal_scored`, `goal_conceded`) = the true goal.
Dense rewards (`possession`, `ball_progress`, `kill`, `death`, `time_penalty`) = hints that
help early learning but can mislead if too strong.

## 5b. Combat mode (deathmatch) — one generalist for 1v1 + FFA

Set `mode = "combat"` in `config.toml`. Combat trains **one model that handles 1v1, free-
for-all, and team deathmatch at any kill total**, by playing a *mix* of match sizes at once
and re-randomizing the teams each episode (`[combat]` section):

```toml
[run]
mode = "combat"
[combat]
world_sizes      = [2, 2, 2, 2, 4, 4, 8]  # 2 = a 1v1, 4/8 = FFA/teams; the mix = generalization
kill_min         = 10
kill_max         = 25
randomize_layout = true
```

Combat always **self-plays** (the model plays every role), so there's no `opponent` setting.
Train it the same way: `python -m ibrawls_rl.train`. To grade a combat model, duel it vs a
random bot in 1v1:

```bash
python -m ibrawls_rl.evaluate runs/combat/final_model.zip --mode combat --matches 200 --kill-target 10
```

You'll end up with **two models**: one grifball, one combat — load whichever matches the live
game mode.

## 5c. Domain randomization (surviving balance patches)

Your game's mechanics are live-tunable, so a brain trained at one balance can drift when you
patch speeds/reach/timings. Turn on **domain randomization** to train across a *band* of
settings so small/moderate patches land inside what it already knows:

```toml
[randomize]
enabled = true
pct     = 0.15   # each episode jitters speeds, reach, dash, weapon timings, etc. by +/-15%
```

It applies to both modes. Recommended flow: train first with `enabled = false` (learns the
core skill faster at the fixed preset), then a second phase with `enabled = true` to harden it.
Bigger `pct` = more robust but slower to learn. It only randomizes the mechanics the sim
models and reads (see `src/sim/SIM_AUDIT.md`); `maxHP`, goal targets, and toggles are left
fixed.

## 5d. Mechanics-aware brain (adapts to the current balance)

The brain *sees the current game mechanics* as part of its observation (a normalized block of
the live-tunable knobs — speeds, reach, timings — as deviation from nominal). This is always
on. Two payoffs:
- Paired with domain randomization, the brain learns to **read the balance and adjust its
  play** ("attack range is shorter today → close the gap more"), instead of just being robust.
- After a balance patch, point the sim at the new preset and the brain already conditions on
  it — less retraining.

Nothing to configure. (Internally the observation grew to include this block; the Python side
reads all dims from the handshake, so it adapts automatically.)

## 5e. If it's NOT learning (win-rate flat at 0)

Symptom: `eval/win_rate` stays ~0 and `ep_return` sits at a big negative number (≈ the time
penalty over a full timeout). It means the brain never reaches the action (ball/enemy) under
random exploration, so it gets no reward signal. The default 6-minute / goal-target-3 match is
brutal for a *from-scratch* brain. Use a **learning-friendly stage 1**, then lengthen:

```toml
[run]
match_minutes = 1.0     # short, decisive matches => many more episodes
goal_target   = 1       # grifball: first goal wins (fast resolution)
total_steps   = 3000000 # give it room; this is a hard-exploration task
[reward]
approach      = 0.03    # the foothold that leads the brain to the ball/enemy (raise to 0.05 if still stuck)
```

A healthy run shows `train/explained_variance` rising AND `train/entropy_loss` *falling* from
~−6.5 toward 0. If explained_variance rises but entropy stays pinned at max, the policy isn't
committing — raise `approach`, lower `match_minutes`, or give it more steps. Once it's winning,
raise `match_minutes`/`goal_target` back toward real-match values and continue (warm-started).

## 6. Recommended path (the curriculum)

Start easy, get harder. Each stage is its own run/folder so you can compare:

```toml
# config.toml — Stage 1
[run]
opponent = "random"
total_steps = 3000000
[logging]
dir = "runs/s1_random"
```
**Each stage must continue from the previous one** — set `[network] init_model` to the prior
stage's saved model, or you're just training three separate from-scratch brains (a common
gotcha). Keep `width`/`depth` the same across stages.

```toml
# Stage 1 — from scratch vs random. Train until eval/win_rate plateaus HIGH (>0.9), not 0.6.
[run]
opponent = "random"
[network]
init_model = ""
[logging]
dir = "runs/s1_random"

# Stage 2 — self-play, CONTINUING from stage 1:
[run]
opponent = "self"
[network]
init_model = "runs/s1_random/final_model.zip"
[logging]
dir = "runs/s2_self"

# Stage 3 — vs the heuristic, CONTINUING from stage 2:
[run]
opponent = "heuristic"
[network]
init_model = "runs/s2_self/final_model.zip"
[logging]
dir = "runs/s3_heur"
```

Notes:
- **Don't advance until the stage is actually good.** A 60% win rate vs random means
  undertrained — give it more `total_steps` until it plateaus (>0.9) before moving on.
- The **heuristic is a near-shutout** — treat it as a *final exam*, not a starting point.
  Expect it to be hard even with a strong self-play base; 0% from a weak/cold brain is normal.
- During a `self` stage, `eval/win_rate` is measured **vs random** (a yardstick that rises);
  during a `heuristic` stage it's measured vs the heuristic.

`self` = the bot plays copies of itself (it invents its own counters). `heuristic` = the
strong scripted bot — a hard final exam, not a starting point.

## 7. Grading a brain properly

The in-training `eval/win_rate` is a quick 24-match check. For a real grade, run more matches
on a saved model:

```bash
python -m ibrawls_rl.evaluate runs/s1_random/final_model.zip --opponent random   --matches 200
python -m ibrawls_rl.evaluate runs/s3_heur/final_model.zip   --opponent heuristic --matches 200
```

Checkpoints during a run live in `runs/<name>/checkpoints/` — you can evaluate any of them the
same way to see how the bot improved over time.

## 8. Speed notes

- It's CPU-bound on the **simulation**, not the brain. Bigger `parallel_matches` = more data
  but more CPU.
- The GPU only helps a **big** brain (`network.width`/`depth`); a small one is fine on CPU.
  See README.md → "GPU (CUDA)".
