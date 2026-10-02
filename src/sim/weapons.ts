import type { RosterCombatLearning } from './scriptedCombatLearning';
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
 *    the live impact-time sphere/cone checks. Live lunge contact is sampled after
 *    movement, not swept between frames; VFX trails do not resolve damage.
 *  - live-player-v1 explicitly opts into player slash/swipe mid-swing impact and
 *    two-stage slam/punch timing. It does not certify AI, lunge or trade parity.
 *  - live-roster-v1 opts into stationary roster attack phases and projected splash
 *    geometry. Lunge flight, trades, moving contact and respawn remain uncertified.
 *  - live-roster-v2 adds committed grounded flight, lethal/surviving primary trades and
 *    greedy occupancy-aware revival. Supply lungeTargetId before committing a lunge. It does
 *    not port AI selection, pressure/combo decisions, or certify all combat paths.
 */

import { type UniversalSettings } from '../types';
import { applyAIHammerJumpAtImpact, startAIHammerJumpAction } from '../game/aiHammerJump';
import { resolveAIWeaponSwapTimers } from '../game/aiTacticalWeaponSwap';
import type { ScriptedCombatCommand } from './scriptedCombatInput';
import type { RosterMeleeHitFeedback } from './scriptedMeleeFeedback';
import type { RosterLungeFeedback } from './scriptedLungeFeedback';
import { resolveHammerSlamTiming } from '../game/hammerSlamTiming';
import { exceedsSwordLungeTravel } from '../game/swordLungeTravel';
import { dropBall } from '../game/grifballBall';
import { GRIFBALL_PUNCH_RADIUS, resolvePunchCooldown, resolvePunchLungeDistance } from '../game/runnerBallSettings';
import { adjustRangeForTargetModel } from '../components/grifball/modelHitbox';
import { awardTeamKill, recordTeamDeath } from '../game/teamScoring';
import {
  MELEE_HAMMER_SWIPE_REACH,
  MELEE_SWORD_SLASH_REACH,
  MELEE_EYE_HEIGHT,
  SWORD_SLASH_FORWARD_FACTOR,
  SWORD_SLASH_RADIUS,
} from '../components/grifball/combatGeometry';
import { type SimState, type SimCombatant, findCombatant, isRosterExecution, isMixedPlayer, usesRosterLifecycle, combatExecutionForActor, weaponAttackCooldown } from './simState';
import * as THREE from 'three';
import { selectSimRespawnPosition } from './spawns';
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
  events: KillEvent[],
  weapon = attacker.weapon
): void {
  victim.hp -= 1;
  if (victim.hp > 0) return;
  victim.hp = 0;
  victim.alive = false;
  victim.respawnTimer = RESPAWN_TIME;
  if (usesRosterLifecycle(state)) {
    delete victim.playerSwordLungeRecovery;
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
  events.push({ attackerId: attacker.id, victimId: victim.id, weapon });
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
  initiatesTrade: boolean,
  learning?: RosterCombatLearning
): boolean {
  const tradeBack = initiatesTrade && isTradeEligible(victim, settings, state.tick);
  const targetWasLunging = victim.isLunging;
  strike(state, attacker, victim, settings, events);
  if (tradeBack) strike(state, victim, attacker, settings, events); // victim's team credits the trade kill
  learning?.lifecycle?.impact(attacker, victim, 'melee', tradeBack, targetWasLunging);
  return attacker.alive;
}

/**
 * Stationary-swing hit test, faithful to the live player melee resolver: 3D distance from
 * the attacker's eye (pos.y + 1.65) to the victim's body center must be within `reach`, and
 * the victim must lie inside the 1.0-rad facing cone. Opt-in player geometry also
 * uses view pitch, interpolated crouch height and model reach. Legacy stays planar.
 */
export function inMeleeHitVolume(
  attacker: SimCombatant,
  victim: SimCombatant,
  settings?: UniversalSettings,
  playerView = false
): boolean {
  const reach = playerView ? adjustRangeForTargetModel(meleeReach(attacker, settings), victim.modelType) : meleeReach(attacker, settings);
  const fwd = playerView ? playerLookDirection(attacker) : forwardDir(attacker.yaw);
  const ey = attacker.pos.y + MELEE_EYE_HEIGHT - (playerView ? attacker.crouchAmount ?? 0 : 0);
  const cy = victim.pos.y + (!playerView && victim.isCrouching ? CROUCH_BODY_CENTER_HEIGHT : BODY_CENTER_HEIGHT);
  const dx = victim.pos.x - attacker.pos.x;
  const dy = cy - ey;
  const dz = victim.pos.z - attacker.pos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist > reach) return false;
  if (dist <= 1e-4 && !playerView) return true;
  if (dist === 0) return false; // Live normalization leaves the zero vector; its cone angle is PI/2.
  const dot = (fwd.x * dx + fwd.y * dy + fwd.z * dz) / dist;
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
  settings: UniversalSettings,
  playerView = false
): boolean {
  const fwd = playerView ? playerLookDirection(attacker) : forwardDir(attacker.yaw);
  const ix = attacker.pos.x + fwd.x * strikeRange(settings);
  const iy = attacker.pos.y + MELEE_EYE_HEIGHT - (playerView ? attacker.crouchAmount ?? 0 : 0) + fwd.y * strikeRange(settings);
  const iz = attacker.pos.z + fwd.z * strikeRange(settings);
  const cy = victim.pos.y + (!playerView && victim.isCrouching ? CROUCH_BODY_CENTER_HEIGHT : BODY_CENTER_HEIGHT);
  const dx = victim.pos.x - ix;
  const dy = cy - iy;
  const dz = victim.pos.z - iz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) <= (playerView ? adjustRangeForTargetModel(strikeRadius(settings), victim.modelType) : strikeRadius(settings));
}

