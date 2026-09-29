/**
 * Headless weapon / combat step — the default legacy-v1 training model is a distilled port of the hammer/sword/punch
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
 *  - live-player-v1 explicitly opts into player slash/swipe mid-swing impact and
 *    two-stage slam/punch timing. It does not certify AI, lunge or trade parity.
 *  - live-roster-v1 opts into stationary roster attack phases and projected splash
 *    geometry. Lunge flight, trades, moving contact and respawn remain uncertified.
 *  - live-roster-v2 adds committed grounded flight, lethal/surviving primary trades and
 *    greedy occupancy-aware revival. Supply lungeTargetId before committing a lunge. It does
 *    not port AI selection, pressure/combo decisions, or certify all combat paths.
 */

import { type UniversalSettings } from '../types';
import { resolveHammerSlamTiming } from '../game/hammerSlamTiming';
import { dropBall } from '../game/grifballBall';
import { resolvePunchCooldown, resolvePunchLungeDistance } from '../game/runnerBallSettings';
import { adjustRangeForTargetModel } from '../components/grifball/modelHitbox';
import { awardTeamKill, recordTeamDeath } from '../game/teamScoring';
import {
  MELEE_HAMMER_SWIPE_REACH,
  MELEE_SWORD_SLASH_REACH,
  MELEE_EYE_HEIGHT,
  SWORD_SLASH_FORWARD_FACTOR,
  SWORD_SLASH_RADIUS,
} from '../components/grifball/combatGeometry';
import { type SimState, type SimCombatant, findCombatant, isRosterExecution, isMixedPlayer, usesRosterLifecycle, combatExecutionForActor } from './simState';
import * as THREE from 'three';
import { isVectorXZAtArenaBoundary } from '../components/grifball/arenaBounds';
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
  if (c.weapon === 'ball') return resolvePunchCooldown(settings);
  if (c.weapon === 'sword') return settings.swordSlashReload ?? 0.6;
  return settings.hammerMeleeReload ?? 0.5;
}

function meleeReach(c: SimCombatant, settings?: UniversalSettings): number {
  if (c.weapon === 'sword') return MELEE_SWORD_SLASH_REACH;
  if (c.weapon === 'ball') return settings ? resolvePunchLungeDistance(settings) : 1.8;
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
  settings: UniversalSettings,
  events: KillEvent[]
): void {
  victim.hp -= 1;
  if (victim.hp > 0) return;
  victim.hp = 0;
  victim.alive = false;
  victim.respawnTimer = RESPAWN_TIME;
  if (usesRosterLifecycle(state)) {
    victim.isLunging = false; victim.weaponState = 'idle'; victim.weaponTimer = 0;
    victim.weaponPhaseElapsed = 0; victim.attackKind = 'none'; victim.attackCooldown = 0;
  }
  awardTeamKill(state.scores, attacker.team);
  recordTeamDeath(state.scores, victim.team);
  // Carrier death drops the ball loose where they fell.
  if (state.match.ball.holderId === victim.id && !usesRosterLifecycle(state)) {
    dropBall(state.match.ball, { x: victim.pos.x, y: 0, z: victim.pos.z });
    victim.hasBall = false;
    victim.weapon = 'hammer';
    victim.maxHp = settings.maxHP ?? 1;
    victim.hp = Math.min(victim.hp, victim.maxHp);
    victim.passChargeTimer = 0;
    victim.runnerHealDelayTimer = 0;
    victim.runnerLastHp = victim.hp;
  }
  events.push({ attackerId: attacker.id, victimId: victim.id, weapon: attacker.weapon });
}

const SIM_FPS = 60;

/**
 * Is `victim` eligible to trade back? True when weapon trades are enabled and the victim is
 * mid-attack (or attacked within the trade window). Mirrors `resolveSwordLungeTradeReason`.
 */
