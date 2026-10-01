import type { ActionsById } from './actions';
import type { SimState } from './simState';
import type { UniversalSettings } from '../types';
import { validateScriptedObjectiveInput, SCRIPTED_OBJECTIVE_INPUT_VERSION } from './scriptedObjectiveInput';

export type ScriptedCombatCommand = { kind: 'swap'; weapon: 'hammer' | 'sword' }
  | { kind: 'melee'; weapon: 'hammer' | 'sword'; swipe: boolean }
  | { kind: 'lunge'; targetId: string; direction: { x: number; y: number; z: number } };
export interface ScriptedCombatInput {
  version: 'scripted-combat-v1';
  scriptedBots: Readonly<Record<string, string>>;
  commands: Readonly<Record<string, readonly ScriptedCombatCommand[]>>;
}

/** Explicit ground-AI actuation, after its own decision/reload arbitration. This
 * packet does not grant control to player/RL owners. Reject the whole packet
 * before any engine mutation, including malformed commands for later actors. */
export function validateScriptedCombatInput(state: SimState, input: ScriptedCombatInput | undefined,
  actions: ActionsById, settings: UniversalSettings) {
  if (!input) return undefined;
  if (input.version !== 'scripted-combat-v1') throw new Error('Unsupported scripted combat input version');
  const movement = Object.fromEntries(Object.keys(input.commands).map(id => [id, { x: 0, z: 0 }]));
  validateScriptedObjectiveInput(state, { version: SCRIPTED_OBJECTIVE_INPUT_VERSION, scriptedBots: input.scriptedBots, movement }, actions, settings);
  const validated: Record<string, ScriptedCombatCommand[]> = Object.create(null);
  for (const [id, commands] of Object.entries(input.commands)) {
    const actor = state.combatants.find(c => c.id === id)!;
    if (actor.hasBall || actor.weapon === 'ball' || state.match.ball.holderId === id)
      throw new Error(`Scripted armed combat cannot control a carrier: ${id}`);
    if (actions[id]?.attackPrimary || actions[id]?.attackSecondary || actions[id]?.swapWeapon)
      throw new Error(`Scripted combat has conflicting action owners: ${id}`);
    if (!Array.isArray(commands) || commands.length > 3) throw new Error(`Invalid scripted combat sequence: ${id}`);
    let attacked = false;
    for (const command of commands) {
      if (!command || attacked) throw new Error(`An attack must finish its scripted combat sequence: ${id}`);
      if (command.kind === 'swap' || command.kind === 'melee') {
        if (command.weapon !== 'hammer' && command.weapon !== 'sword') throw new Error(`Invalid scripted weapon: ${id}`);
        if (command.kind === 'melee') {
          if (typeof command.swipe !== 'boolean' || command.swipe && command.weapon !== 'hammer') throw new Error(`Invalid scripted swipe: ${id}`);
          attacked = true;
        }
      } else if (command.kind === 'lunge') {
        const targets = state.combatants.filter(c => c.id === command.targetId), target = targets[0];
        const dir = command.direction;
        const length = dir ? Math.hypot(dir.x, dir.y, dir.z) : NaN;
        if (!dir || ![dir.x, dir.y, dir.z].every(Number.isFinite) || !Number.isFinite(length) || length <= .0001)
          throw new Error(`Invalid scripted lunge direction: ${id}`);
        if (targets.length !== 1 || target.id === id || target.team === actor.team || !target.alive || target.hp <= 0 || target.respawnTimer > 0)
          throw new Error(`Invalid scripted lunge target: ${id}`);
        attacked = true;
      } else throw new Error(`Unknown scripted combat command: ${id}`);
    }
    validated[id] = commands.map(command => command.kind === 'lunge'
      ? { ...command, direction: { ...command.direction } } : { ...command });
  }
  return validated;
}