/** Resolve a swipe/slash/punch cone hit from `attacker` at its active frame. */
function resolveMeleeHit(
  state: SimState,
  attacker: SimCombatant,
  settings: UniversalSettings,
  events: KillEvent[],
  learning?: RosterCombatLearning
): void {
  const initiatesTrade = attacker.attackKind === 'slash'; // only sword slash trades
  for (const v of state.combatants) {
    if (!v.alive || !areHostile(attacker, v)) continue;
    if (v.invulnerabilityTimer > 0) continue;
    if (inMeleeHitVolume(attacker, v, settings, combatExecutionForActor(state, attacker) === 'live-player-v1')) {
      if (!applyHit(state, attacker, v, settings, events, initiatesTrade, learning)) break; // attacker traded out
    }
  }
}

/** Resolve the hammer primary AoE strike (splash around a projected impact point). */
function resolveHammerStrike(
  state: SimState,
  attacker: SimCombatant,
  settings: UniversalSettings,
  events: KillEvent[],
  learning?: RosterCombatLearning
): void {
  for (const v of state.combatants) {
    if (!v.alive || !areHostile(attacker, v)) continue;
    if (v.invulnerabilityTimer > 0) continue;
    if (inHammerStrikeVolume(attacker, v, settings, combatExecutionForActor(state, attacker) === 'live-player-v1')) {
      strike(state, attacker, v, settings, events);
      learning?.lifecycle?.impact(attacker, v, 'melee');
    }
  }
}

/** Player punch uses a 1.5-unit splash around its projected impact, not a swipe cone. */
export function inPlayerPunchVolume(attacker: SimCombatant, victim: SimCombatant, settings: UniversalSettings): boolean {
  const fwd = playerLookDirection(attacker);
  const reach = resolvePunchLungeDistance(settings);
  return Math.hypot(victim.pos.x - attacker.pos.x - fwd.x * reach,
    victim.pos.y + BODY_CENTER_HEIGHT - attacker.pos.y - MELEE_EYE_HEIGHT + (attacker.crouchAmount ?? 0) - fwd.y * reach,
    victim.pos.z - attacker.pos.z - fwd.z * reach) <= adjustRangeForTargetModel(GRIFBALL_PUNCH_RADIUS, victim.modelType);
}

function playerLookDirection(c: SimCombatant) {
  const pitch = c.pitch ?? 0, planar = Math.cos(pitch);
  return { x: Math.sin(c.yaw) * planar, y: Math.sin(pitch), z: Math.cos(c.yaw) * planar };
}

function resolvePlayerPunch(state: SimState, c: SimCombatant, settings: UniversalSettings, events: KillEvent[], learning?: RosterCombatLearning): void {
  for (const victim of state.combatants) {
    if (victim.alive && areHostile(c, victim) && victim.invulnerabilityTimer <= 0 && inPlayerPunchVolume(c, victim, settings)) {
      strike(state, c, victim, settings, events);
      learning?.lifecycle?.impact(c, victim, 'melee');
    }
  }
}