export function isTradeEligible(victim: SimCombatant, settings: UniversalSettings, tick: number): boolean {
  const swordTrade = !!settings.enableSwordTrade && victim.weapon === 'sword';
  const hammerTrade = !!settings.enableHammerSwordTrade && victim.weapon === 'hammer';
  if (!swordTrade && !hammerTrade) return false;
  const windowMs = victim.weapon === 'sword'
    ? (settings.swordTradeWindow ?? 350)
    : (settings.hammerSwordTradeWindow ?? 350);
  const windowTicks = (windowMs / 1000) * SIM_FPS;
  const activeNow = victim.isLunging || victim.weaponState === 'windup' || victim.weaponState === 'active';
  const recent = tick - victim.lastAttackTick <= windowTicks;
  return activeNow || recent;
}

/**
 * Land a hit and, if `initiatesTrade` (a sword lunge/slash) catches a trade-eligible victim,
 * the victim trades back — both die. Returns false if the attacker died in the trade.
 */
function applyHit(
  state: SimState,
  attacker: SimCombatant,
  victim: SimCombatant,
  settings: UniversalSettings,
  events: KillEvent[],
  initiatesTrade: boolean
): boolean {
  const tradeBack = initiatesTrade && isTradeEligible(victim, settings, state.tick);
  strike(state, attacker, victim, settings, events);
  if (tradeBack) strike(state, victim, attacker, settings, events); // victim's team credits the trade kill
  return attacker.alive;
}

/**
 * Stationary-swing hit test, faithful to the live player melee resolver: 3D distance from
 * the attacker's eye (pos.y + 1.65) to the victim's body center must be within `reach`, and
 * the victim must lie inside the 1.0-rad facing cone. Sim combatants have no pitch, so the
 * look heading is `forwardDir(yaw)` (y = 0). Pure geometry — no alive/hostile/invuln checks.
 */
