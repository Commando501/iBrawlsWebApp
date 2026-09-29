/**
 * Pure Grifball objective tick — a headless port of
 * `grifball/grifballObjectiveRuntime.ts` operating on {@link SimState}. All THREE /
 * React refs are gone; the objective logic itself is unchanged and reuses the same
 * pure modules the live game does (`grifballBall`, `grifballGoals`, `grifballMatch`,
 * `teamScoring`).
 *
 * Carrier perks mirror the live `setGrifballCarrierForState`: picking up the ball
 * swaps to the 'ball' (punch) weapon, grants +1 max HP, and heals to full; dropping
 * it reverts the weapon and clamps HP back down.
 */

import { type UniversalSettings } from '../types';
import {
  resolveRunnerHealDelay,
  resolveRunnerHealRate,
  resolveRunnerMaxHp,
  resolveRunnerThrowAllowed,
} from '../game/runnerBallSettings';
import {
  attachBallTo,
  dropBall,
  findBallPickup,
  isBallGrabbable,
  returnBallHome,
  throwBall,
  tickBallPhysics,
  type BallPickupCandidate,
} from '../game/grifballBall';
import { findScoringPlate } from '../game/grifballGoals';
import {
  isGrifballLive,
  registerGoal,
  resolveMatchConfig,
  tickGrifballMatch,
} from '../game/grifballMatch';
import { awardTeamGoal, type TeamId } from '../game/teamScoring';
import { type SimState, type SimCombatant, findCombatant, isMixedPlayer } from './simState';
import { type ActionsById } from './actions';
import { forwardDir } from './physics';
import { inwardSpawnYaw } from './factory';

/** Height of the held ball above the carrier's feet (matches live runtime). */
const CARRY_HEIGHT = 1.1;

export interface ObjectiveEvents {
  /** Countdown ended this tick — ball is now live. */
  startedPlaying: boolean;
  /** A goal was scored this tick (by this team). */
  goal: TeamId | null;
  /** A combatant grabbed the loose/idle ball this tick. */
  pickup: string | null;
  /** Scored hold elapsed with no winner — combatants were re-spawned. */
  roundReset: boolean;
  /** Match ended this tick. */
  matchEnded: boolean;
}

const NO_EVENTS = (): ObjectiveEvents => ({
  startedPlaying: false,
  goal: null,
  pickup: null,
  roundReset: false,
  matchEnded: false,
});

/** Apply / revert the ball-carrier loadout perks on a combatant. */
export function setSimCarrier(
  c: SimCombatant,
  carrying: boolean,
  settings: UniversalSettings,
  state?: SimState
): void {
  const mixed = state?.combatExecution === 'live-mixed-v1';
  const baseMaxHp = settings.maxHP ?? 1;
  if (carrying) {
    c.weapon = 'ball';
    c.maxHp = resolveRunnerMaxHp(settings);
    c.hp = c.maxHp;
    c.hasBall = true;
    if (!mixed) {
      c.weaponState = 'idle';
      c.weaponTimer = 0;
      delete c.weaponPhaseElapsed;
    }
    c.runnerHealDelayTimer = 0;
    c.runnerLastHp = c.hp;
  } else {
    c.weapon = 'hammer';
    c.maxHp = baseMaxHp;
    c.hp = Math.min(c.hp, c.maxHp);
    c.hasBall = false;
    c.passChargeTimer = 0;
    c.runnerHealDelayTimer = 0;
    c.runnerLastHp = c.hp;
    // Live player release readies the hammer without erasing its animation clock.
    // Roster release preserves its current weapon phase.
    if (mixed && isMixedPlayer(state, c)) {
      c.passCharging = false;
      c.weaponState = 'idle'; c.weaponTimer = 0; c.attackKind = 'none'; c.attackCooldown = 0;
    }
  }
}

/** Live objectives enumerate the local player before the offline AI roster.
 * findBallPickup resolves equal distances in favour of the last candidate. */
function mixedObjectiveActors(state: SimState): SimCombatant[] {
  const player = state.combatants.find(c => isMixedPlayer(state, c));
  return [...(player ? [player] : []), ...state.combatants.filter(c => !isMixedPlayer(state, c) && c.controller === 'ai')];
}

/** A live round reset repositions participants; individual death/recovery timers
 * remain owned by their normal lifecycle. It is not a mass respawn. */
