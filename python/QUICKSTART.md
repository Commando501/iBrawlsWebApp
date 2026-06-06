# Quick start

Everything is driven by **one file** (`python/config.toml`) and **three commands** (train,
watch, grade). Setup is already done on this machine.

## 0. Open a terminal in the python folder

```powershell
cd G:\git\iBrawlsWebApp\python
.\.venv\Scripts\Activate.ps1     # activates the venv (now `python` = the trainer's python)
```
If activation is blocked, just prefix commands with `.\.venv\Scripts\python.exe` instead of `python`.

## 1. Edit the control panel

Open `config.toml`. Every setting has a comment. The ones you'll touch first:

```toml
[run]
mode = "grifball"     # "grifball"  or  "combat"
opponent = "random"   # grifball only: random -> self -> heuristic
total_steps = 3000000
[logging]
dir = "runs/run1"     # give each run its own folder
```

## 2. Train

```powershell
python -m ibrawls_rl.train          # reads config.toml
```
Leave it running. (It auto-launches the game sim itself — you don't start anything else.)

## 3. Watch it learn

In a second terminal (same folder, venv active):
```powershell
tensorboard --logdir runs
```
Open http://localhost:6006. Watch **eval/win_rate** (should rise) and **rollout/ep_rew_mean**.
The **TEXT** tab shows the exact settings that produced the run. Full "how to read the graphs"
guide is in `GUIDE.md`.

## 4. Grade a finished brain

```powershell
# grifball:
python -m ibrawls_rl.evaluate runs\run1\final_model.zip --opponent heuristic --matches 200
# combat:
python -m ibrawls_rl.evaluate runs\run1\final_model.zip --mode combat --matches 200
```

---

## The two brains you're building

**Grifball** (`mode = "grifball"`) — carry the ball to the enemy plate. Curriculum, easy→hard:
```
opponent = "random"     # learns the basics (win rate -> ~1.0)
opponent = "self"       # plays copies of itself
opponent = "heuristic"  # the strong scripted bot (a hard final exam, not a start)
```

**Combat generalist** (`mode = "combat"`) — one brain for 1v1 + free-for-all + team deathmatch,
any kill total. Always self-plays. Controlled by `[combat]`:
```toml
[combat]
world_sizes = [2, 2, 2, 2, 4, 4, 8]   # 2 = a 1v1, 4/8 = FFA/teams; the mix = generalization
kill_min = 10
kill_max = 25
```

You end with **two `final_model.zip` files** — load whichever matches the live game mode.

## Robustness + adaptivity (already wired)

- **Domain randomization** — `[randomize] enabled = true, pct = 0.15` jitters mechanics each
  episode so the brain survives live balance patches. Train core skill first with it `false`,
  then a hardening phase with it `true`.
- **Mechanics-aware** — the brain always sees the current balance, so it adapts its play (and
  to a patch). Automatic, nothing to set.

## Recommended first session (≈ your first hour)

```toml
# config.toml
[run]
mode = "grifball"
opponent = "random"
total_steps = 1500000
[logging]
dir = "runs/first"
```
```powershell
python -m ibrawls_rl.train
# (second terminal) tensorboard --logdir runs   -> watch eval/win_rate climb to ~1.0
python -m ibrawls_rl.evaluate runs\first\final_model.zip --opponent random --matches 200
```
Then flip `opponent = "self"`, `dir = "runs/selfplay"`, bump `total_steps`, and go again.

## Going fast: multi-worker + GPU

The sim is CPU-bound and one worker = one CPU core. To feed a GPU (or just go faster), run
several sim processes in parallel and let the policy crunch one big combined batch:

```toml
[run]
num_workers = 8     # ~your physical core count; spreads the sims across cores
device = "cuda"
[network]
width = 1024        # a big net is finally worth it once the batch is large
depth = 3
```

- `num_workers` parallelizes the **sim** across cores (combat splits `world_sizes` across
  workers; grifball splits `parallel_matches`). The combined batch = sum of all workers.
- A bigger batch + bigger net is what actually loads the GPU (vs. ~100% overhead on a tiny
  net — see below). Rule of thumb: `num_workers` ≈ physical cores; grow the batch until the
  GPU does real work.

## GPU (optional, your 4090)

Default torch is CPU-only. For a big network on the GPU:
```powershell
pip install --force-reinstall torch --index-url https://download.pytorch.org/whl/cu124
```
Then in `config.toml`: `[run] device = "cuda"` and `[network] width = 1024, depth = 3`.
(A small net is fine on CPU; the GPU only pays off for a big one — see `README.md`.)

## Reference docs

- `GUIDE.md` — plain-English: reading graphs, tuning knobs, reward shaping.
- `README.md` — architecture, GPU details, termination/truncation.
- `../src/sim/SIM_AUDIT.md` — which game mechanics the sim models (fidelity to the live preset).