export function inMeleeHitVolume(
  attacker: SimCombatant,
  victim: SimCombatant,
  settings?: UniversalSettings
): boolean {
  const reach = meleeReach(attacker, settings);
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
function resolveMeleeHit(
  state: SimState,
  attacker: SimCombatant,
  settings: UniversalSettings,
  events: KillEvent[]
): void {
  const initiatesTrade = attacker.attackKind === 'slash'; // only sword slash trades
  for (const v of state.combatants) {
    if (!v.alive || !areHostile(attacker, v)) continue;
    if (v.invulnerabilityTimer > 0) continue;
    if (inMeleeHitVolume(attacker, v, settings)) {
      if (!applyHit(state, attacker, v, settings, events, initiatesTrade)) break; // attacker traded out
    }
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
    if (inHammerStrikeVolume(attacker, v, settings)) strike(state, attacker, v, settings, events);
  }
}

/** Player punch uses a 1.5-unit splash around its projected impact, not a swipe cone. */
export function inPlayerPunchVolume(attacker: SimCombatant, victim: SimCombatant, settings: UniversalSettings): boolean {
  const fwd = forwardDir(attacker.yaw);
  const reach = resolvePunchLungeDistance(settings);
  return Math.hypot(victim.pos.x - attacker.pos.x - fwd.x * reach,
    victim.pos.y + BODY_CENTER_HEIGHT - attacker.pos.y - MELEE_EYE_HEIGHT,
    victim.pos.z - attacker.pos.z - fwd.z * reach) <= 1.5;
}

function resolvePlayerPunch(state: SimState, c: SimCombatant, settings: UniversalSettings, events: KillEvent[]): void {
  for (const victim of state.combatants) {
    if (victim.alive && areHostile(c, victim) && victim.invulnerabilityTimer <= 0 && inPlayerPunchVolume(c, victim, settings)) {
      strike(state, c, victim, settings, events);
    }
  }
}

/** Roster bots use a planar, body-centered splash, including sword and side-swipe. */
function resolveRosterHit(state: SimState, c: SimCombatant, settings: UniversalSettings, events: KillEvent[]): void {
  const reach = c.weapon === 'ball' ? resolvePunchLungeDistance(settings)
    : strikeRange(settings) * (c.weapon === 'sword' ? SWORD_SLASH_FORWARD_FACTOR : 1);
  const radius = c.weapon === 'ball' ? 1.5 : c.weapon === 'sword' ? SWORD_SLASH_RADIUS : strikeRadius(settings);
  const fwd = forwardDir(c.yaw);
  for (const victim of state.combatants) {
    if (!victim.alive || !areHostile(c, victim) || victim.invulnerabilityTimer > 0) continue;
    const cy = victim.pos.y + (victim.isCrouching ? CROUCH_BODY_CENTER_HEIGHT : BODY_CENTER_HEIGHT);
    const targetRadius = usesRosterLifecycle(state) ? adjustRangeForTargetModel(radius, victim.modelType) : radius;
    if (Math.hypot(victim.pos.x - c.pos.x - fwd.x * reach, cy - c.pos.y - 1.2,
      victim.pos.z - c.pos.z - fwd.z * reach) <= targetRadius) strike(state, c, victim, settings, events);
  }
}

/**
 * Opt-in stationary attack timing. Elapsed clocks and phase-boundary resets mirror live
 * animation updates, including advancing a newly requested attack on this tick.
 * Keeping the elapsed value avoids subtraction round-off moving a boundary one tick.
 * weaponTimer remains remaining time for existing observation consumers.
 */
function stepLiveAttack(state: SimState, c: SimCombatant, action: ActionInput,
  settings: UniversalSettings, dt: number, events: KillEvent[], canAttack: boolean): void {
  const enter = (phase: SimCombatant['weaponState'], duration: number) => {
    c.weaponState = phase; c.weaponPhaseElapsed = 0; c.weaponTimer = duration;
  };
  const slam = resolveHammerSlamTiming(settings);
  const roster = isRosterExecution(combatExecutionForActor(state, c));
  const swingDuration = () => c.attackKind === 'slash' ? (settings.swordSlashSpeed ?? .22) * (roster ? .5 : 1)
    : roster && c.attackKind === 'swipe' ? (settings.hammerMeleeSpeed ? settings.hammerMeleeSpeed * .4 : .1)
    : c.attackKind === 'strike' ? slam.windupTime : (settings.hammerMeleeSpeed ?? .24);
  const strikeDuration = () => c.attackKind === 'strike' ? slam.attackTime
    : c.attackKind === 'slash' ? (settings.swordSlashSpeed ?? .22) * .5
    : c.attackKind === 'swipe' ? (settings.hammerMeleeSpeed ? settings.hammerMeleeSpeed * .6 : .14)
    : Math.max(.03, (settings.hammerMeleeSpeed ?? .24) * .5);
  if (c.weaponState === 'idle') {
    if (!canAttack || c.dashRemaining > 0) return;
    if (action.attackSecondary && c.weapon === 'sword') {
      startLunge(c, settings, state); c.lastAttackTick = state.tick; return;
    }
    const kind = action.attackSecondary && c.weapon === 'hammer' ? 'swipe'
      : action.attackPrimary ? (c.weapon === 'sword' ? 'slash' : c.weapon === 'ball' ? 'punch' : 'strike') : null;
    if (!kind) return;
    c.attackKind = kind; c.lastAttackTick = state.tick;
    if (usesRosterLifecycle(state)) {
      const now = state.combatTimeMs ?? state.tick * 1000 / 60;
      if (c.weapon === 'sword') c.lastSwordAttackTimeMs = now;
      else if (c.weapon === 'hammer') c.lastHammerAttackTimeMs = now;
    }
    enter('windup', swingDuration());
  }
  const previous = c.weaponPhaseElapsed ?? 0;
  const elapsed = previous + dt;
  c.weaponPhaseElapsed = elapsed;
  const recover = () => {
    enter('recovering', recoverForKind(c.attackKind, settings));
    c.attackCooldown = c.weaponTimer;
  };
  if (c.weaponState === 'windup') {
    const duration = swingDuration();
    c.weaponTimer = Math.max(0, duration - elapsed);
    if (!roster && (c.attackKind === 'slash' || c.attackKind === 'swipe')) {
      if (elapsed >= duration * .5 && previous < duration * .5) resolveMeleeHit(state, c, settings, events);
      if (c.alive && elapsed >= duration) recover();
    } else if (elapsed >= duration) {
      enter('active', strikeDuration());
      if (c.attackKind === 'slash') resolveRosterHit(state, c, settings, events);
    }
  } else if (c.weaponState === 'active') {
    const duration = strikeDuration();
    c.weaponTimer = Math.max(0, duration - elapsed);
    if (elapsed >= duration) {
      if (roster) { if (c.attackKind !== 'slash') resolveRosterHit(state, c, settings, events); }
      else if (c.attackKind === 'punch') resolvePlayerPunch(state, c, settings, events);
      else {
        resolveHammerStrike(state, c, settings, events);
        // Live hammer-jump window is based on distance from the projected impact to feet.
        if (Math.hypot(strikeRange(settings), MELEE_EYE_HEIGHT) <= (settings.hammerJumpTriggerRadius ?? 3.5)) {
          c.hammerJumpWindowTimer = settings.hammerJumpWindow ?? .6;
        }
      }
      recover();
    }
  } else if (c.weaponState === 'recovering') {
    const duration = recoverForKind(c.attackKind, settings);
    c.weaponTimer = Math.max(0, duration - elapsed);
    c.attackCooldown = c.weaponTimer;
    if (elapsed >= duration) {
      enter('idle', 0);
      if (isMixedPlayer(state, c)) c.weaponPhaseElapsed = elapsed;
      c.attackKind = 'none'; c.attackCooldown = 0;
    }
  }
}

/** Wind-up time before an attack's active frame, by kind. */
function windupForKind(kind: SimCombatant['attackKind'], settings: UniversalSettings): number {
  if (kind === 'slash') return settings.swordSlashSpeed ?? 0.22;
  if (kind === 'strike') {
    const { windupTime, attackTime } = resolveHammerSlamTiming(settings);
    return windupTime + attackTime;
  }
  return settings.hammerMeleeSpeed ?? 0.24; // swipe / punch share the hammer melee timing
}

/** Recovery (and re-attack cooldown) after an attack lands, by kind. */
function recoverForKind(kind: SimCombatant['attackKind'], settings: UniversalSettings): number {
  switch (kind) {
    case 'strike': return settings.hammerReloadTime ?? 0.6; // hammer PRIMARY reload (live-tunable)
    case 'slash': return settings.swordSlashReload ?? 0.6;
    case 'punch': return resolvePunchCooldown(settings);
    default: return settings.hammerMeleeReload ?? 0.5;       // swipe / punch
  }
}

/** Resolve sword-lunge contact while a combatant is mid-flight (always trade-initiating). */
function resolveLungeHit(
  state: SimState,
  attacker: SimCombatant,
  settings: UniversalSettings,
  events: KillEvent[]
): void {
  for (const v of state.combatants) {
    if (!v.alive || !areHostile(attacker, v)) continue;
    if (v.invulnerabilityTimer > 0) continue;
    const d = Math.hypot(v.pos.x - attacker.pos.x, v.pos.z - attacker.pos.z);
    if (d <= LUNGE_KILL_RADIUS) {
      if (!applyHit(state, attacker, v, settings, events, true)) break;
    }
  }
}

/** Committed roster flight: one locked target, one contact, elapsed timeout and AI cooldown. */
function resolveRosterLunge(state: SimState, c: SimCombatant, settings: UniversalSettings, dt: number, events: KillEvent[]): void {
  c.lungeTimer += dt;
  const target = findCombatant(state, c.lungeTargetId!);
  const finish = (outcome: NonNullable<SimCombatant['lungeOutcome']>, actor = c) => {
    actor.isLunging = false; actor.weaponState = 'idle'; actor.weaponTimer = 0; actor.weaponPhaseElapsed = 0;
    actor.lungeOutcome = outcome; actor.attackCooldown = settings.swordLungeReload ?? 1.2;
    actor.vel.x = actor.vel.z = 0;
    if (actor.pos.y > .01 || Math.abs(actor.vel.y) > .01) { actor.vel.y = Math.min(actor.vel.y, 0); actor.isJumping = true; }
    else { actor.vel.y = 0; actor.isJumping = false; }
  };
  if (!target || !target.alive || !areHostile(c, target)) { finish('target_dead'); return; }
  const centerY = (v: SimCombatant) => v.pos.y + (v.isCrouching ? CROUCH_BODY_CENTER_HEIGHT : BODY_CENTER_HEIGHT);
  if (target.invulnerabilityTimer <= 0 && Math.hypot(target.pos.x - c.pos.x, centerY(target) - centerY(c), target.pos.z - c.pos.z) <= adjustRangeForTargetModel(1.5, target.modelType)) {
    const primaryActive = (target.weaponState === 'windup' || target.weaponState === 'active')
      && (target.attackKind === 'slash' || target.attackKind === 'strike');
    const now = state.combatTimeMs ?? state.tick * 1000 / 60;
    const recent = (time: number | undefined, window: number) =>
      time !== undefined && Number.isFinite(time) && now >= time && now - time <= window;
    const targetWasLunging = target.isLunging;
    const trade = target.weapon === 'sword'
      ? settings.enableSwordTrade && (targetWasLunging || primaryActive || recent(target.lastSwordAttackTimeMs, settings.swordTradeWindow ?? 350))
      : target.weapon === 'hammer' && settings.enableHammerSwordTrade && (primaryActive || recent(target.lastHammerAttackTimeMs, settings.hammerSwordTradeWindow ?? 350));
    strike(state, c, target, settings, events);
    if (trade) {
      strike(state, target, c, settings, events);
      if (target.alive && targetWasLunging && isMixedPlayer(state, target)) {
        // Incoming trades consume local flight into player recovery. The live
        // player keeps this frame's velocity until the next movement update.
        target.isLunging = false; target.lungeTimer = 0; target.lungeOutcome = 'hit';
        target.weaponState = 'recovering'; target.attackKind = 'none'; target.weaponPhaseElapsed = 0;
        target.weaponTimer = target.attackCooldown = settings.swordLungeReload ?? 1.2;
      } else if (target.alive && targetWasLunging) finish('hit', target);
      else if (target.alive && primaryActive) {
        target.weaponState = 'recovering'; target.weaponPhaseElapsed = 0;
        target.weaponTimer = recoverForKind(target.attackKind, settings);
        target.attackCooldown = target.weaponTimer;
      }
      if (c.alive) finish('hit');
      else { c.isLunging = false; c.weaponState = 'idle'; c.weaponTimer = 0; c.weaponPhaseElapsed = 0; }
    } else finish('hit');
    return;
  }
  const start = c.lungeStartPos!;
  const boundary = isVectorXZAtArenaBoundary({ pos: new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z),
    activeCustomMap: state.map, arenaRadius: state.map.arenaRadius, inset: .65 });
  if (boundary) finish('miss_arena');
  else if (Math.hypot(c.pos.x - start.x, c.pos.y - start.y, c.pos.z - start.z) > 16 || c.lungeTimer > .8) finish('miss_timeout');
}

