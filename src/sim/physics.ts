import type { ScriptedAIGroundFeedback } from './scriptedAIGround';
/**
 * Headless movement integration — a port of the player/AI movement core from
 * `GrifballGame.updatePhysics` (lines ~5740–5937). One {@link ActionInput} drives one
 * combatant per tick: turn, dash, walk/run/crouch, gravity/jump, then arena + obstacle
 * constraint.
 *
 * Fidelity notes:
 *  - Yaw convention is the live game's: forward = (0,0,-1) rotated about +Y by yaw,
 *    right = (1,0,0) rotated about +Y by yaw.
 *  - Walk constants (5.8 base, ×1.3 ball runner, 2.5 crouch, 7.2 jump, GRAVITY 18) and
 *    the dash speed (dashDistance / dashDuration) are copied verbatim.
 *  - We reuse the already-pure `arenaBounds` + `combatGeometry` helpers (THREE math only,
 *    no DOM) for byte-identical wall / obstacle / ceiling collision. THREE.Vector3 is used
 *    purely as a math type at that seam; `SimState` stays plain {@link Vec3}.
 *
 * Divergences (documented in README): sprint/slide input is not part of the discrete
 * action space (and `enableSprint`/`enableSlide` default off), so those branches are
 * inert; legacy execution drops crouch height interpolation and all profiles omit VFX/SFX.
 */

import * as THREE from 'three';
import { AI_CROUCH_SPEED_MULTIPLIER } from '../game/aiMovementMechanics';
import { finishSimAIEngagementMotion } from './aiEngagementMotion';
import { advanceAIDashMotion, finishAIHorizontalMotion, type AIDashMotionFrame } from '../game/aiDashMotion';
import type { ScriptedAIDashDecision, ScriptedAIDashFeedback } from './scriptedAIMobility';
import { type UniversalSettings } from '../types';
import { resolveDirectionalSpeedMultiplier, resolveRunnerThrustAllowed } from '../game/runnerBallSettings';
import { constrainCombatantToArenaBounds } from '../components/grifball/arenaBounds';
import { GRAVITY_ACCELERATION } from '../components/grifball/combatGeometry';
import { type SimState, type SimCombatant, combatExecutionForActor } from './simState';
import { type ActionInput } from './actions';

/** Base walk speed (m/s), live `updatePhysics` baseSpeed. */
const BASE_SPEED = 5.8;
/** Crouch walk speed (m/s). */
const CROUCH_SPEED = 2.5;
/** Standing-jump initial vertical velocity. */
const JUMP_VELOCITY = 7.2;

const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();

/**
 * Canonical aim/facing forward for a yaw: `(sin yaw, 0, cos yaw)`.
 *
 * This matches the live game's facing convention — the AI faces a target with
 * `yaw = atan2(toTarget.x, toTarget.z)` and the ball throw / spawn-facing
 * (`getInwardSpawnYaw = atan2(x, z)`) use the same heading — so movement-forward, melee,
 * the throw, and "aim toward X" are all consistent (a carrier facing the goal throws at it).
 */
export function forwardDir(yaw: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}

