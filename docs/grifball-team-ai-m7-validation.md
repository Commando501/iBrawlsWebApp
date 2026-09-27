# Milestone 7 — initial implementation and validation

Date: 2026-09-26. Branch: `codex/grifball-team-tactics`.
Milestone 6 checkpoint: `c7be970` (`feat(grifball): add team styles and adaptive tactics`).

This is the first implementation slice of milestone 7, not acceptance of the entire milestone. The attached implementation plan is unchanged.

## Implemented

- Tactical observation contract v1: copied actor/ball/goal data, full roster identity including inactive members, explicit policy ownership, difficulty, passing rules and geometry. The live planner now uses the shared builder. The opt-in headless adapter requires an explicit scripted roster and interprets its remaining weapon timers using headless mechanics.
- Existing neural observation/action schemas, policy execution and `stepSimulation` remain unchanged. No trained policy receives new inputs or scripted commands.
- Batch evaluation in the existing AI Lab: selected scenario, 1–20 consecutive unsigned seeds, 1–120 seconds per run, three frozen opponent styles, baseline/candidate and optional mirrored legs. Blue's resolved tuning follows its original roster onto red. The arena itself is unchanged, so asymmetric map geometry remains part of each side's trial.
- Batch roster lock through the normal orchestrator prevents normal team/config distribution from undoing mirrored identities. Unexpected roster, mechanics or combat-profile drift cancels the batch instead of publishing a mislabeled trial. The lock ends on completion/cancel/close. The pre-batch state, teams, memory, clock context and random stream are restored.
- Per-team possession, goal, turnover, coverage, exposure, role-change and stuck-time counters. Same-team passes and loose-ball intervals retain ownership until an opposing pickup or goal. Completed-possession denominators exclude unfinished plays. Pressure metrics use actual positions and fixed evaluation thresholds rather than awarding good spacing to passive teams. Shared exposure is a plausibility estimate, not confirmed splash damage.
- Paired candidate-minus-baseline estimates: average mirrored sides and selected opponent styles within each seed first, then form exploratory 95% paired t intervals over seeds. Missing opportunities and fewer than two complete seed groups have no interval. The display does not rank by kills or claim general improvement.
- Reports retain frozen tuning, mechanics, combat presets/roster overrides, map, input mode, initial ball/roster setup, seed/opponent/side, raw counters and whole simulation tick timing. Last three reports survive map/session changes until page reload. JSON is available in the panel. Maps are evaluated separately; there is no automatic cross-map pooling or report replay importer.

## Automated checks

- Final focused selection: **47/47 passed**. Includes live/headless equivalent ready-hammer fixtures and identical resulting plans, copying/ownership, remaining weapon timing, headless spawn projection, possession accounting, denominators, seed-cluster intervals, frozen configuration, pause/cancel/close, real roster-orchestrator mirroring and drift cancellation.
- Final gameplay/component selection (excluding V3/animation suites): **468/468 passed**.
- TypeScript: passed with a 12 GB heap.
- Production build: passed; existing large-chunk warnings remain.
- Full repository test run: **1,415 passed / 1,420 total**, five known V3 failures: two-handed hammer pose, carry grip constraints, attack sweep amplitude, default asset budget, Aegis reference proportions. This full run preceded the final mirrored-roster fix; affected gameplay tests, type checking and build were repeated after that fix and after the final configuration-drift checks.
- `git diff --check`: passed for the implementation paths.

## Live browser verification

Local app on port 3000, Championship Stadium, seven scripted bots in observer scenarios.

- An initial mirrored goal test revealed that normal roster distribution reversed the test's team swap. Fixed in the roster bridge/orchestrator and covered by a regression test. Reports from that pre-fix session were discarded by reloading.
- Final test with classic models: goal scenario, seeds 1 and 2, balanced/patient/aggressive opponents, two sides, baseline and candidate, two seconds per run: **24/24 runs complete**. All 12 baseline/candidate pairs had exactly equal tactical counters for identical tuning. Every focal-team run recorded one goal and one completed possession, including red-side trials. This checks the harness, not improvement.
- After adding combat-profile metadata and configuration-drift checks, a final two-seed, balanced-opponent, mirrored goal batch completed **8/8 runs**. All four pairs matched, each focal team scored once, and exported JSON contained the roster overrides and preset list.
- Pause/resume retained progress. Cancel retained a labeled partial report, returned the original session and released the batch controls. Unit tests additionally verify restoration and lock release.
- Missing possession/pressure samples render as insufficient data; single-seed results do not claim confidence intervals. The complete two-seed report displays zero differences for identical configurations.
- At a 390 px viewport, Lab width was 390 px (client/scroll width 389/389), and the batch region client/scroll width was 342/342. Temporary viewport override reset afterward. Desktop panel and results were visually inspected.
- No browser console errors were returned during the final verification session. This is not an audio or human enjoyment validation.

## Planning benchmark

Existing `scripts/sim/grifballSpaceBench.ts`, run after the full test/build work finished. Milliseconds per planning refresh; this profiles the planner, not the new snapshot adapter or whole frame.

| Participants | Obstacles | Cold | Median | p95 | Max |
| --- | --- | ---: | ---: | ---: | ---: |
| 8 | No | 25.03 | 2.28 | 3.47 | 4.48 |
| 8 | Yes | 75.65 | 12.82 | 14.72 | 19.20 |
| 32 | No | 21.46 | 16.28 | 19.88 | 21.77 |
| 32 | Yes | 140.70 | 133.77 | 140.03 | 141.23 |

The 32-player obstacle stress case remains expensive. Batch-exported timing is whole simulation tick cost, includes combat/objectives and cold work, varies with machine/load, and is deliberately excluded from deterministic metric equality and confidence estimates.

## Remaining milestone 7 gates

1. Full-match batches with countdown, respawns and match termination, plus broader seeded scenarios and maps. Current batches repeat one chosen scenario on the current map.
2. Full live/headless execution parity. The shared contract and equivalent ready-hammer plans pass, but sword/punch timing, recovery/spawn behavior and combat geometry still differ. These differences are surfaced, not concealed by feeding elapsed animation values into remaining headless timers.
3. Isolated planning-cost instrumentation and broader performance budgets, including snapshot/evaluation overhead.
4. Candidate-versus-frozen-baseline evidence that generalizes across held-out seeds, maps and opponents. No improvement has been established by identical-configuration tests.
5. Human playtests of tactical readability and enjoyment.
6. Only after these gates: optional versioned learned-policy inputs/actions, teacher or hierarchy integration, and retraining. Existing neural policies remain separate.