/** Roster bots use a planar, body-centered splash, including sword and side-swipe. */
function resolveRosterHit(state: SimState, c: SimCombatant, settings: UniversalSettings, events: KillEvent[], feedback?: RosterMeleeHitFeedback, learning?: RosterCombatLearning): void {
  const reach = c.weapon === 'ball' ? resolvePunchLungeDistance(settings)
    : strikeRange(settings) * (c.weapon === 'sword' ? SWORD_SLASH_FORWARD_FACTOR : 1);
  const radius = c.weapon === 'ball' ? GRIFBALL_PUNCH_RADIUS : c.weapon === 'sword' ? SWORD_SLASH_RADIUS : strikeRadius(settings);
  const fwd = forwardDir(c.yaw);
  const impact = c.weapon === 'hammer' && c.hammerJumpPlanned
    ? { x: c.pos.x, y: c.pos.y + 1.2 - reach, z: c.pos.z }
    : { x: c.pos.x + fwd.x * reach, y: c.pos.y + 1.2, z: c.pos.z + fwd.z * reach };
  if (c.hammerJumpPlanned) {
    const jump = { ...c, activeWeapon: c.weapon, aiHammerJumpsInAir: c.hammerJumpsInAir };
    if (applyAIHammerJumpAtImpact(jump, settings, impact)) c.grounded = false;
    c.isJumping = jump.isJumping; c.hammerJumpsInAir = jump.aiHammerJumpsInAir;
    c.hammerJumpWindowTimer = jump.hammerJumpWindowTimer;
    c.hammerJumpPlanned = jump.hammerJumpPlanned;
    if (jump.hammerJumpType !== undefined) c.hammerJumpType = jump.hammerJumpType; else delete c.hammerJumpType;
  }
  // Live roster impacts visit the local player before the roster, regardless of storage order.
  const victims = state.combatExecution === 'live-mixed-v1'
    ? [...state.combatants].sort((a, b) => Number(isMixedPlayer(state, b)) - Number(isMixedPlayer(state, a))) : state.combatants;
  for (const victim of victims) {
    if (!victim.alive || !areHostile(c, victim) || victim.invulnerabilityTimer > 0) continue;
    const cy = victim.pos.y + (victim.isCrouching ? CROUCH_BODY_CENTER_HEIGHT : BODY_CENTER_HEIGHT);
    const targetRadius = usesRosterLifecycle(state) ? adjustRangeForTargetModel(radius, victim.modelType) : radius;
    if (Math.hypot(victim.pos.x - impact.x, cy - impact.y, victim.pos.z - impact.z) <= targetRadius) {
      strike(state, c, victim, settings, events);
      learning?.meleeHit(c, victim);
      learning?.lifecycle?.impact(c, victim, 'melee');
      if (victim.hp > 0) feedback?.(c, victim);
    }
  }
}

/**
 * Opt-in stationary attack timing. Elapsed clocks and phase-boundary resets mirror live
 * animation updates, including advancing a newly requested attack on this tick.
 * Keeping the elapsed value avoids subtraction round-off moving a boundary one tick.
 * weaponTimer remains remaining time for existing observation consumers.
 */
