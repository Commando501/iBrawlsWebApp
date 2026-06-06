# `python/` — iBrawls RL trainer

PPO self-play over the headless TypeScript Grifball sim (`src/sim/`). Python owns the
learning stack (PyTorch + Stable-Baselines3); the TS server owns game-truth. They talk
over a **batched binary protocol** so tens of millions of steps move only flat tensors.

## How it connects

```
 Python (PPO)  ──HELLO(json)──▶  Node vec-env server (npx tsx src/sim/server/main.ts)
   GrifballVecEnv               ◀──header(json)──
        │       ──RESET / STEP(int32 actions)──▶   N parallel SimState matches
        ▼       ◀──obs+reward+done (raw f32/u8)──
   SB3 PPO MlpPolicy
```

- `ibrawls_rl/protocol.py` — wire format, the mirror of `src/sim/server/protocol.ts`
  (uint32 BE length prefix; little-endian `<f4`/`<i4` payloads; JSON only at handshake).
- `ibrawls_rl/envs/grifball_vec_env.py` — `GrifballVecEnv(VecEnv)`: spawns the Node
  server, handshakes, and exposes the **learner team's** agents as `numEnvs × agents/team`
  sub-envs. The opponent team is driven by the sim's built-in heuristic
  (`opponent="heuristic"`) or the shared policy (`opponent="self"`).
- `ibrawls_rl/spaces.py` — builds `Box` / `MultiDiscrete` spaces from the handshake header
  (TS `ENV_SPEC` is the single source of truth; nothing is hard-coded here).
- `ibrawls_rl/policies.py` — SB3 MLP `net_arch` + a standalone PyTorch `ActorCritic` for
  the CleanRL self-play path.
- `ibrawls_rl/selfplay.py` — `PolicySnapshot` save/load + a latest-biased PFSP
  `OpponentSampler` for the frozen-snapshot league.
- `ibrawls_rl/train_ppo.py` — SB3 PPO baseline (learner vs heuristic), TensorBoard,
  checkpoints, periodic eval.
- `ibrawls_rl/eval.py` — win-rate / episodic-return vs heuristic.

## Setup

```bash
cd python
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .[dev]                          # or: pip install -r requirements.txt
# Node side (run once at repo root): npm install
```

The env spawns the server with `npx tsx src/sim/server/main.ts` from the repo root.
Override with `IBRAWLS_SIM_CMD` (e.g. a prebuilt `node dist/...`).

## Train / eval

```bash
# Start vs a beatable opponent — the learning signal (Verification #7) is clearest here:
python -m ibrawls_rl.train_ppo --opponent random --num-envs 32 --steps 1500000 \
    --n-steps 128 --batch-size 4096 --goal-target 3
# Then curriculum up: self-play, then vs the (very strong) heuristic.
python -m ibrawls_rl.train_ppo --opponent self      --num-envs 32 --steps 5000000
python -m ibrawls_rl.train_ppo --opponent heuristic --num-envs 32 --steps 10000000
tensorboard --logdir runs                        # watch eval/win_rate rise
```

`--opponent`:
- `random`  — built-in random opponent (curriculum entry point; learns fast).
- `self`    — shared policy controls both teams (true self-play).
- `heuristic` — the built-in scripted bot. **It is a ~100% shutout opponent**, so a from-
  scratch policy gets no gradient foothold against it (it never gets the ball → only
  uncontrollable negative reward). Reach it via curriculum, not cold.

## Tests

```bash
pytest                 # pure protocol-parity tests always run;
                       # the end-to-end handshake test needs npx/tsx + deps (else skipped)
```

## Termination vs truncation

A real match end is a true terminal. A `maxTicks` cut-off is a **truncation** — and these are
common early (near-random policies stall: ~75% of episodes truncate). The env always exposes
`info["truncated"]` + `info["terminal_observation"]`.

Whether a truncation **bootstraps** its value (`info["TimeLimit.truncated"]`) is opt-in
(`--bootstrap-truncation`, default **off**). Measured on this task, bootstrapping truncations
learns *slower*: it rewards "stall to timeout," weakening the drive to actually score. Default
(off) treats the cut-off as a failed terminal, which pressures winning — empirically ~0.5 win
rate vs random by 1M steps, vs ~0.09 with bootstrapping on.

## GPU (CUDA)

The 4090 only accelerates the **policy network**, not the env (the Node sim runs on CPU over
the pipe). For the default tiny MLP, SB3 itself recommends CPU — GPU transfer overhead per step
outweighs the compute. The GPU pays off once you **scale the network + batch**.

1. The default venv has a **CPU-only** torch. Install a CUDA build (4090 = Ada, any recent CUDA):
   ```bash
   pip install --force-reinstall torch --index-url https://download.pytorch.org/whl/cu124
   python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
   ```
2. Train with a bigger net so the GPU is worth it:
   ```bash
   python -m ibrawls_rl.train_ppo --device cuda --policy-width 1024 --policy-depth 3 \
       --num-envs 64 --n-steps 128 --batch-size 16384 --opponent random
   ```
   Flags: `--device {auto,cpu,cuda}`, `--policy-width`, `--policy-depth`, `--batch-size`.

**Important throughput caveat (weak CPU):** the vec-env server runs all `num_envs` matches in a
*single Node process* = one CPU core. Raising `--num-envs` grows the batch but not sim
parallelism. To use multiple cores for the sim you need multiple Node worker processes (the
documented scaling lever, not yet wired) — that, plus the GPU for a large net, is what actually
helps a CPU-limited box.

## Notes / optional

- **Multi-worker (`num_workers`)**: `GrifballVecEnv` spawns N Node sim processes (a `SimWorker`
  each) across CPU cores and concatenates their agents into one flat batch. Per step it sends
  STEP to all workers, then reads all responses, so they compute in parallel. This is how you
  scale the CPU-bound sim and feed a GPU a large batch. Throughput scales with cores
  (sub-linear at small per-tick loads, where per-step IPC/Python overhead dominates).
- `VecNormalize` (obs/reward running stats) is not applied (obs are already hand-normalized);
  add it if longer runs prove unstable.
