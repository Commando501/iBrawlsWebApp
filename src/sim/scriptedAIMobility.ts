import { applyAIEmergencyHopMotion } from '../game/aiEmergencyHop';
import { startAISpatialDodgeMotion } from '../game/aiDashMotion';
import { pickPerpendicularDodgeDirection, type PostEvasionCommitInput } from '../game/aiSpatialStrategy';
import type { PlayerModelSnapshot } from '../game/aiPlayerModel';
import type { AIBehaviorState, UniversalSettings } from '../types';
import type { ActionInput } from './actions';
import type { SimCombatant, SimState } from './simState';

/** Explicit AI actuation; direction has already been selected by the policy's
 * random stream. Execution must not reroll or use the player jump rules. */
export type ScriptedAIMobilityCommand = ({ version: 'scripted-ai-mobility-v1'; kind: 'emergency-hop' }
  | { version: 'scripted-ai-mobility-v2'; kind: 'emergency-hop' | 'spatial-dodge' }) & {
  direction: { x: number; z: number };
};

export interface ScriptedAIDashDecision {
  version: 'scripted-ai-dash-v1';
  aiState: AIBehaviorState | undefined;
  /** Preserved by the caller when airborne recovery returns without dash feedback. */
  pendingPostEvasionCharge: boolean;
  /** Current target observations and sampled local weapon readiness, supplied
   * anew on each actor turn. A launch-frame snapshot cannot authorize a charge. */
  target: PostEvasionCommitInput;
}

export interface ScriptedAIDashFeedback {
  aiState: AIBehaviorState | undefined;
  pendingPostEvasionCharge: boolean;
}

/** Call from the shared evasion policy's emergency-hop port using this host's
 * observation. Sampling belongs to command construction, never execution. */
export function createScriptedAIEmergencyHopCommand(self: Pick<SimCombatant, 'pos'>, arenaRadius: number,
  incoming: { x: number; z: number }, playerModel: PlayerModelSnapshot | null, random: () => number): ScriptedAIMobilityCommand {
  const direction = pickPerpendicularDodgeDirection({ botPosX: self.pos.x, botPosZ: self.pos.z,
    lungeDirX: incoming.x, lungeDirZ: incoming.z, arenaRadius, playerModel, rng: random() });
  return { version: 'scripted-ai-mobility-v1', kind: 'emergency-hop', direction: { x: direction.x, z: direction.z } };
}

export function createScriptedAISpatialDodgeCommand(self: Pick<SimCombatant, 'pos'>, arenaRadius: number,
  incoming: { x: number; z: number }, playerModel: PlayerModelSnapshot | null, random: () => number): ScriptedAIMobilityCommand {
  return { ...createScriptedAIEmergencyHopCommand(self, arenaRadius, incoming, playerModel, random), version: 'scripted-ai-mobility-v2', kind: 'spatial-dodge' };
}

export function validateScriptedAIMobility(state: SimState, id: string, command: ScriptedAIMobilityCommand,
  action: ActionInput, engagementPrepared: boolean, hasOtherCommands: boolean): ScriptedAIMobilityCommand {
  const self = state.combatants.find(c => c.id === id);
  if (!command || !(command.version === 'scripted-ai-mobility-v1' && command.kind === 'emergency-hop' ||
    command.version === 'scripted-ai-mobility-v2' && ['emergency-hop', 'spatial-dodge'].includes(command.kind)))
    throw new Error(`Invalid AI mobility command: ${id}`);
  const direction = command.direction;
  if (!direction || !Number.isFinite(direction.x) || !Number.isFinite(direction.z) ||
    Math.abs(Math.hypot(direction.x, direction.z) - 1) > 1e-6)
    throw new Error(`AI mobility requires a unit direction: ${id}`);
  if (!engagementPrepared || !self || !self.alive || self.hp <= 0 || self.respawnTimer > 0 ||
    self.hasBall || self.weapon === 'ball' || state.match.ball.holderId === id || self.isLunging ||
    (command.kind === 'emergency-hop' && self.slideActive && self.dashRemaining <= 0) ||
    (command.kind === 'spatial-dodge' && (self.dashCooldownTimer > 0 || self.dashRemaining > 0)))
    throw new Error(`AI mobility requires an uncommitted armed engagement: ${id}`);
  // A later contract will own combined counter/hammer-jump priorities. Refuse
  // unimplemented combinations instead of silently changing their execution order.
  if (hasOtherCommands || action.moveX !== 0 || action.moveZ !== 0 || action.jump || action.dash ||
    action.attackPrimary || action.attackSecondary || action.swapWeapon || action.pickup || action.passCharge !== 0)
    throw new Error(`Unsupported AI mobility action combination: ${id}`);
  return { ...command, direction: { ...direction } };
}

/** Called once after decision validation and before airborne recovery. */
export function applyScriptedAIMobility(self: SimCombatant, command: ScriptedAIMobilityCommand, dt: number, settings: UniversalSettings): void {
  if (command.kind === 'spatial-dodge') startAISpatialDodgeMotion(settings, self, command.direction);
  else {
    applyAIEmergencyHopMotion(self, self.pos, self.vel, command.direction, dt);
    self.grounded = false;
  }
}

export function validateScriptedAIDashDecision(state: SimState, id: string, decision: ScriptedAIDashDecision,
  action: ActionInput, engagementPrepared: boolean, mobility: ScriptedAIMobilityCommand | undefined,
  hasOtherCommands: boolean): ScriptedAIDashDecision {
  const self = state.combatants.find(c => c.id === id);
  if (!decision || decision.version !== 'scripted-ai-dash-v1' || typeof decision.pendingPostEvasionCharge !== 'boolean')
    throw new Error(`Invalid AI dash decision: ${id}`);
  if (decision.aiState !== undefined && !['APPROACHING', 'DANCING_FORWARD', 'DANCING_BACKWARD', 'SIDE_STEPPING',
    'CHARGE_ATTACK', 'PRESSURING', 'LUNGING', 'COOLDOWN', 'RESPAWNING', 'SPAWN_GUARDING'].includes(decision.aiState))
    throw new Error(`Invalid AI dash state: ${id}`);
  const target = decision.target;
  if (!target || typeof target.targetWeaponState !== 'string' || !target.targetWeaponState ||
    !Number.isFinite(target.attackDistanceToTarget) || target.attackDistanceToTarget < 0 ||
    !Number.isFinite(target.resolvedAiReach) || target.resolvedAiReach < 0 ||
    !Number.isFinite(target.spatialIQ) || target.spatialIQ < 0 || target.spatialIQ > 100 ||
    typeof target.targetProtected !== 'boolean' || typeof target.weaponReady !== 'boolean')
    throw new Error(`Invalid AI dash observation: ${id}`);
  if (!engagementPrepared || !self || self.isLunging || !self.alive || self.hp <= 0 || self.respawnTimer > 0 ||
    self.hasBall || self.weapon === 'ball' || state.match.ball.holderId === id ||
    (mobility?.kind !== 'spatial-dodge' && self.dashRemaining <= 0))
    throw new Error(`AI dash requires an armed engagement dash: ${id}`);
  if (hasOtherCommands || action.moveX !== 0 || action.moveZ !== 0 || action.jump || action.dash ||
    action.attackPrimary || action.attackSecondary || action.swapWeapon || action.pickup || action.passCharge !== 0)
    throw new Error(`Unsupported AI dash action combination: ${id}`);
  return { version: decision.version, aiState: decision.aiState, pendingPostEvasionCharge: decision.pendingPostEvasionCharge, target: { ...target } };
}
