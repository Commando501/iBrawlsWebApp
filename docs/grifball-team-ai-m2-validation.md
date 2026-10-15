# Grifball Milestone 2 validation

Validated locally on Windows on 2026-09-26, on `codex/grifball-team-tactics`.
This records implementation results; the milestone roadmap is unchanged.

## Implemented

- Visible velocity, weapon phase, animation elapsed time, swap lockout and airborne
  movement constraints feed estimated attack/support times. Hammer dimensions,
  timing, sword lunge settings and movement speeds come from current mechanics.
- Support positions balance formation distance, goal progress, allied support,
  shared hammer exposure, enemy attack time and available escape directions.
  Hysteresis retains a reachable position when alternatives are only marginally better.
- Ground routes explicitly report direct, routed or blocked. Objective movement
  follows reachable waypoints and checks every proposed movement segment, including
  separation/avoidance steering. Thin walls cannot be skipped by sparse sampling.
- Geometry uses current physics footprints, including rounded combatant clearance,
  axis-aligned boxes, cylinders, spheres, vertical overlap and arena boundaries.
  Non-collidable goal plates remain reachable.
- Static navigation grids are bounded and cached independently of moving threats.
  Each planning refresh shares one lazy search per observed participant across candidates.
- AI Lab includes a per-team Space / threats toggle, six tunable fields, candidate
  scores, attack/support estimates, route/candidate overlays, shared-exposure and
  goal-approach scenarios, plus two additional A/B metrics. Schema-v1 presets migrate
  to schema v2 without losing existing settings or team overrides.

## Automated checks

- TypeScript check passed with `node --max-old-space-size=12288 node_modules/typescript/bin/tsc --noEmit`.
- Production build passed (existing large-chunk advisory).
- Gameplay/component suite: **399 passed**, no failures.
- Full package test script: **1,345 passed / 1,350 tests**, five failed assertions
  in unchanged V3 animation/asset areas:
  - `v3AnimationFidelity`: two-handed hammer slam / melee pose assertion.
  - `v3WeaponMotionTracks`: carry grip transforms and hammer windup amplitude.
  - `v3AssetManifest`: default character budget.
  - `v3ReferenceProportions`: built-in Aegis proportion gates.
  These failures are outside the tactical implementation; the full suite is not green.
- Final focused rerun after the geometry broad-phase and wall-contact corrections:
  **17 passed**. Covers thin-wall detours, sealed routes, live waypoint following,
  wall contact/corners, ground height and shape handling, goal plates, 1v1,
  shared-exposure avoidance, support proximity, deterministic/stable destinations,
  per-team disable, preset migration and observable attack timing.
- Existing role/runtime tests cover roster changes, human carriers, uneven teams,
  possession changes, death, phase resets and objective/combat handoff.

## Browser checks

Used the in-app browser at `http://localhost:3000/`, V1 models, Championship Stadium,
seven scripted bots, observer scenarios and seed 1.

- Editor and pause-menu entry points, Space / threats controls, single-step, inspector
  estimates, candidate/route overlays and team overrides worked.
- Disabling only blue's space model restored its formation destination (6.5 m),
  while red retained its scored route. Clearing the override restored blue's scored
  position. Existing local presets loaded through the schema migration.
- Identical configurations in the shared-exposure scenario, 3 seconds each:
  matching results, including 4.42 predicted shared-exposure bot-seconds,
  zero blocked-route time and zero stuck time.
- Identical configurations in the goal-approach scenario, 3 seconds each:
  both scored one goal, with zero blocked-route time and zero stuck time.
- Narrow viewport check: at 390 px, the panel fits exactly within the viewport with no horizontal document overflow. Temporary viewport override was reset.
- No JavaScript errors observed. Existing Three.js warnings about undefined material
  `emissive` values appeared during arena/model construction.

These short runs verify integration and repeatability, not a general win-rate or
match-quality improvement. Custom obstacle routing is covered by deterministic
movement tests; custom-map browser playtesting remains useful for authored maps.

## Planning cost

Reproduce with `npm run bench:grifball-space`. Each case runs one initial refresh
and 60 subsequent refreshes, at the default 5 Hz planning cadence. Numbers are
local wall-clock milliseconds, with the desktop app running; they are not frame
times or a performance guarantee. The obstacle case has a thin box wall and a pillar.

| Participants | Obstacles | First refresh | Median | P95 | Maximum subsequent |
| --- | --- | ---: | ---: | ---: | ---: |
| 8 (supported 7 bots + human) | No | 19.53 | 2.93 | 4.46 | 5.69 |
| 8 (supported 7 bots + human) | Yes | 78.03 | 15.38 | 18.82 | 35.34 |
| 32 (extra stress case) | No | 33.48 | 27.02 | 35.05 | 37.47 |
| 32 (extra stress case) | Yes | 128.09 | 139.00 | 146.03 | 147.91 |

Initial route queries include lazy grid construction; later refreshes reuse geometry.
Obstacle planning can exceed one 60 Hz frame, although it runs at 5 Hz. The 32-player
stress case needs additional scheduling/optimization before expanding the live roster.

## Limits

This milestone models ground navigation. The bounded grid can conservatively reject
narrow passages and jump-only platforms; it never turns that failure into a straight
line through a wall. Threat circles and arrival times are estimates, not exact hit
predictions or knowledge of future enemy decisions. Combat maneuvers remain under
the existing combat executor. Tactical runner route choices, coordinated tanking,
passing and deliberate airborne navigation remain later work.

Shared-exposure time measures the selected position's predicted risk, not actual
multi-kill events. Blocked-route time counts assigned bot-seconds without a route.
