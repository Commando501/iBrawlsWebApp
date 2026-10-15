# Grifball team intelligence implementation plan

## Goal and delivery boundary

Make offline Grifball bots play a coordinated possession game: recover the ball,
create space, protect a runner, convert openings into goals, and defend turnovers.
Ship each milestone as an independently testable change. Milestone 1 establishes
scripted team positioning; it does not claim advanced tanking or trained-policy
improvements. Keep the existing AI advancement and reinforcement-learning plans intact.

Delivery order: milestone 1 -> milestone 1.5 (AI Lab) -> milestones 2 through 7.
Complete the AI Lab foundation before expanding the tactical systems in milestone 2.
The lab described below is planned work; the current diagnostics overlay is read-only.

## Architecture

`match snapshot -> team assignments -> tactical movement/target constraints -> combat -> actions`

- Pure TypeScript planning in `src/game/`, independent of React and Three.js.
- One copied snapshot before the roster acts; no decision depends on bot update order.
- Per-match planning memory in `AIMatchContext`, reset with match/round lifecycle.
- Plans refresh at a bounded cadence, immediately on possession/roster/phase changes.
- Assignments persist across ordinary movement; deaths, turnovers and unreachable
  responsibilities invalidate them. Later utility improvements require a meaningful
  advantage before switching, with event overrides for urgent goal danger.
- Humans and neural bots are observed, never commanded by the scripted coordinator.
- Actual mechanic settings determine movement and combat execution. Tactical logic
  must not grant extra reach, faster reloads, hidden enemy intent, or extra health.
- Replay/network/save schemas remain unchanged unless a later milestone explicitly
  needs a versioned extension. Current offline AI execution remains the authority.
- Keep tactical configuration separate from per-match memory. Each implemented
  module owns typed settings, defaults, validation and diagnostics consumed by the
  AI Lab. Use the same resolved configuration in the planner and its test harness.

## Milestone 1 — Coherent positioning

Deliver a shared snapshot and stable, distinct jobs for scripted bots. Select one
loose-ball retriever per team; others screen and cover. Recognize a human/non-scripted
teammate already collecting the ball without relying on an idle human to act.
For friendly possession assign lead, cover and safety support around the carrier;
for opposing possession assign pressure and goal-side coverage. Scale down with
roster size, remove dead/despawned players, and allocate extra slots distinctly.

Replace the per-bot escort index bug and unconditional loose-ball swarm. Evaluate
support movement before generic combat selection. Permit fights against immediate
self threats and threats in the assigned coverage area; unrelated nearby enemies
must not pull everyone away. Preserve committed movement, airborne physics, attack
recovery and weapon cooldowns. Use arrival slowing and existing ally separation.

Expose role, destination, relevant target and assignment reason in debug mode.
Include pure scenario tests and live-runtime integration tests in `npm test`.
Update README with the shipped scope and neural limitation.

Acceptance scenarios:

1. Loose ball: exactly one scripted retriever on each all-bot team; teammates spread.
2. Human carrier: distinct lead/cover/safety destinations, independent of roster order.
3. Nearby distraction: an escort continues coverage instead of pursuing a remote duel.
4. Relevant threat: an escort uses normal combat against a threat within its responsibility.
5. Turnover/death/respawn: assignments refresh without waiting for periodic replanning.
6. Stable play: small position changes do not continuously swap responsibilities.
7. Countdown/scored/end, observer, mixed controller and non-Grifball cases remain valid.
8. Runtime: bots do not freeze at destinations, cancel jumps, or skip attack recovery.

## Milestone 1.5 — Grifball AI Lab

Build a dedicated offline control panel for tuning, inspecting and comparing the
modular tactical systems. Provide an entry from the AI Behavior Editor and an
in-match pause-menu entry. The panel must be usable while observing a match, with
clear controls for resuming, pausing, stepping and restarting a scenario.

### First delivery: controls for the systems already implemented

Expose a small set of useful controls for milestone 1: role priorities, assignment
refresh interval, reassignment advantage threshold, escort forward/lateral offsets,
safety distance, teammate separation, arrival slowing, threat engagement distance,
and the boundary beyond which a bot returns to coverage. Add assignment persistence
controls where supported by the underlying policy; do not present inert controls.