function stepLiveAttack(state: SimState, c: SimCombatant, action: ActionInput,
  settings: UniversalSettings, dt: number, events: KillEvent[], canAttack: boolean, feedback?: RosterMeleeHitFeedback,
  movingAICommit = false, learning?: RosterCombatLearning, observeAttack = true): void {
  const enter = (phase: SimCombatant['weaponState'], duration: number) => {
    c.weaponState = phase; c.weaponPhaseElapsed = 0; c.weaponTimer = duration;
  };
  const slam = resolveHammerSlamTiming(settings);
  const roster = isRosterExecution(combatExecutionForActor(state, c));
  // Objective pickup/release can change the equipped weapon during a swing.
  // Live roster animation and local hammer/ball swings sample that weapon each
  // frame, preserving elapsed time through objective pickup/release.
  if ((roster || isMixedPlayer(state, c) && (c.attackKind === 'strike' || c.attackKind === 'punch')) &&
    c.weaponState !== 'idle' && c.attackKind !== 'none' && c.attackKind !== 'swipe')
    c.attackKind = c.weapon === 'ball' ? 'punch' : c.weapon === 'sword' ? 'slash' : 'strike';
  const swingDuration = () => c.attackKind === 'slash' ? (settings.swordSlashSpeed ?? .22) * (roster ? .5 : 1)
    : roster && c.attackKind === 'swipe' ? (settings.hammerMeleeSpeed ? settings.hammerMeleeSpeed * .4 : .1)
    : c.attackKind === 'strike' ? slam.windupTime : (settings.hammerMeleeSpeed ?? .24);
  const strikeDuration = () => c.attackKind === 'strike' ? slam.attackTime
    : c.attackKind === 'slash' ? (settings.swordSlashSpeed ?? .22) * .5
    : c.attackKind === 'swipe' ? (settings.hammerMeleeSpeed ? settings.hammerMeleeSpeed * .6 : .14)
    : Math.max(.03, (settings.hammerMeleeSpeed ?? .24) * .5);
  if (c.weaponState === 'idle') {
    if (!canAttack || c.dashRemaining > 0 && !movingAICommit) return;
    if (action.attackSecondary && c.weapon === 'sword') {
      startLunge(c, settings, state); c.lastAttackTick = state.tick; return;
    }
    const kind = action.attackSecondary && c.weapon === 'hammer' ? 'swipe'
      : action.attackPrimary ? (c.weapon === 'sword' ? 'slash' : c.weapon === 'ball' ? 'punch' : 'strike') : null;
    if (!kind) return;
    if (isMixedPlayer(state, c) && kind === 'slash') delete c.playerSwordLungeRecovery;
    c.attackKind = kind; c.lastAttackTick = state.tick;
    if (usesRosterLifecycle(state)) {
      const now = state.combatTimeMs ?? state.tick * 1000 / 60;
      if (c.weapon === 'sword') c.lastSwordAttackTimeMs = now;
      else if (c.weapon === 'hammer') c.lastHammerAttackTimeMs = now;
    }
    if (observeAttack && roster && c.weapon !== 'sword') learning?.hammerAttack(c);
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
      if (elapsed >= duration * .5 && previous < duration * .5) resolveMeleeHit(state, c, settings, events, learning);
      if (c.alive && elapsed >= duration) recover();
    } else if (elapsed >= duration) {
      enter('active', strikeDuration());
      if (c.attackKind === 'slash') resolveRosterHit(state, c, settings, events, feedback, learning);
    }
  } else if (c.weaponState === 'active') {
    const duration = strikeDuration();
    c.weaponTimer = Math.max(0, duration - elapsed);
    if (elapsed >= duration) {
      if (roster) { if (c.attackKind !== 'slash') resolveRosterHit(state, c, settings, events, feedback, learning); }
      else if (c.attackKind === 'punch') resolvePlayerPunch(state, c, settings, events, learning);
      else {
        resolveHammerStrike(state, c, settings, events, learning);
        // Live hammer-jump window is based on distance from the projected impact to feet.
        const aim = playerLookDirection(c), reach = strikeRange(settings);
        if (Math.hypot(aim.x * reach, MELEE_EYE_HEIGHT - (c.crouchAmount ?? 0) + aim.y * reach, aim.z * reach) <= (settings.hammerJumpTriggerRadius ?? 3.5)) {
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

/** Intent clocks are independent of flight resolution. No-target recovery uses
 * this boundary before cancelling flight, so cancellation cannot cause contact. */
export function tickWeaponIntentTimers(c: SimCombatant, dt: number, swapTimersAdvanced = false): void {
  if (!swapTimersAdvanced) tickWeaponSwapTimers(c, dt);
  if (c.attackCooldown > 0) c.attackCooldown = Math.max(0, c.attackCooldown - dt);
  if (c.hammerJumpWindowTimer > 0) c.hammerJumpWindowTimer = Math.max(0, c.hammerJumpWindowTimer - dt);
}

/** Committed roster flight: one selected target, one contact, elapsed timeout and AI cooldown. */
function resolveRosterLunge(state: SimState, c: SimCombatant, settings: UniversalSettings, dt: number, events: KillEvent[], feedback?: RosterLungeFeedback, learning?: RosterCombatLearning): void | 'trade_return' {
  c.lungeTimer += dt;
  const target = findCombatant(state, c.lungeTargetId!);
  const finish = (outcome: NonNullable<SimCombatant['lungeOutcome']>, actor = c, damageAlreadyRecorded = false) => {
    actor.isLunging = false; actor.weaponState = 'idle'; actor.weaponTimer = 0; actor.weaponPhaseElapsed = 0;
    actor.lungeOutcome = outcome; actor.attackCooldown = settings.swordLungeReload ?? 1.2;
    actor.vel.x = actor.vel.z = 0;
    if (actor.pos.y > .01 || Math.abs(actor.vel.y) > .01) { actor.vel.y = Math.min(actor.vel.y, 0); actor.isJumping = true; }
    else { actor.vel.y = 0; actor.isJumping = false; }
    feedback?.finish(actor, outcome, actor === c ? c.lungeTargetId : c.id, damageAlreadyRecorded);
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
    const trade = c.invulnerabilityTimer <= 0 && (target.weapon === 'sword'
      ? settings.enableSwordTrade && (targetWasLunging || primaryActive || recent(target.lastSwordAttackTimeMs, settings.swordTradeWindow ?? 350))
      : target.weapon === 'hammer' && settings.enableHammerSwordTrade && (primaryActive || recent(target.lastHammerAttackTimeMs, settings.hammerSwordTradeWindow ?? 350)));
    // A live decision can equip the hammer during flight. Non-trade contact
    // still credits the committed sword lunge, not the newly equipped weapon.
    strike(state, c, target, settings, events, trade ? c.weapon : 'sword');
    if (trade) {
      strike(state, target, c, settings, events);
      feedback?.impact(c, target, true);
      learning?.lifecycle?.impact(c, target, 'lunge', true, targetWasLunging);
      if (target.alive && targetWasLunging && isMixedPlayer(state, target)) {
        // Incoming trades consume local flight into player recovery. The live
        // player keeps this frame's velocity until the next movement update.
        target.isLunging = false; target.lungeTimer = 0; target.lungeOutcome = 'hit';
        target.weaponState = 'recovering'; target.attackKind = 'none'; target.weaponPhaseElapsed = 0;
        target.weaponTimer = target.attackCooldown = settings.swordLungeReload ?? 1.2;
      } else if (target.alive && targetWasLunging) finish('hit', target, true);
      else if (target.alive && primaryActive) {
        target.weaponState = 'recovering'; target.weaponPhaseElapsed = 0;
        target.weaponTimer = recoverForKind(target.attackKind, settings);
        target.attackCooldown = target.weaponTimer;
      }
      if (c.alive) finish('hit', c, !isMixedPlayer(state, target));
      else { c.isLunging = false; c.weaponState = 'idle'; c.weaponTimer = 0; c.weaponPhaseElapsed = 0; }
    } else {
      feedback?.impact(c, target, false); finish('hit');
      learning?.lifecycle?.impact(c, target, 'lunge');
    }
    return trade ? 'trade_return' : undefined;
  }
  const start = c.lungeStartPos!;
  const boundary = isVectorXZAtArenaBoundary({ pos: new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z),
    activeCustomMap: state.map, arenaRadius: state.map.arenaRadius, inset: .65 });
  if (boundary) finish('miss_arena');
  else if (exceedsSwordLungeTravel(Math.hypot(c.pos.x - start.x, c.pos.y - start.y, c.pos.z - start.z)) || c.lungeTimer > .8) finish('miss_timeout');
}

/** Independently resolved local-player flight for the opt-in mixed profile. */
export function resolveMixedPlayerLunge(state: SimState, c: SimCombatant, settings: UniversalSettings, dt: number, events: KillEvent[], learning?: RosterCombatLearning): void {
  c.lungeTimer += dt;
  const finish = (outcome: NonNullable<SimCombatant['lungeOutcome']>) => {
    learning?.localLungeEnd?.(c, outcome === 'hit');
    c.isLunging = false; c.lungeOutcome = outcome;
    c.playerSwordLungeRecovery = { elapsed: 0, duration: settings.swordLungeReload ?? 1.2 };
    // A reset may already have equipped the hammer. Finish the hidden sword without blocking the hammer.
    if (c.weapon === 'sword') {
      c.weaponState = 'recovering'; c.attackKind = 'none';
      c.weaponPhaseElapsed = 0; c.weaponTimer = c.attackCooldown = c.playerSwordLungeRecovery.duration;
    }
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
    const trade = c.invulnerabilityTimer <= 0 && (target.weapon === 'sword'
      ? settings.enableSwordTrade && (target.isLunging || primary || recent(target.lastSwordAttackTimeMs, settings.swordTradeWindow ?? 350))
      : target.weapon === 'hammer' && settings.enableHammerSwordTrade && (primary || recent(target.lastHammerAttackTimeMs, settings.hammerSwordTradeWindow ?? 350)));
    const targetWasLunging = target.isLunging;
    if (!trade) learning?.localLungeImpact?.(c, target, false);
    strike(state, c, target, settings, events);
    if (trade) {
      strike(state, target, c, settings, events);
      if (target.alive && target.isLunging) {
        target.vel.x = target.vel.z = 0;
        target.vel.y = Math.min(target.vel.y, 0);
        target.isJumping = target.pos.y > .01 || Math.abs(target.vel.y) > .01;
        target.attackCooldown = settings.swordLungeReload ?? 1.2;
      }
      // A recent-history counter may come from a roster actor whose flight has
      // already ended. Live trades retain that survivor's existing reload.
      // Lethal hits already clear cooldown through strike's death handling.
      target.isLunging = false; target.weaponState = 'idle'; target.weaponTimer = target.weaponPhaseElapsed = 0;
      target.attackKind = 'none';
    }
    learning?.lifecycle?.impact(c, target, 'lunge', !!trade, targetWasLunging);
    if (trade) learning?.localLungeImpact?.(c, target, true);
    finish('hit'); return;
  }
  const start = c.lungeStartPos!;
  if (exceedsSwordLungeTravel(Math.hypot(c.pos.x - start.x, c.pos.y - start.y, c.pos.z - start.z)) || c.lungeTimer > .8) finish('miss_timeout');
  else if (isVectorXZAtArenaBoundary({ pos: new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z), activeCustomMap: state.map,
    arenaRadius: state.map.arenaRadius, inset: .6 })) finish('miss_arena');
}

/** Local sword animation only advances while equipped; retain elapsed time after it becomes ready. */
function advancePlayerLungeRecovery(c: SimCombatant, settings: UniversalSettings, dt: number): void {
  const recovery = c.playerSwordLungeRecovery ??= { elapsed: c.weaponPhaseElapsed ?? 0, duration: settings.swordLungeReload ?? 1.2 };
  recovery.elapsed += dt;
  c.weaponPhaseElapsed = recovery.elapsed;
  c.weaponTimer = Math.max(0, recovery.duration - recovery.elapsed);
  c.attackCooldown = c.weaponTimer;
  c.weaponState = c.weaponTimer === 0 ? 'idle' : 'recovering';
}

/** Mechanical swap clocks; the mixed main-AI frame owns these before roster turns. */
export function tickWeaponSwapTimers(c: SimCombatant, dt: number): void {
  if (c.swapLockoutTimer > 0) c.swapLockoutTimer = Math.max(0, c.swapLockoutTimer - dt);
  if (c.weaponReadyTimer > 0) c.weaponReadyTimer = Math.max(0, c.weaponReadyTimer - dt);
}

/**
 * Advance one combatant's weapon FSM by `dt` and resolve any hits this tick.
 * Movement (including the lunge flight integration) is owned by physics; this only
 * mutates weapon state/timers and applies damage. A frame owner that already
 * advanced swap clocks must set swapTimersAdvanced to avoid spending them twice.
 */
export function stepCombatantWeapons(
  state: SimState,
  c: SimCombatant,
  action: ActionInput,
  settings: UniversalSettings,
  dt: number,
  events: KillEvent[],
  stage: 'complete' | 'intent' | 'animation' | 'flight' | 'flight-animation' = 'complete',
  scriptedCommands?: readonly ScriptedCombatCommand[],
  feedback?: RosterMeleeHitFeedback,
  lungeFeedback?: RosterLungeFeedback,
  swapTimersAdvanced = false,
  engagement?: { beforeAttack?: () => void; mobilityAfterCommands?: number; sequentialOpportunities?: boolean; groundReadyOverride?: boolean;
    committedFlight?: boolean; lungeStarted?: boolean },
  learning?: RosterCombatLearning
): void | 'trade_return' {
  if (engagement && (stage !== 'intent' || !scriptedCommands || state.combatExecution !== 'live-mixed-v1' || isMixedPlayer(state, c)))
    throw new Error('Engagement commits require scheduled roster command intent');
  if (scriptedCommands && (!usesRosterLifecycle(state) || isMixedPlayer(state, c)))
    throw new Error('Scripted combat commands require a roster actor in an explicit live roster profile');
  if (!c.alive) return;
  // Live roster visuals advance swings even during flight. This phase follows
  // objectives and must neither resolve flight contact nor spend intent clocks.
  if (stage === 'flight-animation') {
    if (state.combatExecution !== 'live-mixed-v1' || isMixedPlayer(state, c) || scriptedCommands)
      throw new Error('Scheduled flight animation requires a mixed roster actor without commands');
    stepLiveAttack(state, c, action, settings, dt, events, false, feedback, false, learning);
    return;
  }
  // The scheduled owner already spent intent clocks before flight movement.
  if (stage === 'flight') {
    if (!usesRosterLifecycle(state) || isMixedPlayer(state, c) || !c.isLunging || scriptedCommands)
      throw new Error('Flight contact requires an existing roster flight without new commands');
    return resolveRosterLunge(state, c, settings, dt, events, lungeFeedback, learning);
  }
  if (stage === 'animation' && c.isLunging) return;
  if (isMixedPlayer(state, c)) {
    if (c.isLunging) return;
    if (c.weaponState === 'recovering' && c.attackKind === 'none') {
      advancePlayerLungeRecovery(c, settings, dt);
      return;
    }
  }

  if (stage !== 'animation') {
    tickWeaponIntentTimers(c, dt, swapTimersAdvanced);

    if (scriptedCommands) {
      // The AI owner already checked its decision cooldown. Preserve live swap
      // ordering, including a recovery swap making the local decision ready;
      // the old animation itself continues unless a subsequent attack replaces it.
      let decisionReady = c.weaponState === 'idle';
      const entryDashRemaining = c.dashRemaining;
      let committedHere = false;
      let mobilityApplied = false;
      const applyMobility = () => {
        if (mobilityApplied) return;
        mobilityApplied = true;
        engagement?.beforeAttack?.();
      };
      for (const [index, command] of scriptedCommands.entries()) {
        if (engagement?.mobilityAfterCommands === undefined
          ? command.kind === 'melee' || command.kind === 'lunge' || command.kind === 'hammer-jump'
          : index === engagement.mobilityAfterCommands) applyMobility();
        if (command.kind === 'revert-weapon-feint') {
          if (c.isLunging && !engagement?.committedFlight || c.weapon !== 'sword' || c.weaponState === 'windup' || c.weaponState === 'active') continue;
          // Live feint expiry clears lockout, retains readiness and leaves the
          // underlying recovery animation running under the restored hammer.
          c.weapon = 'hammer'; c.swapLockoutTimer = 0;
          learning?.weaponSwap(c, 'hammer');
          if (c.weaponState === 'recovering' && c.attackKind !== 'swipe') c.attackKind = 'strike';
          decisionReady = true;
        } else if (command.kind === 'swap') {
          if (c.isLunging && !engagement?.committedFlight || c.weapon === 'ball' || c.weapon === command.weapon || c.swapLockoutTimer > 0 ||
            c.weaponState === 'windup' || c.weaponState === 'active') continue;
          c.weapon = command.weapon;
          learning?.weaponSwap(c, command.weapon);
          if (c.weaponState === 'recovering' && c.attackKind !== 'swipe') c.attackKind = c.weapon === 'sword' ? 'slash' : 'strike';
          const timers = resolveAIWeaponSwapTimers(settings, c.swapLockoutTimer, c.weaponReadyTimer);
          c.swapLockoutTimer = timers.lockout; c.weaponReadyTimer = timers.readiness;
          decisionReady = true;
        } else if (command.kind === 'hammer-jump') {
          if (!engagement || !decisionReady || c.weapon !== 'hammer') continue;
          const jump = { id: c.id, weaponState: 'ready' as import('../types').WeaponState, weaponTimer: c.weaponPhaseElapsed ?? 0,
            isJumping: c.isJumping, aiHammerJumpsInAir: c.hammerJumpsInAir,
            hammerJumpPlanned: c.hammerJumpPlanned, hammerJumpType: c.hammerJumpType };
          const started = startAIHammerJumpAction({ self: jump, settings, vel: c.vel, horizontalHeading: command.heading,
            jumpType: command.jumpType, playSwing: () => {}, playJump: () => {}, onMainAIHammerSwing: () => {
              // Main AI's live weapon callback checks readiness and an active dash.
              if (c.weaponReadyTimer > 0 || (engagement.sequentialOpportunities ? entryDashRemaining : c.dashRemaining) > 0) return;
              c.weaponState = 'idle';
              stepLiveAttack(state, c, { ...action, attackPrimary: true, attackSecondary: false }, settings, 0, events, true, feedback, !!engagement.sequentialOpportunities, learning, false);
              if ((c as SimCombatant).weaponState === 'windup') jump.weaponState = 'swing_up';
            } });
          if (jump.hammerJumpPlanned !== undefined) c.hammerJumpPlanned = jump.hammerJumpPlanned;
          if (jump.hammerJumpType !== undefined) c.hammerJumpType = jump.hammerJumpType; else delete c.hammerJumpType;
          if (!started) continue;
          // Ordinary launch sets animation directly: it does not record a new
          // attack timestamp through the generic attack callback in production.
          c.weaponState = 'windup'; c.attackKind = 'strike'; c.weaponPhaseElapsed = 0;
          c.weaponTimer = resolveHammerSlamTiming(settings).windupTime;
          c.isJumping = jump.isJumping; c.hammerJumpsInAir = jump.aiHammerJumpsInAir;
          if (c.isJumping) c.grounded = false;
          decisionReady = false; committedHere = true;
        } else if ((decisionReady || engagement?.sequentialOpportunities && committedHere && command.kind === 'melee' && command.weapon === 'hammer' && !command.swipe) && c.weaponReadyTimer <= 0 && (c.dashRemaining <= 0 || engagement && command.kind === 'melee' || engagement?.sequentialOpportunities && command.kind === 'lunge')) {
          if (command.kind === 'lunge') {
            const target = findCombatant(state, command.targetId);
            if (c.weapon !== 'sword' || !target?.alive || target.hp <= 0 || target.team === c.team || target.invulnerabilityTimer > 0) continue;
            c.lungeTargetId = command.targetId; c.lungeAimDirection = { ...command.direction };
            startLunge(c, settings, state); c.lastAttackTick = state.tick;
            if (engagement) engagement.lungeStarted = true;
            return; // Live combo commitment returns before advancing new flight.
          }
          if (c.weapon !== command.weapon) continue;
          c.weaponState = 'idle';
          stepLiveAttack(state, c, { ...action, attackPrimary: !command.swipe, attackSecondary: command.swipe }, settings, 0, events, true, feedback, !!engagement, learning);
          decisionReady = false; committedHere = true;
        }
      }
      applyMobility();
      // A later ground priority may retain ready locals after an accepted swap
      // or an attack committed in this turn. Merely attempting a refused command
      // must not authorize replacing an attack that was already in progress.
      if (engagement) engagement.groundReadyOverride = decisionReady || committedHere;
    }

    // Weapon swap (hammer <-> sword): blocked while carrying the ball, mid-action, or on lockout.
    // A swap makes the new weapon un-ready for `weaponReadyTime` before it can fire.
    if (action.swapWeapon && !c.isLunging && c.weapon !== 'ball' && c.weaponState === 'idle' && c.swapLockoutTimer <= 0) {
      c.weapon = c.weapon === 'hammer' ? 'sword' : 'hammer';
      learning?.weaponSwap(c, c.weapon);
      if (isRosterExecution(combatExecutionForActor(state, c))) {
        const timers = resolveAIWeaponSwapTimers(settings, c.swapLockoutTimer, c.weaponReadyTimer);
        c.swapLockoutTimer = timers.lockout;
        c.weaponReadyTimer = timers.readiness;
      } else {
        c.swapLockoutTimer = settings.weaponSwapLockout ?? 1.0;
        c.weaponReadyTimer = settings.weaponReadyTime ?? 0.5;
      }
      if (isMixedPlayer(state, c) && c.weapon === 'sword' && c.playerSwordLungeRecovery) {
        const recovery = c.playerSwordLungeRecovery;
        c.weaponPhaseElapsed = recovery.elapsed;
        if (recovery.elapsed < recovery.duration) {
          c.attackKind = 'none';
          advancePlayerLungeRecovery(c, settings, dt);
          return;
        }
      }
    }
  }

  // Scheduled flight decisions commit before travel, including an empty intent.
  if (stage === 'intent' && engagement?.committedFlight) return;

  // Active lunge flight: kill-on-contact, run down the lunge timer.
  if (c.isLunging) {
    if (usesRosterLifecycle(state)) return resolveRosterLunge(state, c, settings, dt, events, lungeFeedback, learning);
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
  const canAttack = weaponAttackCooldown(c, combatExecutionForActor(state, c)) <= 0 && c.weaponReadyTimer <= 0;

  // Mixed frames commit the roster's requested action before objectives, but
  // advance skeletal melee afterward. Existing complete-step callers are unchanged.
  if (stage === 'intent') {
    if (c.weaponState === 'idle') stepLiveAttack(state, c, action, settings, 0, events, canAttack, feedback, false, learning);
    return;
  }

  if ((combatExecutionForActor(state, c) === 'live-player-v1' || isRosterExecution(combatExecutionForActor(state, c))) && !(c.weaponState === 'recovering' && c.attackKind === 'none')) {
    stepLiveAttack(state, c, action, settings, dt, events, stage !== 'animation' && canAttack, feedback, false, learning);
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

/** Commit an already-arbitrated roster lunge without advancing any turn clocks
 * or travelling on its launch frame. Used by deferred ground opportunities. */
export function startSimRosterLunge(state: SimState, c: SimCombatant, settings: UniversalSettings,
  targetId: string, direction: SimCombatant['lungeDir']): void {
  if (!usesRosterLifecycle(state) || isMixedPlayer(state, c) || c.weapon !== 'sword')
    throw new Error('Ground lunge requires an armed roster actor');
  c.lungeTargetId = targetId; c.lungeAimDirection = { ...direction };
  startLunge(c, settings, state); c.lastAttackTick = state.tick;
}

function startLunge(c: SimCombatant, settings: UniversalSettings, state?: SimState): void {
  if (state && isMixedPlayer(state, c)) {
    const target = findCombatant(state, c.lungeTargetId ?? '');
    if (!target || target.id === c.id) throw new Error('live-mixed-v1 requires an explicit lungeTargetId for commitment');
    const aim = c.lungeAimDirection ?? { x: target.pos.x - c.pos.x, y: 0, z: target.pos.z - c.pos.z };
    const length = Math.hypot(aim.x, aim.z);
    if (!Number.isFinite(length) || length === 0) throw new Error('Player lunge heading must be finite and nonzero');
    delete c.playerSwordLungeRecovery;
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
    delete c.playerSwordLungeRecovery;
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
  const spawn = selectSimRespawnPosition(state, c);
  c.pos = { x: spawn.x, y: rosterV2 ? spawn.y : 0, z: spawn.z };
  c.vel = { x: 0, y: 0, z: 0 };
  c.yaw = inwardSpawnYaw(spawn);
  if (combatExecutionForActor(state, c) === 'live-player-v1') c.pitch = 0;
  // Both player and roster actors use +Z aim in the mixed execution profile.
  if (state.combatExecution === 'live-mixed-v1') c.yaw -= Math.PI;
  c.alive = true;
  c.hp = rosterV2 ? c.maxHp : settings.maxHP ?? 1;
  if (!rosterV2) c.maxHp = settings.maxHP ?? 1;
  c.respawnTimer = 0;
  c.invulnerabilityTimer = settings.respawnInvulnerabilityDuration ?? 1.0;
  if (!rosterV2) c.weapon = 'hammer';
  c.weaponState = 'idle';
  c.weaponTimer = 0;
  delete c.playerSwordLungeRecovery;
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
  if (c.aiHammerJumpCooldownTimer !== undefined) c.aiHammerJumpCooldownTimer = 0;
  if (c.hammerJumpPlanned !== undefined) c.hammerJumpPlanned = false;
  delete c.hammerJumpType;
  c.passChargeTimer = 0;
  c.isJumping = false;
  c.isLunging = false;
  c.lungeTimer = 0;
  c.dashRemaining = 0;
  c.hasBall = false;
}
