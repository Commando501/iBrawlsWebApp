# V3 crouch animation review

Added five Blender-authored clips: unarmed, hammer, sword, pistol, and ball. Each is 120 frames at 60 FPS, with entry (0–39), a breathing hold (39–78), and recovery (78–120). Both boots remain planted. The hips lower 0.34 game units and shift backward, with delayed torso settling and a counter-rotating head. Weapon orientation and physical hand contacts follow the standing carry.

Source: `author.py`, registered in `extra-clips.json`. The open Blender scene was backed up to `output/blender-repair/pre-crouch-backup.blend` before authoring. The updated `ibrawls-animation-repair.blend` is saved on hammer crouch frame 2548, with preview range 2494–2614. Native skeleton keys and all five carry variants remain editable there.

Validation:

- All 44 Blender animation and atlas tests passed, including every-frame limb length, wrist articulation, sole contact, grip contact, crouch depth, foot sliding, and carry endpoint checks.
- The additional held-crouch armor-preview assertion passed.
- TypeScript passed with a 12 GB Node heap (the default 4 GB heap exhausted memory).
- The wider animation/clearance/defect run passed 53 of 56 tests. Three assertions in `combatantAnimationV3.test.ts` expect `v3CleanAuthoredClip` to equal `clean_pistol_fire` on the legacy path, where it is undefined: “keeps lower-body locomotion active during hammer windup upper-body animation,” “drives V3 detail bones for higher fidelity upper and lower body layers,” and “layers V3 weapon carry over Mixamo locomotion without flattening lower-body motion.” Those tests and the legacy animation path were not changed for crouch.
- All previous 26 generated clips compare identically to the pre-crouch artifact.
- Fifteen Blender armor-binding samples had maximum matrix error 0.000001133; all five new clips report zero reach clamp.
- Inspected Blender quarter/profile renders and the browser atlas's four views for every carried item, plus unarmed sequence playback. Local evidence: `output/blender-repair/crouch-*.png` and `crouch-*.log`.

Choose **Crouch** in the atlas and change **Carry** (Hidden is unarmed). The armor editor's Crouch case uses the held hammer pose.

Gameplay integration now routes player/bot/remote crouch state and replay posture through these clips. Entry/hold/recovery and interrupted transitions are managed in `v3GameplayAnimation.ts` and `v3GameplayCrouch.ts`; attacks preserve their original timing and prop contacts, and walking uses a leg solve at the lowered pelvis height. V3 no longer uses the legacy vertical squash. First-person weapons and the held ball share the authored posture, and the network carries an explicit slide flag. Regression coverage lives in `v3GameplayCrouch.test.ts` alongside the existing gameplay animation tests.
