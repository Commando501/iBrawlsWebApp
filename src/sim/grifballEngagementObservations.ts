import { recordAIEngagementApproachSamples } from '../game/aiEngagementObservations';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import type { AIMatchContext } from '../game/aiMatchContext';
import { getOrCreatePlayerModel } from '../game/aiPlayerModel';
import { retainSimGrifballCombatObservation, type SimGrifballCombatObservation } from './grifballCombatObservation';
import type { SimState } from './simState';

/** Called after preparation and before feint/combo decisions, once per target
 * engagement. Uses retained distance but this turn's physical positions/speeds.
 * The caller supplies match time and observer mode; the engine does not infer
 * either from a fixed-rate tick or fabricate a local-player model. */
export function recordSimGrifballEngagementObservations(state: SimState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, observation: SimGrifballCombatObservation,
  context: { matchContext: AIMatchContext; nowSeconds: number; isObserverMode: boolean }, dt = 1 / 60): boolean {
  if (!Number.isFinite(context.nowSeconds) || context.nowSeconds < 0 || typeof context.isObserverMode !== 'boolean' ||
    !(context.matchContext.playerModels instanceof Map)) throw new Error('Invalid engagement observation owner');
  const retained = retainSimGrifballCombatObservation(state, botId, scriptedBots, observation, dt);
  if (!retained) return false;
  const bot = state.combatants.find(c => c.id === botId)!;
  const locals = state.combatants.filter(c => c.id === state.localPlayerId);
  if (locals.length > 1) throw new Error('Engagement observations require a unique local player');
  const tuning = resolveBehaviorTuning(state.settings);
  recordAIEngagementApproachSamples({ bot,
    localPlayer: context.isObserverMode ? null : locals[0] ?? null,
    targetId: retained.targetId, distanceToTarget: retained.prediction.distanceToTarget,
    arenaRadius: state.map.arenaRadius, mapShape: state.map.mapShape, nowSeconds: context.nowSeconds,
    maxSpeed: (state.settings.speedForward / 100) * 5,
    record: (id, observe) => observe(getOrCreatePlayerModel(context.matchContext, id, {
      emaAlpha: tuning.playerModelEmaAlpha, defaultLungeDistance: tuning.defaultLungeDistance,
      defaultReactionTime: tuning.defaultReactionTime,
    })),
  });
  return true;
}
