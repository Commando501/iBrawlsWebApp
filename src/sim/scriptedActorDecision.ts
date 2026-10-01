import { validateScriptedAIGroundOwner, type ScriptedAIGroundOwner, type ScriptedAIGroundFeedback } from './scriptedAIGround';
import { validateScriptedAINoTargetOwner, type ScriptedAINoTargetOwner, type ScriptedAINoTargetFeedback } from './scriptedAINoTarget';
import type { UniversalSettings } from '../types';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import type { ActionInput } from './actions';
import type { SimState } from './simState';
import { validateScriptedAIMobility, validateScriptedAIDashDecision, type ScriptedAIMobilityCommand,
  type ScriptedAIDashDecision, type ScriptedAIDashFeedback } from './scriptedAIMobility';
import { validateScriptedCombatInput, type ScriptedCombatCommand, type ScriptedCombatInput } from './scriptedCombatInput';
import { validateScriptedObjectiveInput, type ObjectiveGroundIntent } from './scriptedObjectiveInput';

export type ScriptedDecisionClockPhase = 'before-swap-tick' | 'after-swap-tick';
export const remainingDecisionSwapTime = (remaining: number, dt: number, phase: ScriptedDecisionClockPhase) =>
  Math.max(0, remaining - (phase === 'after-swap-tick' ? 0 : dt));

export type ScriptedActorDecision = { kind: 'handled'; action: ActionInput; movement?: ObjectiveGroundIntent; commands?: readonly ScriptedCombatCommand[]; commandVersion?: ScriptedCombatInput['version']; mobility?: ScriptedAIMobilityCommand; dash?: ScriptedAIDashDecision; ground?: ScriptedAIGroundOwner; noTarget?: ScriptedAINoTargetOwner;
  /** Live evasion returns after airborne recovery when no dash remains. Keep
   * the retained velocity without walking or running the ground FSM. */
  holdAfterEvasion?: boolean;
  /** Number of earlier combo commands to execute before evasion mobility. */
  mobilityAfterCommands?: number;
  /** Live target/facing selection during committed flight; heading stays frozen. */
  flightTargetId?: string }
  | { kind: 'handoff'; reason: string };
export interface ScriptedActorDecisionOwner {
  version: 'scripted-actor-decision-v1';
  scriptedBots: Readonly<Record<string, string>>;
  /** Once per active actor, after physical cooldowns and before objective
   * handoff. Advance caller-owned adaptive clocks here, including carrier and
   * target-free turns. No physical mutation; inactive actors never call this. */
  beginTurn?: (context: { state: SimState; actorId: string; dt: number; clockPhase: 'after-swap-tick' }) => void;
  /** Once after each active actor's movement/intent or early lunge return, before
   * the next roster actor. Adopt ground/dash feedback into caller-owned memory;
   * do not mutate physical state. Later objective/animation events are not yet
   * resolved. A failed turn does not complete; callback errors abort in place. */
  completeTurn?: (context: { state: SimState; actorId: string; dt: number;
    record: Readonly<ScriptedActorDecisionRecord> }) => void;
  /** Called only after objective handoff. Choose engagement only when this
   * actor enters the live target-engagement branch; no-target/objective recovery
   * has a different owner. Gravity then precedes resolve and recovery precedes walking. */
  prepare?: (context: { state: SimState; actorId: string; dt: number; clockPhase: 'after-swap-tick' }) => 'default' | 'engagement';
  /** Synchronous policy, called at this actor's turn after its shield/dash/swap
   * clocks. Read this host's state; mutate only caller-owned AI memory/RNG.
   * Handoff preserves the caller's fallback input and is not autonomous success.
   * AI reload/feint/combo/coordinator clocks remain the policy owner's responsibility. */
  resolve(context: { state: SimState; actorId: string; dt: number; clockPhase: 'after-swap-tick';
    motionPhase: 'default' | 'after-engagement-gravity' }): ScriptedActorDecision;
}
export interface ScriptedActorDecisionRecord {
  id: string;
  kind: 'handled' | 'handoff' | 'objective' | 'inactive';
  reason?: string;
  motionPhase?: 'after-engagement-gravity';
  mobility?: ScriptedAIMobilityCommand['kind'];
  dash?: ScriptedAIDashFeedback;
  ground?: ScriptedAIGroundFeedback;
  noTarget?: ScriptedAINoTargetFeedback;
  /** True only when the grounded evasion return actually owned movement. */
  evasionHeld?: true;
  flightTargetId?: string;
  /** Objective priority that completed before combat selection. */
  objective?: { kind: 'support' | 'carrier'; reason?: string };
}

/** Configuration is validated before frame mutation. Runtime decisions cannot be
 * validated until their turn: an invalid callback result aborts the run after any
 * preceding actors have executed, rather than claiming a rolled-back frame. */
