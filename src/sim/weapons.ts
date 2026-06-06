/**
 * Headless weapon / combat step — a distilled port of the hammer/sword/punch
 * resolution from `GrifballGame.updatePhysics`. Each combatant runs a small FSM:
 *   idle --attack--> windup --(timer)--> active(one hit frame) --> recovering --> idle
 *
 * On the single `active` frame the strike resolves against hostile, living, non-invuln
 * enemies inside the weapon's forward reach and deals 1 damage. With the default
 * `maxHP = 1` that is lethal; the ball carrier's +1 HP means they survive one hit, as
 * in the live game. The sword's secondary is a lunge (a short forward flight that kills
 * on contact); the ball carrier's secondary is the pass (handled in `grifball.ts`).
 *
 * Fidelity notes / divergences (see README):
 *  - Reach + forward constants are reused from `combatGeometry`; the hit test is a
 *    forward-cone approximation (distance ≤ reach, facing dot ≥ threshold) rather than
 *    the live per-VFX swept volume. Pinned by fidelity spot-checks, to be tightened.
 *  - Combos, feints, weapon trades, and hammer-jump are not modelled (heuristic-AI
 *    flavour, not core objective play).
 */

import { type UniversalSettings } from '../types';
import { dropBall } from '../game/grifballBall';
import { awardTeamKill, recordTeamDeath } from '../game/teamScoring';
import {
  MELEE_HAMMER_SWIPE_REACH,
  MELEE_SWORD_SLASH_REACH,
  MELEE_EYE_HEIGHT,
} from '../components/grifball/combatGeometry';
import { type SimState, type SimCombatant, findCombatant } from './simState';
import { type ActionInput } from './actions';
import { forwardDir } from './physics';
import { inwardSpawnYaw } from './factory';

/** Seconds a downed combatant waits before respawning. */
export const RESPAWN_TIME = 3.0;
/** Lunge flight reach / speed fall back to live sword defaults. */
const LUNGE_KILL_RADIUS = 1.6;
/**
 * Stationary-swing facing cone, copied from the live player melee resolver: a hit needs
 * `acos(lookDir · toTargetDir) <= 1.0` radian, i.e. `dot >= cos(1.0)`.
 */
const MELEE_CONE_COS = Math.cos(1.0);
/** Combatant body-center heights above the feet (from `combatGeometry`). */
const BODY_CENTER_HEIGHT = 0.825;
const CROUCH_BODY_CENTER_HEIGHT = 0.52;

export interface KillEvent {
  attackerId: string;
  victimId: string;
  weapon: 'hammer' | 'sword' | 'ball';
}

/** Two combatants are hostile iff they are alive and on different teams. */
export function areHostile(a: SimCombatant, b: SimCombatant): boolean {
  return a.id !== b.id && a.team !== b.team;
}

function recoverDuration(c: SimCombatant, settings: UniversalSettings): number {
  if (c.weapon === 'sword') return settings.swordSlashReload ?? 0.6;
  return settings.hammerMeleeReload ?? 0.5;
}

function meleeReach(c: SimCombatant): number {
  if (c.weapon === 'sword') return MELEE_SWORD_SLASH_REACH;
  return MELEE_HAMMER_SWIPE_REACH; // hammer & ball-punch share the swipe reach
}

/** Hammer-strike forward distance (live-tunable `attackRange`). */
function strikeRange(settings: UniversalSettings): number {
  return settings.attackRange ?? 3.2;
}

/** Hammer-strike splash radius (live-tunable `attackRadius`). */
function strikeRadius(settings: UniversalSettings): number {
  return settings.attackRadius ?? 4.5;
}

/** Apply 1 lethal-by-default damage to a victim; records death + drops ball + respawn. */
function strike(
  state: SimState,
  attacker: SimCombatant,
  victim: SimCombatant,
  events: KillEvent[]
): void {
  victim.hp -= 1;
  if (victim.hp > 0) return;
  victim.hp = 0;
  victim.alive = false;
  victim.respawnTimer = RESPAWN_TIME;
  awardTeamKill(state.scores, attacker.team);
  recordTeamDeath(state.scores, victim.team);
  // Carrier death drops the ball loose where they fell.
  if (state.match.ball.holderId === victim.id) {
    dropBall(state.match.ball, { x: victim.pos.x, y: 0, z: victim.pos.z });
    victim.hasBall = false;
  }
  events.push({ attackerId: attacker.id, victimId: victim.id, weapon: attacker.weapon });
}

/**
 * Stationary-swing hit test, faithful to the live player melee resolver: 3D distance from
 * the attacker's eye (pos.y + 1.65) to the victim's body center must be within `reach`, and
 * the victim must lie inside the 1.0-rad facing cone. Sim combatants have no pitch, so the
 * look heading is `forwardDir(yaw)` (y = 0). Pure geometry — no alive/hostile/invuln checks.
 */
