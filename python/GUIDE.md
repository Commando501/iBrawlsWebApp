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
Run it, confirm win_rate → ~1.0. Then change `opponent = "self"`, `dir = "runs/s2_self"`,
`total_steps = 10000000`, run again. Then `opponent = "heuristic"`, `dir = "runs/s3_heur"`.

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
