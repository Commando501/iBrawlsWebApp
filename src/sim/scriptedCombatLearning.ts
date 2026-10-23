import type { AIMatchContext } from '../game/aiMatchContext';
import { createScriptedActorLifecycle, validateScriptedActorLifecycle, type ScriptedActorLifecycle, type RosterActorLifecycle } from './scriptedActorLifecycle';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { notifyBotDamageTag } from '../game/aiBotCoordinator';
import { getOrCreatePlayerModel, observePlayerHammerAttack, observePlayerWeaponSwap, observePlayerDash,
  observePlayerDamageDealt, observePlayerDamageReceived, observePlayerCounter, observePlayerLungeEnd } from '../game/aiPlayerModel';
import { isSkillCalibrationEnabled, recordCalibrationDodgeAttempt, recordCalibrationDodgeFailed } from '../game/aiSkillCalibration';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import type { UniversalSettings } from '../types';
import { isMixedPlayer, type SimState, type SimCombatant } from './simState';

/** Learning belongs to the caller's match context, never the RL state. Events
 * run at acceptance/impact, before subsequent actors can observe the models. */
export interface ScriptedCombatLearning {
  version: 'scripted-combat-learning-v1';
  scriptedBots: Readonly<Record<string, string>>;
  matchContext: AIMatchContext;
  isObserverMode: boolean;
  lifecycle?: ScriptedActorLifecycle;
}
export interface RosterCombatLearning {
  lifecycle?: RosterActorLifecycle;
  localLungeImpact?(actor: SimCombatant, target: SimCombatant, trade: boolean): void;
  localLungeEnd?(actor: SimCombatant, hit: boolean): void;
  hammerAttack(actor: SimCombatant): void;
  weaponSwap(actor: SimCombatant, weapon: 'hammer' | 'sword'): void;
  spatialDodge(actor: SimCombatant): void;
  meleeHit(actor: SimCombatant, target: SimCombatant): void;
}

export function validateScriptedCombatLearning(state: SimState, control: ScriptedCombatLearning | undefined,
  settings: UniversalSettings): void {
  if (!control) return;
  if (control.version !== 'scripted-combat-learning-v1' || state.mode !== 'grifball' ||
    state.combatExecution !== 'live-mixed-v1' || typeof control.isObserverMode !== 'boolean' ||
    !(control.matchContext?.playerModels instanceof Map) || !(control.matchContext.skillCalibration instanceof Map) ||
    !(control.matchContext.coordinator?.recentTags instanceof Map) || !control.scriptedBots ||
    isNeuralNetDifficulty(state.settings.aiDifficulty) || isNeuralNetDifficulty(settings.aiDifficulty))
    throw new Error('Invalid scripted combat learning owner');
  for (const [id, difficulty] of Object.entries(control.scriptedBots)) {
    const actors = state.combatants.filter(c => c.id === id);
    if (actors.length !== 1 || actors[0].controller !== 'ai' || isMixedPlayer(state, actors[0]) ||
      typeof difficulty !== 'string' || isNeuralNetDifficulty(difficulty))
      throw new Error(`Invalid scripted learning authority: ${id}`);
  }
  validateScriptedActorLifecycle(control);
}

export function createScriptedCombatLearning(state: SimState, control: ScriptedCombatLearning,
  settings: UniversalSettings): RosterCombatLearning {
  const owns = (id: string) => Object.hasOwn(control.scriptedBots, id);
  const tuning = resolveBehaviorTuning(settings), ai = control.matchContext;
  const model = (id: string) => getOrCreatePlayerModel(ai, id, { emaAlpha: tuning.playerModelEmaAlpha,
    defaultLungeDistance: tuning.defaultLungeDistance, defaultReactionTime: tuning.defaultReactionTime });
  return {
    lifecycle: createScriptedActorLifecycle(state, control, settings),
    localLungeImpact(actor, target, trade) {
      if (!isMixedPlayer(state, actor) || control.isObserverMode) return;
      if (trade) observePlayerCounter(model(actor.id), true);
      else {
        observePlayerDamageDealt(model(actor.id));
        if (target.id === 'main_ai') recordCalibrationDodgeFailed(ai, target.id, tuning.calibrationWindowSize);
      }
    },
    localLungeEnd(actor, hit) {
      if (!isMixedPlayer(state, actor) || control.isObserverMode || !actor.lungeStartPos) return;
      const start = actor.lungeStartPos;
      observePlayerLungeEnd(model(actor.id), Math.hypot(actor.pos.x - start.x, actor.pos.y - start.y, actor.pos.z - start.z), hit);
    },
    hammerAttack(actor) {
      if (owns(actor.id) || isMixedPlayer(state, actor) && !control.isObserverMode) observePlayerHammerAttack(model(actor.id));
    },
    weaponSwap(actor, weapon) { if (owns(actor.id)) observePlayerWeaponSwap(model(actor.id), weapon); },
    spatialDodge(actor) {
      if (!owns(actor.id)) return;
      observePlayerDash(model(actor.id), actor.dashDir.x, actor.dashDir.z);
      if (isSkillCalibrationEnabled(control.scriptedBots[actor.id])) recordCalibrationDodgeAttempt(ai, actor.id);
    },
    meleeHit(actor, target) {
      if (!owns(actor.id)) return;
      // Match the live offline roster impact owner; remote peers are not modeled.
      if (isMixedPlayer(state, target)) {
        if (control.isObserverMode) return;
        observePlayerDamageReceived(model(target.id));
        observePlayerDamageDealt(model(actor.id));
      } else {
        if (target.controller !== 'ai') return;
        observePlayerDamageDealt(model(actor.id));
        observePlayerDamageReceived(model(target.id));
      }
      if (target.hp > 0 && actor.team !== target.team) notifyBotDamageTag(ai.coordinator, actor.id, target.id, tuning.damageTagTtl);
    },
  };
}