export function inMeleeHitVolume(attacker: SimCombatant, victim: SimCombatant): boolean {
  const reach = meleeReach(attacker);
  const fwd = forwardDir(attacker.yaw); // y = 0 (no pitch)
  const ey = attacker.pos.y + MELEE_EYE_HEIGHT;
  const cy = victim.pos.y + (victim.isCrouching ? CROUCH_BODY_CENTER_HEIGHT : BODY_CENTER_HEIGHT);
  const dx = victim.pos.x - attacker.pos.x;
  const dy = cy - ey;
  const dz = victim.pos.z - attacker.pos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > reach) return false;
  if (dist <= 1e-4) return true;
  const dot = (fwd.x * dx + fwd.z * dz) / dist;
  return dot >= MELEE_CONE_COS;
}

/**
 * Hammer primary-strike AoE test, faithful to `applyHammerStrikeImpactForState`: an impact
 * point is projected `attackRange` ahead of the attacker's eye along its facing, and every
 * hostile whose body center is within `attackRadius` of that point is hit (a splash sphere,
 * not a cone). Wires the live-tunable `attackRange` / `attackRadius`.
 */
export function inHammerStrikeVolume(
  attacker: SimCombatant,
  victim: SimCombatant,
  settings: UniversalSettings
): boolean {
  const fwd = forwardDir(attacker.yaw); // y = 0 (no pitch)
  const ix = attacker.pos.x + fwd.x * strikeRange(settings);
  const iy = attacker.pos.y + MELEE_EYE_HEIGHT; // impact y = eye height (look heading is planar)
  const iz = attacker.pos.z + fwd.z * strikeRange(settings);
  const cy = victim.pos.y + (victim.isCrouching ? CROUCH_BODY_CENTER_HEIGHT : BODY_CENTER_HEIGHT);
  const dx = victim.pos.x - ix;
  const dy = cy - iy;
  const dz = victim.pos.z - iz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) <= strikeRadius(settings);
}

/** Resolve a swipe/slash/punch cone hit from `attacker` at its active frame. */
function resolveMeleeHit(state: SimState, attacker: SimCombatant, events: KillEvent[]): void {
  for (const v of state.combatants) {
    if (!v.alive || !areHostile(attacker, v)) continue;
    if (v.invulnerabilityTimer > 0) continue;
    if (inMeleeHitVolume(attacker, v)) strike(state, attacker, v, events);
  }
}

/** Resolve the hammer primary AoE strike (splash around a projected impact point). */
function resolveHammerStrike(
  state: SimState,
  attacker: SimCombatant,
  settings: UniversalSettings,
  events: KillEvent[]
): void {
  for (const v of state.combatants) {
    if (!v.alive || !areHostile(attacker, v)) continue;
    if (v.invulnerabilityTimer > 0) continue;
    if (inHammerStrikeVolume(attacker, v, settings)) strike(state, attacker, v, events);
  }
}

/** Wind-up time before an attack's active frame, by kind. */
function windupForKind(kind: SimCombatant['attackKind'], settings: UniversalSettings): number {
  if (kind === 'slash') return settings.swordSlashSpeed ?? 0.22;
  return settings.hammerMeleeSpeed ?? 0.24; // strike / swipe / punch share the hammer swing speed
}

/** Recovery (and re-attack cooldown) after an attack lands, by kind. */
function recoverForKind(kind: SimCombatant['attackKind'], settings: UniversalSettings): number {
  switch (kind) {
    case 'strike': return settings.hammerReloadTime ?? 0.6; // hammer PRIMARY reload (live-tunable)
    case 'slash': return settings.swordSlashReload ?? 0.6;
    default: return settings.hammerMeleeReload ?? 0.5;       // swipe / punch
  }
}

/** Resolve sword-lunge contact while a combatant is mid-flight. */
function resolveLungeHit(state: SimState, attacker: SimCombatant, events: KillEvent[]): void {
  for (const v of state.combatants) {
    if (!v.alive || !areHostile(attacker, v)) continue;
    if (v.invulnerabilityTimer > 0) continue;
    const d = Math.hypot(v.pos.x - attacker.pos.x, v.pos.z - attacker.pos.z);
    if (d <= LUNGE_KILL_RADIUS) strike(state, attacker, v, events);
  }
}

/**
 * Advance one combatant's weapon FSM by `dt` and resolve any hits this tick.
 * Movement (including the lunge flight integration) is owned by physics; this only
 * mutates weapon state/timers and applies damage.
 */
