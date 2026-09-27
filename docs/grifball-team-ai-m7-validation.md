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


## Follow-up audit across milestones 1–7

The initial milestone 7 slice was committed as `f9c943d`. The subsequent audit checked the planner, live execution boundary, Lab setup, module/lifecycle invalidation, passing and evaluation contracts against the unchanged roadmap. Milestones 1–6 have implementation and automated regression coverage; that does not establish all behavioral acceptance criteria. Milestone 7 remains incomplete for the gates listed above.

| Milestone | Implementation and regression evidence | Acceptance limits |
| --- | --- | --- |
| 1 — shared roles and spacing | Single retriever, stable slots, copied snapshot, roster-order checks, human/neural ownership, before-combat movement and lifecycle reset tests | General match behavior still needs broader playtesting |
| 1.5 — AI Lab | Presets/schema migration, team overrides, module fallback, pause/step/restart, seeded A/B, retained batch metadata and restoration | Human-controlled runs remain exploratory |
| 2 — space and threats | Geometry/route invalidation, mechanics-based estimates, blocked routes, exposure scoring; added reachable-retriever regression | Ground navigation and attack estimates are approximations; the 32-player obstacle stress case remains expensive |
| 3 — runner and escort | Cut/advance/wait/retreat/finish, bounded patience, commitment, rear coverage and observed human heading tests | Tests do not establish breakthrough rates or human escort quality |
| 4 — purposeful tanking | Coverage reservation, recovery rotation, bounded double commit, release and outnumbered delay tests; live coordinator integration | Fight utility is heuristic and needs outcome comparisons |
| 5 — defense and passing | Interception/containment/safety, respawn projections, live pass charge/revalidation/settling/pickup and cancellation tests | Predicted timing and moving respawn selection can differ from execution |
| 6 — styles and adaptation | Bounded tuning, seeded near-equal alternatives, evidence/confidence gates, reset and urgent-event cadence tests | Recognizable styles and enjoyable variation require human review |
| 7 — evaluation and integration | Shared contract, ready-hammer parity, seeded mirrored scenario batches, paired estimates and denominators | Full matches, broader execution parity, isolated planning cost, held-out improvement evidence and human playtests remain open |

### Bugs reproduced and fixed

1. **Scenario health could depend on the previous play.** Lab setup reused each bot's current maximum health, including an earlier carrier boost, and only changed the new carrier's weapon. Join runner also bypassed normal carrier health transitions. Scenario setup now initializes ordinary health from current mechanics and uses the live carrier transition for both scripted and human carriers. A regression loads escort → pickup → escort with non-default health and then joins the runner; it checks fresh health, removal of the old boost and healing-memory reset.
2. **An unreachable bot could monopolize recovery.** Retriever selection used straight-line distance and retained an incumbent across a sealed wall; an unreachable human approach could also suppress bot recovery. With space awareness enabled, selection and reassignment now use checked route distance and reject blocked human recovery. A regression closes a passage during a live assignment, checks immediate reassignment to the reachable teammate, then checks observed-human and disabled-space fallback behavior.

Both regressions failed before their fixes and passed afterward. README behavior notes were updated; the implementation plan was not edited.

### Audit verification

- Final gameplay/component selection: **470/470 passed**, including the two new regressions.
- Focused Lab/live objective checks: **33/33 passed**; focused space/team/passing checks: **22/22 passed**.
- TypeScript: passed with a 12 GB heap.
- Production build: passed; existing large-chunk warnings remain.
- Full repository run at the initial audit checkpoint: **1,418/1,423 passed**; the same five V3 failures listed above remain. This run started before the two audit fixes. The affected gameplay selection, live/headless adapter checks, type checking and build were repeated on the final code.
- Live/headless adapter checks after the fixes: passed.
- Browser: Championship Stadium, classic models, seven scripted bots, escort scenario, seeds 1–2, balanced opponent, mirrored sides, five seconds per run. **8/8 runs completed**, all four baseline/candidate pairs had exactly equal counters for identical tuning. Every exported setup had carrier max health 2 and ordinary max health 1. These trials verify the harness, not improvement.
- Browser: Load escort → Join runner → Resume showed the player holding the ball with **2/2 HP** and a 2 HP maximum. No browser console errors were returned during the batch check.
- `git diff --check` passed. The attached implementation plan was unchanged.


## Validation pass — lifecycle, contract and cost

This pass starts from `a90ea8e`. It expands acceptance evidence without changing the attached implementation plan or the neural policy contract.

### Lifecycle regression and fix

A new integration test exercises the actual live objective update, team planner, spawn callback and evaluation tracker across countdown, pickup, two goals, the intermediate round reset and match termination. Carrier positions are scripted to reach the goal; combat and autonomous match success are not simulated by this test. It verifies no countdown/terminal pickup, no repeated goal during the scored hold, normal carrier health transitions, cleared orders/charge/runner/tank/style memory, separate team spawns and exactly two completed scoring possessions.

The test reproduced a round-reset bug: an observer camera at `(0, 25, 25)` moved to the blue player spawn at `(-40, 0, -3)`. The spawn callback also reserved this position for the invisible observer. Round placement now preserves the observer camera, skips observer bots and allocates spawns only to participants. The regression failed before the fix and passed afterward.