/** Right-hand strafe heading for a yaw: `(cos yaw, 0, -sin yaw)` (perpendicular to forward). */
export function rightDir(yaw: number, out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

/** Cooldowns sampled by a scheduled roster decision before physical movement. */
export function tickMovementCooldowns(c: SimCombatant, dt: number): void {
  if ((c.aiHammerJumpCooldownTimer ?? 0) > 0) c.aiHammerJumpCooldownTimer = Math.max(0, c.aiHammerJumpCooldownTimer! - dt);
  if (c.dashCooldownTimer > 0) c.dashCooldownTimer = Math.max(0, c.dashCooldownTimer - dt);
  if (c.invulnerabilityTimer > 0) c.invulnerabilityTimer = Math.max(0, c.invulnerabilityTimer - dt);
}

/**
 * Advance one combatant's movement by `dt`. Mutates `c.pos`, `c.vel`, `c.yaw`, and the
 * movement-mechanic timers in place. Dead combatants are skipped (respawn owns them).
 */
export function stepCombatantMovement(
  state: SimState,
  c: SimCombatant,
  action: ActionInput,
  settings: UniversalSettings,
  dt: number,
  objectiveMovement?: import('./scriptedObjectiveInput').ObjectiveGroundIntent,
  cooldownsAdvanced = false,
  engagementPrepared = false,
  dashDecision?: ScriptedAIDashDecision,
  ground?: { execute: (savedVelY: number) => ScriptedAIGroundFeedback; completed?: ScriptedAIGroundFeedback },
  evasionHold?: { held: boolean }
): ScriptedAIDashFeedback | undefined {
  if (!c.alive) return;
  const playerView = combatExecutionForActor(state, c) === 'live-player-v1';
  if (playerView && action.aimPitch !== undefined) {
    if (!Number.isFinite(action.aimPitch)) throw new Error('Player aimPitch must be finite');
    // Same mouse/gamepad view limit as playerInputRuntime.
    c.pitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, action.aimPitch));
  }

  // Timers tick down regardless of action.
  if (!cooldownsAdvanced) tickMovementCooldowns(c, dt);

  // Flight retains its launch velocity. Local mouse look still changes the view;
  // roster/legacy facing remains committed. The weapon FSM owns the timer/end.
  if (c.isLunging) {
    if (playerView) c.yaw = normalizeYaw(action.aim);
    if (state.combatExecution === 'live-mixed-v1' && c.id === state.localPlayerId) {
      c.isCrouching = false; c.isJumping = false; c.hammerJumpsInAir = 0;
    }
    const speed = settings.swordLungeSpeed ?? 24.0;
    c.vel.x = c.lungeDir.x * speed;
    c.vel.z = c.lungeDir.z * speed;
    if (combatExecutionForActor(state, c) === 'live-roster-v2') {
      c.vel.y -= GRAVITY_ACCELERATION * dt; c.pos.y += c.vel.y * dt;
      if (c.pos.y <= 0) { c.pos.y = 0; c.vel.y = 0; }
    } else { c.vel.y = 0; c.pos.y = 0; }
    c.pos.x += c.vel.x * dt;
    c.pos.z += c.vel.z * dt;
    constrainAndStore(state, c);
    c.grounded = combatExecutionForActor(state, c) === 'live-roster-v2' ? c.pos.y <= .0001 : true;
    return;
  }

  // Face the requested aim instantly (mouse-equivalent), normalized to (-PI, PI].
  c.yaw = normalizeYaw(action.aim);
  // Live local inputs allow crouching in flight; other profiles keep grounded-only stance.
  c.isCrouching = action.crouch && (engagementPrepared || playerView || !c.isJumping);
  const savedVelY = c.vel.y;
  if (engagementPrepared && finishSimAIEngagementMotion(state, c, settings, dt)) return;
  if (engagementPrepared && evasionHold && c.dashRemaining <= 0) {
    evasionHold.held = true;
    return;
  }
  if (engagementPrepared && c.dashRemaining > 0 && dashDecision) {
    const frame: AIDashMotionFrame = { pos: c.pos, vel: c.vel, dashDir: c.dashDir, aiState: dashDecision.aiState,
      dashRemaining: c.dashRemaining, slideActive: c.slideActive, slideCooldownTimer: c.slideCooldownTimer,
      isSprinting: c.isSprinting, pendingPostEvasionCharge: dashDecision.pendingPostEvasionCharge };
    advanceAIDashMotion(settings, frame, dt, dashDecision.target);
    c.dashRemaining = frame.dashRemaining; c.slideActive = frame.slideActive;
    c.slideCooldownTimer = frame.slideCooldownTimer; c.isSprinting = frame.isSprinting;
    c.grounded = constrainAndStore(state, c) || c.pos.y <= .0001;
    finishAIHorizontalMotion(c, frame);
    return { pendingPostEvasionCharge: frame.pendingPostEvasionCharge, aiState: frame.aiState };
  }
  if (engagementPrepared && ground) { ground.completed = ground.execute(savedVelY); return; }
  const isRunner = c.hasBall || c.weapon === 'ball';

  // Dash trigger (tap): only when grounded-ready and off cooldown.
  if (
    action.dash &&
    (!isRunner || resolveRunnerThrustAllowed(settings)) &&
    c.dashRemaining <= 0 &&
    c.dashCooldownTimer <= 0 &&
    c.alive
  ) {
    forwardDir(c.yaw, _f);
    rightDir(c.yaw, _r);
    const dd = new THREE.Vector3();
    if (action.moveZ !== 0 || action.moveX !== 0) {
      dd.addScaledVector(_f, action.moveZ).addScaledVector(_r, action.moveX).normalize();
    } else {
      dd.copy(_f).normalize();
    }
    c.dashDir = { x: dd.x, y: 0, z: dd.z };
    c.dashRemaining = settings.dashDuration || 0.25;
    c.dashCooldownTimer = settings.dashCooldown || 2.0;
  }

  // --- Horizontal velocity ---
  if (c.dashRemaining > 0) {
    c.dashRemaining = Math.max(0, c.dashRemaining - dt);
    const speed = settings.dashDistance / (settings.dashDuration || 0.25);
    c.vel.x = c.dashDir.x * speed;
    c.vel.z = c.dashDir.z * speed;
  } else if (objectiveMovement) {
    // Objective steering is world-space and independent of attack facing. Live
    // support walking uses forward speed; carriers use the runner forward rule.
    const speed = isRunner ? 5.8 * resolveDirectionalSpeedMultiplier(settings, 'forward', true)
      : 5.2 * settings.speedForward / 100 * (c.isCrouching ? AI_CROUCH_SPEED_MULTIPLIER : 1);
    c.vel.x = objectiveMovement.x * speed;
    c.vel.z = objectiveMovement.z * speed;
  } else {
    if (playerView) c.crouchAmount = (c.crouchAmount ?? 0) + ((c.isCrouching ? .72 : 0) - (c.crouchAmount ?? 0)) * 12 * dt;
    forwardDir(c.yaw, _f);
    rightDir(c.yaw, _r);

    const baseSpeed = c.isCrouching && !isRunner ? CROUCH_SPEED : BASE_SPEED;

    const moveForward = action.moveZ;
    const moveRight = action.moveX;
    const inputLength = Math.hypot(moveForward, moveRight);
    let vx = 0;
    let vz = 0;
    if (inputLength > 0) {
      const normForward = moveForward / inputLength;
      const normRight = moveRight / inputLength;
      const fMultiplier =
        normForward > 0
          ? resolveDirectionalSpeedMultiplier(settings, 'forward', isRunner)
          : normForward < 0
            ? resolveDirectionalSpeedMultiplier(settings, 'backward', isRunner)
            : 1.0;
      const sMultiplier = resolveDirectionalSpeedMultiplier(settings, 'side', isRunner);
      // Clamp magnitude so an over-driven analog action can't exceed unit speed.
      const analogScale = Math.min(1, inputLength);
      vx = _f.x * normForward * fMultiplier * baseSpeed * analogScale +
        _r.x * normRight * sMultiplier * baseSpeed * analogScale;
      vz = _f.z * normForward * fMultiplier * baseSpeed * analogScale +
        _r.z * normRight * sMultiplier * baseSpeed * analogScale;
    }
    c.vel.x = vx;
    c.vel.z = vz;
  }

  // --- Jump trigger + gravity ---
  if (action.jump && !c.isJumping && c.pos.y <= 0.0001) {
    c.isJumping = true;
    c.vel.y = JUMP_VELOCITY + hammerJumpBoost(c, settings);
  }
  if (c.isJumping) {
    c.vel.y -= GRAVITY_ACCELERATION * dt;
    c.pos.y += c.vel.y * dt;
    if (c.pos.y <= 0) {
      c.pos.y = 0;
      c.vel.y = 0;
      c.isJumping = false;
      c.hammerJumpsInAir = 0; // landed — reset the air hammer-jump count
    }
  } else {
    c.pos.y = 0;
    c.vel.y = 0;
  }

  // --- Integrate planar position ---
  c.pos.x += c.vel.x * dt;
  c.pos.z += c.vel.z * dt;

  // --- Arena + obstacle constraint (reused, byte-identical) ---
  const grounded = constrainAndStore(state, c);
  c.grounded = grounded || c.pos.y <= 0.0001;
}