function placeMixedObjectiveActors(state: SimState, settings: UniversalSettings): void {
  const used: SimCombatant['pos'][] = [];
  for (const c of mixedObjectiveActors(state)) {
    const cluster = state.map.teamSpawns?.[c.team]?.length ? state.map.teamSpawns[c.team] : state.map.spawnPoints;
    let spawn: { x: number; y: number; z: number; yaw?: number } = cluster[0] ?? { x: 0, y: 0, z: 0 };
    let best = -1;
    for (const point of cluster) {
      const clearance = used.reduce((distance, other) => Math.min(distance,
        Math.hypot(point.x - other.x, point.y - other.y, point.z - other.z)), Infinity);
      if (clearance > best) { best = clearance; spawn = point; }
    }
    c.pos = { x: spawn.x, y: spawn.y, z: spawn.z }; c.vel = { x: 0, y: 0, z: 0 };
    // Live spawn yaw points the model's -Z forward; simulation aim uses +Z.
    c.yaw = (spawn.yaw ?? inwardSpawnYaw(spawn)) - Math.PI;
    used.push(c.pos);
    if (!isMixedPlayer(state, c)) { delete c.lastSwordAttackTimeMs; delete c.lastHammerAttackTimeMs; }
  }
  const player = state.combatants.find(c => isMixedPlayer(state, c));
  if (player) setSimCarrier(player, false, settings, state);
  for (const c of state.combatants) if (c.controller === 'ai' && c.weapon === 'ball') { c.weapon = 'hammer'; c.hasBall = false; }
}

export function tickSimRunnerHealing(
  state: SimState,
  settings: UniversalSettings,
  dt: number
): void {
  const holderId = state.match.ball.state === 'held' ? state.match.ball.holderId : null;
  if (!holderId) return;
  const carrier = findCombatant(state, holderId);
  if (!carrier || !carrier.alive || !carrier.hasBall) return;

  carrier.maxHp = resolveRunnerMaxHp(settings);
  carrier.hp = Math.min(carrier.hp, carrier.maxHp);
  if (carrier.hp < carrier.runnerLastHp) {
    carrier.runnerHealDelayTimer = resolveRunnerHealDelay(settings);
  } else if (carrier.runnerHealDelayTimer > 0) {
    carrier.runnerHealDelayTimer = Math.max(0, carrier.runnerHealDelayTimer - dt);
  } else if (carrier.hp > 0 && carrier.hp < carrier.maxHp) {
    carrier.hp = Math.min(carrier.maxHp, carrier.hp + resolveRunnerHealRate(settings) * dt);
  }
  carrier.runnerLastHp = carrier.hp;
}

/** Reset every combatant to its team spawn cluster, revived and re-armed. */
export function placeCombatantsAtSpawns(state: SimState, settings: UniversalSettings): void {
  const cursor: Record<TeamId, number> = {} as Record<TeamId, number>;
  for (const c of state.combatants) {
    const cluster = state.spawns[c.team] ?? [];
    const i = cursor[c.team] = (cursor[c.team] ?? 0);
    cursor[c.team] = i + 1;
    const spawn = cluster.length ? cluster[i % cluster.length] : { x: 0, y: 0, z: 0 };
    c.pos = { x: spawn.x, y: 0, z: spawn.z };
    c.vel = { x: 0, y: 0, z: 0 };
    c.yaw = inwardSpawnYaw(spawn);
    c.hp = settings.maxHP ?? 1;
    c.maxHp = settings.maxHP ?? 1;
    c.alive = true;
    c.respawnTimer = 0;
    c.invulnerabilityTimer = settings.respawnInvulnerabilityDuration ?? 0;
    c.weapon = 'hammer';
    c.weaponState = 'idle';
    c.weaponTimer = 0;
    delete c.weaponPhaseElapsed;
    c.attackKind = 'none';
    c.weaponReadyTimer = settings.weaponReadyTime ?? 0.5;
    c.hammerJumpWindowTimer = 0;
    c.hammerJumpsInAir = 0;
    c.passChargeTimer = 0;
    c.runnerHealDelayTimer = 0;
    c.runnerLastHp = c.hp;
    c.hasBall = false;
    c.isLunging = false;
    c.lungeTimer = 0;
    if ((state.combatExecution === 'live-roster-v2' || state.combatExecution === 'live-mixed-v1')) {
      delete c.lungeStartPos; delete c.lungeTargetId; delete c.lungeOutcome;
      delete c.lungeAimDirection;
      delete c.lastSwordAttackTimeMs; delete c.lastHammerAttackTimeMs;
      c.attackCooldown = 0;
    }
    c.dashRemaining = 0;
  }
}

/**
 * Throw the ball from its current carrier (a pass / shot). `chargeT` in [0,1] picks
 * the throw speed between the configured min/max. No-op if `c` isn't the carrier.
 */
