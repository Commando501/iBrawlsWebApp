/**
 * `stepSimulation` — one fixed simulation tick (dt = 1/60 s). The legacy profiles
 * use actions → movement → weapons/damage → passes → grifball
 * objective (phase machine, ball, pickups, scoring) → respawns. Returns the tick's
 * events (goals, kills, pickups, phase transitions) for reward calculation.
 * live-roster-v2 moves respawns before AI and resolves committed flights in roster
 * order; this does not model the complete live decision or mixed-player pipeline.
 *
 * Determinism: the only randomness source is the injected RNG, whose state lives in
 * `SimState.rngState` and is restored/snapshotted every tick. A (seed + action
 * sequence) therefore reproduces an identical state hash across runs and restarts.
 */

import { type UniversalSettings } from '../types';
import { resolveRunnerThrowAllowed } from '../game/runnerBallSettings';
import { resolveSimSettings } from './factory';
import { type SimState } from './simState';
import { type ActionsById, idleAction } from './actions';
import { createRng, type Rng } from './rng';
import { stepCombatantMovement } from './physics';
import { stepCombatantWeapons, resolveMixedPlayerLunge, tickRespawns, type KillEvent } from './weapons';
import { tickGrifballObjective, throwSimPass, reconcileSimCarrier, type ObjectiveEvents } from './grifball';
import { tickCombat } from './combat';

/** Canonical fixed timestep. */
export const SIM_DT = 1 / 60;

export interface StepEvents extends ObjectiveEvents {
  kills: KillEvent[];
}

export interface StepOptions {
  /** Effective settings; defaults to the standard grifball sim settings. */
  settings?: UniversalSettings;
  /** Timestep override (defaults to {@link SIM_DT}). */
  dt?: number;
}

/**
 * Advance `state` in place by one tick using `actionsById` (missing combatants idle).
 * Returns the events produced this tick.
 */
