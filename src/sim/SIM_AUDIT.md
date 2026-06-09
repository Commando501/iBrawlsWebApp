# Sim ↔ Live-mechanics audit

Every gameplay key in the Official Multiplayer Preset is live-tunable (`LIVE_CONFIG_KEYS` =
all of `PersistedGameplaySettings`). For a trained policy to track balance changes, the sim
must read the same **dynamics-affecting** keys the live game does. This is the audit of which
keys the sim honours, which the live game hardcodes, and which the sim is currently blind to.

Status legend: ✅ wired (sim reads the live setting) · ⚙️ constant in *both* (not really
tunable without a code deploy) · 🔶 omitted mechanic (sim blind until implemented) · ➖ not a
policy dynamic (AI-only / unused) · 🎨 cosmetic.

## ✅ Wired — sim reads these, training tracks the preset

| Key | Where in sim | Notes |
|---|---|---|
| `maxHP` | factory, weapons, grifball | also the +1 carrier perk |
| `speedForward` / `speedBackward` / `speedSide` | physics | walk multipliers |
| `dashDistance` / `dashDuration` / `dashCooldown` | physics | dash burst |
| `respawnInvulnerabilityDuration` | weapons | post-respawn i-frames |
| `weaponSwapLockout` | weapons | swap lockout |
| `attackRange` | weapons (`inHammerStrikeVolume`) | **NEW** — hammer-strike forward reach |
| `attackRadius` | weapons (`inHammerStrikeVolume`) | **NEW** — hammer-strike splash radius |
| `hammerSlamWindupTime` / `hammerSlamAttackTime` | weapons | hammer **primary** impact delay (`windup + attack`) |
| `hammerReloadTime` | weapons | **NEW** — hammer **primary** reload |
| `hammerMeleeSpeed` / `hammerMeleeReload` | weapons | hammer swipe (alt) windup / reload |
| `swordSlashSpeed` / `swordSlashReload` | weapons | sword slash |
| `swordLungeDistance` / `swordLungeSpeed` / `swordLungeReload` | weapons + physics | sword lunge |
| `grifballGoalTarget` / `grifballCountdownDuration` / `grifballRoundResetDelay` | grifball (via `resolveMatchConfig`) | match flow |
| `grifballPickupRadius` / `grifballBallReturnTimeout` | grifball | ball |
| `grifballPassSpeedMin` / `grifballPassSpeedMax` | grifball | pass speed |

**Audit fix landed:** the hammer **primary** is now the AoE *strike* (impact point projected
`attackRange` ahead, splash `attackRadius`, impact delay `hammerSlamWindupTime +
hammerSlamAttackTime`, reload `hammerReloadTime`) — faithful to `applyHammerStrikeImpactForState`.
Previously it was modelled as the short swipe, so those keys had **no effect** on the sim. The
quick swipe is now the hammer **secondary**.

## ⚙️ Constant in both sim and live (no drift — not preset-tunable)

Walk base `5.8`, ball-runner `×1.3`, crouch `2.5`, jump `7.2`, gravity `18`, swipe reach
`3.0`, slash reach `2.8`, eye height `1.65`, body center `0.825`, melee cone `1.0 rad`. These
are hardcoded constants in `updatePhysics` / `combatGeometry` in the live game too, so the
preset cannot change them without a code deploy. The sim mirrors the constants — faithful.

## ✅ Mechanics implemented (was BLIND, now wired) — `mechanics.test.ts`

- **Hammer-jump:** a *grounded* hammer strike opens a jump window; jumping in it launches at
  `7.2 + hammerJumpPower`, gated by `hammerJumpWindow` / `hammerJumpInputGate` /
  `hammerJumpAirLimit`. (The sim has no pitch, so the window opens on a grounded strike rather
  than the live "aim the impact at your feet" — same gameplay outcome.)
- **Weapon trades:** a sword lunge/slash that hits a victim who is mid-attack or attacked
  within `swordTradeWindow` / `hammerSwordTradeWindow` kills **both** (`enableSwordTrade` /
  `enableHammerSwordTrade`).
- **`weaponReadyTime`:** a freshly swapped/spawned weapon can't fire until it readies.
- **`grifballChargeMax`:** the pass is now a hold-to-charge / release-to-throw — longer hold
  ⇒ faster throw (capped at `grifballPassSpeedMax`).

Observation gained `self_pass_charge`, `self_hammerjump_window`, `self_weapon_ready_lockout`
so the (memoryless) policy can perceive and use these (OBS spec bumped to v2).

## 🔶 Still omitted — sim BLIND to these balance levers

- **Sprint / slide:** `enableSprint`, `enableSlide`, `speedSprint`, `speedSlide`,
  `slideDistance`, `slideCooldown` (and `hammerJumpTriggerRadius` is only partially honoured —
  the no-pitch grounded-strike gate replaces it).

If sprint/slide become important levers, they're a bounded follow-up like the above.

## ➖ Not a policy dynamic / unused

- **AI-only** (drive the scripted heuristic, not the RL agent's physics): all `ai*` tuning
  keys, `aiDifficulty`, `aiArchetype`, `grifballEscortSpacing`.
- **Unused in live:** `grifballPunchLungeRange` (defined, never referenced).

## 🎨 Cosmetic (no dynamics)

Lighting / skybox / fog / `nameVisibility*` / VFX style (`hammerSplashVfx`, `swordLungeVfx`) /
`visualizeJumpZone` / `enableBurnDecals`. Irrelevant to a headless policy.

## Takeaway

Every **currently-modelled** dynamic is now parameterized by the live setting, so pointing the
sim at the current preset (or fine-tuning on a balance patch) keeps it faithful. The remaining
risk is the 🔶 omitted mechanics — the sim can't track those levers until they're implemented.
The ✅ "wired" set is exactly what domain randomization should range over.