/** Independently resolved local-player flight for the opt-in mixed profile. */
export function resolveMixedPlayerLunge(state: SimState, c: SimCombatant, settings: UniversalSettings, dt: number, events: KillEvent[]): void {
  c.lungeTimer += dt;
  const finish = (outcome: NonNullable<SimCombatant['lungeOutcome']>) => {
    c.isLunging = false; c.lungeOutcome = outcome; c.weaponState = 'recovering'; c.attackKind = 'none';
    c.weaponPhaseElapsed = 0; c.weaponTimer = c.attackCooldown = settings.swordLungeReload ?? 1.2;
  };
  const centerY = (v: SimCombatant) => v.pos.y + (v.isCrouching ? CROUCH_BODY_CENTER_HEIGHT : BODY_CENTER_HEIGHT);
  let target: SimCombatant | undefined, distance = Infinity;
  // Live main AI wins exact-distance ties before roster iteration.
  const candidates = [...state.combatants].sort((a, b) => Number(b.id === 'main_ai') - Number(a.id === 'main_ai'));
  for (const v of candidates) {
    if (!v.alive || v.hp <= 0 || v.respawnTimer > 0 || v.invulnerabilityTimer > 0 || !areHostile(c, v)) continue;
    const d = Math.hypot(v.pos.x - c.pos.x, centerY(v) - centerY(c), v.pos.z - c.pos.z);
    if (d < distance) { distance = d; target = v; }
  }
  if (!target) { finish('target_dead'); return; }
  if (distance <= adjustRangeForTargetModel(1.5, target.modelType)) {
    const primary = (target.weaponState === 'windup' || target.weaponState === 'active') &&
      (target.attackKind === 'slash' || target.attackKind === 'strike');
    const now = state.combatTimeMs ?? state.tick * 1000 / 60;
    const recent = (time: number | undefined, window: number) =>
      time !== undefined && Number.isFinite(time) && now >= time && now - time <= window;
    const trade = target.weapon === 'sword'
      ? settings.enableSwordTrade && (target.isLunging || primary || recent(target.lastSwordAttackTimeMs, settings.swordTradeWindow ?? 350))
      : target.weapon === 'hammer' && settings.enableHammerSwordTrade && (primary || recent(target.lastHammerAttackTimeMs, settings.hammerSwordTradeWindow ?? 350));
    strike(state, c, target, settings, events);
    if (trade) {
      strike(state, target, c, settings, events);
      target.isLunging = false; target.weaponState = 'idle'; target.weaponTimer = target.weaponPhaseElapsed = 0;
      target.attackKind = 'none'; target.attackCooldown = 0;
    }
    finish('hit'); return;
  }
  const start = c.lungeStartPos!;
  if (Math.hypot(c.pos.x - start.x, c.pos.y - start.y, c.pos.z - start.z) > 16 || c.lungeTimer > .8) finish('miss_timeout');
  else if (isVectorXZAtArenaBoundary({ pos: new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z), activeCustomMap: state.map,
    arenaRadius: state.map.arenaRadius, inset: .6 })) finish('miss_arena');
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
  if (isMixedPlayer(state, c)) {
    if (c.isLunging) return;
    if (c.weaponState === 'recovering' && c.attackKind === 'none') {
      c.weaponPhaseElapsed = (c.weaponPhaseElapsed ?? 0) + dt;
      c.weaponTimer = Math.max(0, (settings.swordLungeReload ?? 1.2) - c.weaponPhaseElapsed);
      c.attackCooldown = c.weaponTimer;
      if (c.weaponTimer === 0) c.weaponState = 'idle';
      return;
    }
  }

  if (c.swapLockoutTimer > 0) c.swapLockoutTimer = Math.max(0, c.swapLockoutTimer - dt);
  if (c.attackCooldown > 0) c.attackCooldown = Math.max(0, c.attackCooldown - dt);
  if (c.weaponReadyTimer > 0) c.weaponReadyTimer = Math.max(0, c.weaponReadyTimer - dt);
  if (c.hammerJumpWindowTimer > 0) c.hammerJumpWindowTimer = Math.max(0, c.hammerJumpWindowTimer - dt);

  // Weapon swap (hammer <-> sword): blocked while carrying the ball, mid-action, or on lockout.
  // A swap makes the new weapon un-ready for `weaponReadyTime` before it can fire.
  if (action.swapWeapon && !c.isLunging && c.weapon !== 'ball' && c.weaponState === 'idle' && c.swapLockoutTimer <= 0) {
    c.weapon = c.weapon === 'hammer' ? 'sword' : 'hammer';
    c.swapLockoutTimer = settings.weaponSwapLockout ?? 1.0;
    c.weaponReadyTimer = settings.weaponReadyTime ?? 0.5;
  }

  // Active lunge flight: kill-on-contact, run down the lunge timer.
  if (c.isLunging) {
    if (usesRosterLifecycle(state)) { resolveRosterLunge(state, c, settings, dt, events); return; }
    resolveLungeHit(state, c, settings, events);
    c.lungeTimer = Math.max(0, c.lungeTimer - dt);
    if (c.lungeTimer <= 0) {
      c.isLunging = false;
      c.weaponState = 'recovering';
      c.weaponTimer = recoverDuration(c, settings);
      c.attackCooldown = c.weaponTimer;
    }
    return;
  }

  // Attacks are blocked until the weapon is ready (post-swap / post-spawn).
  const canAttack = c.attackCooldown <= 0 && c.weaponReadyTimer <= 0;

  if ((combatExecutionForActor(state, c) === 'live-player-v1' || isRosterExecution(combatExecutionForActor(state, c))) && !(c.weaponState === 'recovering' && c.attackKind === 'none')) {
    stepLiveAttack(state, c, action, settings, dt, events, canAttack);
    return;
  }

  switch (c.weaponState) {
    case 'idle': {
      // Secondary: sword = lunge, hammer = quick swipe, ball = pass (handled in grifball.ts).
      if (action.attackSecondary && canAttack) {
        if (c.weapon === 'sword') { c.lastAttackTick = state.tick; startLunge(c, settings); return; }
        if (c.weapon === 'hammer') { beginAttack(c, 'swipe', settings); return; }
      }
      // Primary: hammer = AoE strike, sword = slash, ball = punch.
      if (action.attackPrimary && canAttack) {
        const kind = c.weapon === 'hammer' ? 'strike' : c.weapon === 'sword' ? 'slash' : 'punch';
        beginAttack(c, kind, settings);
      }
      break;
    }
    case 'windup': {
      c.weaponTimer -= dt;
      if (c.weaponTimer <= 0) {
        c.lastAttackTick = state.tick; // for the trade window
        // The single active hit frame — geometry depends on the attack kind.
        if (c.attackKind === 'strike') {
          resolveHammerStrike(state, c, settings, events);
          // A grounded hammer strike opens the hammer-jump window (sim has no pitch, so we
          // gate on "grounded" instead of the live "aim the impact at your feet").
          if (c.grounded) c.hammerJumpWindowTimer = settings.hammerJumpWindow ?? 0.6;
        } else {
          resolveMeleeHit(state, c, settings, events);
        }
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

function startLunge(c: SimCombatant, settings: UniversalSettings, state?: SimState): void {
  if (state && isMixedPlayer(state, c)) {
    const target = findCombatant(state, c.lungeTargetId ?? '');
    if (!target || target.id === c.id) throw new Error('live-mixed-v1 requires an explicit lungeTargetId for commitment');
    const aim = c.lungeAimDirection ?? { x: target.pos.x - c.pos.x, y: 0, z: target.pos.z - c.pos.z };
    const length = Math.hypot(aim.x, aim.z);
    if (!Number.isFinite(length) || length === 0) throw new Error('Player lunge heading must be finite and nonzero');
    c.isLunging = true; c.lungeTimer = 0; c.lungeStartPos = { ...c.pos }; delete c.lungeOutcome;
    c.lungeDir = { x: aim.x / length, y: 0, z: aim.z / length }; delete c.lungeAimDirection;
    c.lastSwordAttackTimeMs = state.combatTimeMs ?? state.tick * 1000 / 60;
    c.attackKind = 'none'; c.weaponState = 'idle'; c.weaponPhaseElapsed = c.weaponTimer = c.attackCooldown = 0;
    return;
  }
  if (state && usesRosterLifecycle(state)) {
    if (!c.lungeTargetId || !findCombatant(state, c.lungeTargetId) || c.lungeTargetId === c.id)
      throw new Error('live-roster-v2 requires an explicit lungeTargetId before a sword lunge');
    const aim = c.lungeAimDirection ?? forwardDir(c.yaw);
    const length = Math.hypot(aim.x, aim.y, aim.z);
    if (!Number.isFinite(length) || length === 0)
      throw new Error('live-roster-v2 lungeAimDirection must be finite and nonzero');
    const direction = { x: aim.x / length, y: aim.y / length, z: aim.z / length };
    c.lastSwordAttackTimeMs = state.combatTimeMs ?? state.tick * 1000 / 60;
    c.isLunging = true; c.lungeTimer = 0; c.lungeStartPos = { ...c.pos }; delete c.lungeOutcome;
    c.attackKind = 'none'; c.weaponState = 'idle'; c.weaponTimer = 0; c.weaponPhaseElapsed = 0;
    c.lungeDir = direction; delete c.lungeAimDirection;
    c.vel.y = Math.max(c.vel.y, direction.y * (settings.swordLungeSpeed ?? 24));
    c.isJumping = c.pos.y > .01 || c.vel.y > .01;
    c.attackCooldown = 0;
    return;
  }
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
export function tickRespawns(state: SimState, settings: UniversalSettings, dt: number, actors = state.combatants): void {
  for (const c of actors) {
    if (c.alive) continue;
    c.respawnTimer = Math.max(0, c.respawnTimer - dt);
    if (c.respawnTimer > 0) continue;
    respawnCombatant(state, c, settings);
  }
}

/** Revive at a fixed legacy slot, or a live-roster-v2 max-clearance team spawn. */
export function respawnCombatant(state: SimState, c: SimCombatant, settings: UniversalSettings): void {
  const rosterV2 = usesRosterLifecycle(state);
  const cluster = state.spawns[c.team] ?? [];
  // Deterministic slot: index of this combatant among its team.
  const teammates = state.combatants.filter((m) => m.team === c.team);
  const idx = teammates.indexOf(c);
  let spawn = cluster.length ? cluster[idx % cluster.length] : { x: 0, y: 0, z: 0 };
  if (rosterV2) {
    // Match live greedy arbitration in roster order. Actors revived earlier in
    // this tick now occupy space; dead actors and absent observers do not.
    // Strict > preserves the first authored spawn when clearance ties.
    const occupied = state.combatants.filter(m => m !== c && m.alive && m.hp > 0 && m.respawnTimer <= 0);
    let bestClearance = -1;
    for (const point of cluster) {
      let clearance = Infinity;
      for (const other of occupied) clearance = Math.min(clearance,
        (point.x - other.pos.x) ** 2 + (point.y - other.pos.y) ** 2 + (point.z - other.pos.z) ** 2);
      if (clearance > bestClearance) { bestClearance = clearance; spawn = point; }
    }
  }
  c.pos = { x: spawn.x, y: rosterV2 ? spawn.y : 0, z: spawn.z };
  c.vel = { x: 0, y: 0, z: 0 };
  c.yaw = inwardSpawnYaw(spawn);
  if (isMixedPlayer(state, c)) c.yaw -= Math.PI;
  c.alive = true;
  c.hp = rosterV2 ? c.maxHp : settings.maxHP ?? 1;
  if (!rosterV2) c.maxHp = settings.maxHP ?? 1;
  c.respawnTimer = 0;
  c.invulnerabilityTimer = settings.respawnInvulnerabilityDuration ?? 1.0;
  if (!rosterV2) c.weapon = 'hammer';
  c.weaponState = 'idle';
  c.weaponTimer = 0;
  delete c.weaponPhaseElapsed;
  c.attackKind = 'none';
  c.weaponReadyTimer = rosterV2 ? 0 : settings.weaponReadyTime ?? 0.5;
  if (rosterV2) {
    c.attackCooldown = 0; c.swapLockoutTimer = 0;
    delete c.lungeTargetId; delete c.lungeStartPos; delete c.lungeOutcome;
    delete c.lungeAimDirection;
    delete c.lastSwordAttackTimeMs; delete c.lastHammerAttackTimeMs;
  }
  c.hammerJumpWindowTimer = 0;
  c.hammerJumpsInAir = 0;
  c.passChargeTimer = 0;
  c.isJumping = false;
  c.isLunging = false;
  c.lungeTimer = 0;
  c.dashRemaining = 0;
  c.hasBall = false;
}