Every control includes its units, valid range, default and a short explanation of
the gameplay effect. Show whether it applies to both teams or a selected team.
Resolve configuration as defaults plus explicit team overrides; do not add per-bot
overrides in this milestone. Validate edits before applying them, and apply a complete
configuration at a simulation-tick boundary. Mark any option that requires a restart.
Changing tactical settings must not bypass weapon cooldowns or alter combat mechanics.

Provide live editing, per-module reset, reset-all, named local presets, and validated
JSON import/export with a schema version. Keep the lab's presets separate from
existing combat-AI presets and account/cloud saves. Show unsaved changes and the
active preset. Module enable/disable controls must state their fallback behavior;
dependent modules must use a valid fallback or be disabled together. Turning off a
module must clear its stale decisions rather than leave bots following old orders.

### Module panels added as behavior ships

| Module | Controls | Visual diagnostics | Delivery |
| --- | --- | --- | --- |
| Team roles | Priorities, reassignment threshold, persistence and refresh cadence | Current role, assignment reason, role changes | 1.5 |
| Spacing and threats | Support offsets, separation, coverage boundaries; later danger/support weights | Destinations, coverage areas, relevant threats; later danger estimates | 1.5 foundation, expanded in 2 |
| Runner and escort | Route preferences, waiting limits, retreat thresholds and escort positions | Candidate routes, selected route, screen/interception points | 3 |
| Tanking | Commitment, double-team thresholds, trade value and disengagement rules | Engage/cover assignments and reasons for committing or releasing | 4 |
| Defense and passing | Pressure/containment balance, safety positioning and passing risk | Defensive coverage, interception points and pass candidates | 5 |
| Styles and adaptation | Aggression, patience, bounded variation and adaptation strength | Active style, observed tendencies and adaptation confidence | 6 |

Later modules appear as clearly labelled roadmap items until their behavior ships;
they must not appear adjustable before they work. Each later milestone includes
its panel, validated configuration, meaningful diagnostics and scenario coverage
as part of its acceptance criteria. Keep advanced weights collapsed by default.

### Inspect and repeat a play

Select a bot or team to inspect its role, destination, relevant threat and decision
reason. Draw destinations, coverage boundaries and assignment lines in the arena;
allow these overlays to be toggled independently. Keep a bounded recent-decision
history so a role change or lost assignment can be inspected after it happens.

Provide initial scenario presets for contested pickup, human-runner escort,
possession turnover and outnumbered defense. Each preset records the map, roster,
positions, possession, mechanic settings, tactical configuration and random seed.
Pause must stop simulation time; single-step advances exactly one simulation tick
while refreshing diagnostics. Restart restores initial state, timers and AI memory.

Repeatability requires a seeded random source for every decision exercised by a
scenario, including existing combat randomness, and a fixed simulation timestep.
Use recorded or scripted inputs for automated comparisons. Interactive human play
is exploratory unless the same inputs are replayed; sharing a seed alone does not
make two human-controlled runs equivalent.

### Compare configurations

Allow a saved configuration to be pinned as the baseline and a working copy to be
run against the same scenario, seed and input sequence. Start with sequential A/B
runs and a compact comparison view showing configuration differences, goals,
possession losses, time outside assigned coverage, role changes and stuck time.
Define each metric and its denominator; keep missing metrics visibly unavailable.
Show run duration and seed so a single result is not presented as a general win-rate
improvement. Preserve baseline settings when editing the candidate configuration.
Milestone 7 extends this same harness to batches, mirrored teams, multiple opponents
and confidence intervals rather than introducing a separate evaluation tool.

Acceptance criteria:

1. A role or spacing control changes actual bot behavior without editing source code.
2. Invalid values are rejected; resets restore defaults; saved presets round-trip.
3. Team-specific tuning affects only that team and is visible in the resolved settings.
4. Pause, single-step and restart preserve correct simulation timing and reset memory.
5. Identical scripted inputs, configuration and seed reproduce the scenario outcome.
6. Selected-bot diagnostics explain assignments and show coverage during combat.
7. Disabling a module exercises its documented fallback without stale assignments.
8. A/B results retain both configurations and expose the metric definitions and seed.
9. The panel and overlays remain readable and responsive with the largest supported
   roster; diagnostic history is bounded and disabled overlays avoid rendering work.
