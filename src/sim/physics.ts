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
 * inert; crouch height interpolation and VFX/SFX are dropped.
 */

import * as THREE from 'three';
import { type UniversalSettings } from '../types';
import { constrainCombatantToArenaBounds } from '../components/grifball/arenaBounds';
import { GRAVITY_ACCELERATION } from '../components/grifball/combatGeometry';
import { type SimState, type SimCombatant } from './simState';
import { type ActionInput } from './actions';

/** Base walk speed (m/s), live `updatePhysics` baseSpeed. */
const BASE_SPEED = 5.8;
/** Ball carrier speed multiplier ("Runner is faster"). */
const RUNNER_MULT = 1.3;
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

/**
 * Advance one combatant's movement by `dt`. Mutates `c.pos`, `c.vel`, `c.yaw`, and the
 * movement-mechanic timers in place. Dead combatants are skipped (respawn owns them).
 */
export function stepCombatantMovement(
  state: SimState,
  c: SimCombatant,
  action: ActionInput,
  settings: UniversalSettings,
  dt: number
): void {
  if (!c.alive) return;

  // Timers tick down regardless of action.
  if (c.dashCooldownTimer > 0) c.dashCooldownTimer = Math.max(0, c.dashCooldownTimer - dt);
  if (c.invulnerabilityTimer > 0) c.invulnerabilityTimer = Math.max(0, c.invulnerabilityTimer - dt);

  // Sword-lunge flight overrides input: facing is locked, velocity is the committed
  // lunge heading at the configured lunge speed. The weapon FSM owns the timer/end.
  if (c.isLunging) {
    const speed = settings.swordLungeSpeed ?? 24.0;
    c.vel.x = c.lungeDir.x * speed;
    c.vel.z = c.lungeDir.z * speed;
    c.vel.y = 0;
    c.pos.y = 0;
    c.pos.x += c.vel.x * dt;
    c.pos.z += c.vel.z * dt;
    constrainAndStore(state, c);
    c.grounded = true;
    return;
  }

  // Face the requested aim instantly (mouse-equivalent), normalized to (-PI, PI].
  c.yaw = normalizeYaw(action.aim);
  c.isCrouching = action.crouch && !c.isJumping;

  // Dash trigger (tap): only when grounded-ready and off cooldown.
  if (action.dash && c.dashRemaining <= 0 && c.dashCooldownTimer <= 0 && c.alive) {
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
  } else {
    forwardDir(c.yaw, _f);
    rightDir(c.yaw, _r);

    let baseSpeed = BASE_SPEED;
    if (c.weapon === 'ball') {
      baseSpeed = BASE_SPEED * RUNNER_MULT;
    } else if (c.isCrouching) {
      baseSpeed = CROUCH_SPEED;
    }

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
          ? settings.speedForward / 100
          : normForward < 0
            ? settings.speedBackward / 100
            : 1.0;
      const sMultiplier = settings.speedSide / 100;
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
    c.vel.y = JUMP_VELOCITY;
  }
  if (c.isJumping) {
    c.vel.y -= GRAVITY_ACCELERATION * dt;
    c.pos.y += c.vel.y * dt;
    if (c.pos.y <= 0) {
      c.pos.y = 0;
      c.vel.y = 0;
      c.isJumping = false;
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

/** Wrap an angle into (-PI, PI]. */
export function normalizeYaw(yaw: number): number {
  let a = yaw % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}