export function validateScriptedActorDecisionOwner(state: SimState, owner: ScriptedActorDecisionOwner | undefined,
  settings: UniversalSettings, dt: number): void {
  if (!owner) return;
  if (owner.beginTurn !== undefined && typeof owner.beginTurn !== 'function') throw new Error('Invalid actor begin-turn callback');
  if (owner.completeTurn !== undefined && typeof owner.completeTurn !== 'function') throw new Error('Invalid actor complete-turn callback');
  if (owner.prepare !== undefined && typeof owner.prepare !== 'function') throw new Error('Invalid actor preparation callback');
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
  decision: ScriptedActorDecision, settings: UniversalSettings, engagementPrepared = false): ScriptedActorDecision {
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
  const committedFlight = decision.flightTargetId !== undefined;
  if (committedFlight) {
    const actor = state.combatants.find(c => c.id === id), targets = state.combatants.filter(c => c.id === decision.flightTargetId), target = targets[0];
    if (!engagementPrepared || !actor?.isLunging || actor.hasBall || actor.weapon === 'ball' || state.match.ball.holderId === id ||
      targets.length !== 1 || target.id === id || target.team === actor.team || !target.alive || target.hp <= 0 || target.respawnTimer > 0 ||
      decision.commandVersion !== 'scripted-combat-v6' || !Array.isArray(decision.commands) ||
      action.attackPrimary || action.attackSecondary || action.swapWeapon ||
      decision.commands.some(command => command.kind === 'lunge' && command.targetId !== decision.flightTargetId) ||
      decision.noTarget || decision.ground || decision.movement !== undefined ||
      decision.holdAfterEvasion || action.moveX !== 0 || action.moveZ !== 0 || action.jump || action.dash || action.pickup || action.passCharge !== 0)
      throw new Error(`Scheduled flight requires an exclusive current armed engagement: ${id}`);
  }
  if (decision.mobilityAfterCommands !== undefined && (!decision.mobility || decision.commandVersion !== 'scripted-combat-v6' ||
    !Number.isInteger(decision.mobilityAfterCommands) || decision.mobilityAfterCommands < 0 ||
    decision.mobilityAfterCommands > (decision.commands?.length ?? 0)))
    throw new Error(`Invalid evasion command boundary: ${id}`);
  if (decision.holdAfterEvasion !== undefined && typeof decision.holdAfterEvasion !== 'boolean')
    throw new Error(`Invalid evasion movement hold: ${id}`);
  if (decision.holdAfterEvasion) {
    const actor = state.combatants.find(c => c.id === id);
    if (!engagementPrepared || !actor || actor.isLunging || actor.hasBall || actor.weapon === 'ball' || state.match.ball.holderId === id ||
      decision.noTarget || decision.movement !== undefined || action.moveX !== 0 || action.moveZ !== 0 || action.jump || action.dash ||
      action.attackPrimary || action.attackSecondary || action.swapWeapon || action.pickup || action.passCharge !== 0 ||
      decision.commands?.some(command => command.kind === 'lunge'))
      throw new Error(`Evasion hold requires exclusive prepared engagement movement: ${id}`);
  }
  const noTarget = decision.noTarget === undefined ? undefined : validateScriptedAINoTargetOwner(decision.noTarget,
    engagementPrepared || !!decision.ground || !!decision.dash || !!decision.mobility || !!decision.commands?.length ||
    decision.movement !== undefined || action.moveX !== 0 || action.moveZ !== 0 || action.jump || action.dash || action.crouch ||
    action.pickup || action.attackPrimary || action.attackSecondary || action.swapWeapon || action.passCharge !== 0);
  if (action.attackSecondary && state.combatants.find(c => c.id === id)?.weapon === 'sword')
    throw new Error(`Scheduled sword lunges require target-locked commands: ${id}`);
  const ground = decision.ground === undefined ? undefined : validateScriptedAIGroundOwner(decision.ground, engagementPrepared,
    decision.movement !== undefined || action.moveX !== 0 || action.moveZ !== 0 || action.jump || action.dash ||
    action.attackPrimary || action.attackSecondary || action.swapWeapon || action.pickup || action.passCharge !== 0 ||
    !!decision.commands?.length && !['scripted-combat-v3', 'scripted-combat-v4', 'scripted-combat-v5', 'scripted-combat-v6'].includes(decision.commandVersion ?? ''));
  const actions = { [id]: action };
  const otherMovement = decision.movement !== undefined;
  const incompatibleCommands = (decision.commands?.length ?? 0) > 0 && !['scripted-combat-v3', 'scripted-combat-v4', 'scripted-combat-v5', 'scripted-combat-v6'].includes(decision.commandVersion ?? '');
  const mobility = decision.mobility === undefined ? undefined : validateScriptedAIMobility(state, id, decision.mobility,
    action, engagementPrepared, otherMovement || incompatibleCommands, committedFlight, decision.commandVersion === 'scripted-combat-v6');
  const dash = decision.dash === undefined ? undefined : validateScriptedAIDashDecision(state, id, decision.dash,
    action, engagementPrepared, mobility, otherMovement || incompatibleCommands, committedFlight);
  if (mobility?.kind === 'spatial-dodge' && !dash) throw new Error(`Spatial dodge requires AI dash observations: ${id}`);
  const movement = decision.movement === undefined ? undefined : validateScriptedObjectiveInput(state, {
    version: 'scripted-objective-v1', scriptedBots: owner.scriptedBots, movement: { [id]: decision.movement },
  }, actions, settings)![id];
  const commands = decision.commands === undefined ? undefined : validateScriptedCombatInput(state, {
    version: decision.commandVersion ?? 'scripted-combat-v1', scriptedBots: owner.scriptedBots, commands: { [id]: decision.commands },
  }, actions, settings, engagementPrepared ? { actorId: id, mobility: !!mobility, dash: !!dash, committedFlight } : undefined)![id];
  return { kind: 'handled', action: { ...action }, ...(decision.holdAfterEvasion ? { holdAfterEvasion: true } : {}),
    ...(committedFlight ? { flightTargetId: decision.flightTargetId } : {}),
    ...(decision.mobilityAfterCommands !== undefined ? { mobilityAfterCommands: decision.mobilityAfterCommands } : {}),
    ...(noTarget ? { noTarget } : {}), ...(ground ? { ground } : {}), ...(mobility ? { mobility } : {}), ...(dash ? { dash } : {}), ...(movement ? { movement } : {}), ...(commands ? { commands, commandVersion: decision.commandVersion } : {}) };
}
