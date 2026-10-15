import { resolveAIHitCombo, type HitComboKnobs } from '../game/aiHitCombo';
import type { BotComboState } from '../game/aiComboEngine';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import type { UniversalSettings } from '../types';
import { isMixedPlayer, type SimState, type SimCombatant } from './simState';
import { observeSimTacticalWeaponTarget, type TacticalAIMemory } from './grifballTacticalWeaponChoice';

/** Explicit caller-owned combo feedback. This owns stationary melee feedback,
 * not lunge completion, pressure, calibration or the full AI decision schedule. */
export interface ScriptedMeleeFeedback {
  version: 'scripted-melee-feedback-v1';
  knobs: Readonly<Record<string, HitComboKnobs>>;
  memories: Readonly<Record<string, TacticalAIMemory>>;
  combos: Map<string, BotComboState>;
  random: () => number;
}
export type RosterMeleeHitFeedback = (attacker: SimCombatant, victim: SimCombatant) => void;

export function validateScriptedMeleeFeedback(state: SimState, control: ScriptedMeleeFeedback | undefined, settings: UniversalSettings) {
  if (!control) return;
  if (control.version !== 'scripted-melee-feedback-v1' || state.mode !== 'grifball' ||
    !['live-roster-v2', 'live-mixed-v1'].includes(state.combatExecution ?? '') ||
    !(control.combos instanceof Map) || typeof control.random !== 'function' ||
    !control.knobs || !control.memories || isNeuralNetDifficulty(settings.aiDifficulty) || isNeuralNetDifficulty(state.settings.aiDifficulty))
    throw new Error('Invalid scripted melee feedback owner');
  for (const [id, knobs] of Object.entries(control.knobs)) {
    const actors = state.combatants.filter(c => c.id === id);
    if (actors.length !== 1 || actors[0].controller !== 'ai' || isMixedPlayer(state, actors[0]) ||
      typeof knobs?.difficulty !== 'string' || isNeuralNetDifficulty(knobs.difficulty) ||
      !Number.isFinite(knobs.weaponSwapIQ) || !Number.isFinite(knobs.weaponPrioritization) ||
      knobs.weaponSwapIQ < 0 || knobs.weaponSwapIQ > 100 || knobs.weaponPrioritization < 0 || knobs.weaponPrioritization > 100)
      throw new Error(`Invalid melee feedback authority for ${id}`);
  }
  // Ready animations may still have an AI reload. Never invent target memory.
  for (const actor of state.combatants) if (actor.controller === 'ai' && !isMixedPlayer(state, actor)) {
    if (!Object.hasOwn(control.memories, actor.id)) throw new Error(`Missing melee feedback AI memory for ${actor.id}`);
    const memory = control.memories[actor.id];
    if (!memory || !Number.isFinite(memory.timer ?? 0)) throw new Error(`Invalid melee feedback AI memory for ${actor.id}`);
  }
}

/** Called synchronously after each surviving roster melee hit, before the next
 * victim's damage or later actor's animation. No end-of-frame reconstruction. */
export function createScriptedMeleeFeedback(state: SimState, control: ScriptedMeleeFeedback, settings: UniversalSettings): RosterMeleeHitFeedback {
  return (attacker, victim) => {
    if (!Object.hasOwn(control.knobs, attacker.id) || attacker.weapon === 'ball' || victim.hp <= 0) return;
    const current = control.combos.get(attacker.id) ?? null;
    const next = resolveAIHitCombo({ current, targetId: victim.id, openingWeapon: attacker.weapon,
      botPos: attacker.pos, target: observeSimTacticalWeaponTarget(state, victim, control.memories[victim.id]),
      knobs: control.knobs[attacker.id], settings, random: control.random,
      targetRecovering: attacker.attackKind === 'slash' || attacker.attackKind === 'swipe' ? true : undefined });
    if (next !== current && next) control.combos.set(attacker.id, next);
  };
}
