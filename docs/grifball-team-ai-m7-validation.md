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