10. Automated configuration/scenario tests and a browser interaction check pass.

## Milestone 2 — Space and threat model

Add observable velocity, attack phase/readiness and movement constraints to threat
evaluation. Score candidate field positions by estimated enemy arrival/attack time,
allied support time, shared attack exposure, goal progress and escape space. Derive
distances from current mechanics. Represent blocked/custom-map routes explicitly;
clamping an unreachable destination is not pathfinding.

Acceptance: avoid shared hammer exposure, stay within useful support distance,
reject blocked routes and remain stable at walls and goal plates. Profile planning
cost on the largest supported roster; cache geometry separately from moving threats.

## Milestone 3 — Runner routes and coordinated escort

Choose short candidate routes for the runner; compare advance, cut, wait, retreat
and finish. Assign screens to the intended route and interception points, including
rear pursuit. Let a runner wait briefly for coverage but enforce progress/timeouts
to avoid passive deadlock. React to a human runner's observed heading and velocity.

Acceptance: escorts clear a lane, the runner uses it, support advances after a
breakthrough, and a blocked push changes route without frame-to-frame oscillation.

## Milestone 4 — Tanking and engagement coordination

Score engagements by possession protection, route opening, delay, trade value and
coverage lost. Coordinate engage/cover/punish rotations and deliberate two-player
commits. Release an engagement after its tactical purpose is complete. Integrate
with existing combat coordination instead of stacking conflicting target owners.

Acceptance: two bots commit only when useful; recovery is covered; a runner breaking
through ends irrelevant duels; outnumbered defenders can delay instead of feeding.

## Milestone 5 — Defense, transitions and passing

Replace basic goal-side coverage with predicted interception, containment, marking
and last-defender protection. Handle numerical advantage/disadvantage and respawn
timing. Add pass/receive decisions using the existing throwing rules and trajectory
physics, receiver availability and interception risk; obey throwing-disabled settings.

Acceptance: defend cuts rather than only following the carrier, recover after a
turnover, maintain last-defender coverage, and avoid passes without a viable receiver.

## Milestone 6 — Styles and adaptive tactics

Introduce persistent, bounded preferences for patient/aggressive tanks, width,
support distance and runner risk. Use seeded variation among similarly useful plays,
not random per-frame role switching. Difficulty controls reaction/perception and
decision quality while retaining coherent team responsibilities. Adapt to observed
opponent tendencies with per-match reset and explicit confidence thresholds.

Acceptance: styles are recognizable in repeatable scenarios, all remain objective
focused, and easier teams remain understandable without mechanic advantages.

## Milestone 7 — Evaluation and optional learned integration

Create a shared live/headless adapter for the same tactical contracts before using
the planner as an RL teacher or hierarchy. Version any new observations/actions;
retrain policies that consume role/route/coverage inputs. Existing neural policies
currently bypass scripted objective code and must not silently receive a different
execution model from their training environment.

Build seeded scenario and match batches, mirrored teams/spawns, and multiple opponent
styles. Compare against a frozen baseline with confidence intervals. Track goals and
turnovers per possession, goal prevention, time without coverage, shared exposure,
role churn, stuck time and planning cost. Do not optimize kill count as the objective.
Track spacing only when tactically relevant so metrics do not reward passive play.

Acceptance: live/headless parity tests pass; improvement generalizes across seeds,
maps and opponents; human playtests confirm readable and enjoyable behavior. Neural
integration remains optional until these gates are met.

## Verification and rollout

- Every milestone: focused deterministic tests, repository typecheck and full tests;
  production build for runtime changes, followed by browser playtest where available.
- Use debug roles/targets to diagnose behavior before adding more tuning parameters.
- Exercise 1v1, uneven rosters, all-bot observer play and human-runner play. Include
  death during a push, thrown balls, goal resets, paused games and custom maps.
- Record measured results separately from this implementation plan. Automated
  geometry/assignment tests establish correctness, not match win-rate or fun.
- Use the AI Lab from milestone 1.5 for tuning and repeatable baseline comparisons.
  Ship each later module with its lab controls, diagnostics and scenarios; expose
  meaningful gameplay settings rather than every internal constant.
