import type { ActionsById } from './actions';
import type { SimState } from './simState';
import type { UniversalSettings } from '../types';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import { validateScriptedObjectiveInput, SCRIPTED_OBJECTIVE_INPUT_VERSION } from './scriptedObjectiveInput';

export type ScriptedCombatCommand = { kind: 'revert-weapon-feint' } | { kind: 'swap'; weapon: 'hammer' | 'sword' }
  | { kind: 'melee'; weapon: 'hammer' | 'sword'; swipe: boolean }
  | { kind: 'hammer-jump'; jumpType: 'offensive' | 'defensive'; heading?: { x: number; y: number; z: number } }
  | { kind: 'lunge'; targetId: string; direction: { x: number; y: number; z: number } };
export interface ScriptedCombatInput {
  version: 'scripted-combat-v1' | 'scripted-combat-v2' | 'scripted-combat-v3' | 'scripted-combat-v4' | 'scripted-combat-v5' | 'scripted-combat-v6';
  scriptedBots: Readonly<Record<string, string>>;
  commands: Readonly<Record<string, readonly ScriptedCombatCommand[]>>;
}

/** V3-v6 are available only at a scheduled actor's prepared engagement boundary. */
export interface ScriptedCombatEngagementContext {
  actorId: string;
  mobility: boolean;
  dash: boolean;
  committedFlight?: boolean;
}

/** V1/v2 ground-AI and v3-v6 prepared-engagement actuation, after caller-owned
 * decision/reload arbitration. This
 * packet does not grant control to player/RL owners. Reject the whole packet
 * before any engine mutation, including malformed commands for later actors. */
