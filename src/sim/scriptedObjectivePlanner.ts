import type { UniversalSettings } from '../types';
import type { BotCoordinatorState } from '../game/aiBotCoordinator';
import { publishGrifballTacticalEngagements } from '../game/aiCoordinationFrame';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import { resolvePunchCooldown } from '../game/runnerBallSettings';
import { resolveScaledAIWeaponReloadTime } from '../game/aiWeaponTiming';
import { observeSimGrifballHammerDefense } from './grifballHammerDefense';
import { idleAction } from './actions';
import { startAISpatialDodgeMotion } from '../game/aiDashMotion';
import { updateGrifballTeamPlan, type GrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import type { GrifballTacticsConfig } from '../game/grifballTacticsConfig';
import type { SimState, SimCombatant } from './simState';
import type { ActionInput, ActionsById } from './actions';
import { createSimGrifballTacticalSnapshot } from './grifballTacticalAdapter';
import { resolveSimGrifballSupportInput } from './grifballSupportInput';
import { resolveSimGrifballCarrierInput } from './grifballCarrierInput';
import { SCRIPTED_OBJECTIVE_INPUT_VERSION, validateScriptedObjectiveInput, type ObjectiveGroundIntent } from './scriptedObjectiveInput';

export const SCRIPTED_OBJECTIVE_PLANNER_VERSION = 'scripted-objective-planner-v1' as const;
export const SCRIPTED_CARRIER_PUNCH_VERSION = 'scripted-carrier-punch-v1' as const;
export const SCRIPTED_PASS_VERSION = 'scripted-pass-v1' as const;
export const SCRIPTED_RUNNER_EVASION_VERSION = 'scripted-runner-evasion-v1' as const;
export interface ScriptedCarrierPunchControl {
  version: typeof SCRIPTED_CARRIER_PUNCH_VERSION;
  /** Caller-owned AI reload seconds, separate from mechanical weapon recovery.
   * Seed from this engine's COOLDOWN timer (otherwise zero). A combat handoff's
   * owner must update this memory before returning control. JSON serializable. */
  cooldowns: Record<string, number>;
}
export interface ScriptedObjectivePlanner {
  version: typeof SCRIPTED_OBJECTIVE_PLANNER_VERSION;
  scriptedBots: Readonly<Record<string, string>>;
  /** Caller-owned memory; never stored in the simulator or RL observation. */
  plan: GrifballTeamPlanState;
  tactics?: GrifballTacticsConfig;
  /** Explicit readiness from the caller's AI cooldown owner. Missing carrier
   * readiness delegates rather than disabling attacks silently. */
  weaponReady?: Readonly<Record<string, boolean>>;
  /** Explicitly owns grounded objective reloads, punch commands and enabled
   * hammer pass-defense strikes for these IDs.
   * Other carrier decisions retain the existing readiness/handoff contract. */
  punchControl?: ScriptedCarrierPunchControl;
  /** Charge/recheck/release in the objective phase for IDs with owned AI reloads. */
  passControl?: typeof SCRIPTED_PASS_VERSION;
  /** Launch intent only; requires the same scripted actor's committed-dash owner. */
  runnerEvasion?: typeof SCRIPTED_RUNNER_EVASION_VERSION;
}
export interface ScriptedObjectiveDecision {
  id: string;
  kind: 'support' | 'carrier' | 'handoff' | 'inactive';
  reason?: string;
  action?: ActionInput;
  movement?: ObjectiveGroundIntent;
}
export interface ScriptedObjectivePlannerFrame {
  version: typeof SCRIPTED_OBJECTIVE_PLANNER_VERSION;
  decisions: ScriptedObjectiveDecision[];
}

/** Reject configuration/ownership errors before any engine or planner mutation. */
export function validateScriptedObjectivePlanner(state: SimState, planner: ScriptedObjectivePlanner | undefined,
  settings: UniversalSettings, dt: number): void {
  if (!planner) return;
  if (planner.version !== SCRIPTED_OBJECTIVE_PLANNER_VERSION) throw new Error('Unsupported scripted objective planner version');
  validateScriptedObjectiveInput(state, { version: SCRIPTED_OBJECTIVE_INPUT_VERSION, scriptedBots: planner.scriptedBots, movement: {} }, {}, settings);
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('Objective planning requires a positive finite timestep');
  if (!(planner.plan?.assignments instanceof Map)) throw new Error('Objective planning requires caller-owned team plan memory');
  if (planner.passControl !== undefined && (planner.passControl !== SCRIPTED_PASS_VERSION || !planner.punchControl))
    throw new Error('Scripted passing requires a supported version and owned AI reloads');
  if (planner.runnerEvasion !== undefined && (planner.runnerEvasion !== SCRIPTED_RUNNER_EVASION_VERSION || !planner.punchControl))
    throw new Error('Runner evasion requires a supported version and owned AI readiness');
  for (const [id, difficulty] of Object.entries(planner.scriptedBots)) {
    const actors = state.combatants.filter(c => c.id === id);
    if (actors.length !== 1 || actors[0].controller !== 'ai' || id === state.localPlayerId || typeof difficulty !== 'string' ||
      isNeuralNetDifficulty(difficulty) || isNeuralNetDifficulty(state.settings.aiDifficulty) || isNeuralNetDifficulty(settings.aiDifficulty))
      throw new Error(`Objective planner has no scripted control authority for ${id}`);
  }
  for (const [id, ready] of Object.entries(planner.weaponReady ?? {})) {
    if (!Object.hasOwn(planner.scriptedBots, id) || typeof ready !== 'boolean') throw new Error(`Invalid objective weapon readiness for ${id}`);
  }
  if (planner.punchControl) {
    if (planner.punchControl.version !== SCRIPTED_CARRIER_PUNCH_VERSION || !planner.punchControl.cooldowns ||
      typeof planner.punchControl.cooldowns !== 'object' || Array.isArray(planner.punchControl.cooldowns))
      throw new Error('Invalid scripted carrier punch control');
    for (const [id, remaining] of Object.entries(planner.punchControl.cooldowns)) {
      if (!Object.hasOwn(planner.scriptedBots, id) || Object.hasOwn(planner.weaponReady ?? {}, id) ||
        !Number.isFinite(remaining) || remaining < 0) throw new Error(`Invalid or conflicting carrier cooldown owner for ${id}`);
    }
  }
}

/** Called once after local execution/roster respawns. Assignments use a frozen
 * observation, but each resolve reads current positions at that actor's turn. */
export function beginScriptedObjectivePlanning(state: SimState, planner: ScriptedObjectivePlanner,
  settings: UniversalSettings, dt: number, actions: ActionsById, swapTimersAdvanced: ReadonlySet<string> = new Set(),
  coordinator?: BotCoordinatorState) {
  const view = settings === state.settings ? state : { ...state, settings };
  const snapshot = createSimGrifballTacticalSnapshot(view, {
    scriptedBots: planner.scriptedBots, tactics: planner.tactics,
    pickupRequests: Object.fromEntries(Object.entries(actions).map(([id, action]) => [id, action.pickup])),
  });
  updateGrifballTeamPlan(planner.plan, snapshot, dt);
  if (coordinator) publishGrifballTacticalEngagements(coordinator, planner.plan, snapshot.players);
  const frame: ScriptedObjectivePlannerFrame = { version: SCRIPTED_OBJECTIVE_PLANNER_VERSION, decisions: [] };
  const owns = (id: string) => Object.hasOwn(planner.scriptedBots, id);
  const ownsPunch = (id: string) => Object.hasOwn(planner.punchControl?.cooldowns ?? {}, id);
  const resolve = (actor: SimCombatant) => {
    if (!owns(actor.id)) return null;
    const record = (decision: Omit<ScriptedObjectiveDecision, 'id'>) => { frame.decisions.push({ id: actor.id, ...decision }); };
    if (state.match.phase !== 'playing' || !actor.alive || actor.hp <= 0 || actor.respawnTimer > 0) {
      record({ kind: 'inactive' }); return null;
    }
    const carrier = actor.hasBall || state.match.ball.state === 'held' && state.match.ball.holderId === actor.id;
    const controlled = ownsPunch(actor.id);
    if (carrier && !controlled && !Object.hasOwn(planner.weaponReady ?? {}, actor.id)) {
      record({ kind: 'handoff', reason: 'carrier-readiness-missing' }); return null;
    }
    // Live swap readiness advances before objective selection; AI reload advances
    // only after a handled non-punch decision. Do not spend either clock twice.
    const swapTick = swapTimersAdvanced.has(actor.id) ? 0 : dt;
    const ready = controlled ? planner.punchControl!.cooldowns[actor.id] <= 0 && Math.max(0, actor.weaponReadyTimer - swapTick) <= 0
      : planner.weaponReady?.[actor.id] ?? false;
    // The composed planner owns these same AI reloads for objective strikes.
    const hammerDefense = observeSimGrifballHammerDefense(view, planner.plan, actor, planner.scriptedBots, controlled && ready, dt);
    if (hammerDefense && hammerDefense.action !== 'continue') {
      const action = { ...idleAction(), crouch: actor.isCrouching, aim: Math.atan2(hammerDefense.heading!.x, hammerDefense.heading!.z),
        attackPrimary: hammerDefense.action === 'strike' };
      const movement = { x: 0, z: 0 };
      if (controlled) planner.punchControl!.cooldowns[actor.id] = action.attackPrimary
        ? resolveScaledAIWeaponReloadTime(settings, 'hammer', 1) : Math.max(0, planner.punchControl!.cooldowns[actor.id] - dt);
      const reason = action.attackPrimary ? 'hammer-deflection' : 'hammer-deflection-committed';
      record({ kind: 'support', reason, action, movement });
      return { action, movement, objective: { kind: 'support' as const, reason } };
    }
    const decision = carrier ? resolveSimGrifballCarrierInput(view, planner.plan, actor.id, planner.scriptedBots, ready, dt,
      { punch: controlled, pass: controlled && planner.passControl === SCRIPTED_PASS_VERSION,
        evasion: controlled && planner.runnerEvasion === SCRIPTED_RUNNER_EVASION_VERSION }) : null;
    if (decision?.evasion) {
      startAISpatialDodgeMotion(settings, actor, decision.evasion);
      record({ kind: 'handoff', reason: 'runner-evasion' });
      return null;
    }
    const input = carrier ? decision?.input : resolveSimGrifballSupportInput(view, planner.plan, actor.id, planner.scriptedBots, dt);
    if (!input) {
      record({ kind: 'handoff', reason: decision?.decision.kind ?? 'combat-or-unsupported-state' }); return null;
    }
    if (controlled) planner.punchControl!.cooldowns[actor.id] = decision?.decision.kind === 'punch'
      ? resolvePunchCooldown(settings) : Math.max(0, planner.punchControl!.cooldowns[actor.id] - dt);
    const movement = input.scriptedObjective.movement[actor.id];
    record({ kind: carrier ? 'carrier' : 'support', ...(decision ? { reason: decision.decision.kind } : {}), action: { ...input.action }, movement: { ...movement } });
    return { action: input.action, movement,
      objective: { kind: carrier ? 'carrier' as const : 'support' as const,
        ...(decision ? { reason: decision.decision.kind } : {}) } };
  };
  return { frame, owns, resolve };
}