export function throwSimPass(
  state: SimState,
  c: SimCombatant,
  chargeT: number,
  settings: UniversalSettings
): void {
  const ball = state.match.ball;
  if (ball.holderId !== c.id || !resolveRunnerThrowAllowed(settings)) return;
  const t = Math.min(1, Math.max(0, chargeT));
  const minSpeed = settings.grifballPassSpeedMin ?? 9;
  const maxSpeed = settings.grifballPassSpeedMax ?? 26;
  const speed = minSpeed + t * (maxSpeed - minSpeed);
  // Throw along the carrier's facing — forwardDir(yaw) = (sin yaw, cos yaw), matching the
  // live throw heading now that the sim's facing convention is unified.
  const f = forwardDir(c.yaw);
  const heading = { x: f.x, y: 0, z: f.z };
  throwBall(ball, { x: c.pos.x, y: c.pos.y + CARRY_HEIGHT, z: c.pos.z }, heading, speed);
  setSimCarrier(c, false, settings, state);
}

/** End-of-frame repair after late skeletal damage. Does not advance ball physics,
 * healing, pickup, phase timers or scoring a second time. */
export function reconcileSimCarrier(state: SimState, settings: UniversalSettings): boolean {
  const ball = state.match.ball;
  if (state.mode !== 'grifball' || ball.state !== 'held' || !ball.holderId) return false;
  const holder = findCombatant(state, ball.holderId);
  if (holder && holder.alive && holder.hp > 0 && holder.respawnTimer <= 0) return false;
  dropBall(ball, holder?.pos ?? ball.home);
  if (holder) setSimCarrier(holder, false, settings, state);
  return true;
}

/**
 * Advance the objective one tick: phase machine, ball follow/physics, pickups, and
 * scoring. Mirrors `updateGrifballObjectiveForState`. Returns the tick's events.
 */
export function tickGrifballObjective(
  state: SimState,
  settings: UniversalSettings,
  dt: number,
  actionsById: ActionsById = {}
): ObjectiveEvents {
  const events = NO_EVENTS();
  const g = state.match;
  const config = resolveMatchConfig(settings);
  const mixed = state.combatExecution === 'live-mixed-v1';
  const available = (c: SimCombatant) => c.alive && (!mixed || c.hp > 0 && c.respawnTimer <= 0);

  const phase = tickGrifballMatch(g, dt, config);
  events.startedPlaying = phase.startedPlaying;
  events.roundReset = phase.roundReset;
  events.matchEnded = phase.matchEnded;
  if (phase.roundReset) {
    if (mixed) placeMixedObjectiveActors(state, settings);
    else placeCombatantsAtSpawns(state, settings);
    returnBallHome(g.ball);
  }

  // Live pointer charging advances in the objective, after movement and AI.
  if (mixed) {
    const player = state.combatants.find(c => isMixedPlayer(state, c));
    if (player) {
      if (!resolveRunnerThrowAllowed(settings)) { player.passCharging = false; player.passChargeTimer = 0; }
      else if (player.passCharging) player.passChargeTimer += dt;
    }
  }

  // Ball follows its (living) holder, or runs free physics.
  if (g.ball.state === 'held' && g.ball.holderId) {
    const holder = findCombatant(state, g.ball.holderId);
    if (!holder || !available(holder)) {
      dropBall(g.ball, holder ? { x: holder.pos.x, y: 0, z: holder.pos.z } : g.ball.home);
      if (holder) setSimCarrier(holder, false, settings, state);
    } else {
      tickSimRunnerHealing(state, settings, dt);
      g.ball.pos.x = holder.pos.x;
      g.ball.pos.y = holder.pos.y + CARRY_HEIGHT;
      g.ball.pos.z = holder.pos.z;
    }
  } else {
    tickBallPhysics(g.ball, dt, settings.grifballBallReturnTimeout ?? 8, state.map);
  }

  if (isGrifballLive(g)) {
    // Pickups.
    if (isBallGrabbable(g.ball)) {
      const candidates: BallPickupCandidate[] = (mixed ? mixedObjectiveActors(state) : state.combatants)
        .filter((c) => available(c) && actionsById[c.id]?.pickup === true)
        .map((c) => ({ id: c.id, pos: c.pos, alive: true }));
      const grabId = findBallPickup(g.ball, candidates, settings.grifballPickupRadius ?? 1.6);
      if (grabId) {
        const grabber = findCombatant(state, grabId);
        if (grabber) {
          attachBallTo(g.ball, grabId);
          setSimCarrier(grabber, true, settings, state);
          events.pickup = grabId;
        }
      }
    }

    // Scoring.
    if (g.ball.state === 'held' && g.ball.holderId) {
      const carrier = findCombatant(state, g.ball.holderId);
      if (carrier && available(carrier)) {
        const plate = findScoringPlate(carrier.pos.x, carrier.pos.z, carrier.team, state.goalPlates);
        if (plate) {
          const total = awardTeamGoal(state.scores, carrier.team);
          registerGoal(g, carrier.team, total, config);
          setSimCarrier(carrier, false, settings, state);
          g.ball.state = 'idle';
          g.ball.holderId = null;
          g.ball.pos = { x: g.ball.home.x, y: 0.35, z: g.ball.home.z };
          events.goal = carrier.team;
        }
      }
    }
  }

  return events;
}