export function validateScriptedCombatInput(state: SimState, input: ScriptedCombatInput | undefined,
  actions: ActionsById, settings: UniversalSettings, engagement?: ScriptedCombatEngagementContext) {
  if (!input) return undefined;
  const sequential = input.version === 'scripted-combat-v6';
  const flight = engagement?.committedFlight === true;
  if (flight && !sequential) throw new Error('Scheduled flight commands require sequential engagement execution');
  const prepared = input.version === 'scripted-combat-v3' || input.version === 'scripted-combat-v4' || input.version === 'scripted-combat-v5' || sequential;
  if (input.version !== 'scripted-combat-v1' && input.version !== 'scripted-combat-v2' && !prepared) throw new Error('Unsupported scripted combat input version');
  if (prepared) {
    if (!engagement || state.mode !== 'grifball' || state.combatExecution !== 'live-mixed-v1' || state.match.phase !== 'playing' ||
      Object.keys(input.commands).length !== 1 || !Object.hasOwn(input.commands, engagement.actorId))
      throw new Error('Scripted engagement combat requires one scheduled prepared engagement');
    const actors = state.combatants.filter(c => c.id === engagement.actorId), actor = actors[0];
    if (actors.length !== 1 || actor.id === state.localPlayerId || actor.controller !== 'ai' ||
      !Object.hasOwn(input.scriptedBots, actor.id) || isNeuralNetDifficulty(input.scriptedBots[actor.id]) ||
      isNeuralNetDifficulty(state.settings.aiDifficulty) || isNeuralNetDifficulty(settings.aiDifficulty) ||
      !actor.alive || actor.hp <= 0 || actor.respawnTimer > 0 || actor.isLunging !== flight)
      throw new Error('Scripted engagement combat requires an active armed AI engagement');
  } else {
    const movement = Object.fromEntries(Object.keys(input.commands).map(id => [id, { x: 0, z: 0 }]));
    validateScriptedObjectiveInput(state, { version: SCRIPTED_OBJECTIVE_INPUT_VERSION, scriptedBots: input.scriptedBots, movement }, actions, settings);
  }
  const validated: Record<string, ScriptedCombatCommand[]> = Object.create(null);
  for (const [id, commands] of Object.entries(input.commands)) {
    const actor = state.combatants.find(c => c.id === id)!;
    if (actor.hasBall || actor.weapon === 'ball' || state.match.ball.holderId === id)
      throw new Error(`Scripted armed combat cannot control a carrier: ${id}`);
    if (actions[id]?.attackPrimary || actions[id]?.attackSecondary || actions[id]?.swapWeapon)
      throw new Error(`Scripted combat has conflicting action owners: ${id}`);
    if (!Array.isArray(commands) || commands.length > (sequential ? 5 : input.version === 'scripted-combat-v5' ? 4 : 3)) throw new Error(`Invalid scripted combat sequence: ${id}`);
    let attacked = false, attemptedJump = false, actionStarted = false;
    for (const command of commands) {
      if (!command || attacked) throw new Error(`An attack must finish its scripted combat sequence: ${id}`);
      if (sequential && actionStarted && !(command.kind === 'hammer-jump' || command.kind === 'melee' && command.weapon === 'hammer' && !command.swipe))
        throw new Error(`Only hammer opportunities may follow an engagement action: ${id}`);
      if (!sequential && attemptedJump && (input.version !== 'scripted-combat-v5' || command.kind !== 'melee'))
        throw new Error(`Only a melee counter may follow a hammer-jump attempt: ${id}`);
      if (command.kind === 'revert-weapon-feint') {
        if (input.version === 'scripted-combat-v1' || commands.indexOf(command) !== 0 || commands.filter(c => c?.kind === 'revert-weapon-feint').length !== 1)
          throw new Error(`Feint reversion requires v2/v3 and the first command: ${id}`);
      } else if (command.kind === 'swap' || command.kind === 'melee') {
        if (command.weapon !== 'hammer' && command.weapon !== 'sword') throw new Error(`Invalid scripted weapon: ${id}`);
        if (command.kind === 'melee') {
          if (typeof command.swipe !== 'boolean' || command.swipe && command.weapon !== 'hammer') throw new Error(`Invalid scripted swipe: ${id}`);
          attacked = !sequential || command.weapon !== 'hammer' || command.swipe;
        }
      } else if (command.kind === 'hammer-jump') {
        if (!['scripted-combat-v4', 'scripted-combat-v5', 'scripted-combat-v6'].includes(input.version) || engagement!.mobility && !sequential ||
          !['offensive', 'defensive'].includes(command.jumpType) ||
          command.heading && ![command.heading.x, command.heading.y, command.heading.z].every(Number.isFinite))
          throw new Error(`Invalid or conflicting scripted hammer jump: ${id}`);
        attemptedJump = true; attacked = input.version !== 'scripted-combat-v5' && !sequential;
      } else if (command.kind === 'lunge') {
        if (prepared && !flight && (engagement!.mobility || engagement!.dash || !sequential && (actor.dashRemaining > 0 || actor.slideActive)))
          throw new Error(`Scripted lunge cannot share an evasion movement owner: ${id}`);
        const targets = state.combatants.filter(c => c.id === command.targetId), target = targets[0];
        const dir = command.direction;
        const length = dir ? Math.hypot(dir.x, dir.y, dir.z) : NaN;
        if (!dir || ![dir.x, dir.y, dir.z].every(Number.isFinite) || !Number.isFinite(length) || length <= .0001)
          throw new Error(`Invalid scripted lunge direction: ${id}`);
        if (targets.length !== 1 || target.id === id || target.team === actor.team || !target.alive || target.hp <= 0 || target.respawnTimer > 0)
          throw new Error(`Invalid scripted lunge target: ${id}`);
        attacked = true;
      } else throw new Error(`Unknown scripted combat command: ${id}`);
      if (command.kind !== 'swap' && command.kind !== 'revert-weapon-feint') actionStarted = true;
    }
    validated[id] = commands.map(command => command.kind === 'lunge'
      ? { ...command, direction: { ...command.direction } }
      : command.kind === 'hammer-jump' && command.heading ? { ...command, heading: { ...command.heading } } : { ...command });
  }
  return validated;
}