/**
 * Run the reused arena/obstacle constraint on a combatant's plain-Vec3 pos/vel via the
 * THREE math seam, writing the resolved values back. Returns the grounded flag.
 */
function constrainAndStore(state: SimState, c: SimCombatant): boolean {
  _pos.set(c.pos.x, c.pos.y, c.pos.z);
  _vel.set(c.vel.x, c.vel.y, c.vel.z);
  const { grounded } = constrainCombatantToArenaBounds({
    pos: _pos,
    vel: _vel,
    activeCustomMap: state.map,
    arenaRadius: state.map.arenaRadius,
  });
  c.pos.x = _pos.x;
  c.pos.y = _pos.y;
  c.pos.z = _pos.z;
  c.vel.x = _vel.x;
  c.vel.y = _vel.y;
  c.vel.z = _vel.z;
  return grounded;
}

/**
 * Extra upward velocity if this jump consumes an open hammer-jump window. Mirrors the live
 * launch (`vy = 7.2 + hammerJumpPower`) plus the air-limit and input-gate checks. Consumes
 * the window. Returns 0 for a normal jump.
 */
function hammerJumpBoost(c: SimCombatant, settings: UniversalSettings): number {
  if (c.hammerJumpWindowTimer <= 0) return 0;
  const limit = settings.hammerJumpAirLimit ?? 1;
  const withinLimit = limit === 10 || c.hammerJumpsInAir < limit;
  if (limit <= 0 || !withinLimit) return 0;
  // Input gate: 0 = no gate; otherwise the jump must come within `gate`s of the window opening.
  const gate = settings.hammerJumpInputGate ?? 0;
  const elapsed = (settings.hammerJumpWindow ?? 0.6) - c.hammerJumpWindowTimer;
  if (gate !== 0 && elapsed > gate) return 0;
  c.hammerJumpWindowTimer = 0;
  c.hammerJumpsInAir += 1;
  return settings.hammerJumpPower ?? 6.5;
}

/** Wrap an angle into (-PI, PI]. */
export function normalizeYaw(yaw: number): number {
  let a = yaw % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}
