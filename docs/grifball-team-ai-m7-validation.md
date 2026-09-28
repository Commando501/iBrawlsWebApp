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
