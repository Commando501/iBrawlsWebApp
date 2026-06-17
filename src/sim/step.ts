/**
 * `stepSimulation` — one fixed simulation tick (dt = 1/60 s). Phased to mirror the
 * live tick order: ingest actions → movement → weapons/damage → passes → grifball
 * objective (phase machine, ball, pickups, scoring) → respawns. Returns the tick's
 * events (goals, kills, pickups, phase transitions) for reward calculation.
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
import { stepCombatantWeapons, tickRespawns, type KillEvent } from './weapons';
import { tickGrifballObjective, throwSimPass, type ObjectiveEvents } from './grifball';
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
  const act = (id: string) => actionsById[id] ?? idleAction();

  // Phase 1 — movement.
  for (const c of state.combatants) {
    stepCombatantMovement(state, c, act(c.id), settings, dt);
  }

  // Phase 2 — weapons / damage (resolved against post-movement positions).
  for (const c of state.combatants) {
    stepCombatantWeapons(state, c, act(c.id), settings, dt, kills);
  }

  // Phase 3 — passes: hold secondary to charge the throw (grifballChargeMax), release to throw.
  const chargeMax = settings.grifballChargeMax ?? 1.2;
  const throwingAllowed = resolveRunnerThrowAllowed(settings);
  for (const c of state.combatants) {
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

  // Phase 4 — objective: grifball (ball/pickups/scoring) or combat (kill-target win).
  const objective =
    state.mode === 'combat'
      ? tickCombat(state, settings, dt)
      : tickGrifballObjective(state, settings, dt);

  // Phase 5 — respawns.
  tickRespawns(state, settings, dt);

  state.tick += 1;
  state.rngState = rng.getState();

  return { ...objective, kills };
}
