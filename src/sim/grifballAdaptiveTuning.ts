import { resolveAICombatTuningPreludeForCombatant } from '../components/grifball/aiCombatTuningPreludeRuntime';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import type { AIMatchContext } from '../game/aiMatchContext';
import type { AIPersonalityFlags } from '../game/aiPersonalities';
import type { AIResolvedKnobs, DerivedAIParams, AIMatchScoreContext } from '../game/aiTuning';
import { isNeuralNetDifficulty } from '../game/neuralBrains';
import type { SimState } from './simState';
import type { LungeAIMemory } from './scriptedLungeFeedback';

export interface SimAdaptiveTuningOwner {
  /** The same context used by model, calibration, combo and combat feedback. */
  matchContext: AIMatchContext;
  memory: Pick<LungeAIMemory, 'postLungeDecisionTimer'>;
  knobs: AIResolvedKnobs;
  derived: DerivedAIParams;
  flags: AIPersonalityFlags;
  /** Supplied in the live score convention; do not infer from roster order. */
  score: AIMatchScoreContext;
}

/** Call once per active scripted actor turn, before objective/target selection.
 * Advances the caller's psychological and post-lunge clocks, even when no
 * target is selected. Does not spend movement, state, feint or coordinator
 * clocks. Persist this caller-owned context and memory alongside simulation.
 * Returned psychState aliases that context so later preparation/kill feedback
 * sees the same state. Simulation and player/neural defaults are untouched. */
export function resolveSimGrifballAdaptiveTuning(state: SimState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, owner: SimAdaptiveTuningOwner, dt = 1 / 60) {
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('Adaptive tuning requires a positive finite timestep');
  if (state.mode !== 'grifball' || !['live-roster-v2', 'live-mixed-v1'].includes(state.combatExecution ?? ''))
    throw new Error('Adaptive tuning requires explicit live Grifball execution');
  const actors = state.combatants.filter(c => c.id === botId), actor = actors[0];
  if (actors.length !== 1 || actor.controller !== 'ai' || actor.id === state.localPlayerId ||
    !Object.hasOwn(scriptedBots, botId) || typeof scriptedBots[botId] !== 'string' ||
    isNeuralNetDifficulty(scriptedBots[botId]) || isNeuralNetDifficulty(state.settings.aiDifficulty) ||
    state.match.phase !== 'playing' || !actor.alive || actor.hp <= 0 || actor.respawnTimer > 0) return null;
  const { matchContext, memory, knobs, derived, flags, score } = owner;
  if (knobs.difficulty !== scriptedBots[botId] ||
    ![knobs.reactionLatency, knobs.anticipationFactor, knobs.movementComplexity, knobs.weaponSwapIQ,
      knobs.aiPlaystyle, knobs.weaponPrioritization, derived.spatialIQ, derived.feintChance,
      derived.pressureAggression, flags.feintBias, flags.spacingBand, score.scorePlayer, score.scoreEnemy].every(Number.isFinite) ||
    typeof derived.mechanicAware !== 'boolean' || typeof flags.skipPressure !== 'boolean' ||
    score.killsToWin !== undefined && (!Number.isFinite(score.killsToWin) || score.killsToWin <= 0) ||
    memory.postLungeDecisionTimer !== undefined && (!Number.isFinite(memory.postLungeDecisionTimer) || memory.postLungeDecisionTimer < 0) ||
    !(matchContext.psychState instanceof Map) || !(matchContext.skillCalibration instanceof Map))
    throw new Error('Invalid adaptive tuning owner');
  const self = { aiPostLungeDecisionTimer: memory.postLungeDecisionTimer };
  const result = resolveAICombatTuningPreludeForCombatant({
    state: { settings: state.settings, aiMatchContext: matchContext }, self, botId, dt,
    tuning: resolveBehaviorTuning(state.settings), resolveBotKnobs: () => knobs,
    resolveBotDerived: () => derived, resolveBotFlags: () => flags, getMatchScoreContext: () => score,
  });
  if (self.aiPostLungeDecisionTimer !== undefined) memory.postLungeDecisionTimer = self.aiPostLungeDecisionTimer;
  return result;
}
