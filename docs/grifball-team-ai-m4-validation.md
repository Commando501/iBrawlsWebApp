# Grifball Milestone 4 validation

Validated locally on Windows on 2026-09-26, on `codex/grifball-team-tactics`.
Milestones 1–3 were committed as `ea0c327`. Milestone 4 remains in the working tree for review. The implementation roadmap was not edited.

## Implemented

- Pure engagement scoring combines possession protection, runner/recovery route opening, defensive delay, observable attack/trade timing, and coverage lost.
- A shared team plan assigns a primary tank, a partner covering a punish opportunity, and separate recovery coverage. Two-player commitments require enough tactical value, a visible recovery opening, safe current/planned hammer separation, reachable positions, and a reserve that can arrive in time. Idle humans are not counted as guaranteed reserves.
- Visible primary recovery allows a ready partner to take over. Commitment limits unnecessary changes; obsolete engagements release even during commitment, followed by a brief return-to-coverage interval. Death, possession changes, disabled dependencies and phase changes invalidate old decisions.
- Outnumbered defenders hold distinct goal-side positions outside the nearby push's weapon ranges, including escorts with more reach than the carrier. Imminent goal danger ends delay. Immediate self-defense remains possible.
- The existing combat coordinator receives planned targets and roles before roster updates, avoiding update-order ownership. Normal attack timing, health/reach settings, cooldowns and committed movement remain under the existing executor. Tanking supersedes escort target diagnostics rather than displaying conflicting owners.
- Tanking in the AI Lab includes a per-team toggle, 12 numeric controls (six basic, six advanced), engagement score components, assignment/partner/recovery reasons, an engagement overlay, four scenarios, and four diagnostic metrics. Schema-v1/v2/v3 settings migrate to v4 with existing overrides preserved.
- README reflects the shipped behavior and controls.

## Automated verification

- TypeScript check passed with `node --max-old-space-size=12288 node_modules/typescript/bin/tsc --noEmit`.
- Final production build passed, retaining the existing large-chunk advisory.
- Gameplay/component suite: **428 passed, zero failed**; excludes V3 and animation-specific tests. The final diagnostics ownership cleanup was followed by a **33-test focused rerun**, also all passing.
- Tests cover single/paired commits, waiting punishers, distant recovery coverage, cooldown rotation, obsolete-duel release, solo and uneven defenders, whole-push delay distances, emergency contest, shared exposure, blocked routes, stale openings, self-defense, module disable, possession/death/phase reset, deterministic roster order, preset migration, coordinator ownership, runtime combat handoff, preserved cooldowns and repeatable Lab restart.
- Full package test run: **1,372 passed / 1,377 tests, five failed assertions**. This run preceded the final delay refinements and two additional tests; focused/gameplay checks, typecheck and build verified the refinements.
- Failures match milestones 2 and 3 in unchanged V3 areas: hammer pose in `v3AnimationFidelity`; carry grip and windup amplitude in `v3WeaponMotionTracks`; character budget in `v3AssetManifest`; Aegis proportion gates in `v3ReferenceProportions`. The full repository suite is not green.
- `git diff --check` found no whitespace errors.

## Browser verification

Used the in-app browser at `http://localhost:3000/`, V1 models, Championship Stadium, seven scripted bots and seed 1.

- Main-menu and pause-menu Lab entry points worked. Tanking controls appeared with advanced weights initially collapsed.
- In Two-player opening, `bot_2` engaged `main_ai`, `bot_4` received a punish/commit order on the same target, and `bot_6` retained recovery coverage.
- Raising Double-team threshold to 15 changed the partner to Hold coverage on the next step, with the explicit reason that its value was below the threshold. Reset module restored defaults.
- Final identical-config A/B, 3 seconds each, produced identical metrics: 0 goals, 1 possession loss, 12 role changes, 8.13 outside-coverage bot-seconds, 19.48 assigned-alive bot-seconds, 9.23 shared-exposure bot-seconds, 0 stuck/blocked-route time, 1 runner action change, 3.08 tank-commitment bot-seconds, 0.42 double-commit team-seconds, 4.17 defensive-delay bot-seconds, and 2 releases.
- Corrected Outnumbered delay showed a goal-side destination around (-5.7, 0), Hold coverage, and no selected immediate combat threat. Disabling only blue Tanking removed its tank order and restored the earlier carrier-pursuit destination near (0, 0). The override was then cleared.
- Runner breakthrough returned the observed support to recovery coverage at (20, 0), with no engagement target. Persistent-duel release itself is covered by deterministic tests.
- Candidate component diagnostics and overlays were visible. At 390 px, the panel fit x=0 through x=390 with no horizontal document overflow; the temporary viewport override was reset.
- No JavaScript console errors observed.

These are integration and repeatability checks, not evidence of an overall win-rate increase. Full-match human playtesting remains useful for balancing patience, trade value and risk.

## Planning cost

Run `npm run bench:grifball-space`. Each case includes a scripted carrier, all tactical modules, one initial and 60 subsequent refreshes. The supported case is seven bots plus a human; 32 participants is extra stress. The obstacle case contains a wall and pillar. Costs are local wall-clock milliseconds per refresh, not frame-time guarantees.

| Participants | Obstacles | Initial | Median | P95 | Maximum subsequent |
| --- | --- | ---: | ---: | ---: | ---: |
| 8 | No | 26.21 | 2.09 | 3.51 | 4.53 |
| 8 | Yes | 118.78 | 15.39 | 20.53 | 23.26 |
| 32 | No | 17.63 | 10.24 | 14.97 | 18.83 |
| 32 | Yes | 85.46 | 76.41 | 95.17 | 100.47 |

Shared routers and cached geometry remain in use. Obstacle refreshes can still exceed a 60 Hz frame at the default 5 Hz planning cadence; larger rosters need more scheduling/optimization.

## Limits

The team coordinates one main engagement pair; this is a bounded scripted policy. Trade value and opening duration are estimates from visible mechanics and public movement, not guarantees of a kill or knowledge of private enemy decisions. Recovery means reachable planned coverage, not guaranteed human behavior. Immediate defense and already-committed movement can temporarily differ from a planned order.

Ground-navigation limits from milestone 2 remain. Delay distances are spatial estimates, not future interception or advanced defensive marking; milestone 5 owns richer defense, transitions and passing. Diagnostic commitment time includes approach time, not only actual swings. Double-commit time counts team seconds, and release metrics count transitions back toward coverage rather than kill outcomes.
