# Grifball team AI milestone 5 validation

Validated 2026-09-26 on `codex/grifball-team-tactics`, following milestone 4 commit `f815bc9`. Milestone 5 is an uncommitted working-tree change. The attached implementation roadmap was not edited.

## Implemented behavior

- Shared defensive projection uses visible carrier velocity, reachable goal routes, alive team numbers and estimated respawn arrival. It assigns interception/containment, distinct relevant escort marks, and one last defender among available scripted defenders. A lone defender preserves coverage until a scoring emergency. Loose-ball recovery preserves a retriever and available safety; turnovers briefly restore defensive shape.
- Defense replaces conflicting duel/escort orders. The existing combat coordinator receives permitted defensive engagements before bots act. Immediate defense, weapon cooldowns and committed movement remain with the existing executor.
- Passing evaluates five charge/speed choices per eligible scripted receiver using the existing `throwBall` and `tickBallPhysics` rules, including bounce, boundary reflection and settling. No change to pickup eligibility: thrown balls cannot be caught. Candidates require progress, a reachable receiver and opponent pickup/attack margins, including returning opponents.
- The runner holds while charging. A still-safe charged choice keeps its receiver and power through planning refreshes. Release rechecks current positions, availability, mechanics and weapon cooldowns; uses the existing carrier/weapon/health transition; and occurs only once. Receivers route toward the predicted settled ball. Death, ownership changes, disabled modules or throwing-disabled mechanics cancel pending scripted actions.
- Humans and neural players remain observed, never assigned pass or movement commands. Non-Grifball and multiplayer paths retain their existing behavior.
- Defense / passing is active in the AI Lab, with separate toggles, 11 bounded controls, blue/red overrides, collapsed advanced settings, candidate rejection reasons, interception/throw overlays, five new scenarios, and containment/safety/pass recovery metrics. Preset schema v5 migrates v1-v4. README describes the new behavior and limits.

## Automated checks

- Gameplay/component selection: **443 passed**, before the final charge-stability regression test was added.
- Final affected-module selection: **35 passed**, including the additional charge-stability regression and the final role/ownership refinements.
- Full `npm test` script: **1,394 tests, 1,389 passed, 5 failed** in 408.54 seconds. This run preceded the last charge-stability regression and small refinements; the final focused run covers those changes.
- The five failures match the pre-existing milestone 4 V3 failures: animation fidelity two-handed hammer pose; weapon carry grip constraints; weapon attack sweep amplitude; default character asset budget; and Aegis reference proportions. No V3 implementation or fixture changes are included.
- Final TypeScript `tsc --noEmit`: passed with a 12 GB heap.
- Final production `npm run build`: passed (18.91 seconds). Existing large-bundle warnings remain.
- `git diff --check`: passed.

Coverage includes deterministic roster order, carrier cuts, 1v1 safety, uneven teams, last-defender emergencies, pressure controls, respawn timing without commanding dead players, turnover/death/reset, loose-ball recovery, disabled-module fallbacks, strict preset migration, actual settling physics, receiver availability, contested and blocked passes, human/neural exclusions, charge timing/cancellation, and a complete live movement/throw/physics/pickup sequence. Scenario restart tests reproduce plans and metrics with cleared charge/transition memory.

## Browser verification

In-app browser, local port 3000, V1 models, Championship Stadium, seven scripted bots in observer scenarios:

- Defense / passing tab, controls, independent toggles and advanced section render. Turning off Blue passing removes the pass decision and returns the runner to carrying; clearing overrides restores it.
- Open passing lane selects a named receiver with a 17.5 m/s throw, 0.60-second charge and 1.60-second settle estimate.
- Identical baseline/candidate, seed 1, four seconds each: every metric matched. Each run recorded one scripted pass, one friendly pass recovery, zero opponent recoveries, zero goals, zero stuck time and zero blocked-route time. Last-defender time was 5.58 bot-seconds, alive assignment time 28.00 bot-seconds, outside coverage 21.28 bot-seconds, and role changes 15. These are repeatability results, not a general quality comparison.
- Cut-defense scenario shows a predicted containment point and numerical disadvantage; changing pressure updates its destination. Last-defender emergency shows the goal-emergency order with only one Blue defender alive.
- Desktop 1280x800 and narrow 390x844 checked. At 390 pixels the Lab measures 390 pixels wide with equal 389-pixel scroll/client widths (no horizontal overflow). Temporary viewport override reset.
- No browser console errors observed. Lab left paused on Open passing lane with the new module selected and test overrides cleared.

## Planner benchmark

`node --import tsx scripts/sim/grifballSpaceBench.ts`, after concurrent build/test load finished. Includes defense and pass candidate planning, one cold refresh plus 60 repeated refreshes. Times are milliseconds on this machine.

| Participants | Obstacles | Cold | Median | p95 | Max |
| --- | --- | ---: | ---: | ---: | ---: |
| 8 (7 bots + human) | No | 23.90 | 2.16 | 3.30 | 5.01 |
| 8 (7 bots + human) | Yes | 78.43 | 12.59 | 14.95 | 18.59 |
| 32 stress case | No | 20.83 | 15.99 | 20.15 | 22.85 |
| 32 stress case | Yes | 141.09 | 132.60 | 139.55 | 151.19 |

The default planning cadence is 5 Hz. Cold refreshes and obstacle-heavy peaks can exceed a 60 Hz frame budget; the 32-participant case is not a supported live roster. These fixtures are not worst-case measurements of every runtime action.

## Limits

Ball recovery uses 60 Hz prediction; variable live timestep, future movement and changing spawn exclusions can shift timing/endpoints. The planner continually refreshes, and release revalidates, but cannot guarantee possession or a successful interception. Spawn selection is projected from current positions, with a scaled default spawn-ring estimate when no custom spawn list is available. Ground-footprint checks conservatively reject passes crossing obstacles, including some arcs that could clear low geometry. Existing ground-navigation limits still apply. Human/neural receiving intent is not assumed, so automatic passes target scripted teammates only. Styles/adaptation, broad statistical evaluation and neural-policy integration remain later milestones.
