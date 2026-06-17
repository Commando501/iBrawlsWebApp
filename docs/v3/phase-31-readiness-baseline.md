# V3 Readiness Baseline

Status: blocked
Dashboard status: Not Player Ready
Phase: 31
Local private JSON convention: `.codex/v3-readiness-baselines/phase31-reference-dashboard-export.json`

## Summary

Phase 31 is a repeatable baseline and gap-report pass. Phase 32 extends that baseline with OBJ-grounded proportion evidence. V3 remains an internal prototype until the local readiness dashboard has a sanitized reference comparison export with acknowledged metadata and all automated evidence present. This document is intentionally checked in without raw FBX/GLB/OBJ data, absolute private paths, mesh payloads, or runtime asset dependencies.

## Reference Source

- Canonical calibration file: Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj
- Inspection-only support: FBX, GLB, and GLTF remain browser-local dashboard inputs, but the FBX appears warped and is not the Phase 32 calibration source.
- Handling: browser-local reference input only
- Source status: pending local dashboard export capture
- Private JSON export path: `.codex/v3-readiness-baselines/phase31-reference-dashboard-export.json`

## Prioritized Findings

| Priority | Severity | Category | Finding | Recommended Next Phase |
| --- | --- | --- | --- | --- |
| 1 | blocker | Reference comparison | A sanitized dashboard export with acknowledged reference metadata must be captured before V3 can move beyond blocked review. | Phase 31 reference baseline capture |
| 2 | blocker | Base proportions | Dashboard baseline must record front, side, and vertical-band silhouette deltas against the canonical OBJ reference before body proportion tuning can be scoped. | Phase 32 base proportion tuning |
| 3 | blocker | Built-in armor fidelity | Current automated suit-fidelity evidence must be preserved in the baseline so the next armor pass targets measured gaps instead of subjective screenshots alone. | Phase 32 built-in armor fidelity tuning |
| 4 | blocker | Pose atlas | Pose-clearance evidence must stay attached to the baseline so animation work starts from failing or risky poses, not broad retuning. | Phase 32 pose atlas clearance |
| 5 | blocker | Attack/movement animation | The dashboard checklist must continue to separate attack/movement animation review from static model readiness. | Phase 33 attack and movement animation pass |
| 6 | warning | Performance smoke | Performance smoke remains a release gate after fidelity work increases geometry and panel complexity. | Phase 35 performance smoke hardening |

## Category Readiness

| Category | Ready | Blockers | Summary |
| --- | --- | --- | --- |
| Base proportions | no | 1 | Awaiting reference-grounded global and vertical-band silhouette deltas from the local dashboard export. |
| Built-in armor fidelity | no | 1 | Awaiting captured automated suit-fidelity evidence in the baseline report. |
| Pose atlas | no | 1 | Awaiting captured pose-clearance evidence in the baseline report. |
| Attack/movement animation | no | 1 | Awaiting manual animation review acknowledgement alongside automated pose evidence. |
| Reference comparison | no | 1 | Awaiting local reference load, comparison, acknowledgement, and sanitized export. |
| Performance smoke | no | 0 | Performance is tracked as a future hardening gate, not a player-ready claim. |

## Assumptions

- Phase 31 is baseline/report only.
- The raw reference asset remains private, browser-local, uncommitted, and outside Node tooling.
- The OBJ is the canonical Phase 32 proportion source; the warped FBX remains inspection-only.
- The checked-in Markdown may name the reference file but must not include absolute private paths or raw asset payloads.
- Manual checklist state and advisory warnings cannot create a player-ready claim without reference metadata, acknowledgement, and automated evidence.
- V1/V2 behavior, gameplay collision, hitboxes, reach, AI, networking, simulation, and save schemas are unchanged.
