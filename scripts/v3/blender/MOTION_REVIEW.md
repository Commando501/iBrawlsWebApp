# V3 motion review — September 25, 2026

Reviewed all 26 baked clips with every-frame joint/contact checks and three rendered poses per clip (78 images). Also inspected the runtime atlas, including the separate procedural Death Burst. Refined 10 clips in Blender and exported their evaluated poses back to the V3 runtime.

## Reference

Used selected poses from the official HALO [Halo Infinite multiplayer reveal](https://www.youtube.com/watch?v=4i86Ckj8xKk), including the advancing Spartan near 0:20 and the braced stance near 0:51. The useful visual cues were compact arm carriage, readable weight-bearing legs, and a supported weapon posture. This is a qualitative posture reference, not a measured motion capture match; no Halo assets were imported.

## Findings and changes

| Clips reviewed | Finding | Result of this pass |
| --- | --- | --- |
| Idle | Right wrist retained a fixed downward direction independent of the forearm. | Free right wrist now follows the forearm, matching the left-arm policy. |
| Walk, Sprint | Right wrist bent up to 42°/92°. Foot motion changed direction abruptly at the stance/swing boundary. | Both free arms articulate consistently; sprint hand height follows its swing. Foot swing matches stance velocity at both ends and eases vertically off/onto the floor. |
| Slide | Unarmed right wrist bent about 80° during the skid. | Wrist follows forearm; existing low stance and staged stand-up remain. |
| Hammer carry, windup, strike, recover | Overhand silhouette, two contacts and stage joins remain coherent. | Retained accepted motion. Additional hip/shoulder overlap could give the heavy head more apparent weight in a later stylistic pass. |
| Hammer melee, melee recover | Pommel rises clearly and the support hand adjusts without losing the handle. | Retained accepted motion and matching ready pose. |
| Sword carry, slash, recover | Edge-first arc and grip stay consistent; stage endpoints match. | Retained. The free arm and lower body remain fairly quiet during the slash; a small counterbalance/weight transfer is a possible next polish step. |
| Sword lunge | Right elbow changed its bend plane abruptly during return to carry. | Torso-relative bend direction blended in during the crouch and out during recovery; the extended thrust and side-cut path stay unchanged. |
| Pistol carry, fire | Recoil rose and fell with a broad, symmetrical pulse. | Carry retained. Fire now has a shorter kick and a slower recovery, returning exactly to ready. |
| Hit react | Slow symmetrical sway had little distinction between impact and recovery. | Earlier recoil peak, modest compression, a small counter-settle and longer return; natural free wrists. |
| Slide with hammer, sword, pistol, ball | Existing support-foot transfer and delayed upper-body settle remain consistent across holds. | Retained; all contacts and standing endpoints rechecked. |
| Ball carry | Stable single-hand contact and readable prop. | Retained current size and carry placement. |
| Ball walk, ball sprint | Same abrupt foot swing boundaries as unarmed locomotion. | Shared smooth foot trajectories; accepted ball/hand path remains unchanged. |
| Ball punch | Straight extension and retraction remain distinct, with a stable guard arm. | Retained jab and its timing. |
| Ball throw | Wrist reached 130° and the elbow snapped while following the former grip after release. | Steadier held elbow plane. After release, connected joint rotations carry the arm across the body and down to neutral; the hand no longer chases an obsolete grip. |
| Death Burst (procedural) | Voxel breakup replaces the character; there is no articulated fall to refine. | Retained existing effect. |

## Measured results

Measurements below use the exported 60 FPS tracks, before and after this pass.

| Measure | Before | After |
| --- | ---: | ---: |
| Unarmed sprint maximum right-wrist bend | 92.0° | 2.1° |
| Unarmed slide maximum right-wrist bend | 79.5° | 2.1° |
| Lunge maximum right-forearm rotation per frame | 36.5° | 15.1° |
| Throw maximum right-forearm rotation per frame | 39.8° | 7.6° |
| Throw maximum right-wrist bend | 130.0° | 54.9° |
| Walk peak foot position second difference | 0.015351 | 0.002459 |
| Sprint peak foot position second difference | 0.024990 | 0.004035 |

Foot position second differences measure change in per-frame velocity, in model units per frame squared. Their peaks fell approximately 84%. The same result applies to ball locomotion. These are continuity measurements, not a substitute for judging animation style.

All 20 checked attack/ready transitions match within export tolerance. The lunge and throw weapon transforms are unchanged; throw release is still frame 45. The other 16 clips have no material track changes. Bone lengths, support soles, hand contacts and loop endpoints pass regression checks.

Validation: 48 V3 animation/weapon tests passed; TypeScript typecheck passed. Local evidence is in `output/blender-repair/fluidity-*.json`, `fluidity-tests.log`, `motion-source-joins.json`, and `motion-sheet-1.png` through `motion-sheet-7.png`.

## Highest-value follow-ups

1. **Weapon locomotion coverage.** Hammer, sword and pistol still select standing carry references for the atlas's walk/sprint cases. Each needs dedicated locomotion or a validated upper/lower-body blend before gameplay migration. Ball already has dedicated locomotion.
2. **Hands and fingers.** The visible hand shapes remain open/flat in several free-arm and grip poses. Finger curl/contact silhouettes need their own pass; wrist alignment alone does not create a convincing fist or grasp.
3. **Secondary body motion.** Idle breathing, subtle head stabilization, and staggered pelvis/chest/shoulder timing would add life to the otherwise stable poses. Start with the sword slash and hammer recovery while preserving the accepted blade/hammer paths.

These are remaining polish opportunities, not changes included in this pass. The review covers the built-in V3 suit; custom armor still needs visual clearance checks.
