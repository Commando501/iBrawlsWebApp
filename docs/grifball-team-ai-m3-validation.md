# Grifball Milestone 3 validation

Validated locally on Windows on 2026-09-26, on `codex/grifball-team-tactics`.
The implementation roadmap is unchanged. Changes remain in the working tree alongside milestones 1, 1.5 and 2.

## Implemented

- The carrier compares short advance, left/right cut, coverage wait, retreat and goal-finish routes using reachable ground paths, visible attack times, allied arrival and goal progress.
- Commitment and score hysteresis stabilize routes. New obstacles or materially safer routes can invalidate a commitment. Wait and retreat budgets, plus a net-progress timeout, prevent indefinite hesitation. Only actual net goal progress replenishes patience.
- Escorts screen along the selected route, leave space around the carrier corridor and receive distinct nearby interception targets. Safety covers rear pursuit; when a short-handed team has no safety slot, its last escort covers rear pressure.
- Support advances with a breakthrough. Human and neural carriers supply observed velocity/facing; they receive no scripted movement orders.
- Runtime movement follows selected routes while preserving attack cooldowns and committed airborne/dash/slide actions. The existing combat executor still handles fights.
- Runner / escort in the AI Lab has a per-team enable switch and 14 numeric controls. Advanced weights are collapsed by default. The inspector exposes route scores, relative risk, reasons, wait/stall time, escort targets and interception points; overlays show runner routes and escort points.
- Added lane-pressure, rear-pursuit and coverage-rendezvous scenarios, runner waiting time and action-change metrics. Schema-v1/v2 presets migrate to v3 while preserving existing settings and team overrides.
- README reflects the new behavior and controls.

## Automated verification

- Final TypeScript check passed: `node --max-old-space-size=12288 node_modules/typescript/bin/tsc --noEmit`.
- Final production build passed; existing large-chunk advisory remains.
- Final gameplay/component suite: **412 passed, zero failed**. It excludes V3 and animation-specific tests and includes the final short-handed rear-coverage correction.
- New milestone coverage includes clear advance and goal finish, support after breakthrough, pressure cuts, stable commitments, bounded waits and retreats, solo carriers, unique escort targets, rear pursuit with one/two/three escorts, human velocity/facing, obstacle invalidation, disable/throw/death/round resets, preset migration, runtime steering/cooldown preservation and deterministic scenario restart.
- Full package test script: **1,357 passed / 1,362 tests, five failed assertions**. This run started before the final short-handed correction and its additional test; the final gameplay suite, typecheck and build were rerun afterward.
- The five failures match the milestone-2 results in unchanged V3 areas: `v3AnimationFidelity` two-handed hammer pose; `v3WeaponMotionTracks` carry grip transforms and windup amplitude; `v3AssetManifest` default character budget; `v3ReferenceProportions` Aegis proportion gates. The full repository suite is not green.
- `git diff --check` reported no whitespace errors.

## Browser verification

Used the in-app browser at `http://localhost:3000/`, V1 models, Championship Stadium, seven scripted bots and seed 1.

- Both editor and pause-menu Lab entry points worked. Runner controls, collapsed advanced weights, candidate inspector and route overlays were visible.
- With the human observing, blue has only two escorts. In Rear pursuit, `bot_6` retained its cover slot but received a rear-guard order targeting `main_ai`, with a destination behind the carrier.
- Identical configurations in Rear pursuit, 3 seconds each: all metrics matched; zero goals, zero possession losses, zero stuck/blocked-route time, 2.98 shared-exposure bot-seconds and zero runner action changes.
- Goal approach selected `finish` with destination `(47, 0)`. Identical A/B configurations over 3 seconds each both scored one goal, with zero possession losses, stuck time or blocked-route time.
- Join runner changed the inspector to `Carrier player: observed` / `Screen observed carrier heading`, with escorts and no runner movement assignment.
- Disabling blue's runner module removed its runner plan immediately on the next step. Clearing the override restored the module. Test overrides were cleared.
- Lane-pressure inspection showed advance and both cut scores, unavailable wait/retreat candidates and the selected route overlay.
- At a 390 px viewport, the panel occupied x=0 through x=390 with no horizontal document overflow. The temporary viewport override was reset.
- No JavaScript console errors observed. The Lab tab is left open, paused on Runner lane pressure.

These short checks verify integration and repeatability, not a general win-rate or match-quality improvement. Custom-map route changes and human velocity are covered by deterministic tests; extended human and authored-map playtesting remains useful for tuning.

## Planning cost

Reproduce with `npm run bench:grifball-space`. The benchmark now includes a scripted ball carrier, seven bots plus a human in the supported case, and 32 participants as extra stress. It runs one initial and 60 subsequent planning refreshes with all tactical modules enabled. These are local wall-clock refresh costs, not frame times or performance guarantees.

| Participants | Obstacles | Initial ms | Median ms | P95 ms | Maximum subsequent ms |
| --- | --- | ---: | ---: | ---: | ---: |
| 8 | No | 20.00 | 2.32 | 3.79 | 5.77 |
| 8 | Yes | 89.85 | 13.75 | 20.54 | 25.08 |
| 32 | No | 23.60 | 21.23 | 30.09 | 31.50 |
| 32 | Yes | 90.01 | 106.10 | 191.16 | 212.69 |

Runner and space scoring share lazy per-participant routers. Static geometry remains cached. Obstacle planning can exceed one 60 Hz frame despite the default 5 Hz refresh cadence; expanding the live roster needs further scheduling/optimization.

## Limits and next milestone

Risk and interception positions are estimates from public observations, not predictions that a teammate wins a fight. Ground routing retains the milestone-2 limits around narrow passages and jump-only platforms. Progress timeout forces a reachable forward attempt; it cannot manufacture a route through a sealed obstacle or guarantee a score. Budgets take effect on the next tactical refresh.

Runner action-change metrics count action switches during a possession, not every endpoint refresh. Waiting counts scripted carrier time assigned to wait. Dedicated tank rotations, deliberate double teams, passing and learned styles remain later milestones.