export function stepSimulation(
  state: SimState,
  actionsById: ActionsById,
  options: StepOptions = {}
): StepEvents {
  const settings = options.settings ?? resolveSimSettings();
  const dt = options.dt ?? SIM_DT;
  const rng: Rng = createRng(0);
  rng.setState(state.rngState);

  const kills: KillEvent[] = [];
  const mixed = state.combatExecution === 'live-mixed-v1';
  // An omitted mixed-frame command is idle, preserving a reset/respawn heading.
  // Resolve it at use time because roster revival runs after local physics.
  const act = (id: string) => actionsById[id] ?? (mixed
    ? { ...idleAction(), aim: state.combatants.find(c => c.id === id)!.yaw } : idleAction());
  const mixedObjectiveFrame = mixed && state.mode === 'grifball';
  const player = mixed ? state.combatants.find(c => c.id === state.localPlayerId) : undefined;
  if (mixed && (!player || state.combatants.filter(c => c.id === state.localPlayerId).length !== 1))
    throw new Error('live-mixed-v1 requires exactly one explicit localPlayerId');
  // Pointer events are sampled before the frame: release from the previous
  // position/loadout, then move. Holding across a pickup is not a new press.
  if (mixedObjectiveFrame && player) {
    const input = act(player.id), held = input.attackSecondary;
    if (held && !player.passInputHeld && player.alive && player.hp > 0 && player.hasBall && resolveRunnerThrowAllowed(settings)) {
      player.passCharging = true; player.passChargeTimer = 0;
    } else if (!held && player.passInputHeld && player.passCharging) {
      player.yaw = input.aim;
      throwSimPass(state, player, player.passChargeTimer / (settings.grifballChargeMax ?? 1.2), settings);
      player.passCharging = false; player.passChargeTimer = 0;
    }
    player.passInputHeld = held;
  }
  const rosterV2 = state.combatExecution === 'live-roster-v2' || mixed;
  if (rosterV2) {
    const nominalTimeMs = state.tick * SIM_DT * 1000;
    const previousTimeMs = state.combatTimeMs ?? nominalTimeMs;
    // The live fixed runner derives time from its tick. Repeated addition would
    // turn the inclusive 350ms boundary into 350.00000000000006ms after 21 ticks.
    state.combatTimeMs = dt === SIM_DT && previousTimeMs === nominalTimeMs
      ? (state.tick + 1) * SIM_DT * 1000 : previousTimeMs + dt * 1000;
  }
  const flightAdvanced = rosterV2 ? new Set<string>() : null;
  // Local physics/contact and weapon animation precede roster respawn and AI.
  if (player) {
    const wasDead = !player.alive;
    tickRespawns(state, settings, dt, [player]);
    if (!wasDead) {
      stepCombatantMovement(state, player, act(player.id), settings, dt);
      if (player.isLunging) resolveMixedPlayerLunge(state, player, settings, dt, kills);
    }
    if (player.alive) stepCombatantWeapons(state, player, act(player.id), settings, dt, kills);
    else { delete player.playerSwordLungeRecovery; player.weaponState = 'idle'; player.weaponTimer = player.weaponPhaseElapsed = 0; player.isLunging = false; }
  }
  // The live roster revives actors before their AI tick. Newly killed actors wait
  // until the next frame, and each flight resolves before the next actor's shield tick.
  if (rosterV2) tickRespawns(state, settings, dt, state.combatants.filter(c => c !== player));

  // Ordinary live AI returns before movement/intent in inactive Grifball phases.
  // Capture the pre-objective phase: countdown completion resumes AI on the next frame.
  // This is explicit per actor; existing committed-action and legacy profiles keep their behavior.
  const phasePaused = new Set(mixedObjectiveFrame && state.match.phase !== 'playing'
    ? state.combatants.filter(c => c !== player && c.pauseDuringInactiveGrifball).map(c => c.id) : []);

  // Phase 1 — movement.
  for (const c of state.combatants) {
    if (c === player) continue;
    if (phasePaused.has(c.id)) {
      if (c.alive) {
        c.invulnerabilityTimer = Math.max(0, c.invulnerabilityTimer - dt);
        c.vel.x = c.vel.y = c.vel.z = 0;
      }
      continue;
    }
    stepCombatantMovement(state, c, act(c.id), settings, dt);
    if (rosterV2 && c.alive && c.isLunging) {
      stepCombatantWeapons(state, c, act(c.id), settings, dt, kills);
      flightAdvanced!.add(c.id);
    }
  }

  // Mixed roster decisions commit before objectives; skeletal damage follows them.
  // Other profiles retain their original combined weapons/damage phase.
  for (const c of state.combatants) {
    if (c !== player && !phasePaused.has(c.id) && !flightAdvanced?.has(c.id)) stepCombatantWeapons(state, c, act(c.id), settings, dt, kills, mixedObjectiveFrame ? 'intent' : 'complete');
  }

  // Phase 3 — passes: hold secondary to charge the throw (grifballChargeMax), release to throw.
  const chargeMax = settings.grifballChargeMax ?? 1.2;
  const throwingAllowed = resolveRunnerThrowAllowed(settings);
  for (const c of state.combatants) {
    if ((mixedObjectiveFrame && c === player) || phasePaused.has(c.id)) continue;
    if (!c.alive || !c.hasBall) continue;
    const a = act(c.id);
    if (!throwingAllowed) {
      c.passChargeTimer = 0;
    } else if (a.attackSecondary) {
      c.passChargeTimer = Math.min(chargeMax, c.passChargeTimer + dt);
    } else if (c.passChargeTimer > 0) {
      throwSimPass(state, c, c.passChargeTimer / chargeMax, settings);
      c.passChargeTimer = 0;
    }
  }

  // A paused AI clears pickup intent even when this objective update ends countdown.
  const objectiveActions = phasePaused.size
    ? Object.fromEntries(Object.entries(actionsById).filter(([id]) => !phasePaused.has(id))) : actionsById;

  // Phase 4 — objective: grifball (ball/pickups/scoring) or combat (kill-target win).
  const objective =
    state.mode === 'combat'
      ? tickCombat(state, settings, dt)
      : tickGrifballObjective(state, settings, dt, objectiveActions);

  if (mixedObjectiveFrame) {
    for (const c of state.combatants) if (c !== player && !flightAdvanced?.has(c.id))
      stepCombatantWeapons(state, c, act(c.id), settings, dt, kills, 'animation');
    reconcileSimCarrier(state, settings);
  }

  // Phase 5 — respawns.
  if (!rosterV2) tickRespawns(state, settings, dt);

  state.tick += 1;
  state.rngState = rng.getState();

  return { ...objective, kills };
}
