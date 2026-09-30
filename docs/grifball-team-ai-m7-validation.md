# Milestone 7 — initial implementation and validation

Date: 2026-09-26. Branch: `codex/grifball-team-tactics`.
Milestone 6 checkpoint: `c7be970` (`feat(grifball): add team styles and adaptive tactics`).

This is the first implementation slice of milestone 7, not acceptance of the entire milestone. The attached implementation plan is unchanged.

## Current tracking update — 2026-09-27

At the user's direction, the five historical V3 animation/asset test failures are retired from the active issue list and VS3 follow-up scope. They are no longer tracked as current gameplay defects or planned V3 fixes in this workstream. The animation expectations belong to the older path preceding Blender gameplay; the asset-budget and proportion entries are also removed by this scope decision, without asserting a newly verified fix.

The dated test results below are historical observations, including their original failure counts. Older statements that these V3 items remain open are superseded by this tracking update. Test code, saved reports and automated verdict rules are unchanged; retirement from the issue list does not turn a failing test run into a passing one.

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


## Validation suite foundation — VS1 (2026-09-27)

The pre-existing validation pass was checkpointed separately in `78aed44` (observer reset fix, lifecycle/parity regressions, benchmark and measured findings). VS1 adds the shared manifest, frozen schedule and report contracts under `src/game/grifballValidation/`, plus a preview CLI. Neither implementation plan was edited.

Delivered behavior:

- Strict versioned manifests with explicit scenarios/matches, supported arenas, roster ownership, seeds, styles, sides, mechanics, 60 Hz ticks, simulation caps and independent wall-clock watchdog declarations.
- Copied effective maps/settings/combat tuning; canonical SHA-256 case/job identities; recursive freezing before exposing a plan. Existing evaluator pairing/configuration rules are reused.
- Quick's 32 jobs and Standard's 184 jobs are fully listed by the preview. The three planned autonomous-match rosters are declarations only; no seven-bot fixture is presented as eight-bot validation.
- Commit plus scoped working-tree content fingerprints include untracked source and tracked deletions. The fingerprint explicitly excludes installed dependencies and public assets; this is a preview contract, not executor/build compatibility evidence.
- Separate profile, automated, repository and milestone 7 verdicts. Missing evidence remains not run; partial/cancelled evidence cannot pass. Foreign/duplicate results and impossible state/verdict combinations are rejected.
- JSON preview/manifest exports refuse overwrite. Preview success exits 0; unavailable execution exits 2; invalid input/setup exits 3. The CLI never launches the game or substitutes the headless heuristic evaluator for live gameplay.

Verification:

- Focused suite contract and CLI tests: **40/40 passed**. This includes command-line exports/re-import, exact preview/job correspondence, unchanged map globals, mutation protection, mirrored focal configs, real gameplay mechanic resolution, malformed requests, incomplete results and dirty/untracked/deleted-code fingerprints.
- TypeScript: **passed** (`tsc --noEmit`).
- Full repository test command: **1,463/1,468 passed**, with the same five existing V3 failures (two-handed hammer pose, carry grip constraints, attack sweep amplitude, default asset budget and Aegis reference proportions). Duration: 366.9 seconds. No tests were skipped or cancelled. The final sparse-evidence rejection assertion and implementation were verified again by the focused suite and TypeScript after this full run had started.
- Saved a real Quick dry-run preview and editable manifest under `output/grifball-validation/vs1-quick-*.json`; all executor gates remain not run. Focused/full test logs are alongside these artifacts. No browser/build rerun was needed for this new CLI/shared-contract slice; it does not change the application runtime or UI.

No new gameplay, execution-parity, performance or quality evidence was collected by this preview. Existing milestone 7 limitations remain. VS2 is next: connect these contracts to the real scenario and autonomous-match runner, with explicit roster ownership and terminal/cap/cancellation handling.


## Live validation runner - VS2 (2026-09-27)

VS1 was checkpointed in `7448cc5` before this implementation. VS2 connects its frozen jobs to `GrifballGame` through a serial browser host and a dedicated development page at `/grifball-validation.html`. Neither implementation plan was edited.

Implemented:

- Shared scenario preparation, mirroring and vector-preserving cloning retain the existing Lab pause/restart/batch behavior. A regression protects the original snapshot's goal center when a Lab caller has no map callback.
- Full matches create fresh scripted combatants at authored spawns, neutral ball, zero goals, normal health/cooldowns/memory, the 522-second default clock and normal countdown. They use the real AI, combat, animation-triggered impacts, physics, objectives and timers. No autonomous trial inserts a carrier at a goal or injects kills.
- Explicit 1v1, 3v4 and eight-scripted-bot 4v4 fixtures use ordinary actor creation and mesh provisioning, with an outside observer. Frozen per-actor combat profiles reach the normal roster callbacks. The existing multiplayer capacity and human/neural ownership paths are unchanged; mixed-ownership regressions remain separate from these scripted-only fixtures.
- Each job waits for arena/roster/mesh readiness, scopes its RNG/time, locks its inputs, collects bounded lifecycle traces and team metrics, and restores its prior state on disposal. Cancellation covers loading and active play; cleanup failures fail the job and stop the queue before another arena starts.
- Match completion, scenario completion, unfinished simulation cap, wall watchdog, cancellation, setup error and invalid state have distinct outcomes. Invariants cover required finite actor/ball state, health, ownership, meshes, frozen tuning/goal target, holder validity, pickup phase, scoring and terminal winner. Trace capacity is 512 entries with an explicit dropped-entry count.
- The pilot page runs offline without registering human input or loading Lab presets, saving replays/player memory or submitting match telemetry. Exports contain the frozen plan and trial evidence. Unavailable browser source identity is explicitly null and cannot produce a suite acceptance pass. Remaining gates are not run.

Clock audit: the offline Grifball clock is displayed and decremented, but reaching zero does not declare a winner/draw. Goal-target `matchEnd` is the real terminal condition. Evaluation caps therefore remain unfinished. The wall watchdog uses real timers and covers loading or stalled simulation progress while the browser event loop can run. A completely blocked/crashed browser requires the external process watchdog planned for VS3.

Measured browser evidence (scripted Normal, V2 Medium, seed 101, balanced style, identical baseline/candidate):

| Trial | Evidence |
| --- | --- |
| Stadium autonomous 1v1 | Both runs reached `matchEnd` at tick 2,777 (46.283 simulated seconds), score 0-2, round 2. Start clock 522, terminal clock 475.7167. Initial countdown ended at tick 181; goals at 1,139 and 2,536; round reset at 1,380. Traces and raw team metrics matched exactly across the pair. |
| Roster/map pilot | All 12 five-second legs ran to 300-tick caps: 1v1 and 3v4 on Stadium, 4v4 on Canyon, baseline/candidate on both sides. Recorded starting actor counts were 2, 7 and 8 respectively. All caps remained inconclusive. |
| Canyon 4v4, 20 seconds | Both 1,200-tick runs scored 0-1 and remained unfinished. Real combat reduced the alive roster from 8 to 5 at tick 707; all 8 were alive again at 798. Further death/respawn transitions occurred at 937/1,028. |
| Stadium pass, 20 seconds | Both runs threw at tick 36, a teammate recovered at 131, scored at 481, and reset at 722. Both completed 1,200 ticks. |
| Goal/reinforcements scenarios | Four five-second jobs completed. Goal runs scored and reset; reinforcement runs restored the scripted dead bots to the live roster. |
| Cancellation | Cancelling while loading returned a cancelled job with no start frame and left later jobs not run. Cancelling active play retained the completed first job and the second job's partial 1,114-tick result. A fresh queue started successfully after cancellation. |

WebGL screenshots were inspected for Stadium and Canyon, including the eight-actor fixture. Browser console error capture was empty during the completed pilots. Development hot reload initially interrupted exploratory runs when test files changed; those runs are excluded. Final trials use a server launched with `DISABLE_HMR=true`. Measurements collected alongside builds/tests are not performance evidence.

Verification:

- Focused contracts, queue/runtime, Lab, live planning/ownership and service-worker routing regressions: **106/106 passed** after the final changes. Includes readiness/late-load cleanup, cancellation, watchdog expiry without ticks, frozen combat profiles, all roster sizes/sides, post-terminal stopping, invalid states, bounded history, prior-roster restoration and cleanup failure.
- Final TypeScript check **passed** with Node's heap raised to 8 GiB; the initial default 4 GiB attempt exhausted the heap.
- Final production client/server build **passed** (Vite 25.55 seconds). Existing chunk-size warnings remain. The development page is not a production build entry.
- Full repository test command: **1,484/1,489 passed**, the same five pre-existing V3 failures: two-handed hammer pose, carry grip constraints, attack sweep amplitude, default asset budget and Aegis reference proportions. Duration 505.2 seconds; no skipped/cancelled tests. Subsequent cleanup/invariant/mirroring hardening and nine additional tests were covered by the final focused run, TypeScript and build.
- Final combined browser smoke: **10/10 jobs completed without runtime/setup errors**, with two genuine match endings, two correctly unfinished caps and six completed scenarios. All five identical-config pairs had exactly equal traces and raw team metrics. The browser Export results button produced `grifball-live-validation.json`; a verified copy at `output/grifball-validation/vs2-final-smoke.json` includes the complete frozen plan and all results. Overall status remains inconclusive because required acceptance gates are missing.
- Artifacts and logs are under `output/grifball-validation/vs2-*`, including autonomous-match, roster, recovery, cancellation and screenshot evidence.

VS2 establishes live execution and useful lifecycle evidence. It does not accept M7: broad engine parity, calibrated performance, held-out improvement, browser crash handling and human teamwork/fun review remain open. VS3 supplies unattended CLI execution, verified build/runtime identity, durable incremental artifacts and the external browser watchdog; VS4 supplies the integrated Lab suite UI.


## VS3 unattended runner validation — 2026-09-27

VS2 was committed as `66c49d1` before this buildout. VS3 adds an unattended CLI, a public validation-page API shared with the live runner, exact Playwright/Chromium pinning, offline per-job contexts, an external Node watchdog, production startup and small Lab control checks, and durable evidence with strict resume/rerun compatibility. The approved implementation plans were not changed.

The CLI builds normal production client/relay output and a separate explicit validation entry. The normal production page has no automation hook. Its loopback server uses port 3000; an existing listener must advertise the exact build/runtime identity to be reused. Only owned listeners/browser processes are closed. The browser job queue uses the existing gameplay tick; no substitute headless policy was added.

Evidence lives in ignored `output/grifball-validation/` directories. Each run saves its complete manifest/plan, source/runtime/build hashes, command logs, checkpoints, per-job frozen fixture/seed/trace/metrics and screenshots. Completed JSON files are flushed and atomically published before proceeding. A new resume directory copies only completed compatible jobs, restarts interrupted jobs, preserves failed-attempt history and rejects changed manifests, inputs, assets, code, dependency lockfiles or browser/runtime identity. A case rerun preserves the full plan with unselected jobs marked not run.

Measured checks:

- 113/113 targeted tests passed across manifest/planning, CLI, evidence recovery, live runner, live runtime, Lab, team planning and service-worker routing (`vs3-focused-tests.log`).
- Pinned-browser fault checks passed for injected invalid state, an HTTP 404 resource, a permanently blocked renderer and an actual Chromium crash (`vs3-driver-tests.log`). The invalid-state transport fixture is separate from the real live-runtime invariant tests.
- A hard-killed writer retained its completed job. Recovery copied that file and retained the interrupted job ID. Identity mismatches and corrupted result hashes were rejected; previous failed jobs and gates remained visible across repeated resumes.
- TypeScript, normal production client/relay build and explicit validation build passed. Production menu startup and the absence of the validation hook were checked in an isolated browser context.
- The production Lab opened through Single Player → AI Behavior Editor. The test switched to Spacing, changed/restored Custom spacing, collapsed/expanded and closed the panel. Screenshot reviewed. This is a small control smoke, not VS4's future suite-panel acceptance test.
- Offline validation initially caught the inherited hosted-font dependency. The dedicated page now uses self-contained styles. A separate identity-scope ordering mismatch was fixed and covered by a regression test.

The complete exploratory quick run (`vs3-quick-03`) executed all 32 jobs: goal, pass and reinforcements completed (24), while all eight pickup legs failed the ball-holder invariant. Every identical-config baseline/candidate pair had exactly equal discrete frames, event traces and team metrics, excluding wall-time simulation-cost measurements (16/16 pairs). This is reproducibility evidence for this matrix, not an implemented VS5 reproducibility gate.

The pickup failure was retained instead of relaxing the invariant or claiming a clean suite pass. More detailed holder health/respawn/tick diagnostics were added for the final run. The trace ends at the last valid sampled frame; the failure summary identifies the subsequent failing tick.

VS5 correctness/reproducibility, execution parity, calibrated performance, held-out quality and human-review gates remain unimplemented or unverified. The current pickup failures require a gameplay follow-up. The full repository suite was not rerun during VS3; the five previously documented V3 failures remain unresolved and are not excused. Standard/acceptance executions invoke that full test command and retain its failures separately from scoped AI evidence.


Final quick run (`vs3-quick-final`, Chromium 153.0.8010.12 / Playwright 1.63.0, Node 20.19.1 on Windows x64): all 32 jobs executed, 24 completed and eight pickup legs failed; exit 1. Typecheck/build/startup passed, all 16 null-comparison pairs had exactly equal gameplay traces/metrics, and the reviewed arena screenshots show the rendered live game. The failing carrier is `validation-red-0`, still recorded as holding the ball with HP 0 and respawn timer 2.9833333333333334. Failure occurs at tick 206 for seed 101 and tick 184 for seed 102, identically on original/mirrored sides and baseline/candidate. Investigate carrier-death cleanup around the objective/skeletal-impact ordering in `activeFrameRuntime.ts`: the objective currently updates before skeletal combat impacts.


A separate final-build autonomous 1v1 pilot (`vs3-autonomous-match`) ran both paired jobs through the public browser API. Each reached the real 2-goal `matchEnd` at tick 2,777 (46.2833 simulated seconds), with exactly equal discrete frames, event traces and metrics. Its production Lab UI smoke also passed. A real active-run cancellation (`vs3-live-cancel`) retained the initial state and partial trace through tick 361, marked cancelled/inconclusive, and cleaned up the browser context. These artifacts do not add acceptance gates to the quick report.


The end-to-end `--resume` check (`vs3-resume-final`) rebuilt compatible artifacts, reused all 24 completed jobs and reran the eight failed pickup jobs from their beginnings. All eight reproduced their original failing tick and holder state. The new report retained eight previous failed attempts and returned exit 1; the original report and per-job files remained intact.


The CLI case-selection check (`vs3-case-rerun-final`, `--resume ... --case goal-quick`) executed only the eight goal legs. Each reproduced its original trace and metrics exactly; the other 24 jobs remained not run. Eight earlier pickup failures remained in the attempt history, so the rerun still returned exit 1 instead of presenting a clean first-run pass. Original, resumed and case-rerun artifacts are separate directories.


## VS3 carrier-lifecycle repair — 2026-09-27

Follow-up to the approved VS3 issue-resolution proposal. The original `vs3-quick-final`, resume and case-rerun artifacts are preserved. The implementation roadmaps were not edited.

The regression reproduced the actual failure mechanism: `advanceGrifballFrameForState` runs the objective before skeletal melee impacts; the real `applyBotMeleeImpactForState` then kills the carrier, leaving ownership stale when rendering starts. The new regression failed on the dead holder before the fix and passed afterward.

`reconcileGrifballCarrierForState` now reuses a narrow, idempotent release operation in objective cleanup and after combat/bounds work, before rendering, stats and replay publication. It drops possession, restores carrier weapon/health-cap bookkeeping without reviving the actor, cancels charge/pass state, clears stale priority and carrier-specific assignments, and forces the next planner update to rebuild orders. It retains the prior tactical snapshot so turnover detection still has its previous holder. It does not advance physics, phases, healing or scoring a second time. The existing goal-before-later-hit ordering is preserved. Local-player pickup and carrier validity also check respawn state; observers cannot pick up the ball.

The runtime's additive, versioned `failureState` diagnostic records validation stage, failing tick, last valid tick, ball/holder state and at most 32 actor summaries. Missing actors and non-finite values remain diagnosable and JSON-safe. This snapshot is separate from valid `end` and trace frames and is retained in durable job files and resume history. Older reports may omit it; changed builds still cannot resume each other's evidence. HTML reports explain where the diagnostic lives.

Verification to date:

- Twelve carrier lifecycle regressions cover late/early death, charged state, order invalidation, repeated cleanup/damage credit, living recovery, local player, respawn, missing actors, round reset, terminal/countdown preservation, multiplayer/non-Grifball ownership and goal ordering.
- The final CLI focused command passed **93/93**, including structured failure snapshots, missing-holder/non-finite/tick-exception diagnostics and durable write/resume coverage. The separate team-plan regression run passed as part of the 56-test initial focused run. Final lifecycle/evidence tests passed **19/19**.
- Full repository command: **1,515/1,520 passed**, five failures, no skipped/cancelled tests, 386.7 seconds (`vs3-fix-repository-tests.log`). The two final added lifecycle/evidence tests were verified afterward in the final focused command. No new repository failure category appeared.
- Fresh run `vs3-fix-quick`: **32/32 scenarios completed**, including all eight formerly failing pickup legs. At the exact former failure ticks (206 for seed 101, 184 for seed 102), pickup traces now show `ballState: loose`, `holder: null` and the dead runner absent from the alive roster. All pickup legs reached tick 300.
- All **16/16 identical-config pairs** matched exactly in termination, initial/end frames, event traces and raw team metrics (`vs3-fix-quick/comparison.json`). Wall-time simulation cost was excluded. This is measured repeatability for this matrix, not the future VS5 gate.
- TypeScript, production client/relay build, explicit validation build and production startup passed. Scenario maps, settings, rosters and seeds match the original frozen cases; only build-dependent input hashes changed. The planner's canonical job order ran goal/pass before pickup despite reordering the input manifest.
- The quick run correctly exits **2 / incomplete** with no failed trials: acceptance gates remain outstanding. These runs occurred alongside other checks and are not performance measurements.

