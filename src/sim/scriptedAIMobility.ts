import { applyAIEmergencyHopMotion } from '../game/aiEmergencyHop';
import { pickPerpendicularDodgeDirection } from '../game/aiSpatialStrategy';
import type { PlayerModelSnapshot } from '../game/aiPlayerModel';
import type { ActionInput } from './actions';
import type { SimCombatant, SimState } from './simState';

/** Explicit AI actuation; direction has already been selected by the policy's
 * random stream. Execution must not reroll or use the player jump rules. */
export interface ScriptedAIMobilityCommand {
  version: 'scripted-ai-mobility-v1';
  kind: 'emergency-hop';
  direction: { x: number; z: number };
}

/** Call from the shared evasion policy's emergency-hop port using this host's
 * observation. Sampling belongs to command construction, never execution. */
export function createScriptedAIEmergencyHopCommand(self: Pick<SimCombatant, 'pos'>, arenaRadius: number,
  incoming: { x: number; z: number }, playerModel: PlayerModelSnapshot | null, random: () => number): ScriptedAIMobilityCommand {
  const direction = pickPerpendicularDodgeDirection({ botPosX: self.pos.x, botPosZ: self.pos.z,
    lungeDirX: incoming.x, lungeDirZ: incoming.z, arenaRadius, playerModel, rng: random() });
  return { version: 'scripted-ai-mobility-v1', kind: 'emergency-hop', direction: { x: direction.x, z: direction.z } };
}

export function validateScriptedAIMobility(state: SimState, id: string, command: ScriptedAIMobilityCommand,
  action: ActionInput, engagementPrepared: boolean, hasOtherCommands: boolean): ScriptedAIMobilityCommand {
  const self = state.combatants.find(c => c.id === id);
  if (!command || command.version !== 'scripted-ai-mobility-v1' || command.kind !== 'emergency-hop')
    throw new Error(`Invalid AI mobility command: ${id}`);
  const direction = command.direction;
  if (!direction || !Number.isFinite(direction.x) || !Number.isFinite(direction.z) ||
    Math.abs(Math.hypot(direction.x, direction.z) - 1) > 1e-6)
    throw new Error(`AI mobility requires a unit direction: ${id}`);
  if (!engagementPrepared || !self || !self.alive || self.hp <= 0 || self.respawnTimer > 0 ||
    self.hasBall || self.weapon === 'ball' || state.match.ball.holderId === id || self.isLunging ||
    self.dashRemaining > 0 || self.slideActive)
    throw new Error(`AI mobility requires an uncommitted armed engagement: ${id}`);
  // A later contract will own combined counter/dash/jump priorities. Refuse
  // unimplemented combinations instead of silently changing their execution order.
  if (hasOtherCommands || action.moveX !== 0 || action.moveZ !== 0 || action.jump || action.dash ||
    action.attackPrimary || action.attackSecondary || action.swapWeapon || action.pickup || action.passCharge !== 0)
    throw new Error(`Unsupported AI mobility action combination: ${id}`);
  return { version: command.version, kind: command.kind, direction: { ...direction } };
}

/** Called once after decision validation and before airborne recovery. */
export function applyScriptedAIMobility(self: SimCombatant, command: ScriptedAIMobilityCommand, dt: number): void {
  applyAIEmergencyHopMotion(self, self.pos, self.vel, command.direction, dt);
  self.grounded = false;
}