export function stepCombatantWeapons(
  state: SimState,
  c: SimCombatant,
  action: ActionInput,
  settings: UniversalSettings,
  dt: number,
  events: KillEvent[]
): void {
  if (!c.alive) return;

  if (c.swapLockoutTimer > 0) c.swapLockoutTimer = Math.max(0, c.swapLockoutTimer - dt);
  if (c.attackCooldown > 0) c.attackCooldown = Math.max(0, c.attackCooldown - dt);

  // Weapon swap (hammer <-> sword), never while carrying the ball or mid-action.
  if (action.swapWeapon && c.weapon !== 'ball' && c.weaponState === 'idle' && c.swapLockoutTimer <= 0) {
    c.weapon = c.weapon === 'hammer' ? 'sword' : 'hammer';
    c.swapLockoutTimer = settings.weaponSwapLockout ?? 1.0;
  }

  // Active lunge flight: kill-on-contact, run down the lunge timer.
  if (c.isLunging) {
    resolveLungeHit(state, c, events);
    c.lungeTimer = Math.max(0, c.lungeTimer - dt);
    if (c.lungeTimer <= 0) {
      c.isLunging = false;
      c.weaponState = 'recovering';
      c.weaponTimer = recoverDuration(c, settings);
      c.attackCooldown = c.weaponTimer;
    }
    return;
  }

  switch (c.weaponState) {
    case 'idle': {
      // Secondary: sword = lunge, hammer = quick swipe, ball = pass (handled in grifball.ts).
      if (action.attackSecondary && c.attackCooldown <= 0) {
        if (c.weapon === 'sword') { startLunge(c, settings); return; }
        if (c.weapon === 'hammer') { beginAttack(c, 'swipe', settings); return; }
      }
      // Primary: hammer = AoE strike, sword = slash, ball = punch.
      if (action.attackPrimary && c.attackCooldown <= 0) {
        const kind = c.weapon === 'hammer' ? 'strike' : c.weapon === 'sword' ? 'slash' : 'punch';
        beginAttack(c, kind, settings);
      }
      break;
    }
    case 'windup': {
      c.weaponTimer -= dt;
      if (c.weaponTimer <= 0) {
        // The single active hit frame — geometry depends on the attack kind.
        if (c.attackKind === 'strike') resolveHammerStrike(state, c, settings, events);
        else resolveMeleeHit(state, c, events);
        c.weaponState = 'recovering';
        c.weaponTimer = recoverForKind(c.attackKind, settings);
        c.attackCooldown = c.weaponTimer;
        c.attackKind = 'none';
      }
      break;
    }
    case 'recovering': {
      c.weaponTimer -= dt;
      if (c.weaponTimer <= 0) {
        c.weaponState = 'idle';
        c.weaponTimer = 0;
      }
      break;
    }
    default:
      c.weaponState = 'idle';
      break;
  }
}

/** Enter the wind-up phase for a (non-lunge) attack kind. */
function beginAttack(
  c: SimCombatant,
  kind: SimCombatant['attackKind'],
  settings: UniversalSettings
): void {
  c.attackKind = kind;
  c.weaponState = 'windup';
  c.weaponTimer = windupForKind(kind, settings);
}

function startLunge(c: SimCombatant, settings: UniversalSettings): void {
  c.isLunging = true;
  c.attackKind = 'none';
  c.weaponState = 'active';
  const dist = settings.swordLungeDistance ?? 14.5;
  const speed = settings.swordLungeSpeed ?? 24.0;
  c.lungeTimer = dist / speed;
  const fwd = forwardDir(c.yaw);
  c.lungeDir = { x: fwd.x, y: 0, z: fwd.z };
  c.attackCooldown = settings.swordLungeReload ?? 1.2;
}

/** Tick respawn timers; revive downed combatants at their team spawn when ready. */
export function tickRespawns(state: SimState, settings: UniversalSettings, dt: number): void {
  for (const c of state.combatants) {
    if (c.alive) continue;
    c.respawnTimer = Math.max(0, c.respawnTimer - dt);
    if (c.respawnTimer > 0) continue;
    respawnCombatant(state, c, settings);
  }
}

/** Revive a combatant at the next slot of its team spawn cluster. */
export function respawnCombatant(state: SimState, c: SimCombatant, settings: UniversalSettings): void {
  const cluster = state.spawns[c.team] ?? [];
  // Deterministic slot: index of this combatant among its team.
  const teammates = state.combatants.filter((m) => m.team === c.team);
  const idx = teammates.indexOf(c);
  const spawn = cluster.length ? cluster[idx % cluster.length] : { x: 0, y: 0, z: 0 };
  c.pos = { x: spawn.x, y: 0, z: spawn.z };
  c.vel = { x: 0, y: 0, z: 0 };
  c.yaw = inwardSpawnYaw(spawn);
  c.alive = true;
  c.hp = settings.maxHP ?? 1;
  c.maxHp = settings.maxHP ?? 1;
  c.respawnTimer = 0;
  c.invulnerabilityTimer = settings.respawnInvulnerabilityDuration ?? 1.0;
  c.weapon = 'hammer';
  c.weaponState = 'idle';
  c.weaponTimer = 0;
  c.attackKind = 'none';
  c.isJumping = false;
  c.isLunging = false;
  c.lungeTimer = 0;
  c.dashRemaining = 0;
  c.hasBall = false;
}