Historical test observations from the repair run (retired from active tracking at the user's direction on 2026-09-27):

| Test | Observed failed assertion | Tracking status |
| --- | --- | --- |
| `v3AnimationFidelity.test.ts:293` | Hammer carry forward direction fails `z < -0.9`. | Retired from active tracking; historical result only. |
| `v3WeaponMotionTracks.test.ts:92` | Same hammer carry forward-direction requirement. The test name mentions grip constraints, but the failing assertion is orientation. | Retired from active tracking; historical result only. |
| `v3WeaponMotionTracks.test.ts:166` | Hammer windup is not sufficiently high above carry. | Retired from active tracking; historical result only. |
| `v3AssetManifest.test.ts:99` | Default source voxel count exceeds its declared limit. | Retired from active tracking; historical result only. |
| `v3ReferenceProportions.test.ts:223` | Built-in Aegis proportion report is not ready: worst width band neck 0.6891, worst depth band waist 0.1432. | Retired from active tracking; historical result only. |

Those V3 assets, animation code and assertions were not modified by this gameplay repair. Full milestone-7 acceptance, calibrated performance, execution parity, held-out quality and human teamwork/fun review remain open.


Final-build autonomous verification (`vs3-fix-autonomous`): both 1v1 jobs reached the real two-goal `matchEnd` at tick 2,777, score 0-2, round 2. Initial/end frames, traces and raw metrics matched exactly between baseline and candidate. This matches the earlier VS3 pilot's terminal tick and score. Typecheck/build/startup passed again; exit 2 remains correct because acceptance gates are missing. The rendered pickup arena screenshot from the quick run was reviewed.


Same-build recovery was also exercised directly through `RunArtifacts.resume` after verifying current source identity: `vs3-fix-resume-copy` retained all 32 completed compatible jobs, with no previous failures, and remained incomplete rather than promoting copied observations into acceptance gates. The original quick report was unchanged.


The end-to-end CLI pickup rerun (`vs3-fix-pickup-rerun`, `--resume vs3-fix-quick --case pickup-quick`) completed all eight selected jobs. Every initial/end frame, trace and raw metric exactly matched the corresponding repaired quick-run job. The remaining 24 jobs stayed not run in the selected-case report; previous failure count was zero. Typecheck/build/startup passed, the compatible build identity was accepted, and exit 2 correctly retained the missing-gate status.


## VS4 Lab controls and report storage — 2026-09-27

VS3 and its carrier-lifecycle follow-up were committed as `8431c90`. VS4 adds a Validation view to the existing Grifball AI Lab; the implementation roadmaps were not edited.

The view offers Quick/Standard scope, explicit Acceptance manifest import, baseline/candidate sources, case removal/map overrides and manifest editing. Freezing resolves the shared immutable plan before Run; exact jobs, caps, required gates and input hashes remain inspectable. A private React arena invokes the shared live executor in production as well as development. The public automation bridge remains confined to the dedicated development/validation page. The existing offline match and its scenario commands are suspended while a suite owns the Lab.

The queue awaits durable checkpoints before each arena and after disposal. Pause applies between jobs and has no active job watchdog; cancellation also releases a paused queue. Closing the Lab cancels. Reloaded running/paused records are displayed as unfinished checkpoints (possibly owned by another tab), with remaining jobs uncredited. Web Locks prevent concurrent Lab suites in tabs on the same origin. Case reruns create new reports and retain the earlier failure.

IndexedDB stores at most 12 reports / 32 MiB total, with an 8 MiB report limit and 512-job browser limit. Per-report traces retain at most 1,024 frames / 64 per trial, separately preserving endpoints, metrics and failure snapshots. Storage failures stop the next job and leave unsaved evidence exportable in memory. The viewer exposes missing evidence, all gate groups including separate human review, per-case termination/diagnostics, JSON import/export, text download and deletion. Imported Lab-format JSON is validated against reconstructed frozen inputs and derived trial verdicts, receives a fresh local ID, and is reference-only. CLI directories and the development pilot's older export remain separate formats. No imported gate can become a current acceptance pass.

Verification:

- **116/116 focused regressions passed**, covering the manifest/planner/report contracts, runner lifecycle, pause/resume/cancel/checkpoint failure, bounded report retention, tampered imports, carrier cleanup, live validation runtime and existing Lab behavior.
- **Two production-browser integration tests passed** on project-pinned Chromium **153.0.8010.12**. They exercise the actual visible controls and live arenas: freeze, run, pause after one completed trial, tuning edit without changing frozen inputs, resume to four completed goal trials, normal reload, JSON/text downloads, import/delete, injected invalid-state report display, and case rerun retaining the original failure.
- An eight-scripted-bot 4v4 match produced a partial cancelled trial with all eight actors in its initial frame. Reloading another active match left an unfinished checkpoint with no fabricated job result. Cross-tab exclusion, cancellation while paused, cancellation on Lab close, and injected IndexedDB quota failure with in-memory JSON recovery also passed.
- Desktop and **390 × 844** screenshots were inspected; the narrow validation region has no horizontal overflow. The main production page exposed no automation hook and the main browser interaction run reported no page errors.
- TypeScript, production client, explicit validation client and relay builds passed. Vite retains its existing large-chunk advisory. Full repository tests were not repeated for this UI/storage slice; prior dated results and their scope decisions remain above.

Evidence: `output/vs4-focused-tests.log`, `output/vs4-ui-test.log`, `output/vs4-typecheck.log`, build logs under `output/vs4-*`, and `output/grifball-validation/vs4-lab-ui/` (desktop/paused/eight-bot/narrow/storage-failure screenshots, downloaded reports and browser identity summary). Earlier failed UI-test locator attempts in that directory are superseded by the final two passing tests.

Browser source identity remains explicitly unverified. Completed trials do not certify VS5 correctness/reproducibility, execution parity, calibrated performance, quality or human review; those gates remain not run and M7 acceptance remains incomplete. Wall-time estimates are not advertised before calibration.


## VS5 gates and acceptance evidence — 2026-09-27

VS4 was committed as `f3bd82b`. VS5 adds executable correctness, reproducibility, execution-parity, performance and quality gates; the implementation roadmap files were not edited. Passing a quick profile remains distinct from milestone 7 acceptance.

- Live observations cover every tick, including canonical actor/ball state, charge, movement, weapon phases, health and role destinations. Sixty-frame SHA-256 pages keep reports bounded; timing and rendering are excluded from exact same-runtime repeatability. Non-finite gameplay state fails explicitly. Scenario expectations cover pickup, goal, pass recovery and reinforcement return; dead assignments have a 60-tick release allowance. Other tactical scenario outcomes remain diagnostic, not blanket tactical-quality certification.
- Different configurations require a separately persisted identical-baseline control matrix before candidate trials. Its extra job/simulation caps appear in CLI previews. Missing control pairs cannot pass. Resume checks the frozen gate protocol as well as existing source/build/runtime identity; previous failures remain visible, including in portable Lab imports.
- Nine action traces invoke actual live movement, weapon animation/impact, objective and respawn functions alongside headless `stepSimulation`, with explicit field tolerances. Movement, obstacle movement, countdown, pickup, charged pass, goal/reset and the single-player respawn fixture agree. Sword-hit/recovery and punch-hit/recovery disagree. The first sword damage mismatch occurs at tick 7 (live target HP 0, headless HP 1); the first punch phase mismatch occurs at tick 16. These are measured failures, not waived assertions. Sword lunge/trade, damaged-target respawn, oblique attack geometry/model sizes and comprehensive multi-slot/map coverage remain explicit gaps. No RL schema or neural behavior was changed.
- Opt-in live timing measures cold/warm snapshot, planner refresh/between-refresh work, coordination, evaluator/hash collection, complete simulation tick and render-call CPU time. The performance gate requires a frozen matching calibration/environment, sample minimum, absolute budget and paired baseline ratio. Noise or missing channels/samples makes the environment inconclusive. Node benchmarks now include eight-participant moving and respawning obstacle fixtures; the 32-participant probe remains informational.
- Quality uses goal-margin delta, paired mirrored/style legs clustered within seed, predeclared equal case/opponent weights and 95% Student-t intervals. It retains per-map/opponent supporting rates and requires a disjoint tuning ledger. Capped, failed, missing or unpaired matches prevent a quality pass; all scheduled matches remain in the completion denominator. Missing metric opportunities are not treated as zero. Null configurations cannot claim improvement. Human review is separate.
- CLI `gates/*.json` diagnostics are linked from `report.html`; `lab-import.json` imports into the production Lab as original-run reference evidence. Local browser runs evaluate observed correctness but cannot certify pinned runtime, repository checks or calibrated acceptance.

The first full quick pilot (`output/grifball-validation/vs5-quick`) completed 32/32 live scenarios, passed all behavior expectations and matched all 16 identical-config pairs. It intentionally retains the initial TypeScript fixture error (`grifballCountdownSeconds` was not a supported setting); this was corrected before the final run. Its failed typecheck is not presented as passing evidence. The parity gate measured two differing traces out of nine. Performance and quality remained not run because no calibrated/held-out protocol was supplied.


The first changed-configuration preflight (`vs5-final-ab`) caught a harness defect before candidate execution: the obstacle parity trace had mutated the memoized default map in the Node process. Browser plan reconstruction correctly rejected the resulting null-control map hash. The trace now receives a deep-cloned map, and a regression constructs identical plans before/after all parity traces to prove fixture isolation. Failed control trials now propagate a failed reproducibility gate, and the parent report prints even when controls block the candidate matrix. The original failed attempt is retained; the corrected run uses a fresh output directory.


Verification after map isolation:

- `vs5-final-ab-fixed`: **exit 0 for its quick profile**, **16/16 null-control jobs** and **16/16 changed-configuration jobs**, covering all four quick scenarios on both sides at seed 101. All **8/8 control pairs** matched exactly. Candidate aggression was 0.7; this exercises the A/B protocol and is not evidence of gameplay improvement. Correctness, reproducibility, TypeScript, production client/relay, explicit validation build and production startup passed. Execution parity remained failed; quality, performance, repository-wide tests and human review were not claimed.
- **109/109 focused tests** passed in that frozen run, followed by **29/29 existing evaluation/live-planner/adapter regressions**. A timing audit then found that non-playing phase resets increment planner revisions; instrumentation now counts only playing-phase revisions as active refresh samples. A new regression verifies 90 countdown/scored/terminal updates contribute zero active refresh samples. The final targeted build/run is recorded separately below.
- **3/3 production-browser integration tests passed** on pinned Chromium 153.0.8010.12: the existing full Lab/storage/cancellation workflow plus actual CLI report import, visible original-run gate results, source labeling and a 390px layout with no horizontal overflow. No page errors were observed. Desktop/narrow screenshots and live WebGL arena screenshots were inspected.
- Serial Node probes, after browser trials/builds had stopped, measured warm planner p95 **2.946 ms** (static open), **13.781 ms** (moving obstacles), and **13.261 ms** (respawning obstacles) with eight participants. The separate existing space probe measured **3.34 / 17.86 ms** for eight-participant open/obstacle fixtures; the informational 32-participant cases measured **18.71 / 135.54 ms**. These isolate Node planner work; they are not calibrated browser acceptance measurements. Obstacle planning cost remains an open performance concern. No 4 ms budget or improvement claim was inferred from these probes.

Evidence: `output/grifball-validation/vs5-final-ab-fixed/` (HTML report, gates, null control, immutable job evidence, runtime/environment, portable Lab import), `output/grifball-validation/vs5-lab-ui/`, `output/vs5-lab-tests.log`, `output/vs5-evaluation-tests.log`, `output/vs5-live-bench-serial.log`, and `output/vs5-space-bench-serial.log`. Earlier probe/build attempts remain separate. Implementation source identity is recorded per run; screenshots/import checks used the production build from the A/B run. The final timing classification correction does not change gameplay or the parity/quality algorithms.


Final timing follow-up: `output/grifball-validation/vs5-final-smoke/` passed **exit 0**, with **110/110 focused tests**, TypeScript, all three builds, production startup, two identical-control trials (one exact pair) and two baseline/candidate goal trials. Warm scored-phase work now appears under between-refresh bookkeeping with zero active planner samples, so a short scoring scenario cannot falsely satisfy the performance refresh minimum. This is the final implementation build. Parity still reports sword/punch failures and explicit coverage gaps. Quality/performance/human acceptance remain unrun; there is no M7 acceptance claim. The dev server was restored on port 3000 after the checks.


## M7 acceptance follow-up: player combat parity — 2026-09-27

The first acceptance repair slice follows the agreed order: combat parity, remaining scenario coverage, browser performance calibration, then held-out match evaluation, with human playtests still required. The implementation plan files remain unchanged.

Root causes confirmed with failing tests before the repair:

- The legacy headless sword applied damage after the entire slash and began ticking one frame after input. Production player animation applies damage halfway through the slash and advances on the input tick. At default timing the live hit is tick 7, while legacy damage first appears at tick 15.
- Legacy punch execution omitted the second attack phase. Production player punch uses a windup followed by a strike lasting half the melee duration (minimum 0.03 seconds), then the configured punch cooldown. Default live impact is tick 23.
- The original VS5 punch fixture mistakenly wired the hammer **swipe** impact callback into the primary strike callback. It now invokes `applyHammerStrikeImpactForState`, including the real ball branch. That exposed a geometry discrepancy too: the live player punch uses a 1.5-unit splash around a projected impact point, while the legacy simulator uses a melee cone.

`createMatch({ combatExecution: 'live-player-v1', ... })` explicitly selects the corrected stationary player attack model. It aligns slash/swipe midpoint hits, separate hammer/punch stages, first-tick advancement, recovery and repeat cadence, and player punch geometry. Execution identity and elapsed phase clocks survive serialization; respawn, round reset and carrier equip clear the additional clock. The tactical observation adapter uses the selected execution model and does not predict another hit during a slash's spent follow-through.

The default remains the legacy training model (including snapshots with no execution field). This is deliberate compatibility, not a declaration that legacy dynamics are correct: existing neural artifacts were trained against those rules and no RL environment/observation/action version has been promoted. The report retains two legacy compatibility traces with their differences. `live-player-v1` also does not claim that scripted AI attacks use the player execution path; AI attack parity needs its own fixtures. Broader lunge/trade, damaged-target respawn, movement/sweeps, pitch/crouch/model sizes and multi-slot/map coverage remain explicit gaps. Accordingly, zero corrected-player differences yields **inconclusive**, never an acceptance pass.

The expanded matrix has **33 action traces** of 240 ticks each: the original objective/movement/lifecycle cases plus player hammer/swipe, timing overrides, held attacks, configurable punch reach, standing medium-target front/rear/oblique/range hit and miss cases, and rotated aim. Tests also assert intended hits/misses so agreement cannot pass merely because neither engine attacks. **53/53 initial focused parity/gate/adapter checks passed**, including mid-attack snapshot restoration and default-versus-explicit legacy state equivalence. The standalone TypeScript check passed. Final repository and built-browser results follow.


Final verification for this repair slice:

- **147/147 validation regressions passed** in the frozen browser run and again after the final diagnostic clarification. The earlier **53/53** focused run additionally included the existing live/headless tactical adapter tests.
- Full repository run: **1,571/1,576 passed**, with the same five historical V3 animation/asset failures named in the scope note above. No new failed test names were observed. Those items remain retired from active tracking; this raw run is still a failed repository check, not a waived pass.
- `output/grifball-validation/m7-parity-player-v1/`: **exit 0 for the Quick profile**, **16/16 completed live trials** covering pickup, goal, pass and reinforcements, seed 101 on both sides. All **8/8 identical-configuration pairs** matched exactly. Correctness, reproducibility, TypeScript, production client/relay, explicit validation build and production startup passed. This verifies the existing live suite after the simulator repair, not a gameplay improvement experiment.
- The frozen run recorded **0/33 corrected-player trace differences**. After that run, the diagnostic wording moved optional neural integration out of the required coverage-gap list into an explicit compatibility note. The four remaining required coverage groups are unchanged. Final standalone evidence in `output/m7-parity-final.json` carries the updated source fingerprint, four coverage gaps, the two legacy compatibility traces and an **inconclusive** parity verdict; the 147-test validation selection was rerun. The earlier immutable browser report retains its original five-item diagnostic wording.
- `git diff --check` passed for the implementation paths. The task-owned development server was restored on port **3000**, and both `/` and `/grifball-validation.html` returned HTTP 200.

Logs: `output/m7-parity-focused.log`, `output/m7-parity-final-focused.log`, `output/m7-parity-typecheck.log`, `output/m7-parity-repository.log`, and `output/m7-parity-browser.log`. The browser directory contains the HTML report, frozen inputs, gate diagnostics, source/runtime identity, raw trial evidence and portable Lab import.

M7 acceptance remains open. Next work is AI-specific attack parity, lunge/trade and damage-to-respawn coverage before performance calibration and held-out quality evaluation. Human review and neural integration remain separate; neural integration is optional.

## M7 acceptance follow-up: stationary bot execution and live lifecycle — 2026-09-27

This next slice adds bot-specific evidence without changing either implementation roadmap or promoting the default training model. The production frame uses a player weapon pass before AI decisions and a roster animation/impact pass afterward. Tests invoke both owners in that order, with actual attack triggers and damage callbacks.

Regressions reproduced before their fixes:

- `main_ai` advanced attacks through both the legacy main-AI animation and the roster pass in player view, while observer view skipped the former. Registered bots now use the roster pass once for attack clocks, impacts and weapon presentation. Main-AI swap timers remain in their existing owner.
- Bot secondary melee started in `melee_up`, which the roster updater never advanced. Explicit windup/strike/recovery phases now finish the action and apply one impact.
- Roster visuals advanced offline lunge clocks a second time and could terminate flight early. AI flight owns its clock; remote visual extrapolation retains its separate timer. Dead roster actors cancel pending weapon actions.
- Lunge contact did not reject invulnerable targets, allowing damage or trades through spawn protection. It now does. Hit or target-dead completion now returns before timeout/boundary handling, preventing a second outcome from replacing hit memory.

The opt-in `live-roster-v1` simulator profile models stationary bot slash, slam, secondary swipe and runner punch, including phase boundaries, elapsed clocks, recovery and projected splash geometry. **84 paired traces** cover 21 cases across `main_ai`/`bot_2` and player/observer view: each weapon, held input, timing overrides, tuned punch reach, rotated aim, rear misses and invulnerable targets. Health, position, exact phase and elapsed clock are compared for 240 ticks; intended damage totals are asserted as well. Together with the existing 33 player traces, gate protocol `live-functions-vs-headless-step-v3` evaluates **117 paired traces**.

Seven additional live-only lifecycle regressions cover one-hit lunge termination and configured cooldown, contact coinciding with timeout, shielded contact/trades, dead/friendly cancellation, sword and hammer trades with double respawn, and lethal carrier contact followed by spawn protection. These exercise production flight, finish, trade, damage, roster respawn and carrier reconciliation functions. They do **not** certify headless lunge/trade/respawn parity. The live three-second respawn subtraction can leave a sub-tick floating-point remainder; tests require death through 179 ticks and revival by 181 ticks rather than silently changing that behavior.

Known remaining scope: paired lunge flight/trades and damaged-target respawns still differ in contact geometry, flight termination/cooldown, frame ordering and spawn/inventory policy. AI decisions are deliberately not invoked by stationary input traces. Mixed player/roster execution, moving/swept geometry, pitch/crouch/model variants and authored-map/multi-slot spawning remain open. The four coverage-gap groups keep execution parity **inconclusive**; performance calibration, held-out quality and human review still follow. Neural integration is optional, and legacy training dynamics and observation/action schemas remain unchanged.

Verification so far:

- **108/108** focused bot/lifecycle/tactical-adapter checks passed; the expanded validation selection passed **248/248** checks.
- Full repository run: **1,673/1,678 passed**. The five failed assertions match the previously recorded V3 animation/asset failures above, which remain retired from active tracking. This is still a failed raw repository check; no tests were waived or weakened.
- The initial browser preparation exposed optional fields in the new test fixture's legacy target callback. Explicit target fields corrected the TypeScript error; that superseded preparation run remains in `m7-bot-parity-v1` and is not acceptance evidence.
- `m7-bot-parity-final` passed TypeScript, all three builds, production startup, **16/16** live scenario trials, **8/8** exact repeatability pairs, and **0/117** parity trace differences. It nevertheless exited **3**, because Chromium's shutdown watchdog expired. The task-owned browser tree was verified and terminated separately. The error report is preserved; successful gameplay is not presented as a successful runner exit.

Final verification: `output/grifball-validation/m7-bot-verified/` completed with **exit 0**, including successful browser cleanup. The fresh run again passed **248/248** validation tests, TypeScript, production client/relay and validation builds, production startup, **16/16** live trials and **8/8** exact repeatability pairs. All **117** paired traces match; the parity verdict correctly remains **inconclusive** because the four coverage groups remain open. The final source fingerprint matches the working implementation. The rendered goal-scenario arena from the same implementation was inspected.

The development server was restored on port **3000**; `/` and `/grifball-validation.html` returned HTTP 200. `git diff --check` passed for implementation and documentation paths. Changes remain uncommitted.

Evidence: `output/m7-bot-focused.log`, `output/m7-bot-repository.log`, `output/m7-bot-verified.log`, and the final directory's HTML report, gate diagnostics, source/runtime identity and raw trials. Superseded preparation and shutdown-error artifacts remain available separately. The full repository result above is separate from the Quick profile, which does not require that gate. Next acceptance work is paired lunge/trade and damage-to-respawn execution, followed by the remaining geometry/map coverage before calibrated performance and held-out quality evaluation.

## M7 acceptance follow-up: committed roster flight and revival — 2026-09-27

Previous VS5/M7 work was committed as `85c8831` before this slice. The implementation roadmap files were not edited.

`live-roster-v2` is an explicit opt-in execution profile. V1 profiles and default training dynamics retain their prior flight/respawn behavior, including the old remaining-time lunge clock. V2 stores an explicit tactical `lungeTargetId`, start position, elapsed flight clock and completion outcome. A missing target at commitment is an error; target selection is not inferred. Mid-flight JSON restoration and round cleanup are tested.

The simulator corrections follow production behavior:

- Contact uses the locked target's body-center distance (1.5 for the tested medium model), stops after one hit, stops planar velocity and applies the configured lunge cooldown at completion. Arena/timeout completion uses the production 16-unit/0.8-second bounds, with contact taking precedence. These bounds currently remain independent of the configured AI initiation distance.
- V2 revives downed actors before the AI pass and resolves each committed flight before the next actor's shield tick. This preserves the live order at the exact spawn-protection expiry boundary. Death does not consume a respawn tick in the frame that caused it.
- Lethal sword/hammer trades use the ordinary roster target's active primary attack state, credit one kill per death and cancel dead actors' weapon actions. Carrier release happens through objective reconciliation.
- Revival restores the actor's maximum health, retained weapon and spawn shield without adding the legacy post-spawn ready delay. This slice deliberately uses exactly one authored spawn per team, so it does not certify greedy multi-slot spawn arbitration.
- Stationary attack behavior is retained under V2, and the weapon-swap gate also respects committed flight even though the live roster's weapon animation is idle while lunging.

The gate now runs **173 paired traces**: 33 player, 84 stationary roster and **56 new flight/lifecycle traces** (14 cases across main/regular attacker slots and both views). The flight fixtures start both engines at a committed-lunge boundary through production attack entry points; they never copy state between ticks. They compare health, alive state, respawn/shield clocks, weapons, kill credit, position/velocity, active flight clock, cooldown, completion outcome, ball ownership/state/position/velocity/loose timer, and expected damage/death totals through 300 ticks. The same corrected fixture running the previous roster-v1 model exposes damage/cooldown differences, retained in gate evidence as `priorRosterCompatibility`.

The live fixture reuses the production flight, finish, trade, damage, respawn, shield tick and objective functions. Tactical target choice, pressure/combo decisions and post-contact movement input are held fixed, with a neutral cooldown multiplier of 1, so these traces do not certify the complete AI orchestrator. Player flight, nonlethal trades, main-AI victims, airborne/moving targets, model/crouch variants and authored-map/multi-slot spawning remain explicit gaps. Old `live-roster-v1` flight compatibility, V2 stationary behavior, snapshot restoration and round cleanup have separate regressions. Full parity and M7 acceptance remain **inconclusive**; neural integration remains optional.

Verification:

- **122/122** final focused checks passed across flight parity, default/v1 weapons, simulation stepping, movement mechanics and tactical observations (`output/m7-lunge-final-focused.log`).
- Full repository run: **1,754/1,759 passed**, with the same five retired V3 animation/asset failures listed above. This run preceded the final flight-swap regression and the explicit legacy grounded-flag guard; the final focused selection and frozen validation selection were rerun after those corrections. The raw repository check remains failed rather than waived.
- The final frozen run, `output/grifball-validation/m7-lunge-final/`, completed with **exit 0** and successful browser cleanup. It passed **330/330** validation checks, TypeScript, production client/relay and validation builds, production startup, **16/16** live trials and **8/8** exact repeatability pairs. All **173** parity traces match. The verdict remains **inconclusive** with four explicit coverage-gap groups. This supersedes `m7-lunge-verified` and includes the legacy grounded-flag guard. No live gameplay functions changed in this slice.

The final source fingerprint matches the frozen plan (`output/m7-lunge-review.json`). Browser evidence and runner output are in the final directory and `output/m7-lunge-browser-final.log`. The development server was restored on port **3000**; `/` and `/grifball-validation.html` returned HTTP 200. This new slice remains uncommitted after the prior-work commit `85c8831`.

Spawn facing and post-respawn movement are outside this fixture's comparisons; AI integration, untested trade variants and wider spawn arbitration remain open.


## M7 acceptance follow-up: surviving trades and main-AI victims — 2026-09-27

The prior flight/revival slice was committed as `2c3a860` before this work. The implementation roadmap files remain unchanged.

The expanded fixture exposed a surviving attacker retaining flight velocity without completing its lunge cooldown, a pending defender swing dealing damage again after its trade, main-AI lunge victims reviving on the next roster tick because only the team timer was set, and missing per-actor main-AI trade credit. The initial expanded run failed 48 of 158 checks (`output/m7-trade-before.log`).

Production fixes:

- A surviving attacker finishes the traded flight through the normal finish callback, preserving hit memory, stopping flight movement and entering configured recovery (or existing pressure/combo behavior). Both scripted and neural live callers synchronize the resulting frame before returning. Dead attackers retain the death/respawn path.
- A surviving defender's committed primary swing enters recovery: the trade has already applied that attack's damage, so its pending animation must not deal it again. This applies to active sword/hammer primary attacks; simultaneous lunge handling remains outside this certification.
- Main-AI lunge deaths set the combatant's three-second respawn timer, which the roster loop actually reads, and increment its death count. Main-AI trade kills/deaths update per-actor counters as well as existing legacy counters.
- Finishing a surviving roster trade does not duplicate the damage-dealt observation already recorded by trade resolution. A live regression asserts exactly one dealt/received sample per actor.

The opt-in `live-roster-v2` simulator independently models the surviving trade finish and defender recovery. Default and v1 execution models retain their prior behavior. There is no RL observation/action schema or policy promotion.

Protocol `live-functions-vs-headless-step-v5` now evaluates **249 paired traces**: 33 player, 84 stationary roster and **132 flight/lifecycle**. The latter comprises 22 cases across three attacker/victim identity pairs and both viewing modes. Added cases cover both actors surviving, only the attacker surviving, only the defender surviving, and tuned reloads for sword/hammer trades; all 22 cases also run against a main-AI victim. The fixture supplies the actual main-AI object to production callbacks and aligns both defenders' aim. Traces independently compare both actors' damage, vitals, kill/death credit, weapon phase/elapsed clock, movement, flight/cooldown/outcome, and ball state for 300 ticks, with expected damage/death/death-feed totals.

The fixtures hold target selection, movement after contact, pressure/combo choices and cooldown multipliers fixed. Recent-attack trade windows, simultaneous lunges, player/airborne/moving-target flight, broader geometry, spawn arbitration and full AI decision integration remain open. Main-AI coverage here concerns committed roster lunge/trade victims, not every player-versus-main-AI damage path. Full M7 acceptance remains **inconclusive**.

Verification:

- **218/218** final focused checks passed (`output/m7-trade-regression-final.log`).
- The frozen run `output/grifball-validation/m7-trade-final/` completed with **exit 0** and successful browser cleanup: **409/409** validation tests, TypeScript, production client/relay and validation builds, production startup, **16/16** scenario trials and **8/8** exact repeatability pairs passed. All **249** parity traces match; four remaining coverage groups correctly keep execution parity inconclusive.
- Full repository run: **1,834/1,839 passed**, with the same five historical V3 animation/asset failures listed above (`output/m7-trade-repository.log`). This run started before the final damage-observation guard/assertion; the final focused and frozen selections ran afterward. The raw repository result remains failed; no tests were waived or weakened.
- The source fingerprint matches the frozen plan (`output/m7-trade-review.json`). Browser runner output is retained in `output/m7-trade-browser-final.log`; the final directory includes its report, gate evidence, frozen inputs and raw trials.

The development server was restored on port **3000**; `/` and `/grifball-validation.html` returned HTTP 200. This new slice remains uncommitted after `2c3a860`. Next acceptance work is recent-attack trade windows and simultaneous-lunge coverage before broader geometry/spawn and AI integration certification.


## M7 acceptance follow-up: trade windows and paired lunges — 2026-09-27

The prior surviving-trade/main-AI slice was committed as `8b65486` before this work. The implementation roadmap files remain unchanged.

The initial expanded trace run failed **76/326** checks (`output/m7-window-before.log`). Regular roster bots ignored the configured recent-attack window that main AI used; main AI also accepted a future timestamp or stale `LUNGING` behavior state. A surviving lunge defender could continue its already-traded flight, causing a second contact. These cases now have production fixes and independently stepped headless comparisons.

- All AI roster slots use the same authoritative flight flag, primary attack phases and weapon-specific recent-attack timestamps. Sword and hammer retain their separate configured windows. Boundaries are inclusive; disabled trade flags, absent/zero factory history, future history, and history for the other weapon do not grant a recent counter. The separate human-player resolver is outside this slice.
- A paired opposing lunge trade finishes both surviving flights immediately through the existing finish logic, including hit memory, velocity, cooldown and AI frame state. The defender finishes before its next flight update, so it cannot reapply the collision's damage. Death paths keep their normal respawn behavior. Both actors retain exactly one dealt/received observation; existing pressure/combo callbacks remain wired in production but are held fixed in the parity fixture.
- `live-roster-v2` now persists `combatTimeMs`, `lastSwordAttackTimeMs` and `lastHammerAttackTimeMs`. Commitment records the applicable weapon history. Older v2 snapshots derive the starting clock from their fixed tick and do not invent missing history. Live and v2 respawns and round spawn resets clear recent attack history. Existing default/v1 dynamics and neural observation/action schemas are unchanged.
- An additional real-action regression caught the 21-tick clock reaching `350.00000000000006` instead of `350` milliseconds and rejecting an inclusive counter. Fixed-rate v2 time now follows the live runner's tick-derived clock; custom timestep progression retains its elapsed clock. The failing boundary evidence is in `output/m7-window-clock-before.log`.

Protocol `live-functions-vs-headless-step-v6` evaluates **417 paired traces**: 33 player, 84 stationary roster and **300 flight/lifecycle**. The 50 flight cases run across three attacker/victim identity pairs and both views. Added window cases cover inside/at/outside the boundary, zero and tuned windows, disabled flags, absent/future history and wrong-weapon history. Paired grounded opposing flights cover lethal, both surviving, asymmetric survival and tuned cooldown in both actor update orders. Both actors' cooldowns/outcomes/flight clocks are compared in these cases as well as damage, phase clocks, health, lifecycle, credit, movement and ball state.

Recent history is supplied at a completed-attack boundary using the live action trigger and corresponding headless timestamp; no state is copied between engines during the 300-tick traces. Separate regressions verify actual headless action timestamps, the 21-tick boundary, snapshot restoration, respawn/reset cleanup, stale AI behavior state, and single-count damage observations. These are bounded two-actor grounded tests, not arbitrary multi-attacker or full AI-decision certification. Player flight, airborne and other moving-target geometry, pitch/crouch/model variants, map/spawn arbitration and mixed execution still keep M7 acceptance open.

Verification:

- **415/415** final focused checks passed (`output/m7-window-regression-final.log`).
- The fresh frozen run `output/grifball-validation/m7-window-final/` completed with **exit 0** and successful browser cleanup. It passed **582/582** validation tests, TypeScript, production client/relay and validation builds, production startup, **16/16** scenario trials and **8/8** exact repeatability pairs. All **417** parity traces match; four remaining coverage groups correctly keep execution parity inconclusive.
- The source fingerprint matches the frozen plan (`output/m7-window-review.json`). Browser runner output is retained in `output/m7-window-browser-final.log`; the final directory includes the report, gate evidence, frozen inputs and raw trials.
- Full repository run: **2,007/2,012 passed**, with the same five historical V3 animation/asset failures listed above (`output/m7-window-repository.log`). This run used the final implementation. The raw repository result remains failed; no tests were waived or weakened.

The development server was restored on port **3000**; `/` and `/grifball-validation.html` returned HTTP 200. This new slice remains uncommitted after `8b65486`. Next acceptance work is bounded model/crouch hitbox geometry, followed by airborne/moving-target and broader multi-actor/spawn coverage before full AI integration certification.


## M7 acceptance follow-up: grounded model and crouch geometry — 2026-09-27

The prior trade-window/paired-lunge slice was committed as `3a13ed3` before this work. The implementation roadmap files remain unchanged.

The initial geometry matrix reproduced **88 failures out of 374 checks** (`output/m7-geometry-before.log`). Production roster impacts and committed lunges already include the Large target's 0.2-unit hit-radius bonus; the headless simulator had no model metadata and omitted that bonus. The correction is confined to the explicit `live-roster-v2` execution profile. No live gameplay functions changed in this slice.

- `SimCombatant.modelType` is optional effective gameplay metadata. Missing values retain Medium geometry for older snapshots. Stationary roster impacts and committed lunge contact use the existing target-model radius adjustment; attacker size does not extend reach. Default/v1 profiles retain their previous geometry even if model metadata is supplied.
- Crouched targets use the existing 0.52 body-center height instead of 0.825. Committed flight also uses the attacker's body center. Stationary roster attacks retain the live 1.2 impact-origin height regardless of attacker posture. Tests verify these existing semantics rather than changing the live crouch design.
- Fixtures maintain independent live and headless state over each trace, supply held crouch input to the simulator, compare both actors' posture/model metadata, and retain scenario inputs with the evidence. Expected hit/miss boundaries are calculated independently from authored dimensions, without calling either hit resolver.
- Separate regressions cover JSON restoration of committed Large-target contact, retained model metadata on revival/round reset, older snapshots with no model field, and unchanged default/player-v1/roster-v1 behavior.

Protocol `live-functions-vs-headless-step-v7` now evaluates **815 paired traces**: the existing 33 player, 84 stationary roster and 300 flight/lifecycle traces plus **398 geometry traces**. The new geometry set contains **272 stationary traces** (68 cases across main/regular attackers and both views) and **126 flight traces** (21 cases across three attacker/victim identity pairs and both views). It covers slash, slam, swipe and punch; Medium/Large targets; all four standing/crouched attacker/target combinations; just-inside/just-outside contact; exact lunge tangency; and Large-attacker/Medium-target reach guards. Stationary cases use explicit reach/radius settings; flight tangency is sampled at the first movement tick.

These are grounded, fixed-posture, nonlethal geometry cases with stationary targets. They do not certify posture transitions, visual rig fidelity, body-cylinder collision, airborne/moving/swept contact, player pitch/model/crouch geometry, arbitrary multi-actor interactions, map/spawn arbitration or the full AI decision loop. The four remaining coverage groups continue to keep full M7 acceptance **inconclusive**. Neural policies and their observation/action schemas remain unchanged.

Verification:

- **413/413** final geometry/gate checks passed (`output/m7-geometry-gates.log`). The earlier combined geometry/stationary/flight selection passed **797/797** before the exact-tangency and snapshot/compatibility additions (`output/m7-geometry-focused.log`); those additions are included in the final frozen and full repository runs.
- The frozen run `output/grifball-validation/m7-geometry-final/` completed with **exit 0** and successful browser cleanup: **985/985** validation tests, TypeScript, production client/relay and validation builds, production startup, **16/16** live scenario trials and **8/8** exact repeatability pairs passed. All **815** paired traces have zero differences. Four coverage-gap groups correctly retain an inconclusive execution-parity verdict.
- Full repository run: **2,410/2,415 passed**, with the same five historical V3 animation/asset failures listed above (`output/m7-geometry-repository.log`). This run used the final implementation. Its raw result remains failed; no tests were waived or weakened.
- The source fingerprint matches the frozen plan (`output/m7-geometry-review.json`). Runner output is retained in `output/m7-geometry-browser-final.log`; the final directory contains the HTML report, gate evidence, frozen inputs and raw trials.

The development server was restored on port **3000**; `/` and `/grifball-validation.html` returned HTTP 200. Scoped `git diff --check` passed. This new slice remains uncommitted after `3a13ed3`. Next acceptance work is airborne/moving-target contact, followed by broader multi-actor/spawn coverage before full AI decision integration certification.


## M7 acceptance follow-up: airborne and committed-target motion — 2026-09-27

The grounded model/crouch slice was committed as `f06dea7` before this work. The implementation roadmap files remain unchanged.

The scripted AI engagement prelude integrated airborne displacement and gravity before calling the committed lunge flight function, which integrated them a second time. The prelude now defers to flight while `self.isLunging` is true. Direct production-function regressions assert one 0.4-unit horizontal step and one gravity decrement per 60 Hz tick for main/regular bots in both viewing modes. Non-lunging recovery retains the engagement gravity path.

The opt-in `live-roster-v2` simulator now accepts an optional one-shot `lungeAimDirection` alongside its explicit tactical target. Commitment validates a finite, nonzero vector, normalizes it, copies it into the committed flight direction and consumes the pending input. Missing direction retains planar yaw. Vertical launch follows production's `max(existing vertical velocity, direction.y * lunge speed)` rule and updates jump state. This preserves faster upward momentum and avoids substituting a new aim/target selection policy. Invalid headings fail before weapon commitment; JSON snapshots preserve airborne flight and fall completion; respawn/round reset clear pending headings. Default and v1 execution profiles ignore this new input and keep their previous dynamics.

Protocol `live-functions-vs-headless-step-v8` evaluates **1,031 paired traces**, adding **216 motion traces** to the previous 815. The 36 motion cases run across three attacker/victim identity pairs and both views. They cover rising/falling actors and ballistic targets, upward/downward/vertical commitments, retained launch momentum, vertical separation misses, landing during flight, crossing/diverging/retreating paired lunges, and exact contact-before-escape boundaries. Every motion scenario runs in both actor orders. The escape case independently expects a first-tick trade when the attacker updates first and a miss when the target moves first.

Motion fixtures call the actual scripted gravity prelude, flight/finish/trade functions, and existing lifecycle/weapon/objective owners. Both engines advance independently for 300 ticks. Comparisons now include both actors' jump state and recorded position/velocity alongside damage, phase clocks, cooldowns, outcomes, health and ball state. Initial motion checks exposed the duplicate integration and missing 3D commitment. The initial log also contains an incorrectly authored descending-hit expectation: at z=2 the attacker passes too high; the final matrix explicitly checks that overshoot miss and a separate descending hit at z=4.

This slice is bounded to committed medium-model flights and ballistic targets at 60 Hz, with horizontal tactical choices held fixed after completion. It does not certify walking/dashing/steering targets, moving stationary attacks, swept collision between samples, arbitrary multi-attacker contact, airborne crouch/model combinations, terrain/obstacle recovery, player flight or the full AI decision loop. Geometry and lifecycle checks from earlier slices still run separately. Four coverage-gap groups continue to keep M7 acceptance **inconclusive**; neural-policy integration remains optional and unpromoted.

Verification:

- **957/957** combined geometry/flight/motion regressions passed (`output/m7-motion-regression.log`). After the final invalid-heading bookkeeping guard, **268/268** focused motion/gate/weapons/movement/step checks passed (`output/m7-motion-final-focused.log`).
- The final frozen run `output/grifball-validation/m7-motion-final/` completed with **exit 0** and successful browser cleanup. It passed **1,210/1,210** validation tests, TypeScript, production client/relay and validation builds, production startup, **16/16** live scenario trials and **8/8** exact repeatability pairs. All **1,031** paired traces match; four explicit gap groups retain an inconclusive execution-parity verdict.
- Full repository run: **2,635/2,640 passed**, with the same five historical V3 animation/asset failures listed above (`output/m7-motion-repository.log`). This run used the final implementation. Its raw result remains failed; no tests were waived or weakened.
- The source fingerprint matches the frozen plan (`output/m7-motion-review.json`). Runner output is retained in `output/m7-motion-browser-final.log`; the final directory contains the HTML report, gate evidence, frozen inputs and raw trials. Initial diagnostic runs remain in `output/m7-motion-before.log` and `output/m7-motion-focused.log`.

The development server was restored on port **3000**; `/` and `/grifball-validation.html` returned HTTP 200. Scoped `git diff --check` passed. This new slice remains uncommitted after `f06dea7`. Next acceptance work is walking/dashing target contact and moving attacks, followed by broader multi-actor/spawn coverage before full AI decision integration certification.


## M7 acceptance follow-up: assigned walking, committed dashes and moving impacts — 2026-09-27

The airborne/committed-motion slice was committed as `e3333fd` before this work. The implementation roadmap files remain unchanged. This slice adds execution evidence; it required no gameplay or simulator correction.

The new fixture executes production assigned-area objective movement and committed AI dash movement. Walk direction changes and dash commitment boundaries are authored inputs shared by the two independently stepped engines, not positions or velocities copied between them. The live side uses real assignment movement, dash integration and arena constraints; the headless side receives equivalent aim-relative analog input for the objective walker's 5.2-unit speed. Directional speed settings are held equal at 100 for this bounded mapping. Dash direction, duration and cooldown are supplied at the commitment boundary, so autonomous dash initiation is not certified.

Protocol `live-functions-vs-headless-step-v9` evaluates **1,255 paired traces**, adding **224 moving-contact traces**:

- **116 moving-impact traces**: 29 cases across main/regular attackers and both views. Slash/slam/swipe/punch targets enter or leave range by walking or dashing, or reverse their walking direction before impact. Sword/hammer attackers advance, retreat or enter a committed dash during an existing windup. Moving carrier punches are outside this fixture.
- **108 lunge-versus-moving-target traces**: 18 cases across three attacker/victim identity pairs and both views. Walking crossing/escape/retreat cases, committed crossing/escape dashes, dash-expiry catches and tuned short dashes run in both actor orders. Exact boundary cases independently assert contact on tick 1 if the attacker advances first, or no contact if the target escapes first.

The fixture compares both actors' positions, velocities, dash duration/cooldown clocks, weapon phase clocks, health and expected damage alongside prior lunge lifecycle checks. Moving-impact evidence records both actors' motion; lunge traces retain the existing full position/velocity evidence. Independent regressions pin 5.2-unit objective walking, reversal/stop distances, committed-dash expiry-frame travel and remaining cooldown. Successful sword impacts are also required on tick 7 for the authored 0.22-second slash timing. These assertions do not derive expected damage/timing from either resolver.

Type checking caught incorrect live dash property names in the first fixture draft; the final fixture uses the actual `aiDashDir`, `aiDashRemaining` and `aiDashCooldownTimer` fields. An independent tuned-dash check also caught omitted simulator settings in its test call; that fixture now explicitly passes its settings. Neither issue required a runtime change. Superseded diagnostic logs remain separate from final evidence.

This certifies grounded, nonlethal, two-actor execution at 60 Hz under supplied movement/attack intents. It does not certify autonomous threat/route/steering choices, dash initiation decisions, moving-carrier punch behavior, swept collision between frame samples, body-cylinder collisions, moving airborne/crouched/model combinations, arbitrary multi-attacker contact, player execution, map/spawn arbitration or the full AI loop. Current dash motion includes the frame that starts with positive remaining duration; these traces retain that existing sampled behavior. Four coverage-gap groups continue to keep full M7 acceptance **inconclusive**, and neural policy integration remains optional and unpromoted.

Verification:

- **236/236** final focused moving-contact and gate checks passed (`output/m7-moving-final-focused.log`). Earlier draft diagnostics, including the tuned-test settings omission, remain in separate `m7-moving-before` and `m7-moving-regression` logs.
- The final frozen run `output/grifball-validation/m7-moving-final/` completed with **exit 0** and successful browser cleanup: **1,436/1,436** validation tests, TypeScript, production client/relay and validation builds, production startup, **16/16** live scenario trials and **8/8** exact repeatability pairs passed. All **1,255** paired traces match; four gap groups retain the inconclusive execution-parity verdict.
- Full repository run: **2,861/2,866 passed**, with the same five historical V3 animation/asset failures listed above (`output/m7-moving-repository.log`). This run used the final implementation. Its raw result remains failed; no tests were waived or weakened.
- The source fingerprint matches the frozen plan (`output/m7-moving-review.json`). Runner output is retained in `output/m7-moving-browser-final.log`; the final directory contains the HTML report, gate evidence, frozen inputs and raw trials.

The development server was restored on port **3000**; `/` and `/grifball-validation.html` returned HTTP 200. Scoped `git diff --check` passed. This new slice remains uncommitted after `e3333fd`. Next acceptance work is broader multi-actor contact and spawn arbitration; the remaining player/swept-contact and full AI decision-integration gaps stay explicit.


## M7 acceptance follow-up: multi-actor contact and occupied spawn arbitration — 2026-09-27

The prior moving-contact slice was committed as `1e511a6` (`Validate walking and dashing target contact parity`). This follow-up adds independently stepped multi-actor contact and respawn-boundary evidence, plus fixes demonstrated by those fixtures.

Production changes:

- Stationary bot melee now increments the victim's roster death count for `main_ai`, alongside its existing legacy counter. Previously it updated only the legacy counter. The initial multi-actor run reproduced this omission; all 192 contact traces pass after the correction.
- Bot respawn clearance excludes the local player only while that player is alive and participating. An observer camera or dead player previously occupied a phantom exclusion point. The actual production action callback now supplies that occupancy decision to the respawn helper.
- Opt-in `live-roster-v2` respawns select the team spawn with greatest minimum distance from living actors, with first-authored-point tie breaking. Earlier revivals in the same roster tick become occupied points for subsequent revivals. Authored spawn height is retained. Legacy profiles keep their existing fixed team slots and height behavior; explicit compatibility tests protect that boundary.

Protocol `live-functions-vs-headless-step-v10` adds **348 paired traces**, for **1,603 total**:

- **192 six-actor contact traces**: sword slash, hammer slam and hammer swipe across splash kills, one-/two-HP focus fire, and opposing simultaneous attacks. Both roster orders, mirrored teams, player/observer views and main-AI attacker/victim identities are exercised. Every tick compares health, life/death, weapon phase, respawn/shield clocks and per-actor kill/death credit; legacy main-AI counters are checked too. Independent expected victims and winning attackers guard against both engines agreeing on incorrect outcomes. Friendly, shielded and out-of-range actors are present throughout. These traces stop before revival to isolate impact arbitration.
- **156 roster spawn-boundary traces**: all eight supplied maps after normal Grifball conversion, plus empty, single, tied, fallback and elevated custom spawn lists. Three actors revive simultaneously or on consecutive ticks, with another living actor occupying space. Both teams and roster orders run with an alive, dead or observer local-player context. The fixture invokes the real roster respawn/action callback and independently invokes `tickRespawns`, comparing spawn positions, cleared velocities, health, shields, retained weapon and inward yaw before movement. Six independent numeric sequence checks pin occupancy, tie breaking and staggered selection; two compatibility checks protect legacy slots.

The first map fixture draft retained optional team-spawn fields from its default arena when loading maps without those fields. Removing that stale fixture property corrected the remaining draft mismatches; no production map change was necessary. Historical diagnostic logs remain distinct from final evidence.

The gate remains **inconclusive**. This evidence covers authored grounded slash/slam/swipe contact and roster revival boundaries. It does not certify mixed lunge/melee groups, autonomous decision-to-action choices, player lunges, swept collision, moving-carrier punches, initial placement, round resets, elevated-spawn landing or full matches across those maps. Calibrated performance, held-out quality/generalization and human playtest acceptance are still required. Neural integration remains optional and unpromoted.


Verification:

- **366/366** focused multi-actor, spawn and gate checks passed (`output/m7-multi-focused.log`).
- The frozen run `output/grifball-validation/m7-multi-spawn-final/` finished with **exit 0**: **1,792/1,792** validation tests, TypeScript, production client/relay and validation builds, startup, **16/16** live scenario trials and **8/8** exact repeatability pairs passed. All **1,603** paired traces match; four remaining coverage groups retain the inconclusive execution-parity verdict. This quick run does not supply calibrated performance, quality or human-review acceptance.
- The separate full repository run completed: **3,217/3,222 passed**, with the same five historical V3 animation/asset failures listed in earlier sections (`output/m7-multi-spawn-repository.log`). Its raw exit remains **1**; no tests were waived or weakened. That separate log is not imported into the CLI report's repository-tests gate.
- Source identity matches the frozen plan (`output/m7-multi-spawn-review.json`): commit `1e511a61176b6f285a0986af868ffd6ee3e5e194`, working-tree hash `3efe13c0ab775f391e1fd15192ff601e86af12d7579df841ae5f4849d2156974`. The run contains its HTML report, gate evidence, raw trials and build logs.
- Scoped `git diff --check` passed and the attached implementation plans were not changed. Development server restored on port **3000**; `/` and `/grifball-validation.html` both returned HTTP 200.

This new multi-actor/spawn slice remains uncommitted after `1e511a6`. Remaining M7 acceptance work includes mixed flight/melee and player contact, complete decision-to-action/map lifecycle coverage, calibrated performance and held-out quality/generalization, followed by human playtesting. Passing these bounded traces establishes execution evidence; it does not establish better match outcomes or enjoyable tactics.


## M7 acceptance follow-up: mixed lunge/melee contact — 2026-09-27

The prior multi-actor/spawn slice was committed as `b1503fb` (`Validate multi-actor impacts and occupied respawn arbitration`). This follow-up combines committed flights with authored melee attacks through the actual live roster frame owners and independent `stepSimulation` execution.

The new matrix reproduced a live order-dependent death bug in **18 cases**: when a melee attacker killed a lunging actor whose visual update had already run, the dead victim retained `isLunging=true` until the next frame. Reversing roster order let the visual loop clear the flag and concealed the defect. `applyBotMeleeImpactForState` now clears the flight flag at lethal impact, alongside health/respawn/death bookkeeping. No simulator gameplay changes were necessary. The original diagnostic run passed 306/324; all 324 pass with the fix.

Protocol `live-functions-vs-headless-step-v11` adds **324 mixed-contact traces**, bringing the paired total to **1,927**. Nine encounters run across slash/slam/swipe, both roster orders, main-AI identity as lunger/target/melee attacker, and player/observer views:

- A teammate's melee kills the locked target before the lunge arrives; the flight cancels on its next tick.
- The lunge kills before the melee impact, or both attacks reach the target on the same frame with one or two HP.
- An enemy's melee kills or damages the actor mid-flight, preventing contact or allowing the surviving flight to finish.
- A surviving lunge trade consumes the defender's primary attack while a third-party swing still lands. An additional bystander guards against the consumed primary damaging other actors.
- Two allied lunges share a target with two or three HP while a teammate's melee also lands; credit follows the production flight-before-visual ordering and the configured roster order.

Each trace independently advances four grounded actors for 120 ticks. Comparisons cover per-actor position/velocity, health, alive/lunging state, weapon phases and phase clocks, respawn/shield clocks, kill/death credit and legacy main-AI counters, plus flight cooldowns/outcomes. Independent expectations assert final health, exact victims and winning attackers, first-hit frames, flight-finish frames and termination outcomes. Fixed 24-unit flight speed and authored distances place contact immediately before, on or after frame-seven melee impacts. The fixtures use production action triggers at the commitment boundary, then never copy state between engines. Existing fixture flight callbacks are reused for additional registered actors.

This certifies the listed grounded encounters under authored commitments, not autonomous tactical choices or arbitrary crowd combat. Moving/airborne/carrier mixed groups, player execution, swept collision and complete map/round lifecycle integration remain gaps. Calibrated performance, held-out quality/generalization and human playtesting are still required for M7 acceptance. Four coverage-gap groups keep the execution gate **inconclusive**; neural integration remains optional and unpromoted.


The first frozen attempt (`output/grifball-validation/m7-mixed-final/`) passed 2,116 validation tests, TypeScript and all builds, then exited **3** before browser trials with `Invalid string length`. Growing parity evidence exceeded V8's limit while the artifact writer formatted the entire gate as one JSON string. The writer now serializes bounded traces individually to its temporary file, flushes it, and atomically publishes the same complete JSON schema. No frames or trace groups are discarded. Regression tests verify that aggregate serialization is never required, escaped/optional fields round-trip correctly, and a mid-trace serialization error preserves both the previous evidence file and gate verdict. All nine artifact/executor tests pass. The failed attempt is retained separately; the corrected writer requires a new frozen source identity and run directory.


Final verification:

- **334/334** mixed-contact and gate checks passed (`output/m7-mixed-focused.log`), and **9/9** artifact/executor checks passed (`output/m7-mixed-artifacts.log`).
- The corrected frozen run `output/grifball-validation/m7-mixed-final-r2/` finished with **exit 0**: **2,118/2,118** validation tests, TypeScript, production client/relay and validation builds, startup, **16/16** scenario trials and **8/8** exact repeatability pairs passed. All **1,927** paired traces match. Four remaining coverage groups retain the inconclusive execution-parity verdict; this quick run does not supply calibrated performance, held-out quality or human-review acceptance.
- The saved parity JSON was parsed after publication: all nine required trace groups and **408,588 frames** are present, with zero differences. The complete compact artifact is **186,956,855 bytes** (`output/m7-mixed-parity-review.json`). The failed first attempt remains preserved as setup-error evidence.
- Final full repository run: **3,543/3,548 passed**, with the same five historical V3 animation/asset failures (`output/m7-mixed-repository-final.log`). Raw exit remains **1**; nothing was waived or weakened. This is a separate run and is not imported into the CLI report's repository-tests gate. The earlier pre-writer-fix repository run is retained separately.
- Final source identity matches the frozen plan (`output/m7-mixed-review-final.json`): commit `b1503fb9c61ac3f2e745830e5b75eae2501ef1ef`, working-tree hash `89d39c893e0b47b1e59c9dd8f4b085c51b345ad985d5b17a22ea6a1a0f9ab763`.
- Scoped `git diff --check` passed; attached implementation plans remain unchanged. The development server was restored on port **3000**, with HTTP 200 responses from `/` and `/grifball-validation.html`.

The mixed-contact and evidence-writer changes remain uncommitted after `b1503fb`. Next acceptance work includes player/roster execution and full AI decision/lifecycle integration, followed by calibrated performance, held-out quality/generalization and human playtesting; moving/airborne/carrier group contact remains an explicit bounded-coverage limitation.


## M7 acceptance follow-up: player/roster impact ownership and death lifecycle — 2026-09-28

The prior mixed-contact slice was committed as `8e3ce00` (`Validate mixed lunge melee contact and stream parity evidence`). Human playtesting is explicitly deferred to the user until the remaining automated M7 acceptance work is complete.

The player-impact callbacks still processed `main_ai` through both a legacy branch and the `otherPlayers` roster. When a main AI survived the first hit, the roster branch applied a second damage point from the same attack. The legacy lethal branch also set only its legacy respawn timer and death counter, leaving the actual roster timer/death count incomplete. Regular roster slash/slam/punch kills did not immediately cancel AI weapon and flight state. Main-AI eligibility omitted observer and positive-respawn-timer checks; a main AI excluded by its AI respawn state could still be hit through the roster branch. Player sword slash also lacked the dead-player guard already used by hammer attacks.

The first **166 live-only regressions reproduced 56 failures** (`output/m7-player-roster-before.log`). The corrected impact paths preserve the legacy main-AI branch, including its sword-trade callback, and exclude that actor from the subsequent offline roster iteration. Shared player-melee death bookkeeping now sets the actual three-second respawn timer, clears weapon/flight state, updates the victim's roster deaths and player kill/score counts, and maintains main-AI legacy counters and calibration. Eligibility checks consistently exclude respawning/observer victims. A dead player cannot produce a slash impact. Multiplayer message and local-acknowledgement behavior is preserved.

The final **174 live-only cases** are included in both `test:grifball-validation` and the full repository suite:

- Four attacks (slash, slam, swipe, punch), registered main AI, unregistered legacy main AI, ordinary roster victim and roster main AI without a lookup callback.
- Independently expected one-point damage, surviving-attack preservation, lethal cancellation, three-second respawn state, kill/death/score counters, medal/calibration/death callbacks and repeated post-death impacts.
- Shielded, dead, respawning, observer, friendly and distant victims, plus dead-player attacks. The unregistered legacy main AI has no Grifball team lookup, so friendly-team assertions apply to registered actors only.
- Multiple victims in both roster orders, each damaged/credited once, with main-AI legacy credit checked separately.
- Main-AI sword-trade callback preservation and one multiplayer hit message per victim without offline kill bookkeeping.
- Actual player action triggers and weapon-frame owner through impact/recovery, with independent tick-seven slash timing; actual roster respawn callbacks keep the victim dead until its timer expires and restore shields afterward.
- Killed runner ownership reconciliation releases the ball exactly once before revival.

These are production-function regression tests, **not new headless parity traces**. The paired total stays **1,927**, protocol `live-functions-vs-headless-step-v11`, with four gap groups and an inconclusive execution gate. The real-frame checks isolate weapon animation and then respawn ownership; they do not certify a complete player/AI match loop. Player lunges, mixed player/roster headless execution, decision-to-action/map lifecycle integration, calibrated performance and held-out quality/generalization remain automated acceptance work. Moving/airborne/carrier group contact and swept collision remain bounded-coverage limitations. Human playtesting follows that work; neural integration remains optional and unpromoted.


Verification:

- **223/223** focused checks passed, including all 174 new regressions, existing player parity and carrier lifecycle tests (`output/m7-player-roster-focused.log`). Type checking caught an invalid fixture-only `IDLE` state during development; it was corrected to the actual `APPROACHING` state before the frozen run.
- The first frozen attempt (`output/grifball-validation/m7-player-roster-final/`) finished with **exit 1**: its writer-recovery child failed to report startup before the existing ten-second watchdog, while the large repository suite was running concurrently. It passed **2,291/2,292** validation checks, TypeScript, all builds, startup, **16/16** browser trials and **8/8** exact repeatability pairs. Its failed verdict is retained. Resource contention is a possible cause, not a proven diagnosis; no timeout or assertion was relaxed.
- Full repository run: **3,717/3,722 passed**, with the same five historical V3 animation/asset failures (`output/m7-player-roster-repository-final.log`). Raw exit remains **1**; nothing was waived or weakened. This separate run is not imported into the CLI report's repository-tests gate.

- The standalone frozen rerun `output/grifball-validation/m7-player-roster-final-r2/` finished with **exit 0**: **2,292/2,292** validation tests, TypeScript, production client/relay and validation builds, startup, **16/16** browser trials and **8/8** exact repeatability pairs passed. The successful rerun used identical source to the failed attempt; it does not erase the original timeout. This quick run does not supply calibrated performance, quality or human-review acceptance.
- Final parity artifact re-parsed successfully: **1,927 traces**, **408,588 frames**, zero differences and four remaining gap groups (`output/m7-player-roster-parity-review-r2.json`). The execution gate remains **inconclusive**.
- Current source matches both frozen attempts (`output/m7-player-roster-review.json`): commit `8e3ce008e4060f54b7d646846f21cc5f293638c5`, working-tree hash `53a089d2e4e39fb00826278cda0e2d6f46123ba2a99c9ceea680c61804e1c10b`.

The new player/roster slice remains uncommitted after `8e3ce00`. README and these validation findings are updated; attached implementation plans remain unchanged. Next automated work is player lunge and mixed player/roster execution coverage, followed by the remaining decision/lifecycle, performance and quality acceptance. Human testing remains deferred to the user until that automated work is complete.

Scoped `git diff --check` passed. The development server was restored on port **3000**; both `/` and `/grifball-validation.html` returned HTTP 200.


## M7 acceptance follow-up: player-lunge contact and roster counter trades — 2026-09-28

The prior player/roster impact slice was committed as `87ce909` (`Validate player roster impacts and repair melee death lifecycle`). This slice validates the separate live player-lunge path before extending versioned headless player execution. Human testing remains deferred to the user until the remaining automated M7 work is complete.

The initial 114-case fixture reproduced **89 failures** (`output/m7-player-lunge-before.log`). Player lunges could ignore main-AI shields and inactive-target state, fail to damage a roster main AI when its legacy lookup was missing, leave actual respawn/death/weapon state incomplete after kills, and publish both a hit and a miss when contact overlapped a travel, timeout or arena limit. Re-entering a completed flight function could continue moving or hitting. Surviving main-AI trades wrote false death-feed entries and bypassed player lunge recovery; main-AI roster kill/death counters were incomplete. The old counter checks also accepted future timestamps and stale AI `LUNGING` state instead of the actual flight flag.

After fixing those paths, expanding trade tests to ordinary roster bots and a main AI without legacy lookup reproduced **16 further failures** (`output/m7-player-lunge-roster-before.log`). Ordinary bots' active sword/hammer counters were ignored entirely. The player-lunge path now resolves counters through the existing shared weapon/history eligibility function. The main-AI trade entry point delegates to shared player/combatant trade bookkeeping, which also handles ordinary roster victims and the missing-lookup fallback. Main-AI callback routing is preserved where available. Both participants take one point of damage, only actual deaths get feed/medal/kill/death credit, main-AI legacy counters are updated alongside roster counters, and committed defender attacks are consumed. Non-trade lethal lunges use the player-melee death helper from the prior slice. Bot-versus-bot trade execution and simulator profiles are unchanged.

All contact branches now finish once and return before miss/limit checks. Valid contact still takes precedence on a frame that also reaches a limit. Target selection consistently excludes shields, dead/respawning actors, observers and teammates, without traversing main AI twice. An inactive player cancels before moving or contacting. Completed-flight calls are no-ops. After a trade, a surviving player receives the configured lunge recovery rather than an immediately ready sword. Multiplayer counter detection uses the shared recent-history rules while retaining its existing hit-message/local-acknowledgement ownership.

The **195 live-only cases** run in both validation and repository suites:

- Real commitment and flight functions at 24 units/s in four cardinal directions across registered main AI, unregistered legacy main AI, ordinary bots and a roster main AI with no legacy lookup. Independent frame-nine contact, one damage, kill/death credit and configured recovery expectations; actual weapon animation and registered roster respawn callbacks verify cooldown and revival.
- Shield/dead/respawn-clock/respawn-state/observer/team exclusions, nearest eligible opponent in both roster orders, and dead/respawning/observer player cancellation. Unregistered legacy actors have no Grifball team lookup, so the friendly-team assertion is scoped to registered actors.
- Exactly one hit or miss at time, travel-distance and circular-arena boundaries, including missing targets and repeated calls after completion.
- Real carrier reconciliation after lethal contact; ball release occurs once before revival.
- Sword and hammer counters across every identity with both participants at one or two HP, including one-sided and mutual deaths. Independent damage, feed totals, per-actor credit and recovery expectations.
- Recent/expired/exact-window/zero/future/disabled counter history, actual sword-flight flag and stale AI state across every identity. Explicit hammer/sword settings remain independent.
- Multiplayer main/regular targets with ordinary, sword/hammer trade, future-history, shield and closed-connection cases: one outgoing message when connected, no offline remote-health mutation, and local trade recovery.

This is live-function regression evidence, **not additional headless parity**. The total remains **1,927 paired traces**, protocol `live-functions-vs-headless-step-v11`, with four open coverage groups. The tests isolate flight, weapon recovery and roster revival; they do not run complete player/AI matches, validate network round trips, certify swept collision, or compare player-lunge execution to an independently stepped simulator. The next automated slice is versioned player-lunge/mixed player-roster execution parity. Decision-to-action and complete map/round lifecycle integration, calibrated performance, held-out quality/generalization and broader moving/airborne/carrier mixed groups remain open. Human playtesting follows the automated work; neural integration remains optional and unpromoted.


Verification:

- **710/710** focused checks passed (`output/m7-player-lunge-focused.log`): all 195 new live player-lunge cases, prior player/roster impact regressions, roster lunge parity checks and carrier lifecycle checks.
- Full repository suite: **3,912/3,917 passed**, with the same five historical V3 animation/asset failures (`output/m7-player-lunge-repository-final.log`). Raw exit remains **1**; no checks were waived or weakened. This separate run is not imported into the CLI report's repository-tests gate. The repository suite finished before starting frozen validation to avoid the concurrent-run writer-startup timeout seen in the previous slice.

- The frozen run `output/grifball-validation/m7-player-lunge-final/` finished with **exit 0**: **2,487/2,487** validation tests, TypeScript, production client/relay and validation builds, startup, **16/16** browser trials and **8/8** exact repeatability pairs passed. This quick run does not supply calibrated performance, held-out quality or human-review acceptance.
- The final parity artifact was re-parsed: all **1,927 traces** and **408,588 frames** are present, with zero differences and four remaining gap groups (`output/m7-player-lunge-parity-review.json`). The execution gate remains **inconclusive**.
- Source identity matches the frozen plan (`output/m7-player-lunge-review.json`): commit `87ce909c122cbe4e4102ac0cb03732709afd6356`, working-tree hash `81ce395f03671ddc5b16cdca461da79712b459865c044132e62428143b2b0432`.
- Scoped `git diff --check` passed. The development server was restored on port **3000**; `/` and `/grifball-validation.html` both returned HTTP 200. Attached implementation plans remain unchanged.

The player-lunge and counter-trade slice remains uncommitted after `87ce909`. Next work is independently stepped player-lunge/mixed player-roster parity and the remaining automated M7 acceptance gaps. Human playtesting remains deferred until that automated work is complete.

## 2026-09-28 — independent player-lunge and mixed-roster parity

Committed the preceding live player-lunge/counter-trade slice as `3a0efef` (`Validate player lunge contact and roster counter trades`). This slice adds independent simulator evidence for a bounded subset of that corrected runtime.

New opt-in `live-mixed-v1` requires exactly one explicit `localPlayerId`. It applies player movement, nearest-eligible lunge contact and recovery before roster movement/attacks, while retaining roster-v2 timing for the other actors. Player flight remains planar; trades consume the defender's committed attack, and local recovery retains the live elapsed clock. Death and respawn countdown order match the tested player-first frame boundary. No live gameplay code changes in this slice. Existing execution profiles and default training behavior remain unchanged; this is not a neural-policy promotion.

Protocol `live-functions-vs-headless-step-v12` adds **128 traces**, bringing the total to **2,055**. Sixteen encounters run for 120 ticks across both roster orders, mirrored teams and main-AI/regular targets. They cover one-/two-HP hits, shield/team exclusions, travel and arena misses, lethal/surviving sword/hammer counters, melee-before-flight/contact-before-melee/same-frame damage, and lethal/nonlethal damage during flight. The live fixture calls production commitment, movement/flight, weapon animation, roster respawn and roster visual-impact functions. The headless fixture advances independently through `stepSimulation`; no live state is copied after commitment. Every tick compares player position/velocity, flight, health, phase/elapsed clock, death countdown and credit, plus roster health, phase, shields, countdown and credit. Independent expectations pin final health, contact/finish frames and kill ownership.

The initial **104/128** result exposed two fixture defects: two-HP survivors had an incorrect one-HP expectation, and a small-arena miss placed stationary live targets outside the arena while the simulator correctly constrained them. The corrected boundary case uses valid in-arena targets and a committed heading that misses them. These fixes changed fixture expectations/setup, not production behavior. All **134 focused checks** now pass: 128 paired encounters, three JSON snapshot continuations through flight/recovery/death countdown, local identity validation, mixed-role/flight/history hash sensitivity with legacy compatibility, and a retained incompatible prior-player diagnostic.

The execution gate remains **inconclusive**, with four coverage groups. These traces stop before revival and do not certify player primary attacks or incoming roster lunges under mixed execution, carrier/objective reconciliation, complete round ordering, autonomous decisions, moving/airborne/carrier groups, swept collision, or player pitch/crouch/model variants. The mixed profile still uses existing objective/respawn machinery beyond the tested boundary. Full decision-to-action and map/round lifecycle integration, calibrated performance and held-out quality/generalization remain automated M7 work. Human playtesting stays deferred until that work is complete.

Verification:

- **184/184** focused integration checks passed (`output/m7-player-parity-integration.log`), including the new mixed traces, acceptance gate, tactical adapter and existing simulator step/weapons/mechanics tests.
- Full repository suite: **4,046/4,051 passed**, raw exit **1**, with the same five historical V3 animation/asset failures (`output/m7-player-parity-repository-final.log`). No checks were waived. This separate run is not imported into the CLI report's repository-tests gate.
- Frozen quick run `output/grifball-validation/m7-player-parity-final/` finished with **exit 0**: **2,621/2,621** validation tests, TypeScript, production client/relay and validation builds, startup, **16/16** browser trials and **8/8** exact repeatability pairs passed. It does not provide calibrated performance, held-out quality or human-review acceptance.
- The saved parity artifact was re-parsed successfully: **2,055 traces**, **423,948 frames**, zero differences and four remaining coverage groups (`output/m7-player-parity-artifact-review.json`). Execution parity remains **inconclusive**.
- Source identity matches the frozen plan (`output/m7-player-parity-review.json`): commit `3a0efef40462ee7049f25f3d52ff9f30f606279e`, working-tree hash `8940fa9adea1ad149e9d5ab686f49025b645c7f9578d2395fd3b956ffee8ccc1`.
- Scoped `git diff --check` passed. Attached implementation plans remain unchanged. The development server was restored on port **3000**; both the game and validation page returned HTTP 200.

This new parity slice remains uncommitted after `3a0efef`. The next bounded work is mixed-player lifecycle and incoming roster-flight coverage before full decision-to-action/objective integration. Human testing remains deferred until all automated M7 acceptance work is complete.

## 2026-09-29 — incoming roster flight and mixed-player revival

Continued the prior uncommitted mixed-player parity slice. No commit was requested this turn; HEAD remains `3a0efef`. Human testing stays deferred.

The first 128-case run reproduced **104 failures** (`output/m7-mixed-lifecycle-before.log`). Incoming roster trades did not consume a surviving player's active sword/hammer swing, allowing a second hit after the trade. Player counter eligibility accepted future timestamps. The mixed simulator also retained the roster spawn-facing convention for the local player and erased the recovery clock that the live animation retains once ready.

The shared incoming-trade handler now consumes active player counters into their configured recovery, clears dead players' attacks immediately and uses the same finite, positive, nonfuture recent-history rule for player and roster defenders. Mixed simulation converts local-player respawn yaw and preserves the completed player recovery clock. Existing nonmixed simulator profiles remain unchanged. Local respawn's harmless negative timer remainder is compared canonically as zero; health, revival frame and shield boundaries remain explicit assertions.

Protocol `live-functions-vs-headless-step-v13` adds **168 traces** (21 encounters × two attacker identities × mirrored teams × both actor orders), totaling **2,223 paired traces**. Each new trace independently advances actual live player movement/respawn/weapon frames and roster lunge/respawn/visual functions against `stepSimulation` for 300 ticks. Cases cover one-/two-HP contact, active sword/hammer counters, both weapons' exact-window/expired/future/zero/disabled histories, shield and shield-expiry contact, friendly/dead exclusions, and simultaneous player/roster revival. Two shared authored spawns expose player-first occupancy arbitration. Independent checks pin health before/after revival, kill/death credit, exact revival ticks, spawn selection and the shield decrement that occurs for a roster bot on its revival frame but not for the player. Four JSON snapshot continuations cross contact/recovery or revival. No live-to-simulator state copying occurs after setup.

**830/830** focused checks passed (`output/m7-mixed-lifecycle-focused.log`), covering the new traces/snapshots, existing player-lunge parity, live player-lunge regressions and prior roster-flight parity. The execution gate remains **inconclusive**. These grounded two-actor traces do not certify opposing player/roster flights, general player primary combat, broader maps/spawn recovery, carrier/airborne/moving groups, full objective/round ordering or autonomous decisions. Calibrated performance and held-out quality/generalization remain open acceptance work; neural integration remains optional and unpromoted.

Verification:

- **182/182** acceptance-gate integration checks passed (`output/m7-mixed-lifecycle-integration.log`).
- Full repository suite: **4,218/4,223 passed**, raw exit **1**, with the same five historical V3 animation/asset failures (`output/m7-mixed-lifecycle-repository-final.log`). No checks were waived or weakened. This separate run is not imported into the CLI report's repository-tests gate.
- Frozen quick run `output/grifball-validation/m7-mixed-lifecycle-final/` finished with **exit 0**: **2,793/2,793** validation tests, TypeScript, production client/relay and validation builds, startup, **16/16** browser trials and **8/8** exact repeatability pairs passed. Quick success does not supply calibrated performance, held-out quality or human-review acceptance.
- The saved parity artifact was re-parsed: **2,223 traces**, **474,348 frames**, zero differences and four remaining coverage groups (`output/m7-mixed-lifecycle-artifact-review.json`). Execution parity remains **inconclusive**.
- Source identity matches the frozen plan (`output/m7-mixed-lifecycle-review.json`): commit `3a0efef40462ee7049f25f3d52ff9f30f606279e`, working-tree hash `329cf25acf9516960383ba2981c3ecbc7369d1e36d6e7f9ff198877d12931f4e`.
- Scoped `git diff --check` passed; attached implementation plans remain unchanged. The old task-owned development server was no longer running at the start of validation. A new hidden development server was started on port **3000** afterward; the game and validation page returned HTTP 200.

This slice and the preceding player-lunge parity slice remain uncommitted. Next work is opposing player/roster flights and broader mixed objective/lifecycle ordering, followed by the remaining decision integration and calibrated acceptance gates. Human testing remains deferred until the automated M7 work is complete.

## 2026-09-29 — opposing player/roster lunges

Committed the preceding player-lunge and incoming-flight/lifecycle slices as `a70405d` (`Validate mixed player combat and respawn parity`). Continued with the next bounded acceptance slice; human testing remains deferred.

The initial **88/128** paired result exposed **40 failing cases** (`output/m7-opposed-flight-before.log`). A lethal incoming roster lunge could leave the local player lunging or recovering until the next weapon frame. A surviving player hit by an incoming trade was sent through roster-style simulator flight completion, becoming ready immediately and losing the current frame's velocity instead of entering player recovery.

Lethal live roster-lunge hits now immediately cancel local flight and clear weapon phases/timers. The opt-in mixed simulator handles a surviving local player's traded flight separately from roster recovery: it preserves the current frame's velocity, starts configured lunge recovery and advances that recovery on the next player weapon frame. Existing nonmixed execution profiles remain unchanged.

Protocol `live-functions-vs-headless-step-v14` adds **128 traces**, totaling **2,351 paired traces**. Two starting separations select player-first or roster-first contact. Every player/bot one-/two-HP combination runs with trades enabled/disabled, main/regular opponent identity, mirrored teams and both actor orders. Both-two-HP cases use a shorter reload. Actual player commitment/flight and roster flight functions advance independently from `stepSimulation` for 300 ticks, including death countdown and revival. Independent checks pin surviving health, kill/death ownership, the contact/end frame, and the last recovering/first ready frame. Four JSON snapshot continuations cross contact/recovery or revival. The existing mixed-lifecycle fixture now supports these opposed commitments and compares local flight state each tick.

**767/767** focused checks passed (`output/m7-opposed-flight-focused.log`), including the 128 new paired cases, four snapshot checks and prior mixed lifecycle, player-lunge and roster-flight parity. This remains bounded two-actor grounded execution: shielded/airborne/moving/carrier duels, group interference, complete objective/round ordering, telemetry callback completeness, autonomous decisions, calibrated performance and held-out quality remain outside this result. The four remaining coverage groups keep execution parity **inconclusive**; neural integration remains optional and unpromoted.

Verification:

- **142/142** acceptance-gate integration checks passed (`output/m7-opposed-flight-integration.log`).
- Full repository suite: **4,350/4,355 passed**, raw exit **1**, with the same five historical V3 animation/asset failures (`output/m7-opposed-flight-repository-final.log`). No checks were waived or weakened. This separate run is not imported into the CLI report's repository-tests gate.
- Frozen quick run `output/grifball-validation/m7-opposed-flight-final/` finished with **exit 0**: **2,925/2,925** validation tests, TypeScript, production client/relay and validation builds, startup, **16/16** browser trials and **8/8** exact repeatability pairs passed. Quick success does not provide calibrated performance, held-out quality or human-review acceptance.
- The saved parity artifact was re-parsed: **2,351 traces**, **512,748 frames**, zero differences and four remaining coverage groups (`output/m7-opposed-flight-artifact-review.json`). Execution parity remains **inconclusive**.
- Source identity matches the frozen plan (`output/m7-opposed-flight-review.json`): commit `a70405d514159f3d6acb024cb009a52bd8e0a81a`, working-tree hash `0e88278ae051f673cbb2d14156fda60363cce33a38ca5ca26ea20e1bdc47e1da`.
- Scoped `git diff --check` passed; attached implementation plans remain unchanged. The verified task-owned development server was stopped for the frozen run and restored afterward on port **3000**. Both the game and validation page returned HTTP 200.

This new slice remains uncommitted after `a70405d`. Next work is mixed carrier/objective ordering and the remaining bounded execution gaps before full decision integration, calibrated performance and held-out quality acceptance. Human testing remains deferred until the automated M7 work is complete.


## 2026-09-29 — mixed objective lifecycle boundaries

Continued on `a70405d` without committing; both the prior opposing-flight slice and this slice remain uncommitted. Human testing remains deferred.

Added **236 objective boundary traces** plus four JSON snapshot checks. These compare actual `updateGrifballObjectiveForState` execution directly with `tickGrifballObjective`, independently after setup. They deliberately do not call the full movement/combat frame. Authored player releases invoke the production player pass function; authored roster releases invoke the same ball primitive and carrier transition used by scripted passing, without certifying its planning, charge scheduling or facing decisions.

Coverage includes player/bot carriers, mirrored teams and reversed actor order; nearest/tied pickups, remote/respawning eligibility, request consumption and pickup during recovery; minimum/full/disabled throws, settled-ball reception and automatic return; dead/respawning/missing holders; healing delay and recovery; immediate pickup-and-score, own-goal exclusion, goal suppression after death or release, exactly one goal notification, winner transitions and reset callbacks. Round-reset placement additionally spans eight supplied maps and five spawn edge cases. Independent expected outcomes supplement paired comparisons, including preservation of injury, death countdown and weapon recovery at the reset boundary.

The first initialized 216-test version passed **93/216** (`output/m7-objective-before.log`). Some failures were incorrect fixture expectations: tied pickups select the last equally near candidate, and reception waits for the thrown ball to settle. Correcting those expectations left real simulator differences in remote/respawning pickup eligibility, player-first enumeration, invalid possession, local release recovery, and reset placement/vitals. The expanded suite also checks recovery-preserving pickups and death/release on a goal plate.

The opt-in mixed simulator now enumerates the local player before offline AI, applies live HP/respawn eligibility, and preserves live carrier weapon-phase transitions. Mixed round resets use greedy team-spawn placement in live participant order, retain spawn height/facing and preserve individual health, death countdown and recovery. They reposition participants rather than mass-respawn them. Legacy execution profiles remain unchanged; this slice changes simulator behavior and validation, not the production objective rules.

Protocol `live-functions-vs-headless-step-v15` stores `objectiveTraces` with an explicit `objective-functions` boundary and scope. The **236 traces / 30,240 frames** have zero differences, bringing combined evidence to **2,587 traces / 542,988 frames**. The execution gate remains **inconclusive**: objective-only checks do not close full-frame carrier death/pass/pickup/score ordering, autonomous decisions, observer representation or complete map execution. Calibrated performance, held-out quality and final repository acceptance remain open.

Verification:

- **296/296** focused objective, carrier lifecycle and simulator regression checks passed (`output/m7-objective-focused.log`).
- **3,165/3,165** validation-suite tests passed, including the complete parity gate and all prior trace groups (`output/m7-objective-validation.log`).
- Final TypeScript check passed with the same 8 GB heap allowance used by the validation runner (`output/m7-objective-typecheck.log`); an initial invocation with Node's default heap exhausted memory.
- Production client build passed (`output/m7-objective-build.log`); Vite reported its existing large-chunk warning.
- Scoped `git diff --check` passed; attached implementation plans remain unchanged.
- Saved objective evidence: `output/m7-objective-evidence.json`; compact summary: `output/m7-objective-summary.json`. Source identity: commit `a70405d514159f3d6acb024cb009a52bd8e0a81a`, working-tree hash `dfed442ef215ee6c1b4bae4b745da7f575f46e12638761b746720b7dc741bae6`.
- A full repository suite and frozen browser CLI run were not repeated for this simulator/objective-boundary slice. The previous full run's five historical V3 failures remain unresolved; no waiver or M7 acceptance is implied.

Next work is integration of these objective boundaries into complete mixed movement/combat frames, particularly carrier death versus respawn, pass release and same-frame pickup/scoring. Human review remains deferred until the automated acceptance requirements are completed.


## 2026-09-29 — mixed combat/objective frame ordering

Committed opposing-flight and objective-boundary work as `3b2582c` (`Validate opposing flights and mixed objective lifecycle`). Continued with frame ordering; this new slice remains uncommitted. Human review remains deferred.

Added **64 traces** plus two snapshot continuations through the actual `advanceGrifballFrameForState` coordinator. Production local movement/respawn and weapon frames, roster respawn, lunge flight, objective processing, skeletal melee and end-of-frame carrier reconciliation run independently from `stepSimulation`. Targets and attack commands are authored; the runner is grounded and stationary. Cases vary player/bot runner, lunge/newly requested slash, on/off enemy goal, one/two HP, mirrored teams and roster order. Presentation, general AI policy and match-timer callbacks are suppressed; traces stop before revival or round-reset placement.

The initialized pre-fix suite passed **41/66** (`output/m7-frame-objective-before.log`). The simulator advanced roster melee before objective scoring, unlike the live coordinator, and lacked the live end-of-frame carrier repair. Mixed Grifball execution now commits roster attack intent before objectives, advances skeletal melee after objectives and repairs dead possession without running physics, healing, pickups or scoring a second time. Cooldown/swap timers advance once. Committed lunge contact stays before objectives. Other execution profiles and combat-mode ordering retain their previous behavior.

Independent expectations establish that lethal early lunges deny the goal and allow same-frame recovery; late melee permits a goal already registered by the objective and allows recovery only at the next objective tick. Scoring removes runner benefits before late damage, so a two-HP runner may be clamped to one HP and killed after scoring. Both engines are checked for that outcome, exact pickup timing and a single goal notification. A render-boundary assertion ensures a dead runner never publishes possession. JSON continuations cross the first impact/pickup boundary.

Protocol `live-functions-vs-headless-step-v16` adds `frameObjectiveTraces` with explicit bounded scope. **64 traces / 7,680 frames** match, bringing combined evidence to **2,651 traces / 550,668 frames**. This does not certify pass-input ordering, moving carrier crowds, autonomous decisions, observer representation, full map/round lifecycle, calibrated performance or held-out quality. The execution gate remains **inconclusive**.

Verification:

- **3,231/3,231** validation-suite tests passed, including the complete parity gate and all earlier trace groups (`output/m7-frame-objective-validation.log`).
- **122/122** focused frame, simulator and live carrier regressions passed after limiting the new ordering to Grifball mode (`output/m7-frame-objective-focused.log`).
- TypeScript passed with the validation runner's 8 GB heap allowance (`output/m7-frame-objective-typecheck.log`).
- Production client build passed (`output/m7-frame-objective-build.log`), with the existing large-chunk warning.
- Saved evidence: `output/m7-frame-objective-evidence.json`; summary: `output/m7-frame-objective-summary.json`. Source identity: commit `3b2582c32313e759d6fa25241d48c11c2b585b3c`, working-tree hash `4b6d1125af6a457416656965345914747a7703f9b2a72bcf8dee02ebad37a9d7`.
- Scoped `git diff --check` passed; attached implementation plans remain unchanged.
- Full repository and frozen browser CLI runs were not repeated for this simulator/frame-ordering slice. The previous five V3 repository failures remain unresolved, without waivers.

Next work is player pass-input/charge ordering and movement across objective transitions, followed by remaining complete-frame/map/decision integration. Human testing stays deferred until the automated acceptance requirements are complete.


## 2026-09-29 — pointer pass timing and moving release

Committed the prior frame-ordering slice as `6db815b` (`Validate mixed combat and objective frame ordering`). Continued with local pointer pass timing. New changes remain uncommitted, and human review remains deferred.

Added **64 traces**, three snapshot continuations and two hash checks. Actual pointer press/release handlers run before the live frame coordinator, followed by production local movement, weapon animation and objective processing, independently from mixed `stepSimulation`. Cases include forward/sideways movement, mirrored facing, turning at release, two maximum charge durations, overcharge, disabled/re-enabled throwing, holding before pickup, releasing/repressing after pickup and scoring during charge. There are no roster opponents in this family; combat during charging, autonomous passing and other input devices remain outside its scope.

After correcting the fixture's mouse-binding identifier, the pre-fix suite passed **8/67** (`output/m7-pass-input-before.log`). Mixed simulation released after movement, capped the raw charge timer, and treated an already-held button as a new pass request after pickup or re-enabling throwing. Mixed local pass input now remembers the previous button state and active charging, accepts press edges, releases before movement using the sampled heading, and advances raw charge in the objective phase. Throw strength remains capped by existing rules. The two new flags survive snapshots and participate in mixed hashes; legacy behavior and hashes remain unchanged.

The live scoring path also left the timer and displayed charge stale until a later update. It now clears both on the scoring frame. Independent checks assert release counts, pre-movement throw origins, possession retention after blocked/early holds, and immediate charge-display cleanup after a goal. Snapshot continuation crosses overcharge, held-through-pickup and disable/re-enable states.

Protocol `live-functions-vs-headless-step-v17` stores `passInputTraces`: **64 traces / 7,680 frames**, zero differences. Combined evidence now totals **2,715 traces / 558,348 frames**. This samples pointer-equivalent input once per tick; sub-frame event timing, combat during charging, remote/device-specific input, remaining moving carrier interactions, autonomous decisions, complete maps/matches, calibrated performance and held-out quality are not certified. The execution gate remains **inconclusive**.

Verification:

- **3,300/3,300** validation-suite checks passed (`output/m7-pass-input-validation.log`), including all parity groups and acceptance-gate checks.
- **125/125** focused pass, simulator and live carrier regressions passed (`output/m7-pass-input-focused.log`).
- TypeScript passed with the validation runner's 8 GB heap allowance (`output/m7-pass-input-typecheck.log`).
- Production client build passed (`output/m7-pass-input-build.log`), with the existing large-chunk warning.
- Scoped `git diff --check` passed; attached implementation plans remain unchanged.
- Saved and re-parsed evidence: `output/m7-pass-input-evidence.json`; summary: `output/m7-pass-input-summary.json`. Source identity: commit `6db815b6a3fb3eb861aeb6bb8569ad108bf952da`, working-tree hash `116b0dfa703fe9efa6e3ae2a3290cdbb426451d97796a8a490b608ccda7282ae`.
- Full repository and frozen browser CLI runs were not repeated. The previous five V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is combat during charging and the remaining carrier/objective transitions, followed by broader execution and acceptance closure. Human testing stays deferred until the automated acceptance requirements are complete.


## 2026-09-29 — combat during charge and recovery after revival

Committed the prior pass-input slice as `7189398` (`Validate pointer pass input and moving release timing`). Continued with charged-player combat and revival/recovery coverage. This new slice remains uncommitted; human review remains deferred.

Added **208 traces** plus eight JSON snapshot checks, extending the existing actual-frame coordinator fixture. A player begins with an authored pre-existing charge, then receives a roster slash or committed lunge while standing or strafing. Cases cover one/two HP, mirrored teams and reversed actor order, protected/unprotected targets, release immediately before contact, release after surviving contact, or continued holding through death. Traces run 240 ticks through player revival. Sixteen additional recovery cases return the player to an authored origin spawn, recover the loose ball after revival, and either keep holding the old input or release/repress to start a fresh pass.

The first run passed **148/196** (`output/m7-charge-combat-before.log`). The 48 shielded-lunge failures were fixture defects: its target proxy omitted the live player shield, and its live lunge retained the helper's original start position after actors were repositioned. The fixture now supplies the current shield and calls the production lunge commitment function after setup. These fixes also strengthen the earlier frame/objective fixture. After correction, the expanded **212/212** focused checks passed (`output/m7-charge-combat-focused.log`); the final suite adds four recovery-input snapshots and further independent assertions. No production gameplay changes were needed.

Independent checks pin contact health, survival of a ball released before a lethal hit, release counts, charge cancellation on death, health after revival, exact recovery/pointer-repress checkpoints, and absence of automatic recharging on pickup. Snapshots cross the first hit, the pre-revival boundary and fresh input around recovery. The live and headless states advance independently after initialization; no state copying is used between frames.

Protocol `live-functions-vs-headless-step-v18` stores `chargeCombatTraces`: **208 traces / 49,920 frames**, zero differences. Combined evidence totals **2,923 traces / 608,268 frames**. This covers a single authored attacker and player runner, not multi-attacker carrier crowds, autonomous pass/attack decisions, other devices, complete map/round execution or full matches. Calibrated performance, held-out quality and final repository acceptance remain open, so execution parity stays **inconclusive**.

Verification:

- **3,516/3,516** validation-suite tests passed, including all prior trace groups and acceptance-gate assertions (`output/m7-charge-combat-validation.log`).
- TypeScript passed with the validation runner's 8 GB heap allowance (`output/m7-charge-combat-typecheck.log`).
- Saved and re-parsed evidence: `output/m7-charge-combat-evidence.json`; summary: `output/m7-charge-combat-summary.json`. Source identity: commit `7189398f46e4ad4587dcc3234438bdf787f90a0f`, working-tree hash `25f77a07ea2e623a43287a3e61ac1eef41e935b81d2d51a81fa87d0b3a410238`.
- Scoped `git diff --check` passed; attached implementation plans remain unchanged.
- Production builds, full repository tests and frozen browser CLI runs were not repeated for this validation-only change. The previous five V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is multi-actor carrier execution and the remaining broader map/decision integration. Human testing stays deferred until the automated acceptance requirements are complete.


## 2026-09-29 — multiple attackers and contested carrier recovery

Committed the prior charge/combat slice as `3579b0c` (`Validate combat during charge and carrier recovery`). Continued with multiple attackers and contested recovery. This new slice remains uncommitted; human testing remains deferred.

Added **384 traces** plus **12 JSON snapshot continuations**. The existing actual-frame fixture now registers two attackers, a player or roster runner, and protected pickup candidates from opposing teams (five actors, or six with the separate idle local player). Paired slashes, paired committed lunges and mixed flight/slash focus fire cover one to four runner HP, shielded/unshielded runners, mirrored teams and reversed roster order. Collectors either stand at equal distance or put the escort closer, so the winner must follow insertion order only for a tie. Live and simulated actors advance independently after setup; targets, attack commitments and pickup requests are authored.

Independent assertions verify first-contact health, exactly one credited kill and death for lethal focus fire, surviving carrier retention, same-frame recovery after an early flight death, next-frame recovery after late skeletal melee, collector health, stable possession and no goals. Kill attribution follows flight-before-skeletal ordering and roster order within each phase. Twelve snapshots cover all three attack combinations and both runner identities immediately after contact and recovery. Saved frames include every roster actor's health, weapon, position, shield, lunge state and kill/death counters, alongside ball state and simulator kill events.

The first focused run failed **196/196** because newly added simulated collectors inherited the sword-equipped template while their live counterparts held hammers (`output/m7-carrier-crowd-before.log`). Explicitly initializing collector weapons fixed the fixture. The 196 initial checks then passed; adding unequal-distance cases and more snapshots expanded coverage to 396 checks. TypeScript also identified three overly broad `TeamId` arguments; using the fixture's explicit blue/red team constants resolved them. No production gameplay changes were needed.

Protocol `live-functions-vs-headless-step-v19` stores `carrierCrowdTraces`: **384 traces / 46,080 frames**, zero differences. Combined evidence totals **3,307 traces / 654,348 frames**. This bounded family covers stationary targets and protected collectors. Moving/airborne crowds, unprotected recovery combat, carrier counterattacks, autonomous decisions, complete map/match execution, calibrated performance, held-out quality and final repository acceptance remain open. Execution parity stays **inconclusive**.

Verification:

- **3,912/3,912** validation-suite tests passed, including prior parity groups and acceptance-gate checks (`output/m7-carrier-crowd-validation.log`).
- After narrowing the team constants, **396/396** focused checks passed (`output/m7-carrier-crowd-focused.log`) and TypeScript passed with the 8 GB heap allowance (`output/m7-carrier-crowd-typecheck.log`).
- Saved and re-parsed final evidence: `output/m7-carrier-crowd-evidence.json`; summary: `output/m7-carrier-crowd-summary.json`. Source identity: commit `3579b0cd03513bbf16314d7668ba2328a5f25b59`, working-tree hash `1d7d118f1e9b4c8f7732728c8ca87a2b6e02f29f121180bcde869018d7820ff3`.
- Scoped `git diff --check` passed; attached implementation plans remain unchanged. README and both explicit test command lists include the new validation coverage.
- Production builds, full repository tests and frozen browser CLI runs were not repeated for this validation-only change. The previous five V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is moving-carrier combat and unprotected recovery interactions, followed by broader map/decision integration and the remaining acceptance gates. Human testing stays deferred until the automated acceptance requirements are complete.


## 2026-09-29 — moving player carriers and exposed recovery candidates

Committed the prior carrier-crowd slice as `858e123` (`Validate multi-attacker carrier recovery`). Continued with moving player carriers and recovery under damage. This new slice remains uncommitted; human testing remains deferred.

Added **384 traces** and **48 JSON snapshot continuations** to the actual-frame versus mixed `stepSimulation` comparison. Five/six actors include a one-to-three-HP runner, two attackers, and opposing collectors without shields. The escort has one or three HP. Paired slashes or a committed lunge plus slash start immediately or at tick 12; runners are stationary players/roster bots or players crossing/retreating under continuous authored input. Mirrored teams and reversed actor order exercise eligibility and credit ordering. Moving roster carriers and autonomous steering remain outside this family.

The fixture uses production local movement, roster attack/flight resolution, objective processing, skeletal melee and final carrier repair. Delayed commitments are applied independently to the live state, headless state and restored continuation. Independent assertions pin health, movement, kill/death credit, possession boundaries and collector eligibility. With pinned movement settings, a retreating runner leaves slash range at the delayed attack but crosses the pursuing lunge's contact radius on tick 17. A lethal contact there drops the ball beyond the stationary collectors' reach. Nearer contacts verify that a dead escort cannot recover, and a three-HP escort that recovers as a one-HP carrier can die from a later slash in that same frame; the opponent then recovers on the next tick. The render-boundary assertion now rejects any dead/missing published holder, including newly recovered carriers. Snapshots cross ticks 11, 12, 16 and 17 for both lethal and surviving scenarios.

The initial focused run passed **288/384** (`output/m7-carrier-recovery-before.log`). The 96 retreat failures were a fixture error: its live joystick's forward axis was reversed relative to the simulator command. Correcting that input mapping produced zero differences; independent movement assertions now catch that error directly. TypeScript also found a widened string in the generated case list; explicit return typing and a typed motion filter resolved it. No production gameplay changes were needed.

Protocol `live-functions-vs-headless-step-v20` stores `carrierRecoveryTraces`: **384 traces / 46,080 frames**, zero differences. Combined evidence totals **3,691 traces / 700,428 frames**. Authored grounded input does not certify moving roster carriers, carrier counterattacks, autonomous attack/pass/route decisions, airborne crowds, complete map/match execution, calibrated performance, held-out quality or final repository acceptance. Execution parity stays **inconclusive**.

Verification:

- **4,344/4,344** validation-suite tests passed, including previous trace families and acceptance-gate checks (`output/m7-carrier-recovery-validation.log`).
- After the case-list type correction, **432/432** focused checks passed (`output/m7-carrier-recovery-focused.log`) and TypeScript passed with the 8 GB heap allowance (`output/m7-carrier-recovery-typecheck.log`).
- Saved and re-parsed final evidence: `output/m7-carrier-recovery-evidence.json`; summary: `output/m7-carrier-recovery-summary.json`. Source identity: commit `858e1232bce3bad3144ee360e24b27ae7228a901`, working-tree hash `c420253e55de8afa4e787b5f3e89ac76e77f3de1a7dec071be2328049ce8ab4b`.
- Scoped `git diff --check` passed; attached implementation plans remain unchanged. README and both explicit test command lists include the new family.
- Production builds, full repository tests and frozen browser CLI runs were not repeated for this validation-only change. The previous five V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is moving roster carriers and carrier counterattacks, followed by broader map/decision integration and remaining acceptance gates. Human testing stays deferred until the automated acceptance requirements are complete.


## 2026-09-29 — moving roster carriers and counterpunch execution

Committed the prior carrier-recovery slice as `ab83576` (`Validate moving carriers and exposed recovery`). Continued with roster carrier movement and counterpunch execution. This new slice remains uncommitted; human testing remains deferred.

Added **576 traces** plus **48 JSON snapshot continuations**. Two ordinary roster actors and an idle local player run through the actual frame coordinator independently of mixed `stepSimulation`. The production carrier movement function follows a supplied straight goal direction with an empty avoidance list; its close-enemy counter branch is made available at tick four. Incoming slashes/lunges or no attack, one/two HP on each actor, two movement speeds, quick/default punch durations, shields, mirrored teams and both roster orders cover surviving counters, death cancellation, blocked damage and movement out of punch range. Headless movement/attack intent is derived from its own state, never copied from the live frame. This tests a bounded counter branch and execution, not autonomous availability or route selection.

The pre-fix run passed **320/576** (`output/m7-runner-combat-before.log`). It exposed a production bug: carrier goal movement overwrote the punch's heading on the following frame, so a committed counter turned away from the enemy before impact. Counter initiation also retained the previous horizontal velocity on a frame where no movement occurred. The production objective movement function now clears horizontal velocity when starting the counter and preserves the committed heading during movement until the weapon is ready again, including after route validation. Route movement still advances normally, so a slower punch can miss when its carrier has moved too far away; the fix does not guarantee a hit.

Independent assertions pin counter-request counts, movement on every frame, incoming contact timing, damage, kill/death credit, ball retention/drop and goal absence. The quick punch lands on tick eight when the carrier survives and the target is unshielded; the default-duration punch arrives after the continuously moving carrier has left range. Roster order and counter pauses also test the one-frame contact difference for the faster runner. Snapshots cross ticks three, four, eight and 26. Two direct movement regressions verify the counter's velocity reset, preserved aim during windup/impact/recovery and resumed goal facing when ready. Per-frame evidence includes runner heading, velocity while alive, weapon phase/elapsed time and kill counters.

Protocol `live-functions-vs-headless-step-v21` stores `runnerCombatTraces`: **576 traces / 69,120 frames**, zero differences. Combined evidence totals **4,267 traces / 769,548 frames**. Route selection, attack availability, repeated counters, main-AI-specific execution, moving/airborne crowds, complete map/match execution, calibrated performance, held-out quality and final repository acceptance remain uncertified. Execution parity stays **inconclusive**.

Verification:

- **4,968/4,968** validation-suite tests passed, including previous trace groups and acceptance-gate assertions (`output/m7-runner-combat-validation.log`).
- **645/645** focused runner-combat and team-plan runtime checks passed, including the new direct movement regressions (`output/m7-runner-combat-focused.log`).
- TypeScript passed with the 8 GB heap allowance (`output/m7-runner-combat-typecheck.log`).
- Production client build passed (`output/m7-runner-combat-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-runner-combat-evidence.json`; summary: `output/m7-runner-combat-summary.json`. Source identity: commit `ab83576c1024bb387e519646970d969a47b5c721`, working-tree hash `eb3c8a43038b0d9921c444664ae38a1e66b042839e6eb279dca47f8ad80c50c1`.
- Scoped `git diff --check` passed; attached implementation plans remain unchanged. README and both explicit test command lists include the new family.
- Full repository tests and frozen browser CLI runs were not repeated. The previous five V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is broader map/round execution integration and the remaining decision/acceptance gates. Human testing stays deferred until the automated acceptance requirements are complete.


## 2026-09-29 — map scoring, round reset and scheduled revival in full frames

Committed the prior runner-counter slice as `ef7544b` (`Preserve runner counterpunch aim during movement`). Continued with map/round execution integration. This new slice remains uncommitted; human testing remains deferred.

Added **80 traces** plus **50 JSON snapshot continuations** on the five supplied rectangular maps with actual Grifball goal plates: Forerunner Canyon, Synthwave Grid Arena, Rainy Industrial Streets, Winter Glacier Rink and Championship Stadium. The normal map conversion leaves the other three circular arenas without goal plates; they remain covered by existing spawn-boundary tests but are excluded from this scoring/reset family. The fixture accepts the real converted map and supplies player or ordinary-roster movement into the enemy plate. Both teams and actor orders run through scoring, the scored hold and either next-round placement/countdown/resumed movement or match end. An injured opponent and independently downed teammate test lifecycle preservation and scheduled revival. These are authored movement commands, not autonomous route choices.

The actual frame coordinator invokes production player physics, roster respawn, carrier/assigned-area movement, objectives, skeletal updates and end-of-frame reconciliation. The headless side independently uses mixed `stepSimulation`. Independent assertions pin goal tick four, scored-hold transition tick 16, countdown completion tick 22, resumed movement tick 23, and roster revival tick 30. They verify carrier loadout release, injury preservation, no premature revival during reset, authored spawn membership and inward facing, revival health/shield timing, one score notification, one reset or match-end event and unchanged winner/round counts. Fifty snapshots cross scoring, placement, countdown and revival. Two further API checks distinguish omitted input from explicit aim on the revival tick.

The initial setup exposed two fixture issues: not every supplied map has a Grifball goal, and the simulator's renamed runner needed its offline AI controller set explicitly. The first goal-capable run still failed **80/80** (`output/m7-round-frame-before.log`, before that controller correction and the simulator fixes). Heading comparisons exposed two simulator defects: roster round-reset/respawn yaw was still in the live model convention instead of the simulator aim convention, and missing input defaulted to aim zero, overwriting newly revived facing. Mixed execution now converts both player and roster spawn headings consistently and resolves omitted input at use time to preserve current facing. Explicit aim remains authoritative. Earlier objective-only fixtures now initialize and compare equivalent facing conventions. Legacy execution profiles retain their previous defaults.

Protocol `live-functions-vs-headless-step-v22` stores `roundFrameTraces`: **80 traces / 9,600 frames**, zero differences. Combined evidence totals **4,347 traces / 779,148 frames**. This closes bounded movement/objective/lifecycle integration on the five goal-capable supplied maps. It does not certify combat across resets, autonomous decisions, elevated or observer lifecycle, complete multi-round matches, calibrated performance, held-out quality or final repository acceptance. Execution parity stays **inconclusive**.

Verification:

- **5,100/5,100** validation-suite tests passed, including previous trace groups, acceptance-gate assertions and the two new missing/explicit-input regressions (`output/m7-round-frame-validation.log`).
- **370/370** focused round-frame and objective-boundary checks passed before adding those two input regressions (`output/m7-round-frame-focused.log`).
- TypeScript passed with the 8 GB heap allowance (`output/m7-round-frame-typecheck.log`).
- Production client build passed (`output/m7-round-frame-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-round-frame-evidence.json`; summary: `output/m7-round-frame-summary.json`. Source identity: commit `ef7544b8e03a0b616fd80f74f21b67c0f8dc7d31`, working-tree hash `59f8116495bdc4876f7ab3fea86737a50f810e8e3813e3cb569aace61f52080b`.
- Scoped `git diff --check` passed; attached implementation plans remain unchanged. README and both explicit test command lists include the new family.
- Full repository tests and frozen browser CLI runs were not repeated. The previous five V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is combat across round transitions and the remaining decision/acceptance gates. Human testing stays deferred until the automated acceptance requirements are complete.

## 2026-09-29 — committed melee across scoring and round transitions

Committed the map/round lifecycle slice as `4aaedb6` (`Validate map and round lifecycle execution`). Continued with pending melee and recovery across the scored hold, reset/countdown and continued match-end frames. This slice remains uncommitted; human testing remains deferred.

Added **720 traces / 86,400 frames** and **120 JSON snapshot continuations**. Each trace uses the real frame coordinator with the existing ordinary-roster scorer, idle local player, injured opponent and independently downed teammate, plus a separate melee victim. On all five goal-capable supplied maps, the opponent commits a sword slash, hammer slam or swipe on tick one. Authored timings land the impact on tick five (after scoring), tick 16 (reset/match end), or tick 17. Both team mirrors, roster orders, one/three-HP victims and winner/nonwinner outcomes are included. No new attacks are authored during inactive phases.

Independent expectations verify no early damage, exactly one hit or a reset-induced miss, lethal/nonlethal health, attacker kill and victim death credit, a three-second death timer that continues through reset, weapon phase preservation and exact ready ticks. Previous scoring, placement, countdown, spawn-heading and scheduled-revival assertions remain active. Snapshots after ticks 15, 16, 22 and 39 continue through the transition and recovery. Early attacks land during the scored hold; later attacks miss after reset moves the duelists to opposing spawns. A continued frame at match end retains positions, so its pending hit can still resolve. This records current frame behavior, not an endorsement of post-match combat or a test of outer UI teardown.

The first run passed 360/840 tests and exposed harness assumptions, not a demonstrated new gameplay defect: the slam reload setting needed the actual `hammerReloadTime` field, and raw live team combat tallies are not equivalent to simulation aggregates for ordinary roster actors. The live path stores ordinary-bot kill/death credit on roster entries; the simulator also aggregates team combat totals. The new comparison therefore checks live actor credit against simulation kill events and compares objective goals separately. Existing noncombat round traces retain their full team-tally comparison. Team combat tally aggregation is not certified by this family. Initial evidence is retained at `output/m7-round-combat-before.log`; no production gameplay or simulator behavior changed in this slice.

Protocol `live-functions-vs-headless-step-v23` stores `roundCombatTraces`, with zero differences. Combined evidence totals **5,067 traces / 865,548 frames**. Flights across resets, local/main-AI attack paths across these transitions, autonomous decisions, observer/elevated-spawn lifecycle, complete matches, calibrated performance, held-out quality and final repository acceptance remain open. Execution parity stays **inconclusive**.

Verification:

- Validation-suite tests passed **5,940/5,940**, including all prior trace groups, the 840 new family/snapshot tests and the updated acceptance-gate assertions (`output/m7-round-combat-validation.log`).
- Focused round-combat and prior round-frame checks passed **972/972** (`output/m7-round-combat-focused.log`), before adding the two per-trace death-timer assertions; those are included in the final validation run and saved evidence.
- TypeScript passed with the 8 GB heap allowance (`output/m7-round-combat-typecheck.log`).
- Saved and re-parsed evidence: `output/m7-round-combat-evidence.json`; summary: `output/m7-round-combat-summary.json`. Source identity: commit `4aaedb6134d43967fc6b660dea554aac79408d0c`, working-tree hash `baaceb7dd35b197e4d28c59a54ed4d0c630161649a2e9332407fa09bd756e44d`.
- Scoped `git diff --check` passed. README, both explicit test command lists and gate assertions include the new family. Attached implementation plans remain unchanged.
- Production build, full repository tests and frozen browser CLI runs were not repeated for this validation-harness-only change. The previous five V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is committed flight/lunge handling across round transitions, followed by the remaining decision and acceptance gates. Human testing stays deferred until the automated acceptance requirements are complete.

## 2026-09-29 — committed roster flights across scoring and phase pauses

Committed the melee transition slice as `e1f8501` (`Validate committed melee across round transitions`). Continued with **480 traces / 57,600 frames** and **80 JSON continuations** for grounded, committed roster lunges across scoring, reset/countdown and continued match-end frames. This slice remains uncommitted; human testing stays deferred.

The five goal-capable supplied maps each run an ordinary-roster scorer, idle local player, independently downed teammate and separate lunge duel. Authored initial distances produce contact on tick three, 16 or 17 when flight continues uninterrupted. Both teams, roster orders, one/three-HP victims and winner/nonwinner outcomes are included. The fixture reuses the production flight/finish callbacks without duplicating their implementation, supplies a locked target and commits before the first frame. It runs both the prior continuous committed-flight contract and ordinary-AI phase pausing. This does not certify the neural readiness/target-selection branch, local-player or main-AI-specific flight handling, airborne resets or autonomous decisions.

Code inspection established that ordinary AI returns before movement/intent whenever Grifball is not playing, whereas the ready neural path advances an already committed flight before phase suppression. The first paired run passed **360/560** tests and failed **200** ordinary-pause cases/continuations because mixed simulation kept advancing the flight through the scored hold (`output/m7-round-flight-before.log`). Extracted the existing ordinary phase guard into `pauseInactiveGrifballAI`, preserving its location and behavior in production. Added the serialized, explicit per-actor `pauseDuringInactiveGrifball` setting for mixed simulation. Opted-in roster actors freeze movement, intent and associated cooldowns during inactive Grifball phases, while shields, respawn and skeletal melee continue. Pickup requests are excluded even when the current objective update ends countdown. Omitted settings and legacy, combat-mode and local-player execution retain their previous behavior; this is not a training-profile or neural promotion.

Independent assertions pin contact/finish ticks, hit versus travel-limit outcomes, one damage/kill/death credit, death timer start, reload at flight completion, frozen flight clocks/velocity, and preserved original heading/start point. Existing goal, spawn, phase and scheduled-revival checks remain active. Continuous flights can contact before reset placement on tick 16; later flights miss after teleportation. Ordinary flights pause after scoring and resume on tick 23, after countdown completes. The original flight origin survives reset, so the resumed flight hits the existing travel limit from its new spawn. Ordinary flights remain paused in continued match-end frames. These tests characterize current behavior; they do not endorse the reset-origin policy or certify outer match-end UI teardown or cooldown decision resumption. Snapshots after ticks three, 15, 16 and 22 preserve this behavior.

Eight additional API regressions check inactive phases, shield/committed-melee progression, frozen movement/weapon intent and cooldowns, next-frame countdown resumption, stale pickup suppression, and isolation from local-player/legacy/combat execution. An initial full run passed 6,506/6,507 tests and TypeScript caught a fixture setting placed on the match state instead of settings. That fixture was corrected; the extra pickup regression and final validation cover the corrected source.

Protocol `live-functions-vs-headless-step-v24` stores `roundFlightTraces` with zero differences. Combined evidence totals **5,547 traces / 923,148 frames**. Local/main-AI-specific transition paths, airborne and observer lifecycle, autonomous decisions/target reselection, complete matches, calibrated performance, held-out quality and final repository acceptance remain open. Execution parity stays **inconclusive**.

Verification:

- Final validation-suite tests passed **6,508/6,508**, including all previous groups, new flight/snapshot tests, phase-policy API checks and updated gate assertions (`output/m7-round-flight-final-validation.log`).
- Focused flight, melee and prior round-frame checks passed **1,532/1,532** (`output/m7-round-flight-focused.log`), before the eight API regressions; those passed separately (`output/m7-round-flight-phase-api.log`) and are in the final validation command.
- TypeScript passed with the 8 GB heap allowance (`output/m7-round-flight-final-typecheck.log`).
- Production client build passed (`output/m7-round-flight-final-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-round-flight-evidence.json`; summary: `output/m7-round-flight-summary.json`. Source identity: commit `e1f8501e8781b59c777d569fd1098d737b8bd215`, working-tree hash `eafae3965fd9f5006516e58c0084b3745d9ae2abbdfc8083add3ab08482b96f1`.
- Scoped `git diff --check` passed. README, both explicit test commands and gate assertions include the new family. Attached implementation plans remain unchanged.
- Full repository tests and frozen browser CLI runs were not repeated. The previous five V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is local-player flight handling across round transitions, followed by the remaining decision and acceptance gates. Human testing stays deferred until the automated acceptance requirements are complete.

## 2026-09-29 — local-player flight and hidden sword recovery across reset

Committed the roster-flight slice as `a4b9250` (`Validate roster lunges across round transitions`). Continued with **480 traces / 57,600 frames** and **80 JSON snapshot continuations** for local-player lunges across scoring, reset and continued match-end frames. The new slice remains uncommitted; human testing stays deferred.

The five goal-capable supplied maps run a separate ordinary-roster scorer alongside a committed local-player flight. Both team mirrors, actor orders, ordinary/main-AI victims and one/three-HP cases cover contact on tick three, 16 or 17. Production local flight/contact, player weapon animation, roster respawn, objectives and reset placement execute through the live frame coordinator, independently compared with mixed `stepSimulation`. Victims do not counterattack. On nonwinning rounds the player explicitly switches from the reset-equipped hammer back to sword on tick 45, with swap lockout/ready time set to zero to isolate recovery. Winning cases continue frames without an outer UI shutdown.

The first run passed **180/560** tests and failed **380** (`output/m7-round-player-flight-before.log`). One harness assertion compared normalized direction JSON exactly instead of using numeric tolerance. The behavioral mismatch was separate: reset switches the player to hammer, but the live sword recovery survives and stops advancing while hidden. Mixed simulation discarded that state; when a flight finished after reset, it also put the hammer into sword recovery. Added the serialized `playerSwordLungeRecovery` record, preserving elapsed time and the duration captured at flight completion. A hidden flight finish leaves the hammer ready; equipping the sword resumes its saved recovery on that same frame. Death/revival and fresh sword actions clear stale saved recovery. Existing legacy execution remains unchanged. This is specific sword-lunge recovery support, not certification of a general bank of independent weapon animation states.

Independent expectations verify finish/contact ticks, exactly one end notification, health and kill/death credit, preserved original flight origin/direction, and same-frame roster death-timer advancement after a local-player kill. Tick-16 contacts precede reset placement; tick-17 attempts miss after teleportation. Sword recovery freezes while hammer is equipped. It finishes on tick 54, 67 or 68 after swap-back, depending on contact timing; uninterrupted winning traces become ready 23 frames after contact. Eighty snapshots cross ticks 15, 16, 44 and 45. Two API regressions cover stale recovery cleanup on player death/revival and a new slash. Existing scorer, phase, placement, countdown and scheduled-revival checks remain active.

Protocol `live-functions-vs-headless-step-v25` stores `roundPlayerFlightTraces`, with zero differences. Combined evidence totals **6,027 traces / 980,748 frames**. Autonomous decisions/target selection, main-AI attacker and opposing/trading/airborne transition variants, general multi-weapon animation banking, observer lifecycle, full matches, calibrated performance, held-out quality and final repository acceptance remain open. Execution parity remains **inconclusive**; optional neural integration stays unpromoted.

Verification:

- **7,070/7,070** validation-suite tests passed, including all prior groups, new player-flight/snapshot tests, cleanup regressions and gate assertions (`output/m7-round-player-flight-validation.log`).
- Focused player-flight checks passed **560/560** (`output/m7-round-player-flight-focused.log`) before adding exact ready-tick/frozen-clock assertions and the two API regressions; those are included in the full run and saved evidence.
- TypeScript initially flagged control-flow narrowing across a fixture callback; a getter resolved the typing without changing behavior. Final TypeScript passed with the 8 GB heap allowance (`output/m7-round-player-flight-final-typecheck.log`). The final getter is also exercised by the regenerated paired evidence.
- Production client build passed (`output/m7-round-player-flight-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-round-player-flight-evidence.json`; summary: `output/m7-round-player-flight-summary.json`. Source identity: commit `a4b9250add55db191ff251f17fd1f67f447441cc`, working-tree hash `5d2cdd0343c39d04ac1068d348a65a21c16aa7d6e5caad47a31d1b3a03097424`.
- Scoped `git diff --check` passed. README, both explicit test commands and gate assertions include the family; attached implementation plans remain unchanged.
- Full repository tests and frozen browser CLI runs were not repeated. The previous five V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is AI decision-to-execution integration. Remaining transition variants stay tracked as coverage gaps; this slice does not certify complete matches. Human testing remains deferred until the automated acceptance requirements are complete.


## 2026-09-29 — autonomous retrieval and movement integration

Committed the local-player round-flight slice as `c14ead8` (`Validate player lunge recovery across round resets`). Added **24 live decision-integration traces / 11,520 frames**, three deterministic repeatability checks and 16 versioned tactical-observation regressions. This slice remains uncommitted; human testing stays deferred.

The new synthetic corridor fixtures execute the production roster tick, tactical planner, single-bot updater and objective loop for 480 frames at 60 Hz. Three allied bots and a stationary remote opponent cover open, detour and sealed routes, mirrored teams, both actor orders and main/regular retrievers. Assignments, movement and pickup requests are generated by the runtime, without authored commands. Passing is disabled, combat-related tuning is constrained, and unexpected attacks or generic combat fallback fail the fixture. This validates a bounded planner-to-objective loop, not the outer active-frame coordinator or a complete match.

Independent expectations require one eligible retriever, no remote control, shared detached planning snapshots, correct pickup intent and clearing, finite speed-bounded movement through open geometry, eventual pickup and the next-frame runner role. Open corridors pick up on tick 167; detours on tick 197. Runner roles appear on ticks 168 and 198, with forward progress afterward. Supports move into separated positions. Sealed routes classify the retriever path as blocked, keep the actors in place and never pick up the unreachable ball. Frames retain roles, destinations, reasons, intents, ball state and actor motion.

Observation checks exposed a real headless adapter error: versioned simulation aims along positive sine/cosine, but tactical observations used the live model's negative sine/cosine convention. All 16 new cases initially failed (`output/m7-decision-heading-before.log`). The adapter now emits the correct world heading for player-v1, roster-v1/v2 and mixed-v1. Cardinal and diagonal headings agree with independently built live observations, and planner assignments agree within numeric rounding. Legacy observation behavior remains unchanged; optional neural integration stays unpromoted.

Two harness expectations were corrected during development: the speed oracle initially omitted the configured runner multiplier, and a later support-motion check incorrectly demanded progress through a sealed route. The latter produced eight failing traces and a failed aggregate acceptance gate (`output/m7-decision-validation.log`, `output/m7-decision-before-evidence.json`), confirming that decision failures propagate. These were fixture corrections, not changes to gameplay movement.

Protocol `live-functions-vs-headless-step-v26` stores the new `decisionIntegrationTraces` separately from **6,027 paired traces / 980,748 frames**. Any decision failure fails execution acceptance; passing this family still leaves the gate **inconclusive**. Headless closed-loop action execution, autonomous passing/combat decisions, broader transition coverage, complete matches, calibrated performance, held-out quality and final repository acceptance remain open.

Verification:

- Final validation suite passed **7,120/7,120** tests, including all paired families and the aggregate gate (`output/m7-decision-final-validation.log`). Scoped `git diff --check` passed.
- Focused decision and adapter tests passed **50/50** (`output/m7-decision-final-focused.log`). The validation command now also includes the adapter file's seven existing regressions.
- TypeScript passed with the 8 GB heap allowance (`output/m7-decision-final-typecheck.log`).
- Production client build passed (`output/m7-decision-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-decision-evidence.json`; summary: `output/m7-decision-summary.json`. All 24 traces have zero failures. Source identity: commit `c14ead8866e9b65e051116510af121cff2f00f33`, working-tree hash `6f02799f028520fc65141762633407574a899f0f9bcdebc92eb6a241b3cbffe4`.
- README, both explicit test commands and acceptance gate assertions include this family. Attached implementation plans remain unchanged.
- Full repository tests and frozen browser CLI runs were not repeated. The five previously reported V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next decision-integration work is autonomous pass selection through release/reception and tactical combat handoff. These bounded live checks do not substitute for independent headless decisions or final quality/performance gates. Human testing remains deferred until automated acceptance work is complete.


## 2026-09-29 — autonomous pass selection, release and reception

Committed the retrieval/routing slice as `2817f65` (`Validate autonomous Grifball retrieval and routing`). Added **48 live pass-decision traces / 17,280 frames** and three deterministic repeatability checks. This slice remains uncommitted; human testing stays deferred.

The production roster tick, tactical planner, single-bot updater and objective functions run for 360 frames at 60 Hz in an open synthetic corridor. Two allied scripted bots and a stationary remote opponent cover both teams, both actor orders and main/regular carriers. Only initial possession and external configuration/ownership events are authored: the planner chooses the receiver, throw strength and reception point; the real updater moves the actors and issues pickup intent. Combat-related tuning is constrained and unexpected combat or respawn callbacks fail the fixture.

Six modes cover normal charge, a shorter charge maximum, passing disabled from the start, disabling the module on the intended release frame, changing the intended receiver to remote ownership on that frame, and re-enabling the module after cancellation. Cancellation is applied after planning and movement to test release-time guards against stale intent. It retains possession, clears the charge/display and stops controlling the newly remote receiver. Re-enabling starts a fresh charge rather than resurrecting the cancelled one.

Assertions check one charge increment per frame, the displayed fraction, no early release, the selected charge threshold, exact release-frame horizontal/vertical velocity and displacement, carrier weapon/health restoration, flight receiver identity, settled-ball pickup within range, pickup-intent clearing and the next-frame runner role. Normal passes release at tick 36 and reach the receiver at tick 131. With a 0.3-second charge maximum, release is tick nine and pickup tick 109. Cancellation occurs at tick 36; re-enabling at tick 66 produces a new release at tick 101 and reception at tick 208. All team/order/identity variants agree. No production gameplay change was needed.

Protocol `live-functions-vs-headless-step-v27` retains `passDecisionTraces` separately from **6,027 paired traces / 980,748 frames** and **24 retrieval decision traces / 11,520 frames**. Any failed pass trace fails execution acceptance. Passing these checks leaves the gate **inconclusive**: contested pressure/interception, obstacle/respawn passing, tactical combat handoff, the outer active frame, headless autonomous decisions, full matches, calibrated performance, held-out quality and final repository acceptance remain open. Optional neural integration remains unpromoted.

Verification:

- Final validation suite passed **7,171/7,171** tests, including all previous trace families and the aggregate gate (`output/m7-pass-decision-validation.log`). Scoped `git diff --check` passed.
- Focused pass checks passed **51/51** (`output/m7-pass-decision-focused.log`), including exact normal/short release and reception ticks and release-frame cancellations.
- TypeScript initially rejected a fixture discriminant narrowed to the initial held state across callback mutations. A runtime getter resolves that without changing behavior. Final TypeScript passed with the 8 GB heap allowance (`output/m7-pass-decision-final-typecheck.log`).
- Production client build passed (`output/m7-pass-decision-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-pass-decision-evidence.json`; summary: `output/m7-pass-decision-summary.json`. All 48 traces have zero failures. Source identity: commit `2817f65336f72c952abf2bf0d40dd8c8bdd318b0`, working-tree hash `b84a495db6339329bbf2e1580c4b134b1b6af75b87e631101d1a675a29091ea0`.
- README, both explicit test commands and gate assertions include the new family. Attached implementation plans remain unchanged.
- Full repository tests and frozen browser CLI runs were not repeated. The five previously reported V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is tactical threat selection and combat handoff under pressure, including how a threatened pass returns control to carrying or combat. Human testing remains deferred until the remaining automated acceptance requirements are complete.


## 2026-09-29 — tactical combat handoff under pass pressure

Committed the passing slice as `1a3f8a4` (`Validate autonomous Grifball passing and reception`). Added **24 live pressure-decision traces / 4,320 frames**, three deterministic repeatability checks and a runner movement fix. This slice remains uncommitted; human testing stays deferred.

Two allied bots begin a planned pass. A stationary AI opponent is placed near the runner or receiver after movement on the intended release frame (tick 36). The production pass executor rechecks current positions and cancels the unsafe throw. Subsequent planner/bot updates choose the response; production tactical target lookup, weapon choice, attack initiation, weapon animation and melee damage execute it. Both team mirrors, actor orders and main/ordinary responding bots cover runner pressure, receiver pressure and opponent withdrawal before contact. Opponent decisions are intentionally suppressed. Movement complexity and weapon-swap IQ are fixed at zero, with hammer-only preference; this is bounded grounded combat handoff, not complete autonomous opposing teams.

The first fixture used a remote actor, which the offline roster melee damage path intentionally excludes. Correcting the target to a stationary AI left eight runner cases failing (`output/m7-pressure-decision-ai-target.log`). The runner autonomously started a punch but continued its route during windup, moving past the stationary close target before impact. It now holds position and facing through punch windup/strike, then resumes routing during recovery. Player input, neural execution and generic simulation movement are unchanged.

The existing **576 runner-combat pairs / 69,120 frames** now supply the corresponding hold intent independently from simulator weapon state. Their movement and health oracles require the pause through tick eight for quick punches and tick 26 for normal-duration punches. Both durations now hit eligible stationary enemies when the runner survives. All 48 existing JSON continuations still cross commitment, strike or recovery. The direct movement regression checks holding, preserved aim, no repeated attack initiation and recovery movement; its 21-test runtime file is now also included in the validation command.

Pressure assertions require cancellation and cleared charge/display, retained possession, one autonomous response, correct hostile target lookup, finite safe movement, no allied death, expected enemy health and single kill/death credit. Runner counters start at tick 37 and hit at tick 59. Receiver orders refresh at tick 40, hand off to combat, and hit at tick 64. Removing the runner threat at tick 40 produces a miss and no kill credit. Charging resumes after the kill or withdrawal (ticks 99, 104 and 92 respectively). Opponent placement and withdrawal are authored; pass selection, rejection and allied combat decisions are not.

Protocol `live-functions-vs-headless-step-v28` stores `pressureDecisionTraces` as additional live evidence. Paired totals remain **6,027 traces / 980,748 frames**; the earlier retrieval and passing decision families remain separate. Any pressure failure fails execution acceptance. The gate remains **inconclusive** pending opposing combat choices/trades, contested recovery, broader geometry and lifecycle, full active-frame/headless autonomous execution, complete matches, calibrated performance, held-out quality and final repository acceptance. Optional neural integration remains unpromoted.

Verification:

- Final validation suite passed **7,219/7,219** tests, including the added runtime file and all prior acceptance families (`output/m7-pressure-decision-final-validation.log`). The preceding 7,198-test run also passed. Scoped `git diff --check` passed.
- Pressure, paired runner-combat and snapshot checks passed **651/651** (`output/m7-pressure-decision-focused.log`) before adding exact pressure timing/single-response assertions; those are included in the later full run and saved evidence.
- Pressure plus direct team-plan runtime checks passed **48/48** (`output/m7-pressure-decision-runtime-focused.log`), including the strengthened assertions.
- TypeScript passed with the 8 GB heap allowance (`output/m7-pressure-decision-final-typecheck.log`).
- Production client build passed (`output/m7-pressure-decision-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-pressure-decision-evidence.json`; summary: `output/m7-pressure-decision-summary.json`. These retain all 24 pressure traces and all 576 updated runner-combat pairs with zero failures/differences. Source identity: commit `1a3f8a4a6dbc2ff4db23357150694a017c2cccff`, working-tree hash `c87ccabbfac26512510069a2306777d1bddbd7f975daa8b695106f11374a0824`.
- README, both explicit test commands and aggregate gate assertions include this family. Attached implementation plans remain unchanged.
- Full repository tests and frozen browser CLI runs were not repeated. The five previously reported V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is opposing combat decisions and contested recovery, building on these one-sided pressure responses. Human testing remains deferred until the remaining automated acceptance requirements are complete.


## 2026-09-29 — opposing decisions and contested recovery

Committed the pressure-response slice as `a9604e3` (`Validate tactical combat handoff and fix runner punch overshoot`). Added **24 live opposing-decision traces / 3,600 frames** and six repeatability checks. This slice remains uncommitted; human testing stays deferred.

The production active-frame coordinator now drives these bounded autonomous fixtures: roster ticking, tactical planning, each living bot's updater, tactical target lookup and weapon selection, attack/hammer-jump actions, objective updates, skeletal melee impacts and final carrier reconciliation. All actors are AI-controlled and receive exactly one decision update per frame while alive. Initial positions, possession, wounded carrier health/heal delay and attack timings are authored; subsequent movement, actions, damage and recovery are not. Passing is disabled, movement complexity and weapon-swap IQ are zero, weapon preference is hammer-only and personality flags are neutral. Player-model observation callbacks and pressure/combo extensions remain omitted. Observer input/render and roster resizing are not exercised. The synthetic open corridor has no physical goal objects, and each 150-frame trace ends before revival.

Three modes cover a fast runner punch defeating the opposing attack, a faster hammer killing the runner, and two teammates contesting recovery after the runner dies. Both team mirrors, roster orders and main/ordinary carriers run. The defender can choose a defensive dash and hammer jump when it observes a committed punch; the fixture executes the real action instead of suppressing the response. Order affects what an actor observes within a frame: the reverse-order defender commits a normal hammer attack first, while forward order chooses an evasive jump attack. Determinism is required per configuration, not identical actions across different roster orders.

Assertions pin the first impact (punch tick five, hammer tick eight or nine), cancellation of the loser's unfinished attack, one kill/death credit, main-AI bookkeeping, no friendly damage, finite open movement, cleared pickup intent and a single advancing respawn clock. On carrier death, render-time checks require released possession, restored hammer, cleared assignment/charge and a fresh loose ball at the death position. The next frame must assign retrievers. Recovery requires autonomous pickup intent, a living eligible actor within range, retained possession and a runner assignment on the following frame. The duel defender recovers at tick 57 or 113 depending on its response; in the contested mode the escort wins recovery at tick 70 while both teams have retrievers, then survives one follow-up hit from the defender. No gameplay production change was needed.

Protocol `live-functions-vs-headless-step-v29` retains `opposedDecisionTraces` separately from **6,027 paired traces / 980,748 frames** and the preceding live decision families. Any new trace failure fails execution acceptance. These cases exercise a slice of the live frame with genuine opposing decisions; they do not certify general simultaneous trades, obstacle/mobility combinations, respawn/reset decisions, headless autonomous execution, full matches, calibrated performance, held-out quality or final repository acceptance. The gate stays **inconclusive**, with optional neural integration unpromoted.

Verification:

- Final validation suite passed **7,249/7,249** tests, including all previous trace families and the aggregate gate (`output/m7-opposed-decision-validation.log`). Scoped `git diff --check` passed.
- Focused scenarios and deterministic repeats passed **30/30** (`output/m7-opposed-decision-focused.log`).
- TypeScript passed with the 8 GB heap allowance (`output/m7-opposed-decision-typecheck.log`).
- Production client build passed (`output/m7-opposed-decision-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-opposed-decision-evidence.json`; summary: `output/m7-opposed-decision-summary.json`. All 24 traces have zero failures. Source identity: commit `a9604e3c871f0823458a95529d82834e950108f5`, working-tree hash `6b223e69bdab67e182d3bc031e94b9065113f0310f58d8273815a285c287fc69`.
- README, both explicit test commands and aggregate gate assertions include this family. Attached implementation plans remain unchanged.
- Full repository tests and frozen browser CLI runs were not repeated. The five previously reported V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is autonomous revival and rejoining the contest after these deaths, followed by the remaining round/full-match acceptance boundaries. Human testing remains deferred until the remaining automated acceptance requirements are complete.


## 2026-09-29 — autonomous revival and rejoining play

Committed the opposing-decision slice as `e38e0d3` (`Validate opposing Grifball decisions and contested recovery`). Added **24 live revival-decision traces / 11,520 frames**, six repeatability checks and two direct respawn regressions. This slice remains uncommitted; human testing stays deferred.

The opposing-decision fixture now supports a 480-frame continuation, preserving all original opening-contest assertions at frame 150. The longer cases supply one authored spawn per team and use the production combatant-action callback factory's respawn function inside the real roster/frame loop. The same three opening contests, mirrored teams/orders and main/ordinary carriers run without injecting subsequent actions, deaths, assignments, positions or ownership. A first death at tick five, eight or nine revives at tick 186, 189 or 190: the existing repeated floating-point countdown leaves a sub-tick remainder after 180 updates, so revival occurs on update 181. All later deaths use the same independently checked delay.

The initial runs caught ordinary bots retaining `isJumping` after airborne death. The production respawn reset previously cleared jumping, planned-jump fields and swap cooldown only for `main_ai`. These now reset for every AI combatant, along with the air-jump budget and hammer-jump window. The direct regressions exercise ordinary and main identities with stale airborne commitments and an exhausted jump budget. Simulation already clears its jump state on revival; no simulator change was needed.

The saved continuation evidence contains **30 respawns** with zero failures. Assertions require the correct team spawn, full base health, ready weapon, cleared velocity/flight/dash/pressure/jump state, initialized protection, visible mesh and preserved kill/death credit. Revived actors get a fresh assignment and exactly one AI update in the revival frame. Protection decrements once per frame through expiry; damage callbacks must never damage protected actors. Revived bots resume movement and tactical roles. Contested and forward hammer-win cases additionally require an autonomous attack after revival; some contested cases also produce a second death, recovery or revival. Main-AI hammer-jump requests remain an explicit unsupported-fixture failure rather than a silent no-op, and none occur in these accepted traces.

Protocol `live-functions-vs-headless-step-v30` stores `revivalDecisionTraces` separately from **6,027 paired traces / 980,748 frames** and the earlier live-only families. Any revival failure fails execution acceptance. The gate remains **inconclusive**: these synthetic corridors still omit full round/goal transitions, broader spawn arbitration and obstacle configurations, general main-AI jump execution, headless autonomous decisions, full matches, calibrated performance, held-out quality and final repository acceptance. Passing remains disabled and combat tuning/observer omissions are unchanged. Optional neural integration stays unpromoted.

Verification:

- TypeScript passed with the 8 GB heap allowance (`output/m7-revival-decision-final-typecheck.log`). The initial check caught an unsupported `findLast` API in the fixture; it now uses the existing ES2022-compatible array operations.
- Final validation suite passed **7,281/7,281** tests, including all prior trace families and the aggregate gate (`output/m7-revival-decision-validation.log`). Scoped `git diff --check` passed.
- Focused revival, original opposing-decision and lifecycle regressions passed **74/74** (`output/m7-revival-decision-final-focused.log`).
- Production client build passed (`output/m7-revival-decision-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-revival-decision-evidence.json`; summary: `output/m7-revival-decision-summary.json`. All 24 traces and 30 respawns have zero failures. Source identity: commit `e38e0d3978f4b9e14d3a6b6efec14960b1f57bd1`, working-tree hash `3696a030bc2603f34ff67a5a1428c785c94faa5b3af7dac1d8e8449becdcd575`.
- Initial repeatability checks exposed wall-clock `spawnTime` values in newly added fixture observations. Initial timestamps are no longer serialized; production respawn timestamps are checked against the simulation clock. The final evidence remains deterministic without modifying roster initialization.
- README, both explicit test commands and aggregate gate assertions include this family. Attached implementation plans remain unchanged.
- Full repository tests and frozen browser CLI runs were not repeated. The five previously reported V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is autonomous goal scoring and round reset/reassignment through the live frame, building toward complete-match acceptance. Human testing remains deferred until the remaining automated requirements are complete.


## 2026-09-29 — autonomous scoring and round reassignment

Committed the revival slice as `aba056e` (`Validate autonomous Grifball revival and clear stale jump state`). Added **24 live round-decision traces / 8,640 frames** and six repeatability checks. This slice remains uncommitted; human testing stays deferred.

Two allied AI bots run an uncontested scoring loop through the production frame coordinator, roster/planner/updater, objective, skeletal animation and round-placement callbacks. The synthetic court has physical goal plates and two distinct spawn points per team. Initial possession, positions, settings and map are authored; subsequent movement, scoring, reset placement, retrieval and assignments are autonomous. Passing is disabled and any combat, target selection or respawn fails the fixture. Observer input/render and roster resizing remain omitted. These are bounded round-flow cases, not complete contested-match certification.

Three modes cover a one-goal win, a two-goal win after a reset and the same two-goal flow with zero reset/countdown durations. Both teams, roster orders and main/ordinary opening carriers run for 360 frames. The first goal occurs at tick 24. With 0.19-second scored hold and 0.09-second countdown, reset occurs at tick 36, play resumes at tick 42, pickup occurs at tick 93, the second goal at tick 194 and match end at tick 206. With zero durations, the phase machine still advances one phase per frame: reset at 25, play at 26, pickup at 77, second goal at 178 and match end at 179. One-goal matches end at tick 36 without resetting.

Checks require eligible living scorers over the opposing plate, a single goal/notification per score, restored carrier weapon/base health, released possession, cleared charge, distinct team spawns, cleared velocity/attack history and bounded finite movement. Every actor updates once per frame; scored/countdown/match-end movement pauses and inactive assignments clear. After reset, the fresh retriever is selected from the new positions and becomes runner after its own pickup request. Reversing roster order places the support bot at the closer spawn, so it retrieves and scores the second goal instead of retaining the opening runner's role. The remaining frames verify stable terminal possession, assignments, positions and score counts. No gameplay production change was needed.

The saved evidence contains **40 autonomous goals and 16 resets**, all passing. Protocol `live-functions-vs-headless-step-v31` retains `roundDecisionTraces` separately from **6,027 paired traces / 980,748 frames** and the earlier live-only families. Any failed new trace fails execution acceptance; passing leaves the gate **inconclusive**. Opposing combat and respawns across scoring/reset still need integration, along with broader maps, complete contested matches, headless autonomous execution, calibrated performance, held-out quality and final repository acceptance. Optional neural integration remains unpromoted.

Verification:

- Final validation suite passed **7,311/7,311** tests, including all previous trace families and the aggregate gate (`output/m7-round-decision-validation.log`). Scoped `git diff --check` passed.
- Focused scenarios and deterministic repeats passed **30/30** (`output/m7-round-decision-focused.log`).
- TypeScript passed with the 8 GB heap allowance (`output/m7-round-decision-typecheck.log`).
- Production client build passed (`output/m7-round-decision-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-round-decision-evidence.json`; summary: `output/m7-round-decision-summary.json`. All 24 traces have zero failures. Source identity: commit `aba056e500282c3deb5390bf5901d3e0d6a5ff06`, working-tree hash `976bcb8dad61b56df536384d65be395c8ac378b0e0a8f93944524a7818d6faf9`.
- README, both explicit test commands and aggregate gate assertions include this family. Attached implementation plans remain unchanged.
- Full repository tests and frozen browser CLI runs were not repeated. The five previously reported V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is integrating opposing combat, respawns and goal/round transitions in the same autonomous match loop. Human testing remains deferred until the remaining automated requirements are complete.


## 2026-09-29 — integrated autonomous contested matches

Committed the scoring/reset slice as `1c80dcc` (`Validate autonomous Grifball scoring and round reassignment`). Added **12 live match-decision traces / 46,080 frames** and six deterministic repeatability checks. This slice remains uncommitted; human testing stays deferred.

The existing opposing-decision fixture now has explicit opening, revival and match continuations. The match continuation retains the opening 150-frame contest assertions and subsequent revival checks, adds physical goal plates and production round placement, and runs for 3,840 updates (64 simulated seconds). Punch-first, hammer-first and four-bot contested openings cover both teams and roster orders with ordinary AI identities. The same initial possession, wounded carrier, positions and timing settings are authored; subsequent actions, damage, deaths, respawns, movement, ownership, goals and rounds are autonomous. No production gameplay change was needed.

All 12 configurations finish a two-goal match. Saved evidence contains **29 goals, 17 round resets, 58 deaths and 58 respawns**, including **26 carrier deaths**. Every carrier death must release possession before rendering, drop at the death position, restore the hammer and clear stale assignment/charge. Existing checks require the full death delay, correct team spawn, restored health and attack/jump state, preserved credit, same-frame AI participation and shield countdown/protection. New checks conserve kill/death and score/notification totals, require living scorers over opposing plates, preserve health/death clocks/credit across round placement, and pin the 12-update scored hold and six-update countdown. Every new round must assign retrieval, pick up through intent/range eligibility, engage in combat and score again. Match-end score, possession and assignments remain stable for at least one further second, and inactive bots cannot start new attacks.

The initial 60-second probe left the forward red four-bot case in active combat near its second goal. Its unmodified continuation scores at tick 3,605 and ends at tick 3,617 (60.28 seconds); the final 64-second window observes over three more seconds of terminal state. Other accepted cases finish between ticks 918 and 2,795. Team/order configurations need not have identical outcomes or timings; each configuration must repeat exactly. Reset pickups begin from the objective's `idle` ball state, while recovery after carrier death begins from `loose`; the fixture now checks both valid entry states for match continuations.

The extended probe also exercised main-AI configurations. Several reached the fixture's explicit unsupported `onMainAIHammerSwing` callback, which the previous shorter cases never reached. Those probe failures are retained in `output/m7-match-decision-probe.json`; they are not accepted match evidence or evidence of a confirmed production defect. The accepted match matrix explicitly excludes main-AI identity until its separate weapon/jump owner is wired and validated. Main/ordinary identity coverage in the earlier short contest, revival and uncontested round families remains unchanged. Next work is integrating the main-AI jump/weapon owner into the extended match fixture and investigating any resulting production findings.

Protocol `live-functions-vs-headless-step-v32` stores `matchDecisionTraces` separately from **6,027 paired traces / 980,748 frames** and all previous live-only families. Any accepted-match failure fails execution acceptance. Passing leaves the gate **inconclusive**. These matches use a synthetic flat corridor, one authored spawn per team (including shared teammate spawns), passing disabled, constrained combat tuning and the existing observer/input/render, pressure/combo and player-model omissions. Main-AI complete matches, broader maps/spawn configurations, headless autonomous decisions, calibrated performance, held-out quality and final repository acceptance remain open. Optional neural integration stays unpromoted.

Verification:

- Final validation suite passed **7,329/7,329** tests, including all previous trace families and the aggregate gate (`output/m7-match-decision-validation.log`). Scoped `git diff --check` passed.
- Focused integrated match, opposing-decision and revival tests passed **78/78** (`output/m7-match-decision-focused.log`).
- TypeScript passed with the 8 GB heap allowance (`output/m7-match-decision-typecheck.log`).
- Production client build passed (`output/m7-match-decision-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-match-decision-evidence.json`; summary: `output/m7-match-decision-summary.json`. All 12 traces have zero failures and finish at match end. Source identity: commit `1c80dccf93c1ab364085376c884bc6a1076622f1`, working-tree hash `622fd54fa0e999035138dc54ff02757e8fecc1d01a5ee4636fd219591144657a`.
- README, both explicit test commands and aggregate gate assertions include this family. Attached implementation plans remain unchanged.
- Full repository tests and frozen browser CLI runs were not repeated. The five previously reported V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.


## 2026-09-29 — main-AI match integration and queued hammer jumps

Committed the ordinary contested-match slice as `4702e07` (`Validate autonomous contested Grifball matches across rounds`). Expanded the match family to **24 traces / 154,080 frames**, added six main-identity repeatability checks (twelve total) and ten direct jump regressions. This slice remains uncommitted; human testing stays deferred.

The fixture now routes main-AI hammer-jump requests through `triggerEnemyHammerSwingForCombatant`, matching the production weapon callback. This exposed two gameplay defects. First, `startAIHammerJumpForCombatant` reported success and retained a jump plan even when the weapon owner rejected the swing during a dash or swap lockout. It now checks that the callback actually started `swing_up`, clears the rejected plan/type and returns false otherwise. Second, registered main-AI actors use roster animation/impact, while queued launch logic existed only in the skipped legacy impact path. The roster impact now points a planned hammer strike downward and consumes its jump plan through a helper shared with the legacy impact path. The helper applies the configured trigger radius, window, air limit and upward impulse, consumes the budget once, and clears the plan/type even if launch eligibility changed. Production jump audio and particles are connected. Normal unplanned roster attacks retain their existing forward impact.

Before the fix, six of seven initial direct regressions failed; the existing death-before-impact case passed. The final ten tests cover launch at the eighth roster update after the configured windup/strike, no early or duplicate launch, launch without a live target, downward impact geometry, rejected dash/swap requests, disabled/exhausted/unlimited air budgets, trigger radius, death before impact, an ordinary forward slam and a stale plan followed by a carrier punch. These are authored action regressions, separate from autonomous match coverage.

The autonomous matrix retains the same three opening contests, mirrored teams and roster orders. Main-AI identity is now accepted alongside ordinary initial carriers. Ordinary cases keep their 3,840-frame window; main-AI cases run for 9,000 frames (150 simulated seconds). The reverse blue four-bot case was still exchanging possession after 7,200 frames, causing the initial focused run to pass 105/106 tests. A longer unmodified continuation showed active combat and recoveries, followed by its final goal at tick 8,603 and match end at 8,615. The final window therefore retains a further 385 frames of terminal observation. No actions, positions, damage, ownership or results were injected to finish these matches.

Saved evidence contains **59 goals, 35 resets, 143 deaths and 143 respawns**, including **61 carrier deaths**, with zero failures in all 24 matches. Main-AI legacy kill/death counters must agree with its roster totals. The traces record **137 main jump requests: 134 rejected requests and three accepted commitments**. Each accepted commitment is interrupted by death before impact; a new assertion requires every accepted request to reach a jump impact or an intervening death within the configured strike window. Rejections cannot leave a new latent plan. Consequently, this slice proves the queued launch owner through direct regressions and the real rejection/interruption path through autonomous matches; it does **not** claim a successful autonomous main-AI launch in these low-mobility fixtures.

Protocol `live-functions-vs-headless-step-v33` retains `matchDecisionTraces` as live-only evidence, distinct from **6,027 paired traces / 980,748 frames** and the earlier live families. Any new match failure fails execution acceptance; passing still leaves the gate **inconclusive**. The map remains a flat synthetic corridor with one spawn per team, passing disabled, constrained combat tuning and the previously documented observer, pressure/combo and player-model omissions. Broader mobility/maps, headless autonomous decisions, calibrated performance, held-out quality and final repository acceptance remain open. Optional neural integration stays unpromoted.

Verification:

- Final validation suite passed **7,357/7,357** tests, including all 24 complete-match cases, twelve repeats, ten direct jump regressions, previous trace families and the aggregate gate (`output/m7-main-match-validation.log`). Scoped `git diff --check` passed.
- TypeScript passed with the 8 GB heap allowance (`output/m7-main-match-final-typecheck.log`).
- Production client build passed (`output/m7-main-match-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-main-match-evidence.json`; summary: `output/m7-main-match-summary.json`. All 24 traces have zero failures and finish at match end. Source identity: commit `4702e075af860e68d17e80be29ab238bd475c75e`, working-tree hash `77378395ef369789e531396496363b244945e11d45bc9428b24a4fa1e85adcbc`.
- README, both explicit test commands and aggregate gate assertions include the expanded family and direct regressions. Attached implementation plans remain unchanged.
- Full repository tests and frozen browser CLI runs were not repeated. The five previously reported V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is autonomous main-AI mobility scenarios where a committed jump survives through impact and airborne continuation, followed by broader supplied-map acceptance. Human testing remains deferred until the remaining automated requirements are complete.


## 2026-09-29 — autonomous main-AI flight and landing

Committed the main-AI jump/match slice as `d48aebb` (`Fix queued main AI hammer jumps and validate complete matches`). Added **eight live mobility-decision traces / 14,400 frames**, four repeatability checks and six direct landing/evasion regressions. This slice remains uncommitted; human testing stays deferred.

The shared opposing fixture now has a bounded mobility continuation: a wounded four-bot opening, authored maximum/respawn health of three, mirrored teams and roster orders, and deterministic seeds 1 and 5. Each runs for 1,800 frames through production decisions, real main weapon requests, roster impacts, gravity, respawns and objective/planner owners. Initial positions, health, map and settings are authored; subsequent jumps, actions, movement and ownership are autonomous. The higher respawn health lets a queued jump survive its windup. These selected regression seeds exercise the intended boundary; they are not held-out quality evidence. The corridor has no physical goal plates and passing remains disabled.

The evidence contains **13 complete main-AI flights**. Each launch must follow an accepted autonomous request by the configured seven-tick offset, apply the 13.7m/s impulse once, consume its plan and spend one air jump. An independent semi-implicit ballistic oracle advances vertical speed by 18/60 each update and height by the resulting speed/60 until ground contact. Every observed airborne position/velocity must match, the actor must survive to landing, and its budget must stay spent in flight. Landing must clear the airborne flag, replenish the jump budget, retain a tactical assignment and lead to resumed living movement or a fresh autonomous jump commitment. All first-150-frame contest, respawn, hostile-damage and carrier-cleanup checks remain active. Different team/order/seed configurations can differ; repeatability checks compare identical configurations.

Two production defects were found and fixed:

- The recovery and engagement gravity owners cleared `isJumping` on landing but did not replenish `aiHammerJumpsInAir`. Tactical early returns could then leave a living grounded bot unable to jump again. Both owners now clear the budget on ground contact, with main/ordinary regressions that require eligibility to return immediately while forbidding a mid-flight refill. All four initial landing regressions failed before the fix.
- An emergency hop dodge advanced the entire velocity vector even when engagement gravity had already advanced an existing flight. This applied vertical displacement twice on dodge frames. Existing airborne dodges now advance only horizontal position; a newly started grounded hop retains its original initial upward step. Two ascent/descent regressions failed before the fix and now preserve height and vertical velocity while requiring horizontal evasion.

The corrected motion changes earlier deterministic outcomes. Hammer-win recovery now occurs at tick 53 in reverse order and 107 in forward order, replacing 57/113; the fixture still independently checks pickup intent, range and possession. The 24 revival traces now run 600 frames (14,400 total), retaining their renewed-attack requirement after landing fixes changed engagements. Earlier probes at 480 frames failed that requirement for some contested cases; the requirement was not removed. Ordinary four-bot match traces now allow 10,800 frames (180 seconds); the other match windows and paired trace counts remain unchanged. Unmodified continuation showed the longest changed case reaching its winning goal at tick 10,226 and match end at 10,238, leaving 562 terminal frames. The 24 match traces now total 181,920 frames. Scoring, renewed-combat and completion requirements remain intact.

Protocol `live-functions-vs-headless-step-v34` stores `mobilityDecisionTraces` separately from **6,027 paired traces / 980,748 frames**, complete matches and other live-only families. Any mobility failure fails execution acceptance; passing still leaves the gate **inconclusive**. General mobility settings, supplied obstacle maps, runaway-altitude recovery, airborne objective transitions, headless autonomous parity, calibrated performance, held-out quality and final repository acceptance remain open. Optional neural integration stays unpromoted. Exploratory seed results are retained in `output/m7-mobility-seeds.json`. An apparent missing revived assignment also appeared in existing match cases. Inspection confirmed that another carrier died later in the revival frame, correctly clearing all assignments before render; the planner rebuilt them on the next frame. The revival assertion now checks immediately after planning and before decisions, while existing late-carrier cleanup checks remain active. This was an assertion-boundary defect, not a missing planner assignment; no planner behavior changed.

Verification:

- Focused mobility, revival and direct landing/evasion tests passed **48/48** (`output/m7-mobility-focused.log`).
- Final validation suite passed **7,375/7,375** tests, including the updated complete-match matrix and aggregate gate (`output/m7-mobility-validation.log`). The first full run exposed the revival assertion-boundary issue and insufficient match windows described above; the final run retains every completion requirement. Scoped `git diff --check` passed.
- TypeScript passed with the 8 GB heap allowance (`output/m7-mobility-typecheck.log`).
- Production client build passed (`output/m7-mobility-build.log`), with the existing large-chunk warning.
- Saved and re-parsed evidence: `output/m7-mobility-evidence.json`; summary: `output/m7-mobility-summary.json`. All eight traces and 13 complete flights have zero failures. The updated match evidence is saved and re-parsed separately in `output/m7-mobility-match-evidence.json` / `output/m7-mobility-match-summary.json`: all 24 matches / 181,920 frames pass and finish at match end. Source identity: commit `d48aebba43159771c2c1df6bc957d6ee175af14b`, working-tree hash `a308604d24ab9911d022b41f146bccf7078ce87459a3ac08394f006a3149c747`.
- README, both explicit test commands and aggregate gate assertions include the new family. Attached implementation plans remain unchanged.
- Full repository tests and frozen browser CLI runs were not repeated. The five previously reported V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is supplied-map mobility coverage. Human testing remains deferred until the remaining automated requirements are complete.


## 2026-09-29 — supplied-map terrain mobility

Committed the autonomous flight/landing slice as `576f1cf` (`Validate autonomous AI flights and fix landing and dodge physics`). Added **92 live terrain traces / 16,560 frames**, with **95 focused tests** including two exact-repeat checks and a coverage check. This slice remains uncommitted; human testing stays deferred.

All eight supplied maps pass through the production `toGrifballArena` conversion and are cloned without flattening or removing obstacles. Every map has a floor-flight and an outward arena-boundary flight. Seven explicit elevated surfaces cover box and cylinder landings: Cyber Hex Grid's northwest pillar, Jungle Ruined Outpost's central totem, Vanguard Asteroid Mine's first asteroid, Forerunner Canyon's west barrier, Synthwave Grid's north-center pillar, Rainy Industrial Streets' northwest crate and Winter Glacier Rink's north glass board. Championship Stadium has no collidable platform. Both recovery and engagement gravity owners run for main and ordinary AI identities.

Each trace authors only its initial airborne state and advances 180 production gravity/collision updates. The production arena collision callback is important: it owns grounded flags and jump-budget replenishment on raised surfaces, beyond the floor-level reset checked in the previous slice. An independent ballistic/contact oracle requires the expected height and velocity, an eventual landing, at least 60 updates of stable grounded observation, correct jump eligibility, finite positions and containment within rectangular or radial arena boundaries. Outward boundary flights must reach the wall before landing and lose their outward velocity. Elevated landings retain their horizontal location. Airborne sentinel actors require that neither the other bot's nor the local player's flags/budget be reset accidentally. Supplied maps must remain unchanged. No production gameplay change was needed.

Protocol `live-functions-vs-headless-step-v35` records these as `mapMobilityTraces`, separately from autonomous decision families and **6,027 paired traces / 980,748 frames**. A terrain failure fails execution acceptance; all passing still leaves the gate **inconclusive**. These are authored flight continuations, not autonomous jump choices or headless terrain comparisons. Sphere-platform landing, stepping off platforms, ceiling/runaway recovery, autonomous routing/combat on supplied maps, calibrated performance, held-out quality and final repository acceptance remain open. Optional neural integration stays unpromoted.

Verification:

- Focused map mobility tests passed **95/95** (`output/m7-map-mobility-focused.log`).
- Full validation suite passed **7,470/7,470** tests, including the aggregate execution gate (`output/m7-map-mobility-validation.log`).
- TypeScript passed with the 8 GB heap allowance (`output/m7-map-mobility-typecheck.log`); scoped `git diff --check` passed.
- Saved and re-parsed `output/m7-map-mobility-evidence.json`; summary: `output/m7-map-mobility-summary.json`. All 92 traces / 16,560 frames have zero failures. Source identity: commit `576f1cf5e89ea183c8c275afef32877bbd0a985a`, working-tree hash `dc0ada397ab58fcd24ae0b16ac0c765dee4362ef21ec7e80ca4d2f5ed6a8581c`.
- README, both explicit test commands and aggregate gate assertions include this family. Attached implementation plans remain unchanged.
- Production gameplay and browser UI code did not change; no new browser playtest or production build was required for these Node validation fixtures. Full repository tests and frozen browser CLI runs were not repeated. The five previously reported V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is autonomous retrieval/routing on the supplied goal-capable maps, retaining actual obstacles and team spawn layouts. Human testing remains deferred until the remaining automated requirements are complete.


## 2026-09-29 — autonomous supplied-map retrieval and routing

Committed the terrain-recovery slice as `3f35c22` (`Validate AI terrain recovery across supplied maps`). Added **40 live map-routing traces / 57,600 frames**, with **44 focused tests** including three exact repeats and a matrix-coverage check. This slice remains uncommitted; human testing stays deferred.

The five supplied maps with physical goals after production Grifball conversion are Forerunner Canyon, Synthwave Grid, Rainy Industrial Streets, Winter Glacier Rink and Championship Stadium. Their obstacles, goal plates and team spawn layouts are cloned without modification. Three allied bots begin at actual distinct team spawn points, with the ball at center. Both teams, roster insertion orders and main/ordinary designated carriers run for 1,440 frames. The production roster tick, tactical planner, AI updater, arena collision callback and objective loop autonomously choose retrieval, movement, pickup, carrying and scoring; nothing injects assignments or subsequent positions/actions.

The initial probe incorrectly expected the closest bot by straight-line distance to retrieve on every map. On the three maps with end-zone barriers, the planner instead chose an outer-spawn teammate with a clearer route and scored successfully. The final fixtures put the designated main/ordinary actor at that real outer spawn on those maps, retain a closer but obstructed teammate, and explicitly require the route-aware choice. Winter and Championship retain the closer center spawn as retriever. This corrects the test assumption; planner behavior did not change.

Assertions require one eligible retriever, one update per actor, an autonomous pickup request inside the configured radius, a next-frame runner role, configured speed bounds, safe planner segments and independent ground-obstacle clearance. Both box and cylinder footprints are checked without the production collision resolver. Runners must visibly cross the enemy barrier's X footprint outside its Z extent on the three obstructed maps. Scoring must occur over the actual enemy plate (independent ellipse/rectangle check), clear ownership and restore the hammer. Each run requires one goal notification, the correct winner, the twelve-update scored hold, stopped inactive movement, cleared terminal assignments and at least one second of stable match end. Supports stay separated and the supplied map/spawn data must remain unchanged. No gameplay fix was needed.

Protocol `live-functions-vs-headless-step-v36` records `mapRoutingTraces` separately from terrain-only traces, earlier live decision families and **6,027 paired traces / 980,748 frames**. Any new routing failure fails execution acceptance; passing leaves the gate **inconclusive**. These are uncontested three-ally, one-goal runs with passing disabled and authored initial roster, seed and tuning. They do not exercise opponents, deaths/respawns, round reset, the outer frame/presentation owners, autonomous airborne map movement or headless decision execution. Calibrated performance, held-out quality and final repository acceptance remain open; optional neural integration stays unpromoted.

Verification:

- Focused supplied-map routing tests passed **44/44** (`output/m7-map-routing-focused.log`).
- Full validation suite passed **7,514/7,514** tests, including the aggregate execution gate (`output/m7-map-routing-validation.log`), with an 8 GB Node heap allowance. The focused family and saved evidence were regenerated after the TypeScript phase-read adjustment.
- TypeScript passed with the 8 GB heap allowance (`output/m7-map-routing-typecheck.log`); scoped `git diff --check` passed.
- Saved and re-parsed `output/m7-map-routing-evidence.json`; summary: `output/m7-map-routing-summary.json`. All 40 traces / 57,600 frames have zero failures, including 24 barrier-detour cases. Source identity: commit `3f35c22fda5db82b4c03c12afe5f5549604be1fd`, working-tree hash `d25e98f8378c3e4aaa5dba464307d7af2d3f119412e9d7c8c64ee5728e804996`.
- README, both explicit test commands and aggregate gate assertions include the new family. Attached implementation plans remain unchanged.
- Production gameplay and browser UI code did not change; no new browser playtest or production build was required for these Node validation fixtures. Full repository tests and frozen browser CLI runs were not repeated. The five previously reported V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is opposing autonomous decisions on the supplied maps, joining these routes with combat, carrier loss, recovery and respawns. Human testing remains deferred until the remaining automated requirements are complete.


## 2026-09-29 — opposing decisions on supplied maps

Committed the autonomous supplied-map routing slice as `81b1c7e` (`Validate autonomous retrieval and scoring on supplied maps`). Added **40 live map contests / 72,000 frames**, with **44 new focused tests** including three exact repeats and matrix coverage. This slice remains uncommitted; human testing stays deferred.

The five goal-capable supplied maps retain their production Grifball conversion, obstacles, goal plates and all team spawn points. Four opposing bots begin in the existing authored wounded-carrier contest near midfield. Both carrier teams, roster orders and main/ordinary initial-carrier identities continue autonomously for 1,800 updates (30 seconds). The production frame coordinator joins planning, actual AI/weapon decisions, roster impacts, objective updates, late dead-carrier reconciliation and team respawn callbacks. Initial placement/possession, one-HP combat tuning and seed are authored; subsequent actions, damage, movement, ownership and revivals are not injected.

The shared opposing fixture now accepts a supplied-map continuation. It uses real arena collision/altitude callbacks, derives goal targets and independent ellipse/rectangle scoring checks from the supplied plate dimensions, and validates respawn/reset placement against actual team spawn membership. Movement-segment checks exclude the explicit respawn teleport frame, whose destination is checked independently; ordinary movement and later frames retain their safe-segment assertions. Existing flat-court continuations keep their original opening outcome requirements.

The initial map run passed 38/44 tests. Six reverse-order ordinary-carrier cases on the three barrier maps legitimately killed the replacement escort carrier before the 150-frame opening check ended, invalidating the flat-court assumption that this carrier must survive. The map-specific opening checks now allow that additional lethal follow-up only with its recorded carrier death, impact and cleanup. They still require the first carrier's exact lethal impact, recovery at tick 70, hostile targeting and renewed pressure. Every run requires attacks by both teams, carrier loss, recovery by another living actor, production respawns, re-entry movement/assignment and renewed attacks by the original loser. All deaths whose 181-update delay fits inside the observation window must revive; deaths near the end may still be waiting legitimately. Frame checks retain health/loadout resets, full shields and protected damage, main-identity counters, consumed jump commitments, kill/death credit and goal-notification conservation. No gameplay fix was needed.

Protocol `live-functions-vs-headless-step-v37` records `mapContestTraces` separately from earlier live families and **6,027 paired traces / 980,748 frames**. A map-contest failure fails execution acceptance; passing leaves the gate **inconclusive**. The bounded family does not require a goal or match completion. It retains constrained combat tuning, disabled passing, observer/input/render omissions and the earlier pressure/combo/player-model omissions. Complete contested supplied-map matches, broad airborne/mobility choices, headless autonomous parity, calibrated performance, held-out quality and final repository acceptance remain open. Optional neural integration stays unpromoted.

Verification:

- Map contests plus the existing opening and revival families passed **104/104** focused tests (`output/m7-map-contest-focused.log`).
- Full validation suite passed **7,558/7,558** tests, including earlier trace families and the aggregate gate (`output/m7-map-contest-validation.log`), with an 8 GB Node heap allowance.
- Saved and re-parsed `output/m7-map-contest-evidence.json`; summary: `output/m7-map-contest-summary.json`. All 40 traces / 72,000 frames have zero failures, containing **245 deaths, 220 respawns, 152 carrier deaths, 162 pickups and 14 goals / 14 resets**. The remaining 25 death delays extend beyond the bounded window; every elapsed delay is verified. Source identity: commit `81b1c7efa465c4350118b6733afecc293ddefeb3`, working-tree hash `1ca8cd98908c727672e8cf595e35126063736b4ed9daf936e97e7357cb1f2d4d`.
- TypeScript passed with the 8 GB heap allowance (`output/m7-map-contest-typecheck.log`); scoped `git diff --check` passed.
- README, both explicit test commands and aggregate gate assertions include this family. Attached implementation plans remain unchanged.
- Production gameplay and browser UI code did not change; no new browser playtest or production build was required for these Node fixtures. Full repository tests and frozen browser CLI runs were not repeated. The five previously reported V3 repository failures remain unresolved, without waivers or a claim of M7 acceptance.

Next work is complete contested supplied-map matches, carrying these scenarios through goals, round resets and stable terminal state. Human testing remains deferred until the remaining automated requirements are complete.

## 2026-09-29 — complete opposing matches on supplied maps

Committed the preceding short supplied-map contest slice as `771813e` (`Validate opposing AI contests on supplied maps`). This slice extends its same 40 cases across the five goal-capable supplied maps, both initial carrier teams, roster orders and main/ordinary identities through full two-goal matches.

Implementation:

- Added `grifballMapMatch.ts` and its tests, using the production frame/planner/AI/combat/objective/respawn owners from the shared opposing fixture. Actual map geometry and team spawns remain intact. No actions, subsequent possession, damage, movement or goals are injected.
- Extracted `validateCompleteMatchTrace` so supplied maps and the existing synthetic matches share score/winner, exact phase timing, reset preservation, fresh retrieval/combat, respawn accounting and terminal stability assertions.
- Matches have a thirty-minute simulated cap and stop after 181 updates following match end, allowing the normal death delay to finish. A capped unfinished match remains a failure. The initial five-minute probe found active tied contests with continuing attacks and possession exchanges; Forerunner variants finished without tuning or seed changes in the longer window.
- Replaced the mapped contested fixture's ground-segment assertion with independent final 3D body clearance and arena-bound checks. A ground-segment oracle incorrectly rejects legal platform travel and the chord between two collision-corrected points sliding around a rounded box corner. The first observed example was Forerunner ordinary blue/forward at tick 1964. Box, cylinder, sphere and rounded-corner rejection/contact tests cover the revised oracle. This does not certify swept collision or change gameplay physics. Uncontested route and synthetic-fixture segment checks remain.
- Aggregate protocol is `live-functions-vs-headless-step-v38`. All new match frames are validated, then only events, counts and the final frame are retained as `mapMatchTraces` to bound aggregate memory. Individual full frames remain available from `runMapMatchTrace`. Paired evidence stays at 6,027 traces / 980,748 frames; these are live-only decisions.

The first full validation attempt exposed three completion-window failures at 36,000 updates: Rainy blue/forward/main and Winter blue/reverse with ordinary/main carriers. Diagnostics retained movement, combat, pickup and death evidence at the cutoff; none was an inactive stall. Without seed or tuning changes, those runs ended at ticks 36,514, 48,902 and 62,462 including the terminal observation. Their independent lifecycle checks passed. The final uniform cap is 108,000 updates; the other 37 cases already finished earlier and stop at the same frame. This observation does not establish acceptable pacing or tactical quality.

Verification:

- Initial complete validation suite: **7,602/7,606 passed**. Its four failures were the three 36,000-frame cutoffs and the aggregate gate containing them, not unrelated regressions. See `output/m7-map-match-validation.log`.
- Final affected-case, repeatability, collision and aggregate selection: **12/12 passed** (46 unrelated test names skipped), in 830.76 seconds. The fresh aggregate recomputed all 40 complete matches and every existing parity family, reported no trace failures, and retained the expected **inconclusive** coverage verdict. See `output/m7-map-match-final.log`. The entire 7,606-test command was not repeated after the cap-only change; the 37 already completed matches also reran inside this passing aggregate.
- Final TypeScript checking and implementation-path `git diff --check`: passed.
- Final source identity: commit `771813e7dbb0cf668b06ef91905e83e21eeb8776`, dirty working tree hash `198b868beacd3e679005264d0469d6e2370193e00281707f278d51230ab060b0`.
- Saved and reparsed verification manifest: `output/m7-map-match-verification.json`, containing the source identity, initial suite counts, final passing selection and the 37 initially completed scenario names. The three extended diagnostic event/frame records remain in `output/map-match-extended-*.json`; this is test-result evidence, not a saved full-frame export of all 40 matches.
- No gameplay/UI code changed. A production build, browser run and whole-repository test run were not repeated for these fixture changes.

M7 remains inconclusive: broader tuning/passing, headless autonomous parity, calibrated performance and held-out quality still need evidence. Human testing remains deferred. The next automated decision-integration target is passing while opposing bots are actively contesting possession; completion-window evidence here does not establish match pacing or quality.

## 2026-09-29 — autonomous passing with opposing decisions

The complete supplied-map match slice was committed as `237f387`. This slice adds **40 live passing contests / 48,000 frames** and 46 focused tests (40 cases, matrix coverage and five exact repeats). Five authored openings cover clear reception, close pressure before charging, an opponent approaching during charging, a blocked initial passing lane and passing disabled. Every opening covers both teams, actor orders and main/ordinary initial carriers.

All four actors run the production planner, AI updater, attack/impact callbacks and respawn owners inside the shared live frame coordinator. Only starting positions, initial possession, seed and constrained combat settings are authored. No opponents are teleported during the trace, no attacks/passes are injected, and no opponent updater is suppressed. The carrier starts at normal runner health. These 1,200-update traces use the existing empty synthetic court and authored team respawns; they are not supplied-map or complete-match passing coverage.

The shared fixture now records pass releases, charge cancellations and per-frame charge/flight/selection state. Independent checks verify single-step charge advancement, holder ownership, readiness and threshold at release, restored weapon/health, intended allied receiver, horizontal and vertical release velocity and single-step displacement. Pickup checks use the settled ball position after objective physics, require autonomous intent and range, and verify the next-frame runner assignment and cleared flight intent. Noncharging actors must not retain charge displays. Existing hostile damage, carrier-death cleanup, shield, revival, finite movement and credit checks remain. The new wrapper additionally requires motion and attacks from opposing bots, every elapsed death delay to respawn, and scenario-specific outcomes.

Clear opening passes release at tick 36 and reach the intended receiver at tick 131. Nearby pressure suppresses the initial charge and is dealt with before a later pass. In the closing-charge opening, a moving threat cancels a real charge before a subsequent safe release. The blocked opening becomes a carrier-death and opposing-recovery contest; later possession changes are allowed to produce different decisions. The disabled control never selects a charge or releases a pass.

Exploratory layouts did not produce an interception of a released pass. Interception risk is exercised through pass rejection and cancellation, but actual opposing recovery directly from a thrown pass remains unverified. The fixture retains default pass safety margins and low movement complexity; exploratory risk/mobility overrides were removed. No gameplay change was needed.

Protocol `live-functions-vs-headless-step-v39` retains these as separate `passContestTraces`. Any failure fails the execution gate; a clean run remains **inconclusive** because the broader coverage gaps remain. Paired totals remain 6,027 traces / 980,748 frames. Attached implementation plans are unchanged, and human testing remains deferred.

Verification: **184/184 focused tests pass** (new contests plus existing passing, pressure, opposed-opening and revival regressions), and TypeScript checking passes. Saved `output/m7-pass-contest-evidence.json` was parsed back and all 40 traces rechecked: **48,000 frames, zero failures, 30 releases, 12 cancellations, 120 deaths, 102 revivals, 30 carrier deaths and 56 pickups**. `output/m7-pass-contest-summary.json` retains scenario totals. Evidence source: base commit `237f387bce2bbbf0bc464c98b5c3311a930044a4`, dirty working-tree hash `4b22cd0f6a59234151bccd5cb2e49293efbb1476ab1f2aaca81fef5d230d5217`.

The complete validation suite passed **7,652/7,652 tests**, with zero failures, cancellations or skips, in 1,107.3 seconds using an 8 GB Node heap (`output/m7-pass-contest-validation.log`). Scoped `git diff --check` also passes. No production gameplay source changed; build, browser and unrelated full-repository tests were not rerun. M7 remains **inconclusive** for the documented broader gaps, with human testing deferred.

## 2026-09-29 — autonomous passing through complete matches

The opposing passing-contest slice was committed as `7f4e9ee`. This slice adds **48 complete live passing matches** and 52 tests: clear, closing-pressure and passing-disabled openings, seeds 17 and 43, both teams, both actor orders and main/ordinary initial carriers. Three representative matches are repeated exactly. Both seeds are fixed regression examples, not held-out quality evidence.

The shared live frame fixture now has a passing-match continuation that enables physical goals and production round transitions while retaining the earlier pass charge, release, pickup, hostile-combat, carrier-death and respawn instrumentation. Every match must reach a two-goal win within five simulated minutes, then continue 181 updates after match end. The shared complete-match validator checks score and kill/death accounting, all elapsed respawns, notification counts, goal holds, reset placement, countdown, fresh retrieval and combat, later goals, and stable terminal state. Additional checks require an opening reception for enabled cases, cancellation under closing pressure, no passing in disabled controls, and cleared charge/flight state outside active play. Fixed main-carrier clear-opening cases explicitly require a pass after a round reset.

Protocol `live-functions-vs-headless-step-v40` adds `passMatchTraces` to the execution gate, with any trace failure failing the gate. Every frame is checked before retaining compact events, counts and the final frame in the aggregate report; full individual traces remain available through `runPassMatchTrace`. Existing continuations retain their durations and settings. Paired totals remain 6,027 traces / 980,748 frames.

These are four-bot matches on the authored flat court with constrained combat tuning. Supplied-map passing, larger rosters and broader tuning, actual released-pass interceptions, headless autonomous parity, calibrated performance and held-out quality remain unaccepted. No production gameplay change was needed. Attached implementation plans are unchanged, and human testing remains deferred.

Verification: **52/52 new tests passed** in 91.4 seconds, and TypeScript checking passed. Saved compact evidence (`output/m7-pass-match-evidence.json`) was parsed back and all 48 completed traces rechecked: **146,986 frames, zero failures, 59 passes (22 after a reset across 12 matches), 21 cancellations, 387 deaths and 387 revivals, 123 goals and 75 resets**. The longest trace was 11,128 updates (185.5 simulated seconds, including terminal observation). `output/m7-pass-match-summary.json` retains per-match outcomes. Evidence source: base commit `7f4e9ee470098e564b958b98343c862496cc3082`, dirty working-tree hash `ac2e8b3e2a946718ea1b9e51592e43b4176a92ca2af316223829450eec3a9e41`.

Affected passing-contest, complete-match, opposed-opening and revival tests plus the aggregate gate passed **152/152** in 597.1 seconds with an 8 GB Node heap (`output/m7-pass-match-regressions.log`). Combined with the 52 new tests, **204/204 checks passed**, with no failures or skips. The aggregate gate also reruns all existing paired and live decision families, including the 40 complete supplied-map matches. TypeScript and scoped `git diff --check` pass. The full validation command, unrelated repository tests, production build and browser checks were not rerun for this fixture-only change. The gate remains **inconclusive** because its broader coverage gaps remain; human testing stays deferred.

## 2026-09-29 — passing through complete supplied-map matches

The flat-court passing-match slice was committed as `4c02bd7`. This slice extends passing to **40 complete matches on all five goal-capable supplied maps**, covering both teams, actor orders and main/ordinary initial carriers at seed 17. The clear opening uses verified obstacle-free starting positions and normal runner health; all subsequent movement, passing, combat, pickups and scores are autonomous. Supplied geometry and team spawns are cloned intact and checked for preservation.

The shared fixture combines passing instrumentation with the existing mapped collision, altitude recovery, placement and respawn owners. It rejects invalid starting positions, checks predicted pass path samples and every thrown-ball frame against an independent ground-footprint oracle, and retains planner-refresh counts plus bounded examples of rejected blocked-space candidates (including arena-boundary rejection). Every canyon, grid and industrial match must reject blocked candidates, including an example whose sampled path independently overlaps an obstacle footprint. These are conservative ground-clearance checks, not swept collision or aerial obstacle clearance certification.

The shared complete-match and passing validators enforce release/reception, carrier transitions, hostile combat and credit, shield/death/revival behavior, physical goals, round reset/countdown, inactive charge/flight cleanup and two-goal completion. Each trace allows thirty simulated minutes and retains 181 terminal updates. Existing flat-court limits and unrelated continuations are unchanged. Three full trace repeats cover canyon, industrial and stadium maps. Every frame is validated before compact event/final-frame evidence enters `mapPassMatchTraces` under protocol `live-functions-vs-headless-step-v41`; any trace failure fails the gate. Paired totals remain 6,027 traces / 980,748 frames.

No production gameplay source changed. These are authored four-bot regression fixtures with constrained hammer tuning, not held-out quality trials. Actual released-pass interceptions, broader rosters/tuning, headless autonomous parity, calibrated performance and quality acceptance remain open. M7 remains **inconclusive**, attached implementation plans are unchanged, and human testing stays deferred.

Verification: **44 new map-passing tests and 98 existing passing regressions passed**; TypeScript checking also passed. Final compact evidence (`output/m7-map-pass-evidence.json`) was parsed back and all 40 completed traces rechecked: **513,519 frames, zero failures, 95 passes (55 after resets), 104 goals, 64 resets, and 1,456 deaths matched by 1,456 revivals**. Planner refreshes recorded 16,996 blocked-space candidate samples; those samples include boundary rejection and are not a count of distinct obstacle encounters. The longest trace was 55,614 updates (926.9 simulated seconds), within the thirty-minute cap; match pacing is not accepted by this result. All 40 saved traces exactly reproduce the preliminary matrix. `output/m7-map-pass-summary.json` retains totals.

Final evidence source: base commit `4c02bd71c916040462b4a94d8fb1771bd930fd7e`, dirty working-tree hash `ff7cf6fd6a69d89f809ea7cd88053d7fed337bef61c49746ebb09e98e9e22fcc`. The earlier preliminary artifact retains its own pre-finalization code identity. The combined new-map tests, existing passing regressions and aggregate gate passed **152/152 tests**, with zero failures, cancellations or skips, in 1,050.1 seconds using an 8 GB Node heap (`output/m7-map-pass-tests.log`). The gate reruns all existing paired and live decision families as well as the new map matches. The final code identity matches the saved evidence, and scoped `git diff --check` passes. The full validation command, unrelated repository tests, production build and browser checks were not rerun for this fixture-only change. An outcome review found no opposing next pickup following a released pass in the 95 releases; interception acceptance remains open. M7 remains **inconclusive**, and human testing stays deferred.

## 2026-09-29 — larger rosters and tactical profile integration

The supplied-map passing slice was committed as `200fa2d`. This slice adds **64 live 3v3/4v4 contests / 115,200 frames**: balanced, wider defensive, compact attacking and tanking-disabled escort profiles, both teams, both actor orders and main/ordinary initial carriers. Starts, seed 17, observer context and constrained hammer combat are authored; subsequent actions and possession changes are autonomous. Tactical profiles use validated existing controls and remain unchanged throughout each trace.

The shared frame fixture creates six or eight scripted actors and checks the planner boundary on every tick: exact living-roster assignment coverage, a single holder/runner, one retriever per available team, unique support slots, finite destinations, living hostile tank targets and allied partner/recovery references. Recovery coverage may legitimately refer to the assigned bot itself; a partner must be another actor. Planner refreshes retain role, slot, destination, tanking and escort samples. Existing pass, carrier, finite-motion, damage/shield, respawn and credit checks continue across the larger roster. Every bot must move while alive and receive a tactical role; both teams must attack, and every elapsed death delay must produce a revival.

When tanking is enabled it owns support orders and can replace the escort order; the disabled control explicitly requires escort orders and no tanking orders. A separate wide/compact comparison checks different initial support destinations and subsequent movement. Four full-trace repeats check deterministic replay. Compact `rosterContestTraces` enter protocol `live-functions-vs-headless-step-v42` after every frame is validated; any trace failure fails the gate. Paired totals remain 6,027 traces / 980,748 frames.

This is bounded thirty-second integration evidence on the empty synthetic court, not UI roster lifecycle or complete-match/map acceptance for the larger rosters. Arbitrary combat tuning, double-commit timing, released-pass interceptions, headless autonomous parity, calibrated performance and held-out quality remain open. No production gameplay change was needed. M7 remains **inconclusive**, attached implementation plans are unchanged, and human testing stays deferred.

Verification: the initial twenty-second window passed 69/70 tests; one escort-only trace died too late to observe a respawn. The fixture was extended uniformly to thirty seconds without dropping the respawn requirement. **70/70 final tests passed** in 81.4 seconds, including four exact repeats and the wide/compact destination-and-movement contrast. TypeScript checking passed.

Final compact evidence (`output/m7-roster-evidence.json`) was parsed back and all 64 traces rechecked: **115,200 frames, zero failures, 94 passes, 595 deaths, 514 revivals and 75 carrier deaths**. The 81 remaining deaths have not reached their respawn deadline at the bounded cutoff; every elapsed delay is asserted. The 9,566 planning samples exercise all six roles and cover, engage, punish and release orders. There were **zero double-commit samples**, so this result does not accept live double-team commitment timing. `output/m7-roster-summary.json` retains per-profile counts. Final evidence source: base commit `200fa2dd845bd1e6793f10aee0c2774bee912b8a`, dirty working-tree hash `cd0e51bc5c282dfda1ecc44d42cc17d3bbc55b8a2526179c8c1ef752108c4c7f`.

Existing passing-contest, opposed-opening and revival regressions plus the aggregate gate passed **116/116 tests** in 1,187.0 seconds with an 8 GB Node heap (`output/m7-roster-regressions.log`). Combined with the 70 new tests, **186/186 checks passed**, with no failures or skips. The aggregate gate also reruns the existing paired, full-match and supplied-map passing families. The final code identity matches the saved evidence, and TypeScript plus scoped `git diff --check` pass. The full validation command, unrelated repository tests, production build and browser checks were not rerun for this fixture-only change. An outcome review found no opposing next pickup following a released pass. M7 remains **inconclusive**, and human testing stays deferred.

## 2026-09-29 — live double-tank commitment and guarded openings

The larger-roster slice was committed as `6974c5d`. This slice adds **64 bounded live tanking contests / 19,200 frames**, each five seconds long. Eight starts cover a viable two-bot opening, a ready opponent, almost-complete recovery, distant reserve coverage, shared hammer exposure, a high double-team threshold, no spare teammate and a disabled module. Both team colors, roster update orders and main/ordinary initial carriers are included. The no-spare control has three bots per team; the other starts have four.

These are explicitly authored starts: the target begins in visible hammer recovery except in the ready control; the short-window control begins at 1.19 seconds of a 1.2-second recovery. Base health is three, hammer range/radius 1.5 (radius 4.5 in the shared-blast control), windup/attack .08/.04 seconds and reload 1.2 seconds. Safety-first and a 1.5 double threshold are enabled, defense and passing disabled; the threshold control uses 15. The reserve starts behind the carrier or at x=-23 in the delayed-coverage control. The court is empty, normal difficulty and seed 17 are fixed, and no subsequent movement, attack, damage, assignment or possession is injected.

Planner refresh and attack-boundary snapshots retain live positions, health, weapon phase/timer, observed space data and complete tank orders. Positive cases require reciprocal partners on one living opponent, a separate living allied nonattacking reserve within the three-second coverage budget, actual and planned pair separation greater than 3.5 units, ready attackers, a still-recovering opponent with sufficient time for impact, tactical target consumption and real damage by each tank before the authored recovery deadline. The double commitment must subsequently expire. Negative initial conditions must produce zero double commits, with the appropriate refusal reason where a waiting partner exists. The disabled control must retain no tanking orders. Existing per-frame assignment, combat, shield, carrier, objective, revival and accounting checks continue throughout the five seconds.

Three exact repeats test deterministic traces. Compact `tankContestTraces` enter protocol `live-functions-vs-headless-step-v43`; any failure fails the gate, and paired totals remain 6,027 traces / 980,748 frames. The initial recovery is authored rather than earned through a prior live swing; default combat tuning, main-AI tank attackers, general formation safety throughout arbitrary fights, supplied maps, full matches, headless autonomous parity, performance and held-out quality remain outside this slice. No production gameplay source changed. M7 remains **inconclusive**, attached implementation plans are unchanged, and human testing stays deferred.

Verification: **68/68 focused tests passed** in 28.6 seconds, and TypeScript checking passed. Final compact evidence (`output/m7-tank-evidence.json`) was parsed back and all 64 traces rechecked: **19,200 frames, zero failures, eight positive openings, 16 committed attacks and 16 intended-opponent hits**. Positive attacks start on ticks 2–5; all 56 negative starts have zero initial double commits. The traces retain 1,546 planner samples and 311 action samples, with 40 deaths and 32 revivals; bounded cutoffs can leave later deaths pending. `output/m7-tank-summary.json` retains the totals. Evidence source: base commit `6974c5d9efd76e62e8b35666663e322fe13e4cac`, dirty working-tree hash `8ae88063de8b1f900564b67f82599c0632207c2e61f8f450ddf73e58085aeff1`.

A saved-event audit (`output/m7-tank-audit.ts`) also confirms that the reserve starts no attack before both initial tank hits in all eight positive traces: those hits occur on ticks 9/11 or 10/12, and the reserve first attacks on tick 31 or 32. The evidence identity matches the current source. This is an observed result for these starts, not a claim of unrestricted formation safety.

Existing larger-roster, opposed-opening, revival and tanking unit regressions plus the aggregate gate passed **154/154 tests** in 1,591.8 seconds with an 8 GB Node heap (`output/m7-tank-regressions.log`). Combined with the 68 focused tests, **222/222 tests passed**, with no failures, cancellations or skips. The aggregate reruns all existing paired and live decision families, including complete supplied-map passing matches, and includes the new tanking family. TypeScript, the final saved-evidence identity audit and scoped `git diff --check` pass. The full validation command, unrelated repository tests, production build and browser checks were not rerun for this fixture-only change. M7 remains **inconclusive**, human testing stays deferred, and this new slice is left uncommitted for the next requested commit.


## 2026-09-29 — default-combat tanking geometry and stale punish orders

The previous live tanking slice was committed as `bd3df72`. This slice found two production defects while attempting default-combat acceptance. Default hammer reach is 7.7 units and blast radius is 4.5. The primary's single-tank destination was capped at three units, while the partner used 70% of reach (5.39). Even opposite approaches were therefore at most 8.39 units apart, always failing the 9.5-unit planned blast separation. Both candidate double-team destinations now use weapon-scaled standoff distances and require unblocked routes. Only an accepted double commitment changes the primary's destination; the single-tank three-unit cap is preserved. Current-position blast checks, recovery coverage, value and timing guards remain in force.

The second defect was a cached punish order that checked whether the target was still recovering but not whether enough recovery remained to justify the attack. Target selection now recomputes attack ETA from the latest public actor state and position and requires the same 0.1-second advantage used by planning. A short remaining recovery cancels that tactical target; immediate self-defense still works.

Both defects have failing-before/passing-after regression evidence (`output/m7-default-tank-before.log` and `output/m7-default-tank-stale-before.log`). Fifteen new tests use unmodified default combat observations and default team tactics: eight positive planner variants across teams, roster orders and main/ordinary attacker identity; six controls for ready/closing recovery, actual shared exposure, late reserve and either blocked planned destination; and one stale-order timing regression. Each negative control first verifies a positive commitment before changing its condition. Obstacles block planned positions while attackers start farther away. These are authored tactical snapshots, not full live action or impact evidence, and a main-AI identifier does not establish main-AI runtime execution.

Exploratory live trials with default combat did not produce a naturally earned double commitment. All-ready starting layouts tended to synchronize attacks or close spacing before an exploitable recovery; in a pending-respawn probe the carrier passed the target, removing the route-opening value before fresh tanks arrived. These development searches are not held-out quality evidence or a new accepted trace family. The experimental fixture extension was removed from the tracked implementation and retained only in `output/default-tank-exploration.patch` for investigation. The acceptance protocol and trace counts remain unchanged at v43. **Default live double-team acceptance remains open; this slice fixes two prerequisites and does not close that backlog item.** No human testing is required yet, and M7 remains inconclusive.

Verification: **444 current focused and regression tests passed**: 29 final tanking tests, 247 other tactical/live tanking/roster/opposed/revival tests, and 168 decision/passing/adapter/runtime integration tests. The broad run initially included 21 tanking tests (268 total); after expanding only the test matrix, all 29 final tanking tests reran successfully. All selections have zero failures, cancellations or skips. Logs: `output/m7-default-tank-regressions.log`, `output/m7-default-tank-unit-final.log` and `output/m7-default-tank-integration.log`. TypeScript, production Vite build and scoped diff checking passed; Vite reported large-chunk warnings. Full aggregate acceptance, complete-match families, browser play and unrelated repository tests were not rerun, so previous aggregate evidence is not relabeled as current-source acceptance.

Saved and reparsed verification manifest: `output/m7-default-tank-verification.json`. Source identity: base commit `bd3df725dff8221fab2c1a06335eda8b47a91a0a`, dirty working-tree hash `b466a9a80e9efeb826a08d3032ac3a4b0094f00f4100b96f2f14cf7eaa1e9408`. README and this validation log are updated; attached implementation plans are unchanged. Changes remain uncommitted.


## 2026-09-29 — earned tank opening with default combat mechanics

The default-spacing and stale-punish fixes were committed as `bc104e6`. This slice adds **32 five-second live contests / 9,600 frames**, covering both team colors, roster update orders and main/ordinary **tank attacker** identity. The positive case uses default combat mechanics and the Safety first tactical option. The other tactics remain at their defaults, including coordinated defense, passing, adaptation and the double-team threshold. Three controls use default role allocation, late tank arrival and crowded spawn positions. Four exact repeats check deterministic replay.

Only the initial mid-fight state is authored. The carrier starts at (0,0) in punch recovery. The opponent starts at (4,0), height 0.8, ready, descending with its air-jump budget spent. Two friendly tanks have 0.75 seconds left on pending respawns into (4,+/-5.5); a reserve starts at (-12,0). The late control uses 1.35 seconds and the crowded control uses +/-2. Other opponents start farther away. Red fixtures mirror the positions. The live roster owner performs the initial revivals; they create no new death/kill credit. Subsequent deaths retain the existing exact three-second revival oracle. Timing of initial pending respawns is checked within one 60 Hz frame to allow floating-point countdown rounding. No subsequent attack, recovery, movement, damage, assignment or possession is injected. The existing observer fixture still uses normal difficulty, seed 17, neutral personality and constrained AI knobs, v2 rigs and an empty court; optional pressure/combo/player-model paths remain outside scope.

In all eight positive variants the opponent autonomously swings on tick 18 and damages the carrier on tick 42. Both tanks revive and begin committed attacks on tick 45. Their live impacts run on tick 69, and one kills the one-HP opponent before its recovery ends. Two damaging hits are neither required nor possible against that one-HP target. The main-AI variant executes the real main weapon owner; one mirrored case also credits its lethal hit. The separate reserve starts no attack before the pair resolves the opening. All 24 controls withhold a paired commitment and committed attacks during the opponent's first earned recovery; later autonomous play remains unrestricted.

Independent assertions cover unchanged default combat settings, an initially ready opponent, its attack-to-impact-to-recovery sequence, production respawn and credit, reciprocal tank references, current/planned separation above the default 9.5-unit blast margin, timely living allied nonattacking coverage, ready attackers, current target selection, sufficient remaining recovery, impact callbacks, a single credited death and eventual commitment expiry. Shared per-frame combat/objective/carrier/respawn checks still run throughout each trace. `earnedTankTraces` and their failures are included in aggregate protocol `live-functions-vs-headless-step-v44`; paired trace totals remain 6,027 / 980,748 frames. Both test scripts include the new test file.

This establishes the bounded default-combat earned-opening path and main-AI tank execution. It does **not** prove that double teaming arises frequently or improves quality from arbitrary all-ready match starts. Earlier exploratory all-ready/cooldown probes and an airborne unexecuted commitment are development diagnostics, not accepted positives or held-out quality data. Default role allocation legitimately reserves one of the arriving tanks in this start; Safety first retains the rear reserve and permits the pair. No production tactic was relaxed to force the positive result. Full-match quality, unrestricted formation safety, mixed/headless decision parity and calibrated performance remain open. M7 stays inconclusive; human testing is deferred. Attached implementation plans are unchanged.

Focused verification: **37/37 tests passed** in 18.0 seconds, and TypeScript plus scoped diff checking passed. Saved and reparsed compact evidence (`output/m7-earned-tank-evidence.json`) contains **32 traces, 9,600 frames, zero failures, 16 committed attacks and eight opening kills**. It records 32 deaths and 92 revivals: 64 authored pending spawns and 28 subsequent revivals after recorded deaths; four later deaths remain pending at the cutoff. Incoming tanks receive the normal one-second respawn shield, which is an explicit limit of this bounded opening. A saved-event audit (`output/m7-earned-tank-audit.json`) verifies all eight shared-blast refusal reasons, all eight default-role cases reserving an arriving tank, all eight delayed pairs arriving on tick 81, and one main-AI lethal opening hit.

Evidence source: base commit `bc104e6b510d8b18c8cfe06360413b76cd23bb37`, dirty working-tree hash `8d4bedc4267390464190e2cc2cba268dedf67923f5f1a147dae74a0209bb762c`. No production gameplay source changed in this slice. The shared live fixture, aggregate registration, test scripts, README and this validation log changed.

Final existing tanking/roster/opposed/revival regressions, tanking unit tests and the full aggregate gate passed **237/237 tests** in 1,183.8 seconds with an 8 GB Node heap (`output/m7-earned-tank-regressions.log`). Together with the 37 focused tests, **274/274 tests passed**, with no failures, cancellations or skips. The aggregate reran all paired and live integration families, including complete supplied-map passing matches, and retained the expected inconclusive coverage verdict. It also provides fresh aggregate regression evidence for the preceding committed tanking fixes. Final source identity matches the saved 32-trace evidence. TypeScript and scoped diff checking pass. The saved verification manifest is `output/m7-earned-tank-verification.json`. No browser, production build or unrelated full-repository test run was repeated for this fixture-only slice.

The next planned automated slice is live released-pass interceptions. This new slice remains uncommitted; M7 is inconclusive and human testing stays deferred.

## 2026-09-29 — released-pass recovery and turnover response

The earned-tank slice was committed as `c133331`. This slice adds **32 ten-second live contests / 19,200 frames** with default combat and passing settings. Four openings cover both teams, update orders and main/ordinary **opposing recoverer** identity. Four exact full-trace repeats check determinism. No production gameplay source changes.

The initial release is deliberately authored: the carrier at (-20,0) throws toward positive X from height 1.1, with an intended receiver at (-8,0); red starts mirror both axes. The enemy cover starts at (40,-18). Medium and long interception starts place the opposing recoverer at (3,6), speed 17.5, and (27,8), speed 26. Reception controls use a distant opponent at (-35,12), speed 17.5, and a short throw with opponent at (-11,8), speed 9. The fixture warms the real planner while the carrier still holds the ball, then calls production `throwBall` and carrier cleanup and supplies the intended receiver metadata. This preserves realistic round initialization without asking the passing planner to choose an unsafe throw. All subsequent planning, movement, pickup requests, combat, ownership changes and lifecycle handling are autonomous through the production owners. The normal seed-17 observer fixture, neutral personality, constrained AI knobs, v2 rigs and empty court remain scope limits.

The ball is uncatchable while thrown, including its bouncing phase. Opponents recover medium and long throws on ticks 96 and 132, respectively, when they settle. Allied controls recover the distant-opponent throw on tick 109 after settling at 96, and the short throw on its settling tick 68. These exact boundaries are independent regression expectations. Checks require a real AI pickup request, default pickup distance, actual movement from the opposing start, a projected recovery destination, and at least one denied request while the opponent is close to an unsettled pass. Both first-frame horizontal flight and gravity advance exactly once.

After recovery, the real objective owner grants runner health and the ball weapon. The next planning frame clears the old charge/flight and receive orders, assigns exactly one runner and allied support, and directs the other team's defense at the new carrier. In interception cases the intended receiver becomes a defender and its team retains a last defender. The new holder must make actual goalward progress within the next second. Shared checks validate every frame's living-roster assignment coverage, unique support slots, finite motion, carrier state, combat/respawn behavior and conserved credit. These are **16 opposing interceptions and 16 allied receptions**; they remain live-only evidence, separate from paired execution totals.

The compact `passRecoveryTraces` and any failures enter aggregate protocol `live-functions-vs-headless-step-v45`; both test commands register the new file. Paired totals remain 6,027 traces / 980,748 frames. Preliminary trials of 36 autonomously chosen passing contests produced no opposing next pickup after a release, so those trials are development diagnostics, not accepted interception positives or held-out quality evidence. This slice establishes recovery and turnover response after a controlled release. It does **not** establish AI selection of an intercepted pass, a full player-input release, arbitrary maps/rosters, headless autonomous decisions, calibrated performance or tactical quality. M7 remains inconclusive; human testing stays deferred and attached plans are unchanged.

Initial focused verification passed **37/37 tests** in 20.1 seconds. Final TypeScript checking passed after aggregate registration and expanded default-setting capture. Full aggregate regression and saved-evidence verification are recorded below.

Saved and reparsed compact evidence (`output/m7-pass-recovery-evidence.json`) confirms **32 traces, 19,200 frames, zero failures, 16 interceptions, 16 receptions, 20 deaths and 20 revivals**. Recovery outcomes were recounted from the actual first holder's team in saved pickup-frame samples. The evidence writer preserves nonfinite numbers and signed zero as explicit `$number` objects, restores them and compares the entire structure with the in-memory result; this keeps the defense planner's `Infinity` sentinel for no scheduled reinforcement. `output/m7-pass-recovery-summary.json` records totals and initial recoveries. Evidence source: base commit `c1333316e84f4d6da9ffbe8f5baba1ef784a9fab`, dirty working-tree hash `dfbc2e0721ef2eccf41a0e719f9b5c00e693f6ae392aff1ebaa018fc31b5987f`.

Final passing, earned-tank, opposed/revival, runtime and aggregate regressions passed **268/268 tests**, including the 37 new tests, with zero failures, cancellations or skips in 1,229.0 seconds using an 8 GB Node heap (`output/m7-pass-recovery-regressions.log`). The aggregate reran the existing paired and live families, including complete supplied-map passing matches, and retained the expected inconclusive verdict. Current source identity matches the saved evidence. TypeScript and scoped diff checking pass; `output/m7-pass-recovery-verification.json` was saved and reparsed. No browser, production build or unrelated full-repository test run was repeated for this fixture-only slice.

The next planned automated slice is complete matches with larger rosters on representative maps. This recovery slice remains uncommitted; human testing stays deferred.

## 2026-09-29 — complete larger-roster matches on representative maps

The released-pass recovery slice was committed as `7238886`. This slice joins the existing larger-roster invariants to complete-match acceptance: **32 3v3/4v4 scenarios** on the championship stadium and obstacle grid, both teams and update orders, and main/ordinary initial carriers. Seed 17, balanced tactics, authored clear opening possession and the existing observer fixture are explicit limits. The supplied geometry and team spawns stay intact. Initial positions must clear the independent map-footprint oracle.

The first two stadium probes inherited the older shortened hammer timing (0.08-second windup and 0.04-second attack, with 0.5-second melee). Both exceeded thirty simulated minutes: 3v3 scored twice and recorded 512 deaths; 4v4 scored once and recorded 677 deaths. Sampled late frames showed continuing possession changes, passing, movement and combat, rather than a stationary deadlock. These failed probes remain development diagnostics in `output/m7-roster-match-probe.log` and `output/m7-roster-match-diagnostic.json`; the obstacle-map continuation was interrupted after the stadium results to avoid continuing that tuning experiment. This does not establish a fix for arbitrary combat tuning or acceptable match pacing.

The final new fixture uses **default combat settings**, checked explicitly against the settings defaults. The two-goal target and accelerated 0.19-second scored hold / 0.09-second countdown remain authored to cover transitions. Normal difficulty, neutral personality, constrained movement/weapon-selection knobs, v2 rigs and disabled optional pressure/combo/player-model callbacks remain inherited limits. No production gameplay behavior changes. Initial default-combat probes completed both roster sizes on both maps without lifecycle failures.

All subsequent movement, planning, passing, combat, carrier changes, respawns and scoring use the production owners. Every active planning frame requires exact living-roster assignment coverage, one runner or one retriever per available team, unique support slots, finite destinations and living allied/hostile tactical references. Inactive phases require cleared assignments. Existing checks validate throw paths and blocked candidates against independent ground footprints, exact respawn delays and shields, live pickup requests, carrier health/weapons, actual goal plates, preserved spawn placement and combat credit. Full-frame roster identities/team sizes stay constant, and every bot must move, receive a role and receive a fresh role after reset. Both teams must attack; all recorded deaths must revive before the trace ends. A thirty-minute simulated cap requires a two-goal win, followed by at least 181 terminal updates with stable score and cleared possession/assignments; observation extends through the last committed-impact death plus its full 181-update respawn delay. Two exact full-trace repeats cover a main carrier on each map.

The shared complete-match validator's type constraint now allows callers to provide their own scenario metadata; its runtime assertions are unchanged. The shared roster fixture accepts a supplied map and preserves the earlier bounded cases. Compact `rosterMatchTraces` and their failures enter protocol `live-functions-vs-headless-step-v46`. Both test commands register the new test file. Paired totals remain 6,027 traces / 980,748 frames; these matches are separate live evidence. Headless autonomous decisions, mixed-player execution, calibrated performance, broader tuning and held-out quality remain open. Human testing stays deferred and attached implementation plans are unchanged.

The first full default-combat matrix passed 34/35 tests, including both exact repeats. The red, forward-order, main-carrier 3v3 stadium case exposed an observation-window error: match end occurs at tick 6123, but already-committed impacts cause deaths at ticks 6131 and 6134. The fixed 181-update terminal window stopped at 6304, before their valid revival deadlines. The fixture now observes through `max(matchEndTick, lastDeathTick) + 181` for this larger-roster continuation only; it still forbids new inactive-phase attacks and requires stable goals and cleared possession/assignments. The case explicitly preserves both late deaths and requires revivals on ticks 6312 and 6315, ending 192 ticks after match end. No gameplay suppression or skipped death is used. Earlier continuation windows are unchanged. Preliminary evidence and focused results were retained under `output/m7-roster-match-preliminary-*`; final matrix and evidence reruns use the corrected observation window.

Final verification: **35/35 new tests passed** in 401.3 seconds, including both exact repeats (`output/m7-roster-match-focused.log`). **240/240 affected existing roster, pass-recovery, earned-tank, opposed, revival and complete-match tests passed** in 112.5 seconds (`output/m7-roster-match-regressions.log`). These existing regressions ran before the final larger-roster-only observation adjustment; their runtime branches are unchanged by that adjustment. Combined, **275/275 targeted tests passed**, with no failures, cancellations or skips in the final selections. The isolated late-impact check also passed; its 34 deliberately filtered tests are not counted again. Final TypeScript and scoped diff checking pass.

Saved and reparsed evidence (`output/m7-roster-match-evidence.json`) contains **32 completed matches / 492,785 frames, zero failures, 200 passes (168 after resets), 76 goals, 44 resets, and 2,249 deaths matched by 2,249 revivals**. The longest trace was 41,929 updates (698.8 simulated seconds), within the cap; match pacing is not accepted by this result. Nonfinite numbers and signed zero are preserved with explicit `$number` records and restored for exact comparison with the in-memory evidence. The summary is `output/m7-roster-match-summary.json`. Source identity: base commit `7238886b5cf96443885e978c9e3646af43743aa1`, dirty working-tree hash `f6b547d40765823b976aafbdcb8bd28cece654c2cf87ac8c56c4d79369f93c9a`.

The full aggregate acceptance gate, unrelated repository tests, production build and browser play were **not rerun** for this fixture-only slice; earlier aggregate results are not relabeled as current-source acceptance. The new aggregate assertions are separately checked against the saved current-source 32-match evidence. M7 remains inconclusive. The next planned slice is mixed player/bot execution parity. These changes remain uncommitted; human testing stays deferred.

The saved verification manifest is `output/m7-roster-match-verification.json`. Its comparison with preliminary evidence confirms that 31 traces are exactly unchanged; the affected trace adds only eleven observation frames and the two expected revivals, preserving its original death events. The final source fingerprint matches the saved evidence.

## 2026-09-29 — shielded opposing player/bot flights

The complete larger-roster slice was committed as `0cc97ef`. This slice adds **384 paired five-second encounters / 115,200 frames**. Six profiles give the local player, roster bot or both a shield that either lasts through contact (one second) or expires beforehand (0.05 seconds). Both initial contact geometries, matched one-/two-HP actors, trades enabled/disabled, main/ordinary bot identity, mirrored teams and reversed simulator storage are covered. The live update contract always runs player physics before roster physics; reversing storage does not reverse that contract. Attacks are committed through production actions at the authored start; no autonomous selection is claimed.

The first probes exposed two real defects. Local lunge physics returns before normal horizontal movement, leaving the player's shield timer frozen throughout flight. The live flight owner now decrements it exactly once before contact, including frames where the flight ends. Separately, sword-lunge trades applied reciprocal damage even when the initiating attacker remained shielded. Live player and roster flight resolution, and their versioned headless counterparts, now resolve those contacts as ordinary hits. The unprotected defender takes damage; the protected attacker does not. Once protection expires, normal trade eligibility resumes. This correction covers sword-lunge contact, not a blanket audit of every damage path.

Independent expectations check every frame's health, shield countdown, flight state, death/kill credit, revival boundary and occupied-spawn placement on both sides of the comparison. Recovery checks require the player to remain unavailable until the correct ready frame. The grounded geometry pins mutual contact at tick 5 or 4. A shielded roster target causes the player's existing target-selection rule to end flight on tick 1; roster contact then occurs at tick 8 or 7 after expiry, or its flight ends at the travel limit if both remain protected through the encounter. These distinct actor rules are preserved rather than normalized. Lethal cases cover the same-frame roster respawn timer advance after player contact, next-frame advance after roster contact, player-first spawn arbitration and post-revival shield countdown.

Twelve JSON snapshot continuations cross pending contact or revival, and six exact full-trace repeats check deterministic execution. Twenty extra direct live checks exercise active protection and exact-frame expiry against sword and hammer counters across registered/legacy main AI, missing main lookup, ordinary bots and the local multiplayer hit-message path. Remote damage still awaits acknowledgement; these checks do not certify relay/server authority. The initial four remote-test failures were missing Node `WebSocket.OPEN` fixture setup; the tests now install and restore that browser constant like the existing multiplayer tests.

`shieldedFlightTraces` and failures are registered in aggregate protocol **`live-functions-vs-headless-step-v47`**, with both test commands and the README updated. Registered paired coverage is now **6,411 traces / 1,095,948 frames**. This slice does not close airborne/moving/carrier opposing encounters, broader mixed maps/spawns, autonomous player/bot decision integration, swept contact, calibrated performance or held-out tactical quality. M7 remains **inconclusive**, and human testing stays deferred. Attached implementation plans were not changed.

Verification: the existing lunge, trade, lifecycle, round-flight and simulator regressions passed **2,138/2,138 tests** (`output/m7-shielded-flight-regressions.log`, 21.6 seconds). The final new family plus expanded direct player-lunge file passed **618/618 tests** (`output/m7-shielded-flight-final-tests.log`, 9.5 seconds). Accounting for the 195 existing direct tests repeated in both selections, **2,561 distinct targeted tests passed**, with no failures, skips or cancellations in the final selections. Final TypeScript passes with an 8 GB heap; the first default-heap attempt exhausted Node memory. The production Vite build passed in 28.3 seconds with the existing large-chunk warning. Scoped diff checking passes. The full aggregate acceptance gate, unrelated repository tests and browser play were not rerun; earlier aggregate results are not relabeled as current-source certification.

Saved and reparsed evidence (`output/m7-shielded-flight-evidence.json`) confirms **384 traces, 115,200 validated frames, zero differences, 120 player deaths and 88 bot deaths**, including checked revival of every lethal case. All frames are validated before retaining 6,336 boundary samples and full-trace SHA-256 digests. Nonfinite numbers and signed zero round-trip through explicit `$number` records; the saved structure exactly matches the in-memory evidence. The summary is `output/m7-shielded-flight-summary.json`. Source identity: base commit `0cc97ef311dc3ea95b68f61def6584fb1bc2f8ba`, dirty working-tree hash `8ae3705103765d8785cc4c22c37c8d4bca99f74b57cf8102041463d701786f02`. The verification manifest is `output/m7-shielded-flight-verification.json`.

This new slice remains uncommitted. The next bounded mixed-execution slice is airborne opposing flights; broader integration and quality gates remain after it.

## 2026-09-29 — airborne opposing player/bot flights

The shielded-flight slice was committed as `0c3f6c1`. This slice adds **512 paired encounters / 153,600 frames**. Eight starts cover a rising player, rising/falling roster bot, overhead miss, both initially airborne, upward commitment, retained upward momentum and downward overshoot. Both contact geometries, matched one-/two-HP actors, trades enabled/disabled, main/ordinary bot identities, mirrored teams and reversed simulator storage are included. Production actions commit both attacks; production player physics grounds the player, while roster flight retains its committed vertical velocity. Falling starts use a downward direction so the existing commitment rule does not replace downward momentum with zero.

An independent fixed-step ballistic formula (gravity 18, 60 Hz) and three-dimensional sampled contact schedule check both execution paths. Player contact sees the previous roster pose; roster contact sees both current poses. Checks pin per-frame health, flight state, deaths/credit, survivor altitude and landing, stopped horizontal flight, exact reload and player readiness, and lethal revival boundaries. Sixteen JSON continuations cross pending contact or revival; eight exact full-trace repeats exercise persistence and determinism. The shared fixture now uses the real engagement gravity prelude after flight and captures roster velocity/cooldown; existing grounded families retain their earlier behavior.

The rising and upward-commit probes found a live defect: a bot surviving a player-initiated trade had its flight flag cleared but retained its full horizontal/upward velocity and `LUNGING` state. Subsequent gravity updates continued the drift without sword reload. The live player-trade owner now stops horizontal flight, cancels positive vertical momentum, preserves falling velocity and enters `COOLDOWN` with the configured sword reload. Mixed headless execution mirrors that finish. Twelve direct tests cover rising, falling and grounded survivors across registered/legacy main AI, ordinary bots and missing main lookup. Dead actors retain the existing death/respawn path. This does not claim a full audit of pressure/combo or model-observation callbacks.

`airborneFlightTraces` and failures enter aggregate protocol **`live-functions-vs-headless-step-v48`**. Both test commands and the README are updated; registered paired coverage totals **6,923 traces / 1,249,548 frames**. The new matrix's **537/537 tests** passed, and the final combined lunge, motion, trade, mixed lifecycle, shield, round-flight and simulator selection passed **3,335/3,335 tests** with no failures, cancellations or skips in 24.5 seconds (`output/m7-airborne-flight-regressions.log`). Final TypeScript passes with an 8 GB heap. The production build passed in 17.3 seconds with the existing chunk-size warning, and scoped diff checking passes. The full aggregate gate, unrelated repository tests and browser play were not repeated; this is targeted evidence, not full M7 acceptance.

Saved and reparsed evidence (`output/m7-airborne-flight-evidence.json`) contains **512 traces, 153,600 validated frames, zero differences, 136 player deaths and 104 bot deaths**. All frames are checked before retaining 7,744 boundary samples and full-trace hashes. Explicit `$number` records preserve nonfinite values and signed zero for exact round-trip comparison. Source identity: base commit `0c3f6c14a426ba9c6c0493ca1c3c80ff42036119`, dirty working-tree hash `6640d3b2a471f5198e3783afa613aa4ea77c1d292a5a329389ac168a54c13eaa`. Summary and verification are `output/m7-airborne-flight-summary.json` and `output/m7-airborne-flight-verification.json`.

M7 remains **inconclusive**. These authored two-actor fights do not certify moving/carrier multi-actor encounters, obstacle interactions, autonomous selection, multiplayer authority, calibrated performance or held-out tactical improvement. Human testing remains deferred; attached plans are unchanged. The next slice extends mixed execution to movement and carrier fights.

## 2026-09-30 — moving local-player carrier combat (aggregate verification pending)

The airborne slice was committed as `f663d4d`. This slice extends the existing real frame/objective fixture to **864 paired local-carrier encounters / 103,680 frames**. The player keeps moving while facing the attacker and requesting a punch through the production pointer-input handler. Retreat, cross and approach motion, 100/130-percent speed, one-/two-HP runners, short/long punches, no incoming attack, slash, lunge, shielded-enemy and no-counter controls cover ordinary/main attackers, mirrored teams and reversed roster storage. The AI runner's existing pause-through-impact contract remains separate from unrestricted local input. No production gameplay source changes in this slice.

Independent calculations check player displacement on every living/death frame and the standing punch sphere (eye height 1.65, body center .825, forward reach 1.8, radius 1.5). They require the expected hit or miss at frame 8/26, damage at incoming contact, cancelled lethal punches, continuous survivor movement, dropped possession and conserved kill/death credit. Local movement runs before incoming roster flight regardless of storage order. Six JSON continuations cross the pre-attack checkpoint and three exact full-trace repeats check deterministic execution. The traces end at two seconds, before revival; no full-match or autonomous local-input claim is made.

The focused family passed **874/874 tests**. Existing frame/objective, charge, crowd, carrier recovery, AI runner and new local-runner regressions passed **2,608/2,608 tests** in 16.5 seconds (`output/m7-player-runner-regressions.log`). TypeScript initially found an insufficiently narrowed union around the optional fixture `counters` field. A property-presence guard now keeps missing counters as failing evidence; final TypeScript and a repeat of all **874/874 focused tests** pass (`output/m7-player-runner-final-tests.log`, 12.3 seconds). No production build was repeated for this fixture-only change; the preceding runtime slice's build remains recorded separately.

`playerRunnerTraces` and failures enter aggregate protocol **`live-functions-vs-headless-step-v49`**. Both test commands and README are updated. Registered paired totals are **7,787 traces / 1,353,228 frames**. Saved/reparsed evidence (`output/m7-player-runner-evidence.json`) validates all 103,680 frames before retaining 10,368 samples and full-trace hashes. It contains **zero differences, 336 player deaths, 112 enemy deaths, 768 counter requests and 152 cases with actual punch damage**. Signed zero/nonfinite values use explicit `$number` records for exact round-trip comparison. Final source identity: base commit `f663d4d1b995a646f60cd38ac9ba6ad0a7f43535`, dirty working-tree hash `6004b5c4102941b3d49221eca88e6fa2d61d37b0af782ccfd29a97bf7d0b37f7`. Summary: `output/m7-player-runner-summary.json`.

The full aggregate gate is running in `output/m7-mixed-combined-aggregate.log` to cover the combined shield, airborne and moving-runner work alongside every prior registered family. It started before the final optional-counter type guard; that guard leaves all 864 actual runner results unchanged, as the final focused run and regenerated evidence verify. The aggregate result is pending and is not yet claimed as passing. The fixture slice is committed with the passing focused/typecheck evidence above; this still-running broad regression is explicitly pending and will be recorded separately when it finishes. M7 stays **inconclusive**, human testing stays deferred, and implementation plans are unchanged. Moving multi-attacker fights, broader mixed execution/decisions, calibrated performance and held-out quality remain automated work.

## 2026-09-30 — moving carrier under two-attacker focus fire

Moving local-carrier combat was committed as `5e0b989`. This slice adds **152 paired encounters / 18,240 frames** through the same production frame, movement, pointer input, weapon, impact and objective owners. A main AI and an ordinary bot commit all four slash/lunge combinations from a shared origin. Retreat, cross and approach motion, one/two/three carrier HP, mirrored teams and reversed roster orders exercise phase ordering and damage consumption. Eight additional controls cover no punch, protected enemies, surviving enemies and a long punch. Starts and attack requests are authored; this does not certify autonomous spacing or useful team-tanking decisions.

An independent contact schedule places roster flight before skeletal melee within a frame and preserves roster order within a phase. It predicts same-frame double damage, staggered contact against a retreating runner, the single credited killer, death-cancelled punches, possession release and the carrier's displacement. The standing punch sphere independently predicts both-enemy hits or misses. Every frame checks health/deaths/credit for all three participants, plus carrier movement and ownership. Six JSON continuations cross the pre-commit checkpoint, and three exact repeats check deterministic execution. No production gameplay source change was required.

The new **162/162 tests** passed in preliminary isolation. Final combined frame/objective, charge, crowd, recovery, AI/local runner and focus-fire tests passed **2,770/2,770**, with no failures, cancellations or skips in 19.1 seconds (`output/m7-focus-fire-regressions.log`). Final TypeScript and scoped diff checking pass. Both test commands register the family; `focusFireTraces` and failures enter protocol **`live-functions-vs-headless-step-v50`**, bringing paired totals to **7,939 traces / 1,371,468 frames**. The preceding protocol-v49 aggregate continues in its original process; it does not include this new family. No second aggregate, production build, browser play or unrelated repository-wide run was launched for this fixture-only slice.

Saved/reparsed evidence (`output/m7-focus-fire-evidence.json`) validates all 18,240 frames before retaining 1,824 samples and full-trace SHA-256 hashes. It contains **zero differences, 96 player deaths, 64 enemy deaths, 32 double-kill punches and 150 punch requests**. Tagged special-number records preserve signed zero and nonfinite values. Summary and verification files are `output/m7-focus-fire-summary.json` and `output/m7-focus-fire-verification.json`. Source identity: base commit `5e0b98932beb7cd6dc554cdb043842ceb0b98b9a`, dirty working-tree hash `947d59b267d3772d875131d786e0fd3561bf3128c6f18ec9f22d7ddac0b3daac`.

M7 remains **inconclusive**. These grounded two-second fights end before revival and do not close broader mixed execution/decisions, geometry, calibrated performance or held-out quality. Human testing remains deferred and attached plans are unchanged. Next, bound aggregate trace retention while preserving every check, failure and rerunnable full trace; the current aggregate retains several gigabytes of frame evidence while running its long match batches.


Aggregate follow-up: the original protocol-v49 process completed successfully, **10/10 gate tests** with no failures, cancellations or skips in **1,491.7 seconds** (`output/m7-mixed-combined-aggregate.log`). It reran every family registered through the moving-player slice and retained the expected inconclusive M7 verdict. This resolves the pending combined shield/airborne/moving-runner regression result; it does not include protocol-v50 focus-fire cases or the later retention changes.

## 2026-09-30 — bounded aggregate frame evidence

The focus-fire slice was committed as `4f3bca1`. Aggregate evidence previously retained every frame from 39 paired/live families throughout the long full-match batches; the preceding process was observed retaining roughly 6.9 GB. Protocol **`live-functions-vs-headless-step-v51`** now compacts each of those families after its existing checks complete. Healthy long traces retain eight evenly spaced frames. First/last frames and available failure context receive priority up to a 32-frame cap; histories of at most 32 frames retain all frames. Exact full-history counts are stored as `frameCount`, and streaming SHA-256 calculation fingerprints every frame before discarded samples become collectible. This changes retained evidence, not the scenarios, tolerances, gameplay or gate verdict requirements.

Sampled JSON explicitly represents signed zero, nonfinite numbers and undefined values rather than silently normalizing them. Failure counts/details and other metadata remain intact; existing compact full-match families keep their event/final-frame contracts. Direct trace runners still return full histories. Aggregate assertions now check full validated counts, bounded samples and fingerprints rather than incorrectly treating retained samples as the number of frames tested. Both Node test commands include the new helper tests, and README documents the report format.

Four meaningful helper regressions check failure-context retention, a large failure list against the cap, immutable input, stable empty/short histories, exact JSON round-trips, different fingerprints for special scalar values, a changed omitted frame affecting the fingerprint, and repeatable real focus-fire evidence. The initial combined helper/focus-fire/moving-runner/execution selection passed **1,077/1,077 tests** in 13.6 seconds (`output/m7-parity-evidence-regressions.log`), and TypeScript passed. Reducing healthy long histories from 32 uniform samples to eight was followed by another **4/4 helper tests**; final TypeScript also passed, recorded separately in `output/m7-parity-evidence-final-types.log`.

The saved/reparsed real-family probe (`output/m7-bounded-evidence-probe.json`) contains **152 traces, 18,240 validated frames, 1,216 retained frames and zero differences**. Trace JSON fell from **34,255,853 bytes to 2,401,241 bytes**; this is a storage measurement for this family, not a calibrated gameplay performance claim. Source identity: base commit `4f3bca147a5b9909bc736d0dd27015544fc5c4d1`, dirty working-tree hash `c992024a6b046fa23745f88b3bfcc7e355856cec1d55f1f69cd8d03cfa11e24c`. The summary is `output/m7-bounded-evidence-summary.json`.

A fresh full aggregate passed **10/10 tests**, without failures, skips or cancellations, in **1,231.2 seconds** (`output/m7-bounded-parity-aggregate.log`). It includes focus fire and every prior registered family, validates the retained-frame contract, and preserves the expected inconclusive M7 verdict. The process's observed peak working set was approximately **3.59 GB**; this is a process observation, not a calibrated gameplay performance result. The run loaded the retention slice before subsequent respawn-observation changes, so it does not certify those later changes. M7 remains **inconclusive**; human testing remains deferred. Continue with the actual mixed execution/decision and acceptance gaps.
