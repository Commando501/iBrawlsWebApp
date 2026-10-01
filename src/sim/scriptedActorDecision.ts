import type { UniversalSettings } from '../types';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import type { ActionInput } from './actions';
import type { SimState } from './simState';
import { validateScriptedCombatInput, type ScriptedCombatCommand } from './scriptedCombatInput';
import { validateScriptedObjectiveInput, type ObjectiveGroundIntent } from './scriptedObjectiveInput';

export type ScriptedDecisionClockPhase = 'before-swap-tick' | 'after-swap-tick';
export const remainingDecisionSwapTime = (remaining: number, dt: number, phase: ScriptedDecisionClockPhase) =>
  Math.max(0, remaining - (phase === 'after-swap-tick' ? 0 : dt));

export type ScriptedActorDecision = { kind: 'handled'; action: ActionInput; movement?: ObjectiveGroundIntent; commands?: readonly ScriptedCombatCommand[] }
  | { kind: 'handoff'; reason: string };
export interface ScriptedActorDecisionOwner {
  version: 'scripted-actor-decision-v1';
  scriptedBots: Readonly<Record<string, string>>;
  /** Synchronous policy, called at this actor's turn after its shield/dash/swap
   * clocks. Read this host's state; mutate only caller-owned AI memory/RNG.
   * Handoff preserves the caller's fallback input and is not autonomous success.
   * AI reload/feint/combo/coordinator clocks remain the policy owner's responsibility. */
  resolve(context: { state: SimState; actorId: string; dt: number; clockPhase: 'after-swap-tick' }): ScriptedActorDecision;
}
export interface ScriptedActorDecisionRecord {
  id: string;
  kind: 'handled' | 'handoff' | 'objective' | 'inactive';
  reason?: string;
}

/** Configuration is validated before frame mutation. Runtime decisions cannot be
 * validated until their turn: an invalid callback result aborts the run after any
 * preceding actors have executed, rather than claiming a rolled-back frame. */
export function validateScriptedActorDecisionOwner(state: SimState, owner: ScriptedActorDecisionOwner | undefined,
  settings: UniversalSettings, dt: number): void {
  if (!owner) return;
  if (owner.version !== 'scripted-actor-decision-v1' || typeof owner.resolve !== 'function') throw new Error('Invalid scripted actor decision owner');
  if (state.mode !== 'grifball' || state.combatExecution !== 'live-mixed-v1') throw new Error('Actor decisions require mixed Grifball execution');
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('Actor decisions require a positive finite timestep');
  if (!owner.scriptedBots || typeof owner.scriptedBots !== 'object' || Array.isArray(owner.scriptedBots)) throw new Error('Invalid actor decision authority');
  for (const [id, difficulty] of Object.entries(owner.scriptedBots)) {
    const actors = state.combatants.filter(c => c.id === id);
    if (actors.length !== 1 || actors[0].controller !== 'ai' || id === state.localPlayerId || typeof difficulty !== 'string' ||
      isNeuralNetDifficulty(difficulty) || isNeuralNetDifficulty(state.settings.aiDifficulty) || isNeuralNetDifficulty(settings.aiDifficulty))
      throw new Error(`Actor decision owner has no scripted authority for ${id}`);
  }
}

export function validateScriptedActorDecision(state: SimState, owner: ScriptedActorDecisionOwner, id: string,
  decision: ScriptedActorDecision, settings: UniversalSettings): ScriptedActorDecision {
  if (decision?.kind === 'handoff') {
    if (typeof decision.reason !== 'string' || !decision.reason.trim()) throw new Error(`Actor handoff requires a reason: ${id}`);
    return { kind: 'handoff', reason: decision.reason };
  }
  if (decision?.kind !== 'handled' || !decision.action) throw new Error(`Invalid actor decision: ${id}`);
  const action = decision.action;
  for (const key of ['moveX', 'moveZ', 'aim', 'passCharge'] as const)
    if (!Number.isFinite(action[key])) throw new Error(`Actor decision requires finite ${key}: ${id}`);
  for (const key of ['jump', 'dash', 'crouch', 'pickup', 'attackPrimary', 'attackSecondary', 'swapWeapon'] as const)
    if (typeof action[key] !== 'boolean') throw new Error(`Actor decision requires boolean ${key}: ${id}`);
  if (action.aimPitch !== undefined && !Number.isFinite(action.aimPitch)) throw new Error(`Invalid actor pitch: ${id}`);
  if (action.attackSecondary && state.combatants.find(c => c.id === id)?.weapon === 'sword')
    throw new Error(`Scheduled sword lunges require target-locked commands: ${id}`);
  const actions = { [id]: action };
  const movement = decision.movement === undefined ? undefined : validateScriptedObjectiveInput(state, {
    version: 'scripted-objective-v1', scriptedBots: owner.scriptedBots, movement: { [id]: decision.movement },
  }, actions, settings)![id];
  const commands = decision.commands === undefined ? undefined : validateScriptedCombatInput(state, {
    version: 'scripted-combat-v1', scriptedBots: owner.scriptedBots, commands: { [id]: decision.commands },
  }, actions, settings)![id];
  return { kind: 'handled', action: { ...action }, ...(movement ? { movement } : {}), ...(commands ? { commands } : {}) };
}
