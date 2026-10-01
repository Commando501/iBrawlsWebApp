import type { ActionsById } from './actions';
import type { SimState } from './simState';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import type { UniversalSettings } from '../types';

export const SCRIPTED_OBJECTIVE_INPUT_VERSION = 'scripted-objective-v1' as const;
/** World-space analog steering chosen by the objective planner, before movement.
 * Magnitude 0..1 scales the live objective walking speed. Facing stays in aim. */
export interface ObjectiveGroundIntent { x: number; z: number }
export interface ScriptedObjectiveInput {
  version: typeof SCRIPTED_OBJECTIVE_INPUT_VERSION;
  /** Explicit ownership, independent of controller bookkeeping. */
  scriptedBots: Readonly<Record<string, string>>;
  movement: Readonly<Record<string, ObjectiveGroundIntent>>;
}

/** Validate the entire input before any tick mutation; legacy/RL execution never
 * acquires these controls implicitly. This contract handles grounded steering. */
export function validateScriptedObjectiveInput(state: SimState, input: ScriptedObjectiveInput | undefined, actions: ActionsById,
  settings: UniversalSettings = state.settings) {
  if (!input) return undefined;
  if (input.version !== SCRIPTED_OBJECTIVE_INPUT_VERSION) throw new Error('Unsupported scripted objective input version');
  if (state.mode !== 'grifball' || !['live-roster-v2', 'live-mixed-v1'].includes(state.combatExecution ?? ''))
    throw new Error('Scripted objective input requires an explicit live roster execution profile in Grifball');
  const validated: Record<string, ObjectiveGroundIntent> = Object.create(null);
  for (const [id, movement] of Object.entries(input.movement)) {
    const actors = state.combatants.filter(c => c.id === id), actor = actors[0];
    if (actors.length !== 1 || id === state.localPlayerId || actor.controller !== 'ai'
      || !Object.prototype.hasOwnProperty.call(input.scriptedBots, id)
      || isNeuralNetDifficulty(input.scriptedBots[id]) || isNeuralNetDifficulty(state.settings.aiDifficulty) || isNeuralNetDifficulty(settings.aiDifficulty))
      throw new Error(`Scripted objective input has no control authority for ${id}`);
    if (!Number.isFinite(movement.x) || !Number.isFinite(movement.z) || Math.hypot(movement.x, movement.z) > 1 + 1e-12)
      throw new Error(`Scripted objective steering must be finite and at most unit magnitude: ${id}`);
    if (state.match.phase !== 'playing' || !actor.alive || actor.hp <= 0 || actor.respawnTimer > 0
      || actor.isLunging || actor.isJumping || actor.pos.y > .01 || actor.vel.y !== 0
      || actor.dashRemaining > 0 || actor.slideActive || actions[id]?.jump || actions[id]?.dash)
      throw new Error(`Scripted objective steering requires an active grounded walker: ${id}`);
    validated[id] = { x: movement.x, z: movement.z };
  }
  return validated;
}