### Expanded parity scope

Additional adapter tests compare copied observations and resulting plans across countdown, playing, scored hold, a new round and matchEnd. Another advances the shared ball physics for 660 fixed ticks through thrown, loose and idle/auto-return states, comparing snapshots and recovery plans at every tick. This validates the contract and shared ball subsystem. It does not close the documented sword/punch, combat geometry or respawn execution differences.

### Isolated performance evidence

Added `scripts/sim/grifballValidationBench.ts`. Reproduce with `node --import tsx scripts/sim/grifballValidationBench.ts`. It uses the live adapter, seven bots plus an observed human, default tactics, 120 warm-up ticks and 600 measured fixed ticks, with static ready actors and cached geometry. It reports each stage separately and imposes no hardware-dependent test threshold.

| Eight participants | Snapshot p95 | Planner refresh median / p95 | Between-refresh p95 | Evaluation p95 |
| --- | ---: | ---: | ---: | ---: |
| Open fixture | 0.070 ms | 2.072 / 2.965 ms | 0.055 ms | 0.135 ms |
| Two obstacles | 0.070 ms | 12.786 / 15.256 ms | 0.049 ms | 0.117 ms |

Each fixture produced 46 refreshes during 10 measured simulation seconds. Measurements isolate warm calls in Node; they exclude the coordinator, rendering, combat, cold geometry and dynamic urgent events. A refresh runs on one tick, so averaging its cost over the refresh interval would hide possible frame stalls. The obstacle refresh consumes much of a 16.7 ms frame budget before other gameplay/rendering work, so this performance gate remains open.

The existing forced-refresh benchmark also ran: 8/open median 2.13 ms, p95 3.39 ms; 8/obstacles median 12.40 ms, p95 17.45 ms; 32/open median 15.56 ms, p95 19.90 ms; 32/obstacles median 128.84 ms, p95 133.82 ms. The 32-participant case exceeds the supported roster and is a stress test.

### Automated results

- Gameplay/component selection excluding V3/animation suites: **471/471 passed**.
- All `src/sim` tests: **135/135 passed** (including **6/6** tactical-adapter tests).
- Focused live-plan/lifecycle plus adapter selection: **25/25 passed**.
- No full repository rerun in this pass; the preceding audit's five V3 failures remain unresolved and are listed above.

- TypeScript: passed with a 12 GB heap after correcting the new sparse test-map fixture's type assertion.
- Production build: passed; existing large-chunk warnings remain.
- After extending the lifecycle test to cover observer bots and returning to a participating human, its live-plan suite passed **19/19**. Runtime code was unchanged after the successful gameplay/type/build checks.
- `git diff --check`: passed. The attached implementation plan remains unchanged.

### Live browser results after the fix

Local Vite app on port 3000, classic models, seven scripted bots in observer trials (main AI configured as custom, six other bots normal). Baseline and candidate were identical, so these trials test repeatability rather than improvement. Health mechanics were ordinary max HP 1, runner HP 2; goal target 5.

| Arena | Scenario | Seeds | Opponents | Duration / run | Completed | Matching A/B pairs |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Championship Stadium | Goal approach | 1 | Balanced | 30 s | 4/4 | 2/2 |
| Forerunner Canyon Plateau | Respawn recovery | 21, 22 | Balanced, patient, aggressive | 4 s | 24/24 | 12/12 |

Both batches included mirrored legs. Matching means every raw team metric was exactly equal between each identical-config baseline/candidate pair; machine-dependent timing was excluded. Each Stadium run recorded 1 goal and 1 completed possession per team across 1,800 ticks, exercising multiple scored holds/round resets. Each Canyon run recorded 240 ticks and no goals, as expected for a short recovery trial; its exported map had four collidable objects. The Canyon runs alone do not establish scoring or complete-match quality.

- The elevated observer view remained in place after Stadium round resets. Both arenas rendered nonblank WebGL scenes, visible bots and tactical lines; screenshots were inspected.
- Pause held the long trial at 27.25 seconds after the current frame completed; Run resumed it. Step remains disabled during batches by the current UI.
- Team roles, Spacing, Space / threats, Runner / escort, Tanking, Defense / passing and Styles panels all opened with their controls.
- The Stadium report survived quitting to the title and starting the Canyon arena. A single-seed report correctly displayed insufficient data for confidence intervals.
- No browser console errors were returned. Existing Three.js material/deprecation warnings and localhost network-metadata fallback warnings were observed; these were not treated as AI correctness failures.
- An earlier browser batch was interrupted by development-server reloads while test files changed and is excluded from these results. Final trials ran after code edits and the production build.

### Acceptance decision

The first validation pass closes one concrete observer lifecycle bug and expands match-lifecycle, adapter and reproducibility evidence. It does **not** accept milestone 7 as complete. Next priorities are obstacle-route refresh cost, a true autonomous full-match batch mode (initial countdown through termination, including timeouts), broader live/headless combat and spawn parity, and candidate-versus-frozen-baseline trials on held-out scenarios/maps. Human review is still required for readable teamwork and enjoyment. Existing five V3 failures were not fixed or rerun in this pass.
